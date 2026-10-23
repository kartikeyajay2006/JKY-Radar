import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { AnalysisResult, Finding } from '@jky/radar-core';
import { GateBadge, SeverityIcon, SeverityBar } from '@/components/radar/badges';
import { RadarMark } from '@/components/radar/logo';
import { Skeleton } from '@/components/ui/primitives';
import type { LineHighlight } from '@/components/radar/code-pane';
import { cn } from '@/lib/cn';
import { BASELINE, PRESETS, type PresetId } from './playground-samples';

const CodePane = lazy(() => import('@/components/radar/code-pane'));

type EngineState =
  | { status: 'loading' }
  | { status: 'ok'; result: AnalysisResult; ms: number }
  | { status: 'error'; message: string };

/**
 * The hero: the real JKY-Radar engine running in the browser on two contract versions.
 * Nothing is sent to a server.
 */
export function Playground({ onResult }: { onResult?: (r: AnalysisResult | null) => void }) {
  const [preset, setPreset] = useState<PresetId | 'custom'>('breaking');
  const [candidate, setCandidate] = useState<string>(PRESETS.breaking.text);
  const [side, setSide] = useState<'candidate' | 'baseline'>('candidate');
  const [state, setState] = useState<EngineState>({ status: 'loading' });
  const [selected, setSelected] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const engine = await import('@jky/radar-adapters/browser');
        const start = performance.now();
        const out = engine.analyzeContracts({
          baseline: { content: BASELINE, fileName: 'orders-v1.yaml' },
          candidate: { content: candidate, fileName: 'orders-v2.yaml' },
        });
        if (id !== seq.current) return;
        if (!out.ok) {
          const d = out.candidate?.[0] ?? out.baseline?.[0];
          setState({
            status: 'error',
            message: d ? `${d.message}${d.source?.line ? ` (line ${d.source.line})` : ''}` : out.message,
          });
          onResult?.(null);
          return;
        }
        setState({
          status: 'ok',
          result: out.result,
          ms: Math.max(1, Math.round(performance.now() - start)),
        });
        onResult?.(out.result);
      } catch (e) {
        if (id === seq.current) setState({ status: 'error', message: (e as Error).message });
      }
    }, 250);
    return () => clearTimeout(t);
  }, [candidate]); // eslint-disable-line react-hooks/exhaustive-deps

  const findings: Finding[] = useMemo(
    () => (state.status === 'ok' ? state.result.findings.filter((f) => f.severity !== 'informational') : []),
    [state],
  );
  const sel = findings.find((f) => f.fingerprint === selected) ?? null;
  const highlights = useMemo<LineHighlight[]>(() => {
    const hl: LineHighlight[] = [];
    for (const f of findings) {
      const line = side === 'candidate' ? f.candidateSource?.line : f.baselineSource?.line;
      if (line)
        hl.push({
          line,
          kind: f.fingerprint === selected ? 'focus' : f.severity === 'non_breaking' ? 'add' : 'del',
        });
    }
    return hl.sort((a) => (a.kind === 'focus' ? -1 : 1));
  }, [findings, side, selected]);
  const scrollTo = sel ? (side === 'candidate' ? sel.candidateSource?.line : sel.baselineSource?.line) : null;

  return (
    <div className="overflow-hidden rounded-[14px] border border-line-strong bg-surface shadow-[var(--shadow)]">
      <div className="flex items-center gap-3 border-b border-line bg-raised/60 px-4 py-2.5">
        <RadarMark className="size-5" animated />
        <span className="text-sm font-medium whitespace-nowrap">Radar console</span>
        <span className="hidden text-xs whitespace-nowrap text-muted 2xl:inline">Runs in your browser</span>
        <div
          className="ml-auto flex gap-1 overflow-x-auto scroll-thin"
          role="group"
          aria-label="Example releases"
        >
          {(Object.keys(PRESETS) as PresetId[]).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={preset === p}
              onClick={() => {
                setPreset(p);
                setCandidate(PRESETS[p].text);
                setSide('candidate');
                setSelected(null);
              }}
              className={cn(
                'rounded-md px-2 py-1 text-xs whitespace-nowrap transition-colors',
                preset === p ? 'bg-accent-soft text-fg' : 'text-muted hover:text-fg',
              )}
            >
              {PRESETS[p].label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <div className="min-w-0 border-b border-line md:border-r md:border-b-0">
          <div className="flex border-b border-line text-xs" role="tablist" aria-label="Contract version">
            {(['baseline', 'candidate'] as const).map((s) => (
              <button
                key={s}
                role="tab"
                type="button"
                aria-selected={side === s}
                onClick={() => setSide(s)}
                className={cn(
                  'border-b-2 px-4 py-2 font-medium whitespace-nowrap',
                  side === s ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
                )}
              >
                {s === 'baseline' ? 'Baseline v1' : 'Candidate v2'}
                <span className="ml-1.5 font-normal text-faint">
                  {s === 'baseline' ? 'read only' : 'editable'}
                </span>
              </button>
            ))}
          </div>
          <Suspense fallback={<Skeleton className="h-[380px] rounded-none" />}>
            <CodePane
              value={side === 'baseline' ? BASELINE : candidate}
              fileName="orders.yaml"
              editable={side === 'candidate'}
              onChange={(v) => {
                setCandidate(v);
                setPreset('custom');
              }}
              highlights={highlights}
              scrollTo={scrollTo ?? null}
              height="380px"
              ariaLabel={
                side === 'baseline' ? 'Baseline contract (read only)' : 'Candidate contract (editable)'
              }
            />
          </Suspense>
        </div>

        <div className="flex min-w-0 flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            {state.status === 'ok' ? (
              <GateBadge decision={state.result.gate.decision} />
            ) : (
              <span className="text-xs text-muted">
                {state.status === 'loading' ? 'Starting engine…' : 'Cannot analyse'}
              </span>
            )}
            {state.status === 'ok' && (
              <span className="text-xs text-muted">
                {state.result.findings.length} findings in {state.ms} ms, {state.result.coverage.level}{' '}
                coverage
              </span>
            )}
          </div>
          {state.status === 'ok' && (
            <div className="border-b border-line px-4 py-3">
              <SeverityBar counts={state.result.gate.counts} legend={false} />
              <p className="mt-2 text-xs text-fg-soft">{state.result.gate.reasons[0]}</p>
            </div>
          )}
          <div className="max-h-[300px] min-h-[220px] flex-1 overflow-y-auto scroll-thin" aria-live="polite">
            {state.status === 'loading' && (
              <div className="space-y-2 p-4">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            )}
            {state.status === 'error' && <p className="p-4 text-sm text-breaking">{state.message}</p>}
            {state.status === 'ok' && findings.length === 0 && (
              <p className="p-4 text-sm text-muted">
                No changes that affect clients. Try one of the example releases above, or edit the candidate.
              </p>
            )}
            <ul>
              {findings.map((f) => (
                <li key={f.fingerprint}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(f.fingerprint === selected ? null : f.fingerprint);
                      if (!f.candidateSource?.line && f.baselineSource?.line) setSide('baseline');
                    }}
                    className={cn(
                      'flex w-full gap-2.5 border-b border-line px-4 py-2.5 text-left last:border-0',
                      selected === f.fingerprint ? 'bg-accent-soft' : 'hover:bg-raised',
                    )}
                    aria-expanded={selected === f.fingerprint}
                  >
                    <SeverityIcon severity={f.severity} className="mt-0.5" />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">{f.title}</span>
                      <span className="block truncate font-mono text-[11px] text-muted">{f.logicalPath}</span>
                      {selected === f.fingerprint && (
                        <span className="mt-1.5 block space-y-1 text-xs text-fg-soft">
                          <span className="block">{f.explanation}</span>
                          <span className="block text-muted">Fix: {f.recommendation}</span>
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {state.status === 'ok' && findings.length > 0 && (
            <p className="border-t border-line px-4 py-2 text-[11px] text-muted">
              Select a finding to see the fix and highlight it in the contract.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
