/** @typedef {Record<string, unknown>} JsonObject */

/**
 * @param {unknown} v
 * @returns {v is JsonObject}
 */
export function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * @param {object} o
 * @param {string} k
 * @returns {boolean}
 */
export function hasOwn(o, k) {
  return Object.prototype.hasOwnProperty.call(o, k);
}

/**
 * @param {unknown} v
 * @returns {string | undefined}
 */
export function asString(v) {
  return typeof v === 'string' ? v : undefined;
}

/**
 * @param {unknown} v
 * @returns {number | undefined}
 */
export function asNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * @param {unknown} v
 * @returns {boolean | undefined}
 */
export function asBool(v) {
  return typeof v === 'boolean' ? v : undefined;
}

/**
 * @param {unknown} v
 * @returns {Array<[string, unknown]>}
 */
export function entries(v) {
  return isObject(v) ? Object.entries(v) : [];
}

/**
 * @template T
 * @param {Record<string, T>} rec
 * @returns {string[]}
 */
export function sortedKeys(rec) {
  return Object.keys(rec).sort();
}

/**
 * @param {Record<string, unknown>} a
 * @param {Record<string, unknown>} b
 * @returns {string[]}
 */
export function unionKeys(a, b) {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
}
