import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
/** @param {string | Buffer} s */
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
/**
 * @param {string} secret
 * @param {string} s
 */
export const hmac = (secret, s) => createHmac('sha256', secret).update(s).digest('hex');

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
