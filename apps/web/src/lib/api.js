/** @import { ApiErrorBody } from '@jky/shared' */

const BASE = /** @type {string | undefined} */ (import.meta.env.VITE_API_BASE_URL)?.replace(/\/$/, '') ?? '';
export const API = `${BASE}/api/v1`;

export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message
   * @param {unknown} [details]
   * @param {string} [requestId]
   */
  constructor(status, code, message, details, requestId) {
    super(message);
    /** @type {number} */
    this.status = status;
    /** @type {string} */
    this.code = code;
    /** @type {unknown} */
    this.details = details;
    /** @type {string} */
    this.requestId = requestId;
  }
}

/** @type {string | null} */
let csrfToken = null;
/** @type {Promise<string> | null} */
let csrfPromise = null;

/** @param {string | null} t */
export function setCsrfToken(t) {
  csrfToken = t;
}

/** @returns {Promise<string>} */
async function ensureCsrf() {
  if (csrfToken) return csrfToken;
  csrfPromise ??= fetch(`${API}/auth/csrf`, { credentials: 'include' })
    .then((r) => r.json())
    .then(
      /** @param {{ data: { csrfToken: string } }} b */ (b) => {
        csrfToken = b.data.csrfToken;
        return csrfToken;
      },
    )
    .finally(() => {
      csrfPromise = null;
    });
  return csrfPromise;
}

/**
 * @template T
 * @template [M=Record<string, unknown>]
 * @typedef {Object} Envelope
 * @property {T} data
 * @property {M} [meta]
 */

/**
 * @template T
 * @template [M=Record<string, unknown>]
 * @param {string} method
 * @param {string} path
 * @param {unknown} [body]
 * @returns {Promise<Envelope<T, M>>}
 */
async function request(method, path, body, retried = false) {
  const unsafe = method !== 'GET';
  /** @type {Record<string, string>} */
  const headers = {};
  /** @type {BodyInit | undefined} */
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (unsafe) headers['X-CSRF-Token'] = await ensureCsrf();
  /** @type {Response} */
  let res;
  try {
    res = await fetch(`${API}${path}`, { method, headers, body: payload, credentials: 'include' });
  } catch {
    throw new ApiError(
      0,
      'NETWORK',
      'Cannot reach the JKY-Radar API. Check your connection and that the server is running.',
    );
  }
  if (res.status === 204) return { data: /** @type {T} */ (undefined) };
  const text = await res.text();
  /** @type {unknown} */
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (res.ok === false) {
    const err = /** @type {ApiErrorBody | null} */ (json)?.error;
    if (res.status === 403 && err?.code === 'CSRF_FAILED' && !retried) {
      csrfToken = null;
      return request(method, path, body, true);
    }
    throw new ApiError(
      res.status,
      err?.code ?? 'HTTP_ERROR',
      err?.message ?? `Request failed (${res.status})`,
      err?.details,
      err?.requestId,
    );
  }
  return /** @type {Envelope<T, M>} */ (json);
}

export const api = {
  /**
   * @template [T=any]
   * @template [M=Record<string, any>]
   * @param {string} p
   * @returns {Promise<Envelope<T, M>>}
   */
  get: (p) => request('GET', p),
  /**
   * @template [T=any]
   * @param {string} p
   * @param {unknown} [b]
   * @returns {Promise<Envelope<T>>}
   */
  post: (p, b) => request('POST', p, b),
  /**
   * @template [T=any]
   * @param {string} p
   * @param {unknown} [b]
   * @returns {Promise<Envelope<T>>}
   */
  put: (p, b) => request('PUT', p, b),
  /**
   * @template [T=any]
   * @param {string} p
   * @param {unknown} [b]
   * @returns {Promise<Envelope<T>>}
   */
  patch: (p, b) => request('PATCH', p, b),
  /**
   * @template [T=any]
   * @param {string} p
   * @returns {Promise<Envelope<T>>}
   */
  del: (p) => request('DELETE', p),
};

/**
 * Download an export (JSON/MD/PDF) through the authenticated session.
 * @param {string} path
 */
export async function downloadFile(path) {
  const res = await fetch(`${API}${path}`, { credentials: 'include' });
  if (res.ok === false) {
    let msg = `Export failed (${res.status})`;
    try {
      msg = /** @type {ApiErrorBody} */ (await res.json()).error.message;
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
