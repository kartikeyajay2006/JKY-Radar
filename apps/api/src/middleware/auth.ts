import type { NextFunction, Request, Response } from 'express';
import type { Env } from '../config/env.js';
import { Session, User } from '../models/index.js';
import { hmac, randomToken, safeEqual, sha256 } from '../lib/crypto.js';
import { AppError, unauthenticated } from '../lib/errors.js';
import { CSRF_HEADER } from '@jky/shared';

export const SESSION_COOKIE = 'jky_sid';
export const CSRF_COOKIE = 'jky_csrf';

export function cookieOptions(env: Env, httpOnly: boolean, maxAgeMs?: number) {
  return {
    httpOnly,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
  };
}

/** Loads the session (if any) from the opaque cookie. Never trusts client-supplied user ids. */
export function loadSession(env: Env) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.cookies?.[SESSION_COOKIE];
      if (typeof token !== 'string' || token.length < 20 || token.length > 200) return next();
      const session = await Session.findOne({ tokenHash: sha256(token), expiresAt: { $gt: new Date() } });
      if (!session) {
        res.clearCookie(SESSION_COOKIE, cookieOptions(env, true));
        return next();
      }
      const user = await User.findById(session.userId);
      if (!user || user.sessionVersion !== session.sessionVersion || user.isSystem) {
        await Session.deleteOne({ _id: session._id });
        res.clearCookie(SESSION_COOKIE, cookieOptions(env, true));
        return next();
      }
      req.auth = {
        userId: user._id,
        sessionId: session._id,
        user: {
          id: user._id.toString(),
          email: user.email,
          name: user.name,
          preferences: { theme: user.preferences?.theme ?? 'system' },
          createdAt: user.createdAt,
        },
      };
      if (Date.now() - (session.lastSeenAt?.getTime() ?? 0) > 5 * 60_000) {
        await Session.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date() } });
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(unauthenticated());
  next();
}

/** Session-bound CSRF token: recomputable server-side, never stored in plaintext. */
export function sessionCsrfToken(env: Env, sessionId: string, salt: string): string {
  return hmac(env.SESSION_SECRET, `session:${sessionId}:${salt}`);
}

/** Issue an anonymous double-submit CSRF token (cookie + body). */
export function issueAnonymousCsrf(env: Env, res: Response): string {
  const nonce = randomToken(18);
  const token = `${nonce}.${hmac(env.SESSION_SECRET, `anon:${nonce}`).slice(0, 32)}`;
  res.cookie(CSRF_COOKIE, token, cookieOptions(env, false, 2 * 60 * 60 * 1000));
  return token;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for state-changing requests:
 *  1. Origin/Referer, when present, must be an allowed origin.
 *  2. Header token must equal the CSRF cookie (double submit).
 *  3. Authenticated requests: the token must also match the hash bound to the session.
 *  4. Anonymous requests: the token must carry a valid server HMAC.
 */
export function csrfProtection(env: Env, allowed: string[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin =
      req.header('origin') ?? (req.header('referer') ? safeOrigin(req.header('referer')!) : undefined);
    if (origin && !allowed.includes(origin))
      return next(new AppError(403, 'CSRF_FAILED', 'Cross-origin request rejected.'));
    const header = req.header(CSRF_HEADER);
    const cookie = req.cookies?.[CSRF_COOKIE];
    if (typeof header !== 'string' || typeof cookie !== 'string' || !safeEqual(header, cookie)) {
      return next(
        new AppError(403, 'CSRF_FAILED', 'Missing or invalid CSRF token. Reload the page and try again.'),
      );
    }
    if (req.auth) {
      const session = await Session.findById(req.auth.sessionId).select('csrfSalt').lean();
      if (
        !session ||
        !safeEqual(sessionCsrfToken(env, req.auth.sessionId.toString(), session.csrfSalt), header)
      ) {
        return next(new AppError(403, 'CSRF_FAILED', 'CSRF token does not match your session.'));
      }
      return next();
    }
    const [nonce, mac] = header.split('.');
    if (!nonce || !mac || !safeEqual(mac, hmac(env.SESSION_SECRET, `anon:${nonce}`).slice(0, 32))) {
      return next(new AppError(403, 'CSRF_FAILED', 'Invalid CSRF token.'));
    }
    next();
  };
}

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}
