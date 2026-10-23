import { isAlias, isMap, isPair, isScalar, isSeq, parseDocument, type Node as YNode } from 'yaml';

/** Key names whose string values are treated as secrets. */
const SECRET_KEY =
  /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|id[-_]?token|token|secret|client[-_]?secret|password|passwd|pwd|private[-_]?key|bearer|session[-_]?id|auth[-_]?token|x-auth-token)$/i;

/** Value patterns that look like credentials regardless of key. */
const SECRET_VALUE: RegExp[] = [
  /^\s*(?:Bearer|Basic|Token|Digest)\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, // JWT
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}/, // Stripe-style
  /\bgh[pousr]_[A-Za-z0-9]{20,}/, // GitHub tokens
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/, // Slack
  /\bAIza[0-9A-Za-z_-]{30,}/, // Google API key
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

export const REDACTED = '[REDACTED]';

export interface RedactionResult {
  content: string;
  redactions: Array<{ line: number; reason: string }>;
}

function looksSecret(value: string): boolean {
  return SECRET_VALUE.some((r) => r.test(value));
}

function isPlaceholder(value: string): boolean {
  const v = value.trim();
  return (
    v === '' || /^\{\{[^}]+\}\}$/.test(v) || /^<[^>]+>$/.test(v) || v === REDACTED || /^\$\{[^}]+\}$/.test(v)
  );
}

/**
 * Redact secret-looking values in JSON/YAML text while preserving formatting.
 * Applies to: values under secret-named keys; Postman-style {key: "Authorization", value: "..."} pairs;
 * and any scalar matching well-known credential patterns. Placeholders like {{token}} are kept.
 * For other text formats only credential patterns are replaced.
 */
export function redactSecrets(content: string): RedactionResult {
  const trimmed = content.trimStart();
  const structured =
    trimmed.startsWith('{') || trimmed.startsWith('[') || /^[\w"'-]+\s*:/m.test(trimmed.split('\n')[0] ?? '');
  const lineOf = (offset: number) => content.slice(0, offset).split('\n').length;
  const replacements: Array<{ start: number; end: number; text: string; reason: string }> = [];

  if (structured) {
    let doc;
    try {
      doc = parseDocument(content, { schema: 'core', uniqueKeys: false, strict: false, merge: false });
    } catch {
      doc = undefined;
    }
    if (doc && doc.errors.length === 0) {
      const quoteFor = (src: string) => (src.startsWith("'") ? "'" : '"');
      const redactScalar = (node: YNode, reason: string) => {
        if (!isScalar(node) || typeof node.value !== 'string' || !node.range) return;
        if (isPlaceholder(node.value)) return;
        const [start, end] = node.range;
        const raw = content.slice(start, end);
        const q = raw.startsWith('"') || raw.startsWith("'") ? quoteFor(raw) : '';
        replacements.push({ start, end, text: `${q}${REDACTED}${q}`, reason });
      };
      const visit = (node: YNode | null | undefined, depth: number): void => {
        if (!node || depth > 200 || isAlias(node)) return;
        if (isMap(node)) {
          const pairs = node.items.filter(isPair);
          const keyEntry = pairs.find(
            (p) => isScalar(p.key) && String((p.key as { value: unknown }).value) === 'key',
          );
          const keyName = keyEntry && isScalar(keyEntry.value) ? String(keyEntry.value.value) : undefined;
          for (const p of pairs) {
            const k = isScalar(p.key) ? String(p.key.value) : '';
            const v = p.value as YNode | null;
            if (v && isScalar(v) && typeof v.value === 'string') {
              if (SECRET_KEY.test(k)) redactScalar(v, `secret-named key "${k}"`);
              else if (k === 'value' && keyName && SECRET_KEY.test(keyName))
                redactScalar(v, `secret-named entry "${keyName}"`);
              else if (looksSecret(v.value)) redactScalar(v, 'credential-like value');
            } else visit(v, depth + 1);
          }
          return;
        }
        if (isSeq(node)) {
          for (const it of node.items) {
            const n = it as YNode;
            if (isScalar(n) && typeof n.value === 'string' && looksSecret(n.value))
              redactScalar(n, 'credential-like value');
            else visit(n, depth + 1);
          }
        }
      };
      visit(doc.contents as YNode | null, 0);
    }
  }

  // Pattern-based pass for anything not already covered (also GraphQL SDL / proto comments).
  for (const re of SECRET_VALUE) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (const m of content.matchAll(g)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (replacements.some((r) => start < r.end && end > r.start)) continue;
      replacements.push({ start, end, text: REDACTED, reason: 'credential-like value' });
    }
  }

  replacements.sort((a, b) => b.start - a.start);
  let out = content;
  for (const r of replacements) out = out.slice(0, r.start) + r.text + out.slice(r.end);
  return {
    content: out,
    redactions: replacements
      .map((r) => ({ line: lineOf(r.start), reason: r.reason }))
      .sort((a, b) => a.line - b.line),
  };
}
