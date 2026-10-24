/** @import { FormEvent, ReactNode } from 'react' */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams, Navigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { Check, Eye, EyeOff, GitCompareArrows, Lock, Mail, ShieldCheck, User, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { MiniRadar } from '@/components/radar/mini-radar';

/** @param {string | null} n */
function safeNext(n) {
  return n && n.startsWith('/') && !n.startsWith('//') ? n : '/app';
}

/**
 * @param {unknown} e
 * @returns {Record<string, string>}
 */
function fieldErrors(e) {
  if (!(e instanceof ApiError) || !Array.isArray(e.details)) return {};
  return Object.fromEntries(
    /** @type {Array<{ path: string; message: string }>} */ (e.details).map((d) => [d.path, d.message]),
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** The same rules the server enforces, shown live while typing. */
const PASSWORD_RULES = [
  { id: 'len', label: 'At least 10 characters', test: (/** @type {string} */ p) => p.length >= 10 },
  { id: 'letter', label: 'A letter', test: (/** @type {string} */ p) => /[A-Za-z]/.test(p) },
  { id: 'number', label: 'A number', test: (/** @type {string} */ p) => /\d/.test(p) },
];

/* ------------------------------------------------------------------ showcase panel */

/** Three real findings from the bundled fixtures, cycled in the showcase card. */
const SHOWCASE = [
  {
    severity: 'Breaking',
    tone: 'text-breaking',
    dot: 'bg-breaking',
    title: 'Guaranteed response property removed',
    path: 'GET /customers/{customerId} › response 200 › body.email',
    rule: 'RES_PROPERTY_REMOVED',
  },
  {
    severity: 'Breaking',
    tone: 'text-breaking',
    dot: 'bg-breaking',
    title: 'New required request property',
    path: 'POST /payments › request body › body.currency',
    rule: 'REQ_PROPERTY_REQUIRED_ADDED',
  },
  {
    severity: 'Potentially breaking',
    tone: 'text-potential',
    dot: 'bg-potential',
    title: 'Response enum value added',
    path: 'GET /orders › response 200 › body.items[].status',
    rule: 'RES_ENUM_VALUE_ADDED',
  },
];
function Showcase() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setI((n) => (n + 1) % SHOWCASE.length), 3800);
    return () => clearInterval(t);
  }, []);
  const f = SHOWCASE[i];
  return (
    <div className="relative hidden overflow-hidden border-l border-line bg-sunken/40 lg:flex lg:flex-col lg:justify-center">
      <div
        className="hairline-grid pointer-events-none absolute inset-0 opacity-30 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]"
        aria-hidden
      />
      <div className="radar-glow pointer-events-none absolute top-1/2 left-1/2 size-[40rem] -translate-x-1/2 -translate-y-1/2" />
      <div className="relative mx-auto w-full max-w-md px-10 py-12">
        <MiniRadar />

        <div className="panel relative mt-8 h-[92px] overflow-hidden shadow-[var(--shadow)]">
          <div key={i} className="auth-card-in absolute inset-0 px-4 py-3">
            <p className="flex items-center gap-2 text-xs">
              <span className={cn('size-2 rounded-full', f.dot)} />
              <span className={f.tone}>{f.severity}</span>
              <span className="ml-auto font-mono text-[11px] text-muted">{f.rule}</span>
            </p>
            <p className="mt-1 truncate text-[15px] font-medium">{f.title}</p>
            <p className="truncate font-mono text-[11.5px] text-muted">{f.path}</p>
          </div>
        </div>
        <div className="mt-3 flex justify-center gap-1.5" aria-hidden>
          {SHOWCASE.map((_, n) => (
            <span
              key={n}
              className={cn(
                'h-1 rounded-full transition-all duration-500',
                n === i ? 'w-6 bg-accent' : 'w-1.5 bg-line-strong',
              )}
            />
          ))}
        </div>

        <ul className="mt-10 space-y-4 text-sm">
          {[
            [GitCompareArrows, 'Every finding points at the exact line in both versions.'],
            [Users, 'See which registered apps and teams each change affects.'],
            [ShieldCheck, 'A release gate your CI can enforce, with audited overrides.'],
          ].map(([Icon, text], n) => {
            const I = /** @type {import('lucide-react').LucideIcon} */ (Icon);
            return (
              <li key={n} className="flex gap-3 text-fg-soft">
                <span className="grid size-7 shrink-0 place-items-center rounded-md border border-line bg-surface text-accent">
                  <I className="size-3.5" />
                </span>
                <span className="pt-1">{/** @type {string} */ (text)}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ form pieces */

/** @param {{ title: string; subtitle: string; children: ReactNode; footer: ReactNode }} props */
function AuthFrame({ title, subtitle, children, footer }) {
  return (
    <div className="grid min-h-[calc(100vh-3.5rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="auth-stagger w-full max-w-[25rem]">
          <h1 className="display text-[32px] leading-tight font-semibold">{title}</h1>
          <p className="mt-2 text-[15px] text-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
          <p className="mt-8 text-sm text-muted">{footer}</p>
        </div>
      </div>
      <Showcase />
    </div>
  );
}

/**
 * @param {{ label: string; icon: ReactNode; error?: string; hint?: ReactNode; trailing?: ReactNode; inputProps: import('react').InputHTMLAttributes<HTMLInputElement> }} props
 */
function AuthField({ label, icon, error, hint, trailing, inputProps }) {
  const id = `auth-${label.toLowerCase().replace(/\s+/g, '-')}`;
  const descId = error || hint ? `${id}-desc` : undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-fg-soft">
        {label}
      </label>
      <div className="group relative">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint transition-colors group-focus-within:text-accent [&_svg]:size-4">
          {icon}
        </span>
        <input
          id={id}
          aria-invalid={!!error}
          aria-describedby={descId}
          className={cn(
            'h-11 w-full rounded-lg border border-line bg-surface pr-3 pl-10 text-[15px] text-fg shadow-[0_1px_0_rgba(0,0,0,0.02)] transition-[border-color,box-shadow] duration-200 placeholder:text-faint hover:border-line-strong focus:border-accent focus:ring-4 focus:ring-accent/15 focus:outline-none',
            error && 'border-breaking focus:border-breaking focus:ring-breaking/15',
            trailing && 'pr-11',
          )}
          {...inputProps}
        />
        {trailing && <span className="absolute top-1/2 right-1.5 -translate-y-1/2">{trailing}</span>}
      </div>
      {(error || hint) && (
        <div id={descId} className={cn('mt-1.5 text-xs', error ? 'auth-shake text-breaking' : 'text-muted')}>
          {error ?? hint}
        </div>
      )}
    </div>
  );
}

/** @param {{ shown: boolean; onToggle: () => void }} props */
function RevealButton({ shown, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={shown}
      aria-label={shown ? 'Hide characters' : 'Reveal characters'}
      className="grid size-8 place-items-center rounded-md text-muted transition-colors hover:bg-raised hover:text-fg"
    >
      {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
    </button>
  );
}

/** @param {{ value: string }} props */
function PasswordChecklist({ value }) {
  const passed = PASSWORD_RULES.filter((r) => r.test(value)).length;
  return (
    <div className="mt-2.5">
      <div className="flex gap-1" aria-hidden>
        {PASSWORD_RULES.map((r, n) => (
          <span key={r.id} className="h-1 flex-1 overflow-hidden rounded-full bg-line">
            <span
              className={cn(
                'block h-full origin-left rounded-full transition-transform duration-500 ease-out',
                passed === 3 ? 'bg-safe' : passed === 2 ? 'bg-potential' : 'bg-breaking',
              )}
              style={{ transform: `scaleX(${n < passed ? 1 : 0})` }}
            />
          </span>
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {PASSWORD_RULES.map((r) => {
          const ok = r.test(value);
          return (
            <li
              key={r.id}
              className={cn('flex items-center gap-1.5 transition-colors', ok ? 'text-safe' : 'text-muted')}
            >
              <span
                className={cn(
                  'grid size-3.5 place-items-center rounded-full border transition-all duration-300',
                  ok ? 'scale-100 border-safe bg-safe text-surface' : 'scale-90 border-line-strong',
                )}
              >
                {ok && <Check className="size-2.5" strokeWidth={3} />}
              </span>
              {r.label}
              <span className="sr-only">{ok ? ' (done)' : ' (missing)'}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DemoLink() {
  return (
    <>
      <div className="my-6 flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>
      <Link to="/demo" className="block">
        <Button variant="secondary" size="lg" className="w-full justify-center">
          Explore the public demo first
        </Button>
      </Link>
    </>
  );
}

/* ------------------------------------------------------------------ pages */

export function LoginPage() {
  const { user, signIn } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [touched, setTouched] = useState(/** @type {Record<string, boolean>} */ ({}));
  const m = useMutation({
    mutationFn: async () => (await api.post('/auth/login', { email, password })).data,
    onSuccess: (s) => {
      signIn(s);
      navigate(safeNext(params.get('next')), { replace: true });
    },
  });
  if (user) return <Navigate to={safeNext(params.get('next'))} replace />;
  const local = {
    email: touched.email && !EMAIL_RE.test(email.trim()) ? 'Enter the email you signed up with.' : undefined,
    password: touched.password && !password ? 'Enter your password.' : undefined,
  };
  /** @param {FormEvent} e */
  const submit = (e) => {
    e.preventDefault();
    setTouched({ email: true, password: true });
    if (!EMAIL_RE.test(email.trim()) || !password) return;
    m.mutate();
  };
  return (
    <AuthFrame
      title="Welcome back"
      subtitle="Sign in to open your workspaces, analyses and release reviews."
      footer={
        <>
          New to JKY-Radar?{' '}
          <Link className="font-medium text-accent underline-offset-4 hover:underline" to="/register">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5" noValidate>
        <AuthField
          label="Email"
          icon={<Mail />}
          error={local.email}
          inputProps={{
            type: 'email',
            autoComplete: 'email',
            placeholder: 'you@company.com',
            value: email,
            onChange: (e) => setEmail(e.target.value),
            onBlur: () => setTouched((t) => ({ ...t, email: true })),
          }}
        />
        <AuthField
          label="Password"
          icon={<Lock />}
          error={local.password}
          trailing={<RevealButton shown={shown} onToggle={() => setShown((s) => !s)} />}
          inputProps={{
            type: shown ? 'text' : 'password',
            autoComplete: 'current-password',
            value: password,
            onChange: (e) => setPassword(e.target.value),
            onBlur: () => setTouched((t) => ({ ...t, password: true })),
          }}
        />
        {m.error && (
          <p
            role="alert"
            className="auth-shake rounded-lg border border-breaking/30 bg-breaking/10 px-3 py-2 text-sm text-breaking"
          >
            {/** @type {Error} */ (m.error).message}
          </p>
        )}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full justify-center"
          loading={m.isPending}
        >
          {m.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <DemoLink />
      <p className="mt-6 text-xs leading-relaxed text-muted">
        Password recovery by email is not offered in this deployment. If you are locked out, ask a workspace
        admin to invite a new account.
      </p>
    </AuthFrame>
  );
}

export function RegisterPage() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [touched, setTouched] = useState(/** @type {Record<string, boolean>} */ ({}));
  const m = useMutation({
    mutationFn: async () => (await api.post('/auth/register', { name, email, password })).data,
    onSuccess: (s) => {
      signIn(s);
      navigate('/app', { replace: true });
    },
  });
  if (user) return <Navigate to="/app" replace />;
  const server = fieldErrors(m.error);
  const passwordOk = PASSWORD_RULES.every((r) => r.test(password));
  const local = {
    name: touched.name && !name.trim() ? 'Tell us what to call you.' : undefined,
    email: touched.email && !EMAIL_RE.test(email.trim()) ? 'Enter a valid email address.' : undefined,
    password: touched.password && !passwordOk ? 'Meet all three rules below.' : undefined,
  };
  /** @param {FormEvent} e */
  const submit = (e) => {
    e.preventDefault();
    setTouched({ name: true, email: true, password: true });
    if (!name.trim() || !EMAIL_RE.test(email.trim()) || !passwordOk) return;
    m.mutate();
  };
  return (
    <AuthFrame
      title="Create your workspace"
      subtitle="A private workspace is created for you. Invite your team whenever you are ready."
      footer={
        <>
          Already have an account?{' '}
          <Link className="font-medium text-accent underline-offset-4 hover:underline" to="/login">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5" noValidate>
        <AuthField
          label="Your name"
          icon={<User />}
          error={local.name ?? server.name}
          inputProps={{
            autoComplete: 'name',
            placeholder: 'Ada Lovelace',
            value: name,
            onChange: (e) => setName(e.target.value),
            onBlur: () => setTouched((t) => ({ ...t, name: true })),
          }}
        />
        <AuthField
          label="Work email"
          icon={<Mail />}
          error={local.email ?? server.email}
          inputProps={{
            type: 'email',
            autoComplete: 'email',
            placeholder: 'you@company.com',
            value: email,
            onChange: (e) => setEmail(e.target.value),
            onBlur: () => setTouched((t) => ({ ...t, email: true })),
          }}
        />
        <div>
          <AuthField
            label="Password"
            icon={<Lock />}
            error={local.password ?? server.password}
            trailing={<RevealButton shown={shown} onToggle={() => setShown((s) => !s)} />}
            inputProps={{
              type: shown ? 'text' : 'password',
              autoComplete: 'new-password',
              value: password,
              onChange: (e) => setPassword(e.target.value),
              onBlur: () => setTouched((t) => ({ ...t, password: true })),
            }}
          />
          <PasswordChecklist value={password} />
        </div>
        {m.error && !Object.keys(server).length && (
          <p
            role="alert"
            className="auth-shake rounded-lg border border-breaking/30 bg-breaking/10 px-3 py-2 text-sm text-breaking"
          >
            {/** @type {Error} */ (m.error).message}
          </p>
        )}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full justify-center"
          loading={m.isPending}
        >
          {m.isPending ? 'Creating your workspace…' : 'Create account'}
        </Button>
        <p className="text-center text-xs text-muted">
          Free to use. No card, no API keys, nothing sent to third parties.
        </p>
      </form>
    </AuthFrame>
  );
}
