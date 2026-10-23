import {
  CircleCheck,
  CircleHelp,
  Eye,
  Info,
  OctagonX,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  ShieldX,
  TriangleAlert,
} from 'lucide-react';
import type { CoverageLevel, FindingSeverity, GateDecision, Protocol, SupportStatus } from '@jky/radar-core';
import { PROTOCOL_LABEL, SEVERITY_LABEL } from '@jky/radar-core';
import { cn } from '@/lib/cn';

export const SEV_TEXT: Record<FindingSeverity, string> = {
  breaking: 'text-breaking',
  potentially_breaking: 'text-potential',
  needs_review: 'text-review',
  non_breaking: 'text-safe',
  informational: 'text-info',
};
export const SEV_BG: Record<FindingSeverity, string> = {
  breaking: 'bg-breaking',
  potentially_breaking: 'bg-potential',
  needs_review: 'bg-review',
  non_breaking: 'bg-safe',
  informational: 'bg-info',
};
const SEV_ICON = {
  breaking: OctagonX,
  potentially_breaking: TriangleAlert,
  needs_review: Eye,
  non_breaking: CircleCheck,
  informational: Info,
} as const;

export function SeverityIcon({ severity, className }: { severity: FindingSeverity; className?: string }) {
  const Icon = SEV_ICON[severity];
  return <Icon className={cn('size-4 shrink-0', SEV_TEXT[severity], className)} aria-hidden />;
}

export function SeverityBadge({ severity, className }: { severity: FindingSeverity; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[4px] border border-current/25 px-1.5 py-0.5 text-xs font-medium whitespace-nowrap',
        SEV_TEXT[severity],
        className,
      )}
    >
      <SeverityIcon severity={severity} className="size-3.5" />
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

const GATE: Record<
  GateDecision,
  { label: string; text: string; ring: string; bg: string; icon: typeof ShieldCheck; sentence: string }
> = {
  pass: {
    label: 'Pass',
    text: 'text-safe',
    ring: 'border-safe/40',
    bg: 'bg-safe/10',
    icon: ShieldCheck,
    sentence: 'Safe to release under this policy',
  },
  warn: {
    label: 'Warn',
    text: 'text-review',
    ring: 'border-review/40',
    bg: 'bg-review/10',
    icon: ShieldAlert,
    sentence: 'Release possible after review',
  },
  block: {
    label: 'Block',
    text: 'text-breaking',
    ring: 'border-breaking/40',
    bg: 'bg-breaking/10',
    icon: ShieldX,
    sentence: 'Do not release: breaking changes found',
  },
  inconclusive: {
    label: 'Inconclusive',
    text: 'text-inconclusive',
    ring: 'border-inconclusive/40',
    bg: 'bg-inconclusive/10',
    icon: ShieldQuestion,
    sentence: 'Not enough coverage for a reliable verdict',
  },
};
export const gateMeta = (d: GateDecision) => GATE[d];

export function GateBadge({
  decision,
  size = 'sm',
  className,
}: {
  decision: GateDecision | null;
  size?: 'sm' | 'lg';
  className?: string;
}) {
  if (!decision)
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-[4px] border border-line px-1.5 py-0.5 text-xs text-muted',
          className,
        )}
      >
        <CircleHelp className="size-3.5" aria-hidden />
        Pending
      </span>
    );
  const g = GATE[decision];
  const Icon = g.icon;
  if (size === 'lg') {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-3 rounded-[var(--radius-panel)] border px-4 py-3',
          g.ring,
          g.bg,
          className,
        )}
      >
        <Icon className={cn('size-8', g.text)} aria-hidden />
        <div>
          <div className={cn('text-xl leading-none font-semibold tracking-tight', g.text)}>{g.label}</div>
          <div className="mt-1 text-xs text-muted">{g.sentence}</div>
        </div>
      </div>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[4px] border px-1.5 py-0.5 text-xs font-semibold',
        g.text,
        g.ring,
        g.bg,
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {g.label}
    </span>
  );
}

export function ProtocolBadge({
  protocol,
  version,
  className,
}: {
  protocol: Protocol;
  version?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[4px] bg-raised px-1.5 py-0.5 text-xs text-fg-soft',
        className,
      )}
    >
      {PROTOCOL_LABEL[protocol]}
      {version && <span className="text-muted">{version}</span>}
    </span>
  );
}

const SUPPORT: Record<SupportStatus, string> = {
  supported: 'text-safe border-safe/30',
  partial: 'text-review border-review/30',
  experimental: 'text-inconclusive border-inconclusive/30',
  unsupported: 'text-muted border-line-strong',
};
export function SupportBadge({ status }: { status: SupportStatus | string }) {
  return (
    <span
      className={cn(
        'inline-flex rounded-[4px] border px-1.5 py-0.5 text-xs font-medium capitalize',
        SUPPORT[status as SupportStatus] ?? SUPPORT.unsupported,
      )}
    >
      {status}
    </span>
  );
}

export function CoverageBadge({ level }: { level: CoverageLevel | null }) {
  const cls =
    level === 'full'
      ? 'text-safe border-safe/30'
      : level === 'partial'
        ? 'text-review border-review/30'
        : 'text-muted border-line-strong';
  return (
    <span className={cn('inline-flex rounded-[4px] border px-1.5 py-0.5 text-xs', cls)}>
      {level ? `${level} coverage` : 'coverage pending'}
    </span>
  );
}

const ORDER: FindingSeverity[] = [
  'breaking',
  'potentially_breaking',
  'needs_review',
  'non_breaking',
  'informational',
];
export function SeverityBar({
  counts,
  className,
  legend = true,
}: {
  counts: Partial<Record<FindingSeverity, number>> | null;
  className?: string;
  legend?: boolean;
}) {
  const total = ORDER.reduce((n, s) => n + (counts?.[s] ?? 0), 0);
  return (
    <div className={className}>
      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-raised"
        role="img"
        aria-label={ORDER.map((s) => `${counts?.[s] ?? 0} ${SEVERITY_LABEL[s]}`).join(', ')}
      >
        {total > 0 &&
          ORDER.map((s) =>
            counts?.[s] ? (
              <div key={s} className={SEV_BG[s]} style={{ width: `${((counts[s] ?? 0) / total) * 100}%` }} />
            ) : null,
          )}
      </div>
      {legend && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {ORDER.map((s) => (
            <li key={s} className="flex items-center gap-1.5">
              <SeverityIcon severity={s} className="size-3.5" />
              <span className="tabular font-medium text-fg">{counts?.[s] ?? 0}</span> {SEVERITY_LABEL[s]}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const SEVERITY_ORDER = ORDER;
