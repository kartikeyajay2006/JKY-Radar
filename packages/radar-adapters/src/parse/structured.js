/** @import { Document, Node as YNode } from 'yaml' */
/** @import { SourceRef } from '@jky/radar-core' */
import { isAlias, isMap, isPair, isScalar, isSeq, LineCounter, parseDocument } from 'yaml';

import { joinPointer } from '@jky/radar-core';

/**
 * @typedef {Object} ParseLimits
 * @property {number} maxBytes
 * @property {number} maxDepth
 * @property {number} maxNodes
 * @property {number} maxAliases
 * @property {number} maxKeyLength
 */

/** @type {ParseLimits} */
export const DEFAULT_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  maxDepth: 128,
  maxNodes: 400_000,
  maxAliases: 100,
  maxKeyLength: 2_048,
};

export class StructuredParseError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} [line]
   * @param {number} [column]
   */
  constructor(code, message, line, column) {
    super(message);
    /** @type {string} */
    this.code = code;
    /** @type {number} */
    this.line = line;
    /** @type {number} */
    this.column = column;
    this.name = 'StructuredParseError';
  }
}

/**
 * @typedef {Object} StructuredDocument
 * @property {'json' | 'yaml'} format
 * @property {unknown} value
 * @property {(pointer: string) => SourceRef | undefined} locate
 * @property {number} nodeCount
 */

/**
 * Assign a property without ever touching the prototype chain (defeats "__proto__" pollution).
 * @param {Record<string, unknown>} obj
 * @param {string} key
 * @param {unknown} value
 */
function setOwn(obj, key, value) {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

/**
 * @param {string} text
 * @returns {number}
 */
export function byteLength(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/**
 * @param {string} text
 * @param {ParseLimits} [limits]
 * @returns {StructuredDocument}
 */
export function parseStructured(text, limits = DEFAULT_LIMITS) {
  if (byteLength(text) > limits.maxBytes) {
    throw new StructuredParseError('INPUT_TOO_LARGE', `Document exceeds the ${limits.maxBytes} byte limit.`);
  }
  if (text.includes('\u0000')) {
    throw new StructuredParseError(
      'BINARY_CONTENT',
      'Document contains NUL bytes; binary uploads are not accepted.',
    );
  }
  const trimmed = text.replace(/^\uFEFF/, '').trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('['))
    return parseJsonWithPositions(text.replace(/^\uFEFF/, ''), limits);
  return parseYamlSafe(text.replace(/^\uFEFF/, ''), limits);
}

/* ------------------------------------------------------------------ */
/* Strict JSON parser with positions, depth/node limits, no prototype  */
/* pollution and duplicate-key detection.                              */
/* ------------------------------------------------------------------ */

/**
 * @param {string} text
 * @param {ParseLimits} limits
 * @returns {StructuredDocument}
 */
function parseJsonWithPositions(text, limits) {
  const positions = /** @type {Map<string, number>} */ (new Map());
  let i = 0;
  let nodes = 0;
  /** @type {number[]} */
  const lineStarts = [0];
  for (let k = 0; k < text.length; k++) if (text.charCodeAt(k) === 10) lineStarts.push(k + 1);
  /** @param {number} offset */
  const posOf = (offset) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - lineStarts[lo] + 1 };
  };
  /**
   * @param {string} code
   * @param {string} msg
   * @returns {never}
   */
  const fail = (code, msg, at = i) => {
    const p = posOf(Math.min(at, text.length));
    throw new StructuredParseError(code, `${msg} (line ${p.line}, column ${p.column})`, p.line, p.column);
  };
  const ws = () => {
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) i++;
      else break;
    }
  };
  /** @returns {string} */
  const parseString = () => {
    // assumes text[i] === '"'
    i++;
    let out = '';
    let start = i;
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c === 34) {
        out += text.slice(start, i);
        i++;
        return out;
      }
      if (c === 92) {
        out += text.slice(start, i);
        const e = text[i + 1];
        i += 2;
        switch (e) {
          case '"':
            out += '"';
            break;
          case '\\':
            out += '\\';
            break;
          case '/':
            out += '/';
            break;
          case 'b':
            out += '\b';
            break;
          case 'f':
            out += '\f';
            break;
          case 'n':
            out += '\n';
            break;
          case 'r':
            out += '\r';
            break;
          case 't':
            out += '\t';
            break;
          case 'u': {
            const hex = text.slice(i, i + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('JSON_SYNTAX', 'Invalid unicode escape');
            out += String.fromCharCode(parseInt(hex, 16));
            i += 4;
            break;
          }
          default:
            fail('JSON_SYNTAX', 'Invalid escape sequence', i - 1);
        }
        start = i;
        continue;
      }
      if (c < 32) fail('JSON_SYNTAX', 'Control character in string');
      i++;
    }
    return fail('JSON_SYNTAX', 'Unterminated string');
  };
  /**
   * @param {string} pointer
   * @param {number} depth
   * @returns {unknown}
   */
  const parseValue = (pointer, depth) => {
    if (depth > limits.maxDepth) fail('MAX_DEPTH', `Nesting deeper than ${limits.maxDepth} levels`);
    if (++nodes > limits.maxNodes) fail('MAX_NODES', `More than ${limits.maxNodes} nodes`);
    ws();
    const start = i;
    positions.set(pointer, start);
    const ch = text[i];
    if (ch === '{') {
      i++;
      /** @type {Record<string, unknown>} */
      const obj = {};
      const seen = /** @type {Set<string>} */ (new Set());
      ws();
      if (text[i] === '}') {
        i++;
        return obj;
      }
      for (;;) {
        ws();
        if (text[i] !== '"') fail('JSON_SYNTAX', 'Expected property name');
        const keyAt = i;
        const key = parseString();
        if (key.length > limits.maxKeyLength) fail('KEY_TOO_LONG', 'Property name too long', keyAt);
        if (seen.has(key)) fail('DUPLICATE_KEY', `Duplicate key "${key}"`, keyAt);
        seen.add(key);
        ws();
        if (text[i] !== ':') fail('JSON_SYNTAX', 'Expected ":"');
        i++;
        const childPtr = joinPointer(pointer, key);
        const v = parseValue(childPtr, depth + 1);
        positions.set(childPtr, keyAt);
        setOwn(obj, key, v);
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === '}') {
          i++;
          return obj;
        }
        fail('JSON_SYNTAX', 'Expected "," or "}"');
      }
    }
    if (ch === '[') {
      i++;
      /** @type {unknown[]} */
      const arr = [];
      ws();
      if (text[i] === ']') {
        i++;
        return arr;
      }
      for (;;) {
        arr.push(parseValue(joinPointer(pointer, arr.length), depth + 1));
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === ']') {
          i++;
          return arr;
        }
        fail('JSON_SYNTAX', 'Expected "," or "]"');
      }
    }
    if (ch === '"') return parseString();
    const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i, i + 64));
    if (m && m[0].length > 0) {
      i += m[0].length;
      return Number(m[0]);
    }
    if (text.startsWith('true', i)) {
      i += 4;
      return true;
    }
    if (text.startsWith('false', i)) {
      i += 5;
      return false;
    }
    if (text.startsWith('null', i)) {
      i += 4;
      return null;
    }
    return fail(
      'JSON_SYNTAX',
      i >= text.length ? 'Unexpected end of input' : `Unexpected token "${text[i]}"`,
    );
  };
  const value = parseValue('', 0);
  ws();
  if (i < text.length) fail('JSON_SYNTAX', 'Unexpected trailing content');
  return {
    format: 'json',
    value,
    nodeCount: nodes,
    locate: (pointer) => {
      const off = positions.get(pointer);
      if (off === undefined) return undefined;
      return { jsonPointer: pointer || '/', ...posOf(off) };
    },
  };
}

/* ------------------------------------------------------------------ */
/* YAML: core schema only, no custom tags, bounded aliases/depth/nodes */
/* ------------------------------------------------------------------ */

const ALLOWED_TAGS = new Set([
  'tag:yaml.org,2002:str',
  'tag:yaml.org,2002:int',
  'tag:yaml.org,2002:float',
  'tag:yaml.org,2002:bool',
  'tag:yaml.org,2002:null',
  'tag:yaml.org,2002:map',
  'tag:yaml.org,2002:seq',
]);

/**
 * @param {string} text
 * @param {ParseLimits} limits
 * @returns {StructuredDocument}
 */
function parseYamlSafe(text, limits) {
  const lc = new LineCounter();
  /** @type {Document.Parsed} */
  let doc;
  try {
    doc = parseDocument(text, {
      lineCounter: lc,
      schema: 'core',
      version: '1.2',
      merge: false,
      uniqueKeys: true,
      prettyErrors: false,
      strict: true,
      customTags: [],
    });
  } catch (e) {
    throw new StructuredParseError('YAML_SYNTAX', /** @type {Error} */ (e).message);
  }
  if (doc.errors.length > 0) {
    const err = doc.errors[0];
    const p = lc.linePos(err.pos[0]);
    const code = /duplicate|unique/i.test(err.message) ? 'DUPLICATE_KEY' : 'YAML_SYNTAX';
    throw new StructuredParseError(
      code,
      `${err.message.split('\n')[0]} (line ${p.line}, column ${p.col})`,
      p.line,
      p.col,
    );
  }
  const tagWarning = doc.warnings.find((w) => /tag/i.test(w.message));
  if (tagWarning) {
    const p = lc.linePos(tagWarning.pos[0]);
    throw new StructuredParseError(
      'YAML_CUSTOM_TAG',
      `Custom or unknown YAML tags are not allowed (line ${p.line}).`,
      p.line,
      p.col,
    );
  }

  const positions = /** @type {Map<string, number>} */ (new Map());
  let nodes = 0;
  let aliases = 0;
  /**
   * @param {string} code
   * @param {string} msg
   * @param {number} [offset]
   * @returns {never}
   */
  const fail = (code, msg, offset) => {
    if (offset === undefined) throw new StructuredParseError(code, msg);
    const p = lc.linePos(offset);
    throw new StructuredParseError(code, `${msg} (line ${p.line}, column ${p.col})`, p.line, p.col);
  };

  /**
   * @param {YNode | null | undefined} node
   * @param {string} pointer
   * @param {number} depth
   * @param {Set<YNode>} stack
   * @returns {unknown}
   */
  const convert = (node, pointer, depth, stack) => {
    if (node === null || node === undefined) return null;
    if (depth > limits.maxDepth)
      fail('MAX_DEPTH', `Nesting deeper than ${limits.maxDepth} levels`, node.range?.[0]);
    if (++nodes > limits.maxNodes)
      fail('MAX_NODES', `More than ${limits.maxNodes} nodes (alias expansion included)`, node.range?.[0]);
    if (node.range && !positions.has(pointer)) positions.set(pointer, node.range[0]);
    if (node.tag && !ALLOWED_TAGS.has(node.tag))
      fail('YAML_CUSTOM_TAG', `YAML tag ${node.tag} is not allowed`, node.range?.[0]);

    if (isAlias(node)) {
      if (++aliases > limits.maxAliases)
        fail('MAX_ALIASES', `More than ${limits.maxAliases} alias expansions`, node.range?.[0]);
      const target = node.resolve(doc);
      if (!target) return fail('YAML_SYNTAX', `Unresolved alias *${node.source}`, node.range?.[0]);
      if (stack.has(target)) return fail('YAML_RECURSIVE_ALIAS', 'Recursive YAML alias', node.range?.[0]);
      return convert(target, pointer, depth, stack);
    }
    if (isScalar(node)) {
      const v = node.value;
      if (typeof v === 'bigint') return Number(v);
      if (v instanceof Date) return v.toISOString();
      return v;
    }
    stack.add(node);
    try {
      if (isMap(node)) {
        /** @type {Record<string, unknown>} */
        const obj = {};
        for (const item of node.items) {
          if (!isPair(item)) continue;
          const keyNode = /** @type {YNode | null} */ (item.key);
          if (keyNode && !isScalar(keyNode))
            fail(
              'YAML_COMPLEX_KEY',
              'Complex (non-scalar) mapping keys are not supported',
              keyNode.range?.[0],
            );
          const key = keyNode && isScalar(keyNode) ? String(keyNode.value) : 'null';
          if (key.length > limits.maxKeyLength)
            fail('KEY_TOO_LONG', 'Mapping key too long', keyNode?.range?.[0]);
          if (key === '<<')
            fail('YAML_MERGE_KEY', 'YAML merge keys (<<) are not supported', keyNode?.range?.[0]);
          const childPtr = joinPointer(pointer, key);
          if (keyNode?.range) positions.set(childPtr, keyNode.range[0]);
          setOwn(obj, key, convert(/** @type {YNode | null} */ (item.value), childPtr, depth + 1, stack));
        }
        return obj;
      }
      if (isSeq(node)) {
        return node.items.map((it, idx) =>
          convert(/** @type {YNode} */ (it), joinPointer(pointer, idx), depth + 1, stack),
        );
      }
    } finally {
      stack.delete(node);
    }
    return null;
  };

  const value = convert(/** @type {YNode | null} */ (doc.contents), '', 0, new Set());
  return {
    format: 'yaml',
    value,
    nodeCount: nodes,
    locate: (pointer) => {
      const off = positions.get(pointer);
      if (off === undefined) return undefined;
      const p = lc.linePos(off);
      return { jsonPointer: pointer || '/', line: p.line, column: p.col };
    },
  };
}

/**
 * Locator that walks up to the nearest ancestor with a known position.
 * @param {(p: string) => SourceRef | undefined} locate
 */
export function nearestLocator(locate) {
  return /** @param {string} pointer @returns {SourceRef | undefined} */ (pointer) => {
    let p = pointer;
    for (;;) {
      const hit = locate(p);
      if (hit) return { ...hit, jsonPointer: pointer || '/' };
      if (p === '') return undefined;
      p = p.slice(0, p.lastIndexOf('/'));
    }
  };
}
