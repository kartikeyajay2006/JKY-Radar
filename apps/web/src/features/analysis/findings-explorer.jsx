/** @import { FindingDTO } from '@jky/shared' */
/** @import { FindingSeverity } from '@jky/radar-core' */
/** @import { AnalysisScope, FindingFilters } from '@/lib/queries' */
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';

import { SEVERITY_LABEL } from '@jky/radar-core';
import { Input, Select } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';
import { SEVERITY_ORDER, SEV_BG, SEV_TEXT, SeverityIcon } from '@/components/radar/badges';
import { useFindings } from '@/lib/queries';
import { cn } from '@/lib/cn';
import { FindingDetail } from './finding-detail';

/**
 * @template T
 * @param {T} v
 */
function useDebounced(v, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

/** @type {Record<FindingSeverity, string>} */
const GROUP_TITLE = {
  breaking: 'Breaking',
  potentially_breaking: 'Potentially breaking',
  needs_review: 'Needs review',
  non_breaking: 'Non-breaking',
  informational: 'Informational',
};

/** @param {{ scope: AnalysisScope; analysisId: string; selected: FindingDTO | null; onSelect: (f: FindingDTO | null) => void; onJump: (side: 'baseline' | 'candidate', line: number) => void; initialEntity?: string; }} props */
export function FindingsExplorer({ scope, analysisId, selected, onSelect, onJump, initialEntity }) {
  const [severity, setSeverity] = useState(/** @type {FindingSeverity[]} */ ([]));
  const [ruleId, setRuleId] = useState('');
  const [search, setSearch] = useState('');
  const [entity, setEntity] = useState(initialEntity ?? '');
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  /** @type {FindingFilters} */
  const filters = {
    severity,
    ruleId: ruleId || undefined,
    search: q || undefined,
    entity: entity || undefined,
    page,
    pageSize: 50,
  };
  const res = useFindings(scope, analysisId, filters);
  useEffect(() => setPage(1), [severity, ruleId, q, entity]);

  const items = useMemo(() => res.data?.data ?? [], [res.data]);
  const meta = res.data?.meta;
  useEffect(() => {
    if (items.length && (!selected || !items.some((i) => i.id === selected.id))) onSelect(items[0]);
    if (!items.length && selected && !res.isFetching) onSelect(null);
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  const grouped = useMemo(
    () =>
      SEVERITY_ORDER.map((s) => /** @type {const} */ ([s, items.filter((i) => i.severity === s)])).filter(
        ([, l]) => l.length > 0,
      ),
    [items],
  );
  /** @param {FindingSeverity} s */
  const toggle = (s) => setSeverity((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const filtered = severity.length > 0 || !!ruleId || !!q || !!entity;

  const selectedIndex = selected
    ? Math.max(
        0,
        items.findIndex((x) => x.id === selected.id),
      )
    : 0;
  /** @param {1 | -1} dir */
  const move = (dir) => {
    if (!selected) return;
    const i = items.findIndex((x) => x.id === selected.id);
    const n = items[i + dir];
    if (n) onSelect(n);
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by severity">
          {SEVERITY_ORDER.map((s) => {
            const n = meta?.facets.severity[s] ?? 0;
            const on = severity.includes(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(s)}
                disabled={n === 0 && !on}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-[background-color,border-color,color,transform] duration-150 active:scale-95 disabled:opacity-40',
                  on
                    ? 'border-accent bg-accent-soft text-fg shadow-[inset_0_0_0_1px_var(--accent)]'
                    : 'border-line bg-surface text-fg-soft hover:border-line-strong hover:text-fg',
                )}
              >
                <SeverityIcon severity={s} className="size-3.5" />
                {SEVERITY_LABEL[s]}
                <span
                  className={cn(
                    'tabular rounded-full px-1.5 text-[11px] leading-4',
                    n ? 'bg-raised text-fg-soft' : 'text-muted',
                  )}
                >
                  {n}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search paths, rules, explanations"
              className="pl-8"
              aria-label="Search findings"
            />
          </div>
          <div className="w-44">
            <Select value={ruleId} onChange={(e) => setRuleId(e.target.value)} aria-label="Filter by rule">
              <option value="">All rules</option>
              {meta?.facets.rules.map((r) => (
                <option key={r.ruleId} value={r.ruleId}>
                  {r.ruleId} ({r.count})
                </option>
              ))}
            </Select>
          </div>
        </div>
        {(filtered || entity) && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            {entity && (
              <span className="inline-flex items-center gap-1 rounded-[4px] bg-raised px-1.5 py-0.5 font-mono text-fg-soft">
                {entity}
                <button type="button" aria-label="Clear entity filter" onClick={() => setEntity('')}>
                  <X className="size-3" />
                </button>
              </span>
            )}
            <span>{meta?.total ?? 0} matching</span>
            <Button
              variant="link"
              size="sm"
              onClick={() => (setSeverity([]), setRuleId(''), setSearch(''), setEntity(''))}
            >
              Clear filters
            </Button>
          </div>
        )}

        {res.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : res.error ? (
          <ErrorState error={res.error} retry={() => res.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title={filtered ? 'No findings match these filters' : 'No findings'}
            body={
              filtered
                ? 'Clear a filter to see more.'
                : 'The tested rules detected no differences. Check the coverage tab before treating this as safe.'
            }
          />
        ) : (
          <div
            className={cn(
              'panel max-h-[calc(100vh-14rem)] overflow-y-auto scroll-thin transition-opacity focus-visible:outline-offset-0',
              res.isFetching && 'opacity-70',
            )}
            role="listbox"
            aria-label="Findings"
            tabIndex={0}
            onKeyDown={(e) =>
              e.key === 'ArrowDown'
                ? (e.preventDefault(), move(1))
                : e.key === 'ArrowUp'
                  ? (e.preventDefault(), move(-1))
                  : null
            }
          >
            {grouped.map(([sev, list]) => (
              <div key={sev}>
                <div
                  className={cn(
                    'sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-surface/95 px-4 py-2 text-xs font-semibold backdrop-blur',
                    SEV_TEXT[sev],
                  )}
                >
                  <SeverityIcon severity={sev} className="size-3.5" />
                  {GROUP_TITLE[sev]}
                  <span className="tabular ml-auto rounded-full bg-raised px-1.5 text-[11px] leading-4 font-normal text-fg-soft">
                    {list.length}
                  </span>
                </div>
                {list.map((f) => {
                  const active = selected?.id === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => onSelect(f)}
                      title={f.ruleId}
                      className={cn(
                        'group relative block w-full border-b border-line py-3 pr-4 pl-5 text-left transition-colors last:border-b-0',
                        active ? 'bg-accent-soft' : 'hover:bg-raised/70',
                      )}
                    >
                      <span
                        className={cn(
                          'absolute top-2 bottom-2 left-0 rounded-r-full transition-all duration-200',
                          SEV_BG[f.severity],
                          active ? 'w-1 opacity-100' : 'w-0.5 opacity-50 group-hover:opacity-80',
                        )}
                        aria-hidden
                      />
                      <span
                        className={cn(
                          'line-clamp-2 text-sm font-medium',
                          active ? 'text-fg' : 'text-fg-soft',
                        )}
                      >
                        {f.title}
                      </span>
                      <span className="mt-1 block truncate font-mono text-[11.5px] text-muted">
                        {f.logicalPath}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between text-xs text-muted">
            <span>
              Page {meta.page} of {meta.totalPages}
            </span>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                icon={<ChevronLeft className="size-3.5" />}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={page >= meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="panel relative min-w-0 overflow-hidden p-6 shadow-[var(--shadow)] lg:sticky lg:top-20 lg:self-start">
        {selected && (
          <span
            className={cn(
              'absolute inset-x-0 top-0 h-1 transition-colors duration-300',
              SEV_BG[selected.severity],
            )}
            aria-hidden
          />
        )}
        {selected ? (
          <FindingDetail
            f={selected}
            onJump={onJump}
            ruleHref={`/docs/rules#${selected.ruleId}`}
            nav={{
              index: (page - 1) * 50 + selectedIndex,
              total: meta?.total ?? items.length,
              prev: selectedIndex > 0 ? () => move(-1) : undefined,
              next: selectedIndex < items.length - 1 ? () => move(1) : undefined,
            }}
          />
        ) : (
          <p className="text-sm text-muted">
            Select a finding to see what changed, why it matters, the evidence and how to fix it.
          </p>
        )}
      </div>
    </div>
  );
}
