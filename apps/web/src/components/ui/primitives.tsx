import type { HTMLAttributes, ReactNode } from 'react';
import { AlertTriangle, Inbox, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './button';
import { ApiError } from '@/lib/api';

export function Skeleton({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-raised', className)} aria-hidden {...p} />;
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 text-sm text-muted">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-start gap-3 rounded-[var(--radius-panel)] border border-dashed border-line-strong px-6 py-10',
        className,
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-lg bg-raised text-muted">
        {icon ?? <Inbox className="size-5" />}
      </div>
      <div>
        <h3 className="text-[15px] font-semibold">{title}</h3>
        {body && <p className="mt-1 max-w-prose text-sm text-muted">{body}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({
  error,
  retry,
  className,
}: {
  error: unknown;
  retry?: () => void;
  className?: string;
}) {
  const e = error instanceof ApiError ? error : null;
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-3 rounded-[var(--radius-panel)] border border-breaking/30 bg-breaking/5 p-4',
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-breaking" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {e?.message ?? (error instanceof Error ? error.message : 'Something went wrong.')}
        </p>
        {e?.requestId && (
          <p className="mt-1 text-xs text-muted">
            Request id <code className="text-[11px]">{e.requestId}</code>
          </p>
        )}
      </div>
      {retry && (
        <Button size="sm" variant="secondary" icon={<RefreshCw className="size-3.5" />} onClick={retry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[11px] text-muted">
      {children}
    </kbd>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <h1 className="text-[26px] leading-tight font-semibold">{title}</h1>
        {description && <div className="mt-1.5 max-w-2xl text-sm text-muted">{description}</div>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('panel', className)}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <div>
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {description && <p className="text-xs text-muted">{description}</p>}
        </div>
        {actions}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}
