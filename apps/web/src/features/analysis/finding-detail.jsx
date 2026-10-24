import { useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  HelpCircle,
  Lightbulb,
  MapPin,
  ShieldAlert,
} from 'lucide-react';

import { SeverityBadge, SEV_BG } from '@/components/radar/badges';
import { valuePreview } from '@/lib/format';
import { cn } from '@/lib/cn';

/** @import { FindingDTO } from '@jky/shared' */
/** @import { SourceRef } from '@jky/radar-core' */

/** @param {{ src?: SourceRef; side: 'baseline' | 'candidate'; onJump?: (side: 'baseline' | 'candidate', line: number) => void; }} props */
export function SourceChip({ src, side, onJump }) {
  if (!src) return null;
  const label = `${side}${src.line ? ` line ${src.line}` : ''}`;
  const content = (
    <>
      <MapPin className="size-3 shrink-0" aria-hidden />
      <span className="whitespace-nowrap">{label}</span>
      {src.jsonPointer && (
        <span className="max-w-56 truncate font-mono text-[11px] text-faint">{src.jsonPointer}</span>
      )}
      {onJump && src.line && <ArrowRight className="size-3 shrink-0 text-faint" aria-hidden />}
    </>
  );
  const cls =
    'inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-raised px-2 py-1 text-xs text-fg-soft transition-colors';
  if (onJump && src.line) {
    return (
      <button
        type="button"
        className={cn(cls, 'hover:border-accent hover:bg-accent-soft hover:text-fg')}
        onClick={() => onJump(side, src.line)}
        title={`Show ${label} in the compare view`}
      >
        {content}
      </button>
    );
  }
  return <span className={cls}>{content}</span>;
}

/** @param {{ text: string }} props */
function CopyPath({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard?.writeText(text).catch(() => undefined);
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
      className="grid size-7 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-raised hover:text-fg"
      aria-label={done ? 'Path copied' : 'Copy path'}
      title="Copy path"
    >
      {done ? <Check className="size-3.5 text-safe" /> : <Copy className="size-3.5" />}
    </button>
  );
}

/** @param {{ icon: typeof Lightbulb; label: string; children: React.ReactNode; className?: string }} props */
function Section({ icon: Icon, label, children, className }) {
  return (
    <section className={className}>
      <h4 className="mb-2 flex items-center gap-2 text-[12px] font-medium tracking-wide text-muted">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </h4>
      <div className="text-sm leading-relaxed text-fg-soft">{children}</div>
    </section>
  );
}

/**
 * @typedef {{ index: number; total: number; prev?: () => void; next?: () => void }} FindingNav
 */

/** @param {{ f: FindingDTO; onJump?: (side: 'baseline' | 'candidate', line: number) => void; ruleHref?: string; nav?: FindingNav }} props */
export function FindingDetail({ f, onJump, ruleHref, nav }) {
  const hasDiff = f.before !== undefined || f.after !== undefined;
  return (
    <article key={f.id} className="page-in" aria-label={`${f.title} details`}>
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={f.severity} />
          <span className="text-xs text-muted">Evidence: {f.evidenceLevel.replace('_', ' ')}</span>
          {f.tags.includes('severity-capped') && (
            <span className="text-xs text-review">Severity capped (non-authoritative input)</span>
          )}
          {nav && (
            <div className="ml-auto flex items-center gap-1">
              <span className="tabular mr-1 text-xs text-muted">
                {nav.index + 1} of {nav.total}
              </span>
              <button
                type="button"
                onClick={nav.prev}
                disabled={!nav.prev}
                aria-label="Previous finding"
                className="grid size-7 place-items-center rounded-md border border-line text-fg-soft transition-colors hover:border-line-strong hover:text-fg disabled:opacity-40"
              >
                <ChevronUp className="size-4" />
              </button>
              <button
                type="button"
                onClick={nav.next}
                disabled={!nav.next}
                aria-label="Next finding"
                className="grid size-7 place-items-center rounded-md border border-line text-fg-soft transition-colors hover:border-line-strong hover:text-fg disabled:opacity-40"
              >
                <ChevronDown className="size-4" />
              </button>
            </div>
          )}
        </div>
        <h3 className="mt-3 text-xl leading-snug font-semibold tracking-[-0.01em]">{f.title}</h3>
        <div className="mt-2 flex items-center gap-1 rounded-md border border-line bg-code py-1 pr-1 pl-3">
          <p className="min-w-0 flex-1 font-mono text-[12.5px] break-all text-accent">{f.logicalPath}</p>
          <CopyPath text={f.logicalPath} />
        </div>
      </header>

      <div className="mt-6 space-y-6">
        <Section icon={BookOpen} label="What changed">
          <p className="text-fg">{f.explanation}</p>
          {hasDiff && (
            <div className="mt-3 grid grid-cols-1 items-stretch gap-2 sm:grid-cols-[1fr_auto_1fr]">
              <div className="rounded-md border border-line border-l-2 border-l-breaking bg-[var(--hl-del)] px-3 py-2">
                <div className="mb-1 text-[11px] font-medium text-muted">Before</div>
                <code className="block text-[12.5px] break-all whitespace-pre-wrap text-fg">
                  {valuePreview(f.before, 400)}
                </code>
              </div>
              <ArrowRight className="hidden size-4 self-center text-faint sm:block" aria-hidden />
              <div className="rounded-md border border-line border-l-2 border-l-safe bg-[var(--hl-add)] px-3 py-2">
                <div className="mb-1 text-[11px] font-medium text-muted">After</div>
                <code className="block text-[12.5px] break-all whitespace-pre-wrap text-fg">
                  {valuePreview(f.after, 400)}
                </code>
              </div>
            </div>
          )}
        </Section>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <div className="rounded-lg border border-line bg-raised/40 p-4">
            <Section icon={ShieldAlert} label="Why it is risky">
              {f.impact}
            </Section>
          </div>
          <div className="rounded-lg border border-accent/25 bg-accent-soft p-4">
            <Section icon={Lightbulb} label="How to fix">
              <span className="text-fg">{f.recommendation}</span>
            </Section>
          </div>
        </div>

        <Section icon={MapPin} label="Evidence">
          <div className="flex flex-wrap gap-2">
            <SourceChip src={f.baselineSource} side="baseline" onJump={onJump} />
            <SourceChip src={f.candidateSource} side="candidate" onJump={onJump} />
            {!f.baselineSource && !f.candidateSource && (
              <span className="text-muted">No source location (format carries none).</span>
            )}
          </div>
        </Section>

        <Section icon={HelpCircle} label="What is unknown">
          {f.unknowns ?? (
            <span className="text-muted">
              Nothing beyond the contract itself: this is decided from the documents.
            </span>
          )}
        </Section>

        <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-4 text-xs">
          <span className={cn('size-2 rounded-full', SEV_BG[f.severity])} aria-hidden />
          <span className="font-mono text-fg-soft">{f.ruleId}</span>
          {ruleHref && (
            <a href={ruleHref} className="font-medium text-accent hover:underline">
              Read the rule
            </a>
          )}
          <span className="ml-auto font-mono text-[11px] text-faint">fingerprint {f.fingerprint}</span>
        </footer>
      </div>
    </article>
  );
}
