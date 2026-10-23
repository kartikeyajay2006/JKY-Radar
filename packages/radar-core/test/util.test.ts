import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson, getAtPointer, joinPointer, sha256Hex } from '../src/index.js';

describe('utilities', () => {
  it.each(['', 'abc', 'héllo 😀', 'x'.repeat(1000)])('sha256(%#) matches node:crypto', (s) => {
    expect(sha256Hex(s)).toBe(createHash('sha256').update(s).digest('hex'));
  });
  it('canonical JSON sorts keys and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: undefined, c: 3 }] })).toBe('{"a":[2,{"c":3}],"b":1}');
  });
  it('JSON pointers escape ~ and /', () => {
    const p = joinPointer('', 'paths', '/a~b');
    expect(p).toBe('/paths/~1a~0b');
    expect(getAtPointer({ paths: { '/a~b': 1 } }, p)).toBe(1);
  });
});
