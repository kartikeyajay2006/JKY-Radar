/**
 * Deterministic JSON serialisation: object keys sorted, undefined dropped, cycles marked.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  const seen = /** @type {WeakSet<object>} */ (new WeakSet());
  /**
   * @param {unknown} v
   * @returns {string}
   */
  const walk = (v) => {
    if (v === null || typeof v !== 'object') {
      if (v === undefined) return 'null';
      if (typeof v === 'number' && !Number.isFinite(v)) return 'null';
      if (typeof v === 'bigint') return JSON.stringify(v.toString());
      return JSON.stringify(v);
    }
    if (seen.has(v)) return '"[Circular]"';
    seen.add(v);
    /** @type {string} */
    let out;
    if (Array.isArray(v)) {
      out = `[${v.map(walk).join(',')}]`;
    } else if (v instanceof Set) {
      out = `[${[...v].map(walk).sort().join(',')}]`;
    } else if (v instanceof Map) {
      out = walk(Object.fromEntries([...v.entries()].map(([k, val]) => [String(k), val])));
    } else {
      const keys = Object.keys(v).sort();
      /** @type {string[]} */
      const parts = [];
      for (const k of keys) {
        const val = /** @type {Record<string, unknown>} */ (v)[k];
        if (val === undefined) continue;
        parts.push(`${JSON.stringify(k)}:${walk(val)}`);
      }
      out = `{${parts.join(',')}}`;
    }
    seen.delete(v);
    return out;
  };
  return walk(value);
}

/**
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function stableEquals(a, b) {
  return canonicalJson(a) === canonicalJson(b);
}

/**
 * Short human-friendly rendering of a value for explanations.
 * @param {unknown} value
 * @returns {string}
 */
export function preview(value, max = 80) {
  if (value === undefined) return '(absent)';
  const s = typeof value === 'string' ? JSON.stringify(value) : canonicalJson(value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
