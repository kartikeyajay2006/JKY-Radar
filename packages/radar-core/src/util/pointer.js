/**
 * RFC 6901 JSON Pointer helpers.
 * @param {string | number} token
 * @returns {string}
 */
export function escapePointerToken(token) {
  return String(token).replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * @param {string} token
 * @returns {string}
 */
export function unescapePointerToken(token) {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

/**
 * @param {string} base
 * @param {...string | number} tokens
 * @returns {string}
 */
export function joinPointer(base, ...tokens) {
  return base + tokens.map((t) => `/${escapePointerToken(t)}`).join('');
}

/**
 * @param {string} pointer
 * @returns {string[]}
 */
export function parsePointer(pointer) {
  if (pointer === '' || pointer === '#') return [];
  const p = pointer.startsWith('#') ? decodeURIComponentSafe(pointer.slice(1)) : pointer;
  if (!p.startsWith('/')) throw new Error(`Invalid JSON pointer: ${pointer}`);
  return p.slice(1).split('/').map(unescapePointerToken);
}

/**
 * @param {string} s
 * @returns {string}
 */
function decodeURIComponentSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * @param {object} o
 * @param {string} k
 */
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * Resolve a pointer inside a plain JSON value. Returns undefined if missing.
 * @param {unknown} root
 * @param {string} pointer
 * @returns {unknown}
 */
export function getAtPointer(root, pointer) {
  /** @type {unknown} */
  let cur = root;
  for (const token of parsePointer(pointer)) {
    if (cur === null || typeof cur !== 'object') return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(token);
      if (!Number.isInteger(idx)) return undefined;
      cur = cur[idx];
    } else {
      if (!hasOwn(cur, token)) return undefined;
      cur = /** @type {Record<string, unknown>} */ (cur)[token];
    }
  }
  return cur;
}
