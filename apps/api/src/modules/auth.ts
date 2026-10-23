import { Router, type Request, type Response } from 'express';
import { hash, verify } from '@node-rs/argon2';
import { loginSchema, registerSchema, updateMeSchema, type SessionDTO } from '@jky/shared';
import type { Env } from '../config/env.js';
import { Membership, Session, User, Workspace } from '../models/index.js';
import { asyncHandler, parse, sendData, slugify } from '../lib/http.js';
import { AppError, conflict, unauthenticated } from '../lib/errors.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import {
  cookieOptions,
  CSRF_COOKIE,
  issueAnonymousCsrf,
  requireAuth,
  sessionCsrfToken,
  SESSION_COOKIE,
} from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import type { RequestHandler } from 'express';

// OWASP-recommended argon2id parameters (19 MiB, t=2, p=1).
const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1, algorithm: 2 } as const;
let dummyHash: Promise<string> | null = null;

export async function hashPassword(pw: string) {
  return hash(pw, ARGON);
}

async function createSession(
  env: Env,
  req: Request,
  res: Response,
  user: { _id: unknown; sessionVersion: number },
) {
  // Rotation: destroy any session presented with this request before issuing a new one.
  const old = req.cookies?.[SESSION_COOKIE];
  if (typeof old === 'string') await Session.deleteOne({ tokenHash: sha256(old) });
  const token = randomToken(32);
  const salt = randomToken(16);
  const ttl = env.SESSION_TTL_HOURS * 3600_000;
  const session = await Session.create({
    tokenHash: sha256(token),
    userId: user._id,
    csrfSalt: salt,
    sessionVersion: user.sessionVersion,
    expiresAt: new Date(Date.now() + ttl),
    userAgent: (req.header('user-agent') ?? '').slice(0, 160),
  });
  const csrf = sessionCsrfToken(env, session._id.toString(), salt);
  res.cookie(SESSION_COOKIE, token, cookieOptions(env, true, ttl));
  res.cookie(CSRF_COOKIE, csrf, cookieOptions(env, false, ttl));
  return csrf;
}

function toUserDTO(u: {
  _id: { toString(): string };
  email: string;
  name: string;
  preferences?: { theme?: string | null } | null;
  createdAt: Date;
}): SessionDTO['user'] {
  return {
    id: u._id.toString(),
    email: u.email,
    name: u.name,
    preferences: { theme: (u.preferences?.theme as 'system') ?? 'system' },
    createdAt: new Date(u.createdAt).toISOString(),
  };
}

export function authRouter(env: Env, limiter: RequestHandler) {
  const r = Router();

  r.get(
    '/csrf',
    asyncHandler(async (req, res) => {
      if (req.auth) {
        const s = await Session.findById(req.auth.sessionId).lean();
        if (s) return void sendData(res, { csrfToken: sessionCsrfToken(env, s._id.toString(), s.csrfSalt) });
      }
      sendData(res, { csrfToken: issueAnonymousCsrf(env, res) });
    }),
  );

  r.post(
    '/register',
    limiter,
    asyncHandler(async (req, res) => {
      const input = parse(registerSchema, req.body);
      if (await User.exists({ email: input.email }))
        throw conflict('An account with this email already exists.');
      const user = await User.create({
        email: input.email,
        name: input.name,
        passwordHash: await hashPassword(input.password),
      });
      const base = slugify(`${input.name}-workspace`);
      const workspace = await Workspace.create({
        name: `${input.name.split(' ')[0]}'s workspace`,
        slug: `${base}-${randomToken(4)
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')}`,
        ownerId: user._id,
      });
      await Membership.create({
        workspaceId: workspace._id,
        userId: user._id,
        role: 'OWNER',
        status: 'active',
      });
      const csrfToken = await createSession(env, req, res, user);
      await audit(req, {
        workspaceId: workspace._id,
        actorId: user._id,
        action: 'user.registered',
        resourceType: 'user',
        resourceId: user._id,
      });
      await audit(req, {
        workspaceId: workspace._id,
        actorId: user._id,
        action: 'workspace.created',
        resourceType: 'workspace',
        resourceId: workspace._id,
        metadata: { name: workspace.name },
      });
      sendData(res, { user: toUserDTO(user), csrfToken } satisfies SessionDTO, 201);
    }),
  );

  r.post(
    '/login',
    limiter,
    asyncHandler(async (req, res) => {
      const input = parse(loginSchema, req.body);
      const user = await User.findOne({ email: input.email });
      if (!user || user.isSystem) {
        dummyHash ??= hashPassword('timing-equaliser-password-1');
        await verify(await dummyHash, input.password).catch(() => false);
        throw new AppError(401, 'UNAUTHENTICATED', 'Email or password is incorrect.');
      }
      const ok = await verify(user.passwordHash, input.password).catch(() => false);
      if (!ok) throw new AppError(401, 'UNAUTHENTICATED', 'Email or password is incorrect.');
      user.lastLoginAt = new Date();
      await user.save();
      const csrfToken = await createSession(env, req, res, user);
      sendData(res, { user: toUserDTO(user), csrfToken } satisfies SessionDTO);
    }),
  );

  r.post(
    '/logout',
    asyncHandler(async (req, res) => {
      if (req.auth) await Session.deleteOne({ _id: req.auth.sessionId });
      res.clearCookie(SESSION_COOKIE, cookieOptions(env, true));
      res.clearCookie(CSRF_COOKIE, cookieOptions(env, false));
      res.status(204).end();
    }),
  );

  r.post(
    '/logout-all',
    requireAuth,
    asyncHandler(async (req, res) => {
      await User.updateOne({ _id: req.auth!.userId }, { $inc: { sessionVersion: 1 } });
      await Session.deleteMany({ userId: req.auth!.userId });
      res.clearCookie(SESSION_COOKIE, cookieOptions(env, true));
      res.clearCookie(CSRF_COOKIE, cookieOptions(env, false));
      await audit(req, {
        action: 'user.sessions_revoked',
        resourceType: 'user',
        resourceId: req.auth!.userId,
      });
      res.status(204).end();
    }),
  );

  /** Like /me, but returns null for visitors instead of 401 (keeps public pages quiet). */
  r.get(
    '/session',
    asyncHandler(async (req, res) => {
      if (!req.auth) return void sendData(res, null);
      const [user, session] = await Promise.all([User.findById(req.auth.userId), Session.findById(req.auth.sessionId).lean()]);
      if (!user || !session) return void sendData(res, null);
      sendData(res, { user: toUserDTO(user), csrfToken: sessionCsrfToken(env, session._id.toString(), session.csrfSalt) } satisfies SessionDTO);
    }),
  );

  r.get(
    '/me',
    asyncHandler(async (req, res) => {
      if (!req.auth) throw unauthenticated();
      const [user, session] = await Promise.all([
        User.findById(req.auth.userId),
        Session.findById(req.auth.sessionId).lean(),
      ]);
      if (!user || !session) throw unauthenticated();
      sendData(res, {
        user: toUserDTO(user),
        csrfToken: sessionCsrfToken(env, session._id.toString(), session.csrfSalt),
      } satisfies SessionDTO);
    }),
  );

  r.patch(
    '/me',
    requireAuth,
    asyncHandler(async (req, res) => {
      const input = parse(updateMeSchema, req.body);
      const set: Record<string, unknown> = {};
      if (input.name) set.name = input.name;
      if (input.preferences?.theme) set['preferences.theme'] = input.preferences.theme;
      const user = await User.findByIdAndUpdate(req.auth!.userId, { $set: set }, { new: true });
      if (!user) throw unauthenticated();
      sendData(res, toUserDTO(user));
    }),
  );

  return r;
}
