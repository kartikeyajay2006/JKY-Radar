/**
 * @param {string | undefined | null} iso
 * @returns {string}
 */
export function timeAgo(iso) {
  if (!iso) return '—';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  return new Date(iso).toLocaleDateString();
}

/** @param {string | null} [iso] */
export const dateTime = (iso) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/** @param {string | null} [h] */
export const shortHash = (h, n = 10) => (h ? `${h.slice(0, n)}…` : '—');

/**
 * @param {number} n
 * @returns {string}
 */
export function bytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * @param {unknown} v
 * @returns {string}
 */
export function valuePreview(v, max = 160) {
  if (v === undefined) return '—';
  const s = typeof v === 'string' ? v : JSON.stringify(v, null, 1).replace(/\n\s*/g, ' ');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * @param {number} n
 * @param {string} one
 */
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
