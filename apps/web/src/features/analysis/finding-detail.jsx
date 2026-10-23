import { BookOpen, FileSearch, HelpCircle, Lightbulb, MapPin, ShieldAlert } from 'lucide-react';

import { SeverityBadge } from '@/components/radar/badges';
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
      <MapPin className="size-3" aria-hidden />
      <span>{label}</span>
      {src.jsonPointer && (
        <span className="max-w-56 truncate font-mono text-[11px] text-faint">{src.jsonPointer}</span>
      )}
    </>
  );
  const cls =
    'inline-flex max-w-full items-center gap-1.5 rounded-[4px] border border-line bg-raised px-1.5 py-0.5 text-xs text-fg-soft';
  if (onJump && src.line) {
    return (
      <button
        type="button"
        className={cn(cls, 'hover:border-accent hover:text-fg')}
        onClick={() => onJump(side, src.line)}
        title={`Show ${label} in the compare view`}
      >
        {content}
      </button>
    );
  }
  return <span className={cls}>{content}</span>;
}

/** @param {{ icon: typeof Lightbulb; label: string; children: React.ReactNode; }} props */
function Row({ icon: Icon, label, children }) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[148px_1fr] sm:gap-4">
      <dt className="flex items-center gap-2 text-[13px] text-muted">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

/** @param {{ f: FindingDTO; onJump?: (side: 'baseline' | 'candidate', line: number) => void; ruleHref?: string; }} props */
export function FindingDetail({ f, onJump, ruleHref }) {
  return (
    <article className="space-y-5" aria-label={`${f.title} details`}>
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={f.severity} />
          <span className="text-xs text-muted">Evidence: {f.evidenceLevel.replace('_', ' ')}</span>
          {f.tags.includes('severity-capped') && (
            <span className="text-xs text-review">Severity capped (non-authoritative input)</span>
          )}
        </div>
        <h3 className="text-lg leading-snug font-semibold">{f.title}</h3>
        <p className="font-mono text-[12.5px] break-all text-accent">{f.logicalPath}</p>
      </header>

      <dl className="space-y-4">
        <Row icon={FileSearch} label="What changed">
          <p>{f.explanation}</p>
          {(f.before !== undefined || f.after !== undefined) && (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="rounded-md border border-line bg-code p-2">
                <div className="mb-1 text-xs text-muted">Before</div>
                <code className="block text-[12px] break-all whitespace-pre-wrap text-fg-soft">
                  {valuePreview(f.before, 400)}
                </code>
              </div>
              <div className="rounded-md border border-line bg-code p-2">
                <div className="mb-1 text-xs text-muted">After</div>
                <code className="block text-[12px] break-all whitespace-pre-wrap text-fg-soft">
                  {valuePreview(f.after, 400)}
                </code>
              </div>
            </div>
          )}
        </Row>
        <Row icon={ShieldAlert} label="Why it is risky">
          {f.impact}
        </Row>
        <Row icon={MapPin} label="Evidence">
          <div className="flex flex-wrap gap-2">
            <SourceChip src={f.baselineSource} side="baseline" onJump={onJump} />
            <SourceChip src={f.candidateSource} side="candidate" onJump={onJump} />
            {!f.baselineSource && !f.candidateSource && (
              <span className="text-muted">No source location (format carries none).</span>
            )}
          </div>
        </Row>
        <Row icon={Lightbulb} label="How to fix">
          {f.recommendation}
        </Row>
        <Row icon={BookOpen} label="Rule">
          <span className="font-mono text-[12.5px]">{f.ruleId}</span>
          {ruleHref && (
            <a href={ruleHref} className="ml-2 text-xs text-accent hover:underline">
              Read the rule
            </a>
          )}
          <span className="ml-2 font-mono text-[11px] text-faint">fingerprint {f.fingerprint}</span>
        </Row>
        <Row icon={HelpCircle} label="What is unknown">
          {f.unknowns ?? (
            <span className="text-muted">
              Nothing beyond the contract itself: this is decided from the documents.
            </span>
          )}
        </Row>
      </dl>
    </article>
  );
}
