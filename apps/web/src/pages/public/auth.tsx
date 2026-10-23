import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams, Navigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import type { SessionDTO } from '@jky/shared';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Logo } from '@/components/radar/logo';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

function safeNext(n: string | null) {
  return n && n.startsWith('/') && !n.startsWith('//') ? n : '/app';
}

function AuthFrame({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-md flex-col justify-center px-4 py-12">
      <Logo className="mb-8" />
      <h1 className="text-[28px] leading-tight font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted">{subtitle}</p>
      <div className="mt-8">{children}</div>
      <p className="mt-6 text-sm text-muted">{footer}</p>
    </div>
  );
}

function fieldErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError) || !Array.isArray(e.details)) return {};
  return Object.fromEntries(
    (e.details as Array<{ path: string; message: string }>).map((d) => [d.path, d.message]),
  );
}

export function LoginPage() {
  const { user, signIn } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const m = useMutation({
    mutationFn: async () => (await api.post<SessionDTO>('/auth/login', { email, password })).data,
    onSuccess: (s) => {
      signIn(s);
      navigate(safeNext(params.get('next')), { replace: true });
    },
  });
  if (user) return <Navigate to={safeNext(params.get('next'))} replace />;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  return (
    <AuthFrame
      title="Sign in"
      subtitle="Open your workspaces, analyses and release reviews."
      footer={
        <>
          New to JKY-Radar?{' '}
          <Link className="text-accent underline underline-offset-2" to="/register">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email">
          {(id) => (
            <Input
              id={id}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Field label="Password">
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        {m.error && (
          <p role="alert" className="text-sm text-breaking">
            {(m.error as Error).message}
          </p>
        )}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full justify-center"
          loading={m.isPending}
        >
          Sign in
        </Button>
      </form>
      <p className="mt-4 text-xs text-muted">
        Password recovery by email is not offered in this deployment; ask a workspace admin to invite a new
        account if you are locked out.
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
  const m = useMutation({
    mutationFn: async () => (await api.post<SessionDTO>('/auth/register', { name, email, password })).data,
    onSuccess: (s) => {
      signIn(s);
      navigate('/app', { replace: true });
    },
  });
  if (user) return <Navigate to="/app" replace />;
  const errs = fieldErrors(m.error);
  return (
    <AuthFrame
      title="Create your workspace"
      subtitle="A private workspace is created for you. Invite your team later."
      footer={
        <>
          Already have an account?{' '}
          <Link className="text-accent underline underline-offset-2" to="/login">
            Sign in
          </Link>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
        className="space-y-4"
        noValidate
      >
        <Field label="Your name" error={errs.name}>
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!errs.name}
            />
          )}
        </Field>
        <Field label="Work email" error={errs.email}>
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!errs.email}
            />
          )}
        </Field>
        <Field
          label="Password"
          hint="At least 10 characters with letters and a number."
          error={errs.password}
        >
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!errs.password}
            />
          )}
        </Field>
        {m.error && !Object.keys(errs).length && (
          <p role="alert" className="text-sm text-breaking">
            {(m.error as Error).message}
          </p>
        )}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full justify-center"
          loading={m.isPending}
        >
          Create account
        </Button>
      </form>
    </AuthFrame>
  );
}
