import type { ApiErrorBody } from '@jky/shared';

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
export const API = `${BASE}/api/v1`;

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
    public requestId?: string,
  ) {
    super(message);
  }
}

let csrfToken: string | null = null;
let csrfPromise: Promise<string> | null = null;

export function setCsrfToken(t: string | null) {
  csrfToken = t;
}

async function ensureCsrf(): Promise<string> {
  if (csrfToken) return csrfToken;
  csrfPromise ??= fetch(`${API}/auth/csrf`, { credentials: 'include' })
    .then((r) => r.json())
    .then((b: { data: { csrfToken: string } }) => {
      csrfToken = b.data.csrfToken;
      return csrfToken;
    })
    .finally(() => {
      csrfPromise = null;
    });
  return csrfPromise;
}

export interface Envelope<T, M = Record<string, unknown>> {
  data: T;
  meta?: M;
}

async function request<T, M = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown,
  retried = false,
): Promise<Envelope<T, M>> {
  const unsafe = method !== 'GET';
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (unsafe) headers['X-CSRF-Token'] = await ensureCsrf();
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { method, headers, body: payload, credentials: 'include' });
  } catch {
    throw new ApiError(
      0,
      'NETWORK',
      'Cannot reach the JKY-Radar API. Check your connection and that the server is running.',
    );
  }
  if (res.status === 204) return { data: undefined as T };
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = (json as ApiErrorBody | null)?.error;
    if (res.status === 403 && err?.code === 'CSRF_FAILED' && !retried) {
      csrfToken = null;
      return request<T, M>(method, path, body, true);
    }
    throw new ApiError(
      res.status,
      err?.code ?? 'HTTP_ERROR',
      err?.message ?? `Request failed (${res.status})`,
      err?.details,
      err?.requestId,
    );
  }
  return json as Envelope<T, M>;
}

export const api = {
  get: <T, M = Record<string, unknown>>(p: string) => request<T, M>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b),
  put: <T>(p: string, b?: unknown) => request<T>('PUT', p, b),
  patch: <T>(p: string, b?: unknown) => request<T>('PATCH', p, b),
  del: <T>(p: string) => request<T>('DELETE', p),
};

/** Download an export (JSON/MD/PDF) through the authenticated session. */
export async function downloadFile(path: string) {
  const res = await fetch(`${API}${path}`, { credentials: 'include' });
  if (!res.ok) {
    let msg = `Export failed (${res.status})`;
    try {
      msg = ((await res.json()) as ApiErrorBody).error.message;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, 'EXPORT_FAILED', msg);
  }
  const cd = res.headers.get('content-disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? 'jky-radar-report';
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}
