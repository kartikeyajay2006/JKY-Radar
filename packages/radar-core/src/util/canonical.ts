/** Deterministic JSON serialisation: object keys sorted, undefined dropped, cycles marked. */
export function canonicalJson(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): string => {
    if (v === null || typeof v !== 'object') {
      if (v === undefined) return 'null';
      if (typeof v === 'number' && !Number.isFinite(v)) return 'null';
      if (typeof v === 'bigint') return JSON.stringify(v.toString());
      return JSON.stringify(v);
    }
    if (seen.has(v)) return '"[Circular]"';
    seen.add(v);
    let out: string;
    if (Array.isArray(v)) {
      out = `[${v.map(walk).join(',')}]`;
    } else if (v instanceof Set) {
      out = `[${[...v].map(walk).sort().join(',')}]`;
    } else if (v instanceof Map) {
      out = walk(Object.fromEntries([...v.entries()].map(([k, val]) => [String(k), val])));
    } else {
      const keys = Object.keys(v).sort();
      const parts: string[] = [];
      for (const k of keys) {
        const val = (v as Record<string, unknown>)[k];
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

export function stableEquals(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/** Short human-friendly rendering of a value for explanations. */
export function preview(value: unknown, max = 80): string {
  if (value === undefined) return '(absent)';
  const s = typeof value === 'string' ? JSON.stringify(value) : canonicalJson(value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
