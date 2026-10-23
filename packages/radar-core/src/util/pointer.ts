/** RFC 6901 JSON Pointer helpers. */
export function escapePointerToken(token: string | number): string {
  return String(token).replace(/~/g, '~0').replace(/\//g, '~1');
}

export function unescapePointerToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

export function joinPointer(base: string, ...tokens: Array<string | number>): string {
  return tokens.reduce<string>((acc, t) => `${acc}/${escapePointerToken(t)}`, base);
}

export function parsePointer(pointer: string): string[] {
  if (pointer === '' || pointer === '#') return [];
  const p = pointer.startsWith('#') ? decodeURIComponentSafe(pointer.slice(1)) : pointer;
  if (!p.startsWith('/')) throw new Error(`Invalid JSON pointer: ${pointer}`);
  return p.slice(1).split('/').map(unescapePointerToken);
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Resolve a pointer inside a plain JSON value. Returns undefined if missing. */
export function getAtPointer(root: unknown, pointer: string): unknown {
  let cur: unknown = root;
  for (const token of parsePointer(pointer)) {
    if (cur === null || typeof cur !== 'object') return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(token);
      if (!Number.isInteger(idx)) return undefined;
      cur = cur[idx];
    } else {
      if (!hasOwn(cur, token)) return undefined;
      cur = (cur as Record<string, unknown>)[token];
    }
  }
  return cur;
}
