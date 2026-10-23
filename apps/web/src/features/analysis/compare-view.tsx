import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { FindingDTO } from '@jky/shared';
import { Button } from '@/components/ui/button';
import { ErrorState, Skeleton } from '@/components/ui/primitives';
import { SeverityBadge } from '@/components/radar/badges';
import { useFindings, useSources, type AnalysisScope } from '@/lib/queries';
import type { LineHighlight } from '@/components/radar/code-pane';
import { cn } from '@/lib/cn';

const CodePane = lazy(() => import('@/components/radar/code-pane'));

export function CompareView({
  scope,
  analysisId,
  selected,
  onSelect,
  jump,
}: {
  scope: AnalysisScope;
  analysisId: string;
  selected: FindingDTO | null;
  onSelect: (f: FindingDTO) => void;
  jump: { side: 'baseline' | 'candidate'; line: number; n: number } | null;
}) {
  const src = useSources(scope, analysisId);
  const all = useFindings(scope, analysisId, {
    severity: ['breaking', 'potentially_breaking', 'needs_review', 'non_breaking'],
    page: 1,
    pageSize: 200,
  });
  const [mobileSide, setMobileSide] = useState<'baseline' | 'candidate'>('candidate');
  const findings = useMemo(() => all.data?.data ?? [], [all.data]);
  useEffect(() => {
    if (!selected && findings.length)
      onSelect(findings.find((f) => f.candidateSource?.line || f.baselineSource?.line) ?? findings[0]!);
  }, [findings, selected, onSelect]);

  const hl = useMemo(() => {
    const b: LineHighlight[] = [];
    const c: LineHighlight[] = [];
    for (const f of findings) {
      if (f.baselineSource?.line && !f.candidateSource?.line)
        b.push({ line: f.baselineSource.line, kind: 'del' });
      if (f.candidateSource?.line)
        c.push({ line: f.candidateSource.line, kind: f.severity === 'non_breaking' ? 'add' : 'del' });
    }
    if (selected?.baselineSource?.line) b.push({ line: selected.baselineSource.line, kind: 'focus' });
    if (selected?.candidateSource?.line) c.push({ line: selected.candidateSource.line, kind: 'focus' });
    // focus wins: put focus entries first so the decoration builder keeps them
    const order = (x: LineHighlight[]) =>
      x.sort((p, q) => (p.kind === 'focus' ? -1 : q.kind === 'focus' ? 1 : 0));
    return { b: order(b), c: order(c) };
  }, [findings, selected]);

  const scrollB = jump?.side === 'baseline' ? jump.line : selected?.baselineSource?.line;
  const scrollC = jump?.side === 'candidate' ? jump.line : selected?.candidateSource?.line;
  const idx = selected ? findings.findIndex((f) => f.id === selected.id) : -1;

  if (src.error) return <ErrorState error={src.error} retry={() => src.refetch()} />;
  if (!src.data) return <Skeleton className="h-[480px]" />;

  const pane = (side: 'baseline' | 'candidate') => {
    const d = src.data![side];
    return (
      <div className={cn('panel min-w-0 overflow-hidden', side !== mobileSide && 'hidden md:block')}>
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2 text-xs">
          <span className="font-medium">
            {side === 'baseline' ? 'Baseline' : 'Candidate'} <span className="text-muted">{d.label}</span>
          </span>
          <span className="truncate font-mono text-faint">{d.fileName ?? ''}</span>
        </div>
        <Suspense fallback={<Skeleton className="h-[520px] rounded-none" />}>
          <CodePane
            value={d.content}
            fileName={d.fileName}
            highlights={side === 'baseline' ? hl.b : hl.c}
            scrollTo={side === 'baseline' ? scrollB : scrollC}
            height="560px"
            ariaLabel={`${side} contract source`}
          />
        </Suspense>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          {selected ? (
            <>
              <SeverityBadge severity={selected.severity} />
              <span className="truncate font-medium">{selected.title}</span>
              <span className="hidden truncate font-mono text-xs text-muted sm:inline">
                {selected.logicalPath}
              </span>
            </>
          ) : (
            <span className="text-muted">Highlighted lines show where findings were located.</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="secondary"
            disabled={idx <= 0}
            onClick={() => onSelect(findings[idx - 1]!)}
            icon={<ChevronLeft className="size-3.5" />}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={idx < 0 || idx >= findings.length - 1}
            onClick={() => onSelect(findings[idx + 1]!)}
          >
            Next
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="flex gap-1 md:hidden" role="tablist" aria-label="Choose side">
        {(['baseline', 'candidate'] as const).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={mobileSide === s ? 'primary' : 'secondary'}
            onClick={() => setMobileSide(s)}
            aria-pressed={mobileSide === s}
          >
            {s === 'baseline' ? 'Baseline' : 'Candidate'}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {pane('baseline')}
        {pane('candidate')}
      </div>
      <p className="flex flex-wrap gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block size-3 rounded-sm"
            style={{ background: 'var(--hl-focus)', boxShadow: 'inset 2px 0 0 var(--accent)' }}
          />{' '}
          Selected finding
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm" style={{ background: 'var(--hl-del)' }} /> Risky
          change
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm" style={{ background: 'var(--hl-add)' }} /> Additive
          change
        </span>
      </p>
    </div>
  );
}
