import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { FileCode2, GitCompareArrows, Scale, ShieldCheck, Users } from 'lucide-react';
import { LIMITATIONS } from '@jky/radar-core';
import { Skeleton } from '@/components/ui/primitives';
import { GateBadge, SupportBadge } from '@/components/radar/badges';
import { useCapabilities, useDemoAnalyses } from '@/lib/queries';
import { Playground } from '@/features/landing/playground';
import { RadarScope, RINGS } from '@/features/landing/radar-scope';
import { FindingDetail } from '@/features/analysis/finding-detail';

/** @import { AnalysisResult, GateDecision } from '@jky/radar-core' */

const PIPELINE = [
  {
    title: 'Parse safely',
    body: 'JSON, YAML, SDL and .proto are parsed with depth, alias and size limits. Remote references are never fetched; scripts are never run.',
  },
  {
    title: 'Normalise',
    body: 'Dialect differences are folded together, so OpenAPI 3.0 nullable and 3.1 type null compare as equal instead of producing noise.',
  },
  {
    title: 'Match',
    body: 'Operations, fields, RPCs and channels are paired by stable keys: method and templated path, schema coordinates, field numbers.',
  },
  {
    title: 'Classify',
    body: 'Each difference runs through a versioned rule with fixed severity, aware of direction: requests must keep accepting, responses must keep promising.',
  },
  {
    title: 'Gate',
    body: 'A named policy turns findings and coverage into pass, warn, block or inconclusive. Overrides need a written reason and are audited.',
  },
];

/** @type {Array<[GateDecision, string]>} */
const GATES = [
  ['pass', 'No finding needs action and every construct in both versions was compared by tested rules.'],
  ['warn', 'Nothing confirmed breaking, but some changes could break clients, or coverage is partial.'],
  ['block', 'At least one change will break existing clients under the current policy.'],
  [
    'inconclusive',
    'A change landed in a construct JKY-Radar does not decide formally, such as oneOf or a regex. A human has to look.',
  ],
];

/** Gate colours inside the always-dark scope band. @type {Record<GateDecision, [string, string]>} */
const SCOPE_GATE = {
  pass: ['Pass', 'var(--scope-safe)'],
  warn: ['Warn', 'var(--scope-potential)'],
  block: ['Block', 'var(--scope-breaking)'],
  inconclusive: ['Inconclusive', 'var(--scope-review)'],
};

/** Real output of `npm run radar -- compare` on the ecommerce fixtures, trimmed. */
const CLI_LINES = /** @type {Array<[string, string]>} */ ([
  ['cmd', '$ npm run radar -- compare ecommerce-v1.yaml ecommerce-v2.yaml'],
  ['head', 'JKY-Radar · openapi · gate BLOCK · coverage full'],
  ['soft', '  7 breaking finding(s), policy action "block".'],
  ['blank', ''],
  ['brk', 'Breaking   RES_PROPERTY_REMOVED         GET /customers/{customerId} › response 200 › body.email'],
  ['brk', 'Breaking   HTTP_OPERATION_REMOVED       GET /orders/{orderId}'],
  ['brk', 'Breaking   REQ_PROPERTY_REQUIRED_ADDED  POST /payments › request body › body.currency'],
  ['pot', 'Potential  RES_ENUM_VALUE_ADDED         GET /orders › response 200 › body.items[].status'],
  ['ok', 'Safe       HTTP_OPERATION_ADDED         POST /returns'],
  ['blank', ''],
  ['soft', '$ echo $?'],
  ['brk', '1'],
]);
const CLI_TONE = {
  cmd: 'text-[color:var(--scope-text)]',
  head: 'text-[color:var(--scope-phosphor)]',
  soft: 'text-[color:var(--scope-muted)]',
  blank: '',
  brk: 'text-[color:var(--scope-breaking)]',
  pot: 'text-[color:var(--scope-potential)]',
  ok: 'text-[color:var(--scope-safe)]',
};

export default function Landing() {
  const caps = useCapabilities();
  const demos = useDemoAnalyses();
  const [result, setResult] = useState(/** @type {AnalysisResult | null | undefined} */ (undefined));
  const [ms, setMs] = useState(0);
  useEffect(() => {
    document.title = 'JKY-Radar · Know what breaks before you ship';
  }, []);
  const example = result?.findings.find((f) => f.severity === 'breaking') ?? result?.findings[0];
  const scopeFindings = useMemo(
    () =>
      result ? result.findings.filter((f) => f.severity !== 'informational') : result === null ? [] : null,
    [result],
  );
  const gate = result ? SCOPE_GATE[result.gate.decision] : null;

  return (
    <div>
      {/* ------------------------------------------------------------- hero: the scope */}
      <section className="scope-band relative overflow-hidden">
        <div className="relative mx-auto grid max-w-7xl grid-cols-1 gap-12 px-4 pt-14 pb-16 sm:px-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:gap-x-10 lg:gap-y-0 lg:pt-20 lg:pb-24">
          <div className="lg:col-start-1 lg:row-start-1 lg:self-end">
            <h1 className="display-hero text-[clamp(3.4rem,10vw,7.4rem)] text-[color:var(--scope-text)]">
              Know what breaks before you ship.
            </h1>
            <p className="mt-7 max-w-[36rem] text-[17px] leading-relaxed text-[color:var(--scope-text-soft)]">
              JKY-Radar compares two versions of an API contract and tells you which changes will break the
              clients already calling it, why, and which of your teams depend on them.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link
                to="/register"
                className="scope-btn-primary inline-flex h-12 items-center rounded-lg px-6 text-[15px] font-semibold transition-colors"
              >
                Create a free workspace
              </Link>
              <Link
                to="/demo"
                className="scope-btn-secondary inline-flex h-12 items-center rounded-lg px-6 text-[15px] font-medium transition-colors"
              >
                Open the demo analyses
              </Link>
            </div>
          </div>

          <div className="mx-auto w-full max-w-[34rem] lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center">
            <RadarScope findings={scopeFindings} />
            <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[color:var(--scope-text-soft)]">
              {RINGS.map((r) => (
                <li key={r.severity} className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ background: r.color }} aria-hidden />
                  {r.short}
                  <span className="tabular font-mono text-[color:var(--scope-muted)]">
                    {scopeFindings?.filter((f) => f.severity === r.severity).length ?? 0}
                  </span>
                </li>
              ))}
              <li className="text-[color:var(--scope-muted)] sm:ml-auto">Closer to centre breaks more</li>
            </ul>
          </div>

          {/* live readout of the engine run that the scope is drawing */}
          <div className="lg:col-start-1 lg:row-start-2">
            <dl className="grid lg:mt-12 max-w-[36rem] grid-cols-2 gap-x-6 gap-y-4 border-t border-[color:var(--scope-grid)] pt-5 sm:grid-cols-4">
              <div>
                <dt className="text-xs text-[color:var(--scope-muted)]">Release gate</dt>
                <dd className="mt-1 font-mono text-lg font-medium" style={{ color: gate?.[1] }}>
                  {gate?.[0] ?? '…'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[color:var(--scope-muted)]">Contacts</dt>
                <dd className="tabular mt-1 font-mono text-lg">{scopeFindings?.length ?? '…'}</dd>
              </div>
              <div>
                <dt className="text-xs text-[color:var(--scope-muted)]">Analysed in</dt>
                <dd className="tabular mt-1 font-mono text-lg">{result ? `${ms} ms` : '…'}</dd>
              </div>
              <div>
                <dt className="text-xs text-[color:var(--scope-muted)]">Coverage</dt>
                <dd className="mt-1 font-mono text-lg">{result?.coverage.level ?? '…'}</dd>
              </div>
            </dl>
            <p className="mt-5 max-w-[36rem] text-sm text-[color:var(--scope-muted)]">
              Live: the real engine is running in your browser on the Orders API release in the{' '}
              <a
                href="#console"
                className="text-[color:var(--scope-phosphor)] underline-offset-4 hover:underline"
              >
                console below
              </a>
              . Edit the contract there and the scope redraws. Nothing leaves this page.
            </p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- console */}
      <section id="console" className="scroll-mt-16 border-b border-line">
        <div className="mx-auto max-w-7xl px-4 pt-20 pb-16 sm:px-6">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <h2 className="display text-[clamp(2rem,4vw,3rem)] leading-[1.02] font-semibold">
                Change the contract. Watch the verdict move.
              </h2>
              <p className="mt-3 max-w-2xl text-fg-soft">
                Pick an example release or type into the candidate. Select a finding to see the fix and jump
                to the line that caused it.
              </p>
            </div>
          </div>
          <div className="mt-10">
            <Playground
              onResult={(r, t) => {
                setResult(r);
                if (t) setMs(t);
              }}
            />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- explainability */}
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,6fr)]">
          <div>
            <h2 className="display text-[clamp(2rem,4vw,2.75rem)] leading-[1.04] font-semibold">
              A diff tells you what moved. Radar tells you what it breaks.
            </h2>
            <p className="mt-4 text-fg-soft">
              Every finding answers the questions a reviewer asks before approving a release: what changed,
              why it is risky, where the evidence is, how to fix it, which rule decided, and what cannot be
              known from documents alone.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-fg-soft">
              <li className="flex gap-3">
                <GitCompareArrows className="mt-0.5 size-4 shrink-0 text-accent" />
                Line-accurate source pointers into both versions, clickable in the compare view.
              </li>
              <li className="flex gap-3">
                <Scale className="mt-0.5 size-4 shrink-0 text-accent" />
                Direction-aware: a new required field breaks requests but is additive in responses.
              </li>
              <li className="flex gap-3">
                <FileCode2 className="mt-0.5 size-4 shrink-0 text-accent" />
                Immutable rule IDs with documented severity, examples and tests.
              </li>
            </ul>
          </div>
          <div className="panel p-6">
            {example ? (
              <FindingDetail f={{ ...example, id: example.fingerprint, index: 0 }} />
            ) : (
              <div className="space-y-3">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-24" />
                <Skeleton className="h-24" />
              </div>
            )}
            <p className="mt-5 border-t border-line pt-3 text-xs text-muted">
              Live: the most severe finding from the console above.
            </p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- pipeline: a real sequence */}
      <section className="border-b border-line bg-sunken/40">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <h2 className="display max-w-2xl text-[clamp(2rem,4vw,2.75rem)] leading-[1.04] font-semibold">
            How a verdict is reached
          </h2>
          <p className="mt-3 max-w-2xl text-fg-soft">
            The same deterministic pipeline runs in the browser console above, in the server and in the CLI.
            Identical inputs always produce identical findings and fingerprints.
          </p>
          <ol className="relative mt-14 grid grid-cols-1 gap-10 md:grid-cols-5 md:gap-6">
            <span
              className="signal-path absolute top-[15px] right-[10%] left-[10%] hidden h-[2px] opacity-50 md:block"
              aria-hidden
            />
            {PIPELINE.map((s, i) => (
              <li key={s.title} className="relative flex gap-4 md:block">
                <span className="relative z-10 grid size-8 shrink-0 place-items-center rounded-full border border-accent bg-bg font-mono text-xs text-accent">
                  {i + 1}
                </span>
                <div>
                  <h3 className="font-semibold md:mt-5">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ------------------------------------------------------------- gate + impact */}
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-14 px-4 py-20 sm:px-6 lg:grid-cols-2">
          <div>
            <h2 className="display text-[clamp(2rem,4vw,2.75rem)] leading-[1.04] font-semibold">
              A release gate that admits what it does not know
            </h2>
            <p className="mt-3 text-fg-soft">
              No findings is not the same as safe. When coverage is incomplete, the gate says so instead of
              passing.
            </p>
            <dl className="mt-8 divide-y divide-line border-y border-line">
              {GATES.map(([g, text]) => (
                <div key={g} className="grid grid-cols-[132px_1fr] items-start gap-4 py-4">
                  <dt>
                    <GateBadge decision={g} />
                  </dt>
                  <dd className="text-sm text-fg-soft">{text}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <h2 className="display text-[clamp(2rem,4vw,2.75rem)] leading-[1.04] font-semibold">
              Know who you are about to break
            </h2>
            <p className="mt-3 text-fg-soft">
              Register the apps that call your API and the operations they use. Each analysis maps changed
              operations to those teams, by criticality and owner. JKY-Radar never pretends to discover usage
              it cannot see.
            </p>
            <div className="mt-8 space-y-3">
              {demos.data ? (
                demos.data.slice(0, 4).map((d) => (
                  <Link
                    key={d.id}
                    to={`/demo/${d.id}`}
                    className="panel flex items-center gap-4 p-4 transition-colors hover:border-line-strong"
                  >
                    <Users className="size-5 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{d.projectName}</span>
                      <span className="block text-xs text-muted">
                        {d.baseline.label} to {d.candidate.label}, {d.counts?.breaking ?? 0} breaking
                      </span>
                    </span>
                    <GateBadge decision={d.gate} />
                  </Link>
                ))
              ) : demos.isError ? (
                <p className="text-sm text-muted">
                  Demo analyses load from the API. Start the server to see them.
                </p>
              ) : (
                <>
                  <Skeleton className="h-16" />
                  <Skeleton className="h-16" />
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- CI gate */}
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
          <div>
            <h2 className="display text-[clamp(2rem,4vw,2.75rem)] leading-[1.04] font-semibold">
              Stop the merge, not the release train
            </h2>
            <p className="mt-4 text-fg-soft">
              The same engine ships as an offline CLI. Run it on every pull request and a breaking contract
              change fails the check before anyone deploys it. Or send the candidate to your workspace with a
              project token, and the analysis lands next to its findings, impact and reviews.
            </p>
            <dl className="mt-6 divide-y divide-line border-y border-line text-sm">
              {[
                ['0', 'Gate passed, or stayed below the level you chose with --fail-on.'],
                ['1', 'Gate failed. The pull request check goes red.'],
                ['2', 'Usage or parse error, with the line number.'],
              ].map(([code, text]) => (
                <div key={code} className="grid grid-cols-[72px_1fr] gap-4 py-3">
                  <dt className="font-mono text-muted">exit {code}</dt>
                  <dd className="text-fg-soft">{text}</dd>
                </div>
              ))}
            </dl>
            <Link to="/docs" className="mt-6 inline-block text-sm font-medium text-accent hover:underline">
              Set up the GitHub Actions check
            </Link>
          </div>
          <div className="scope-band overflow-hidden rounded-xl border border-[color:var(--scope-grid)]">
            <div className="flex items-center gap-2 border-b border-[color:var(--scope-grid)] px-4 py-2.5">
              <span className="size-2.5 rounded-full bg-[color:var(--scope-grid)]" />
              <span className="size-2.5 rounded-full bg-[color:var(--scope-grid)]" />
              <span className="size-2.5 rounded-full bg-[color:var(--scope-grid)]" />
              <span className="ml-2 font-mono text-xs text-[color:var(--scope-muted)]">
                pull-request check
              </span>
            </div>
            <pre
              className="scroll-thin overflow-x-auto p-5 font-mono text-[12.5px] leading-[1.75]"
              tabIndex={0}
              aria-label="Example CLI output"
            >
              {CLI_LINES.map(([tone, text], i) => (
                <div key={i} className={CLI_TONE[tone]}>
                  {text || ' '}
                </div>
              ))}
            </pre>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- formats */}
      <section className="border-b border-line" id="formats">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <h2 className="display text-[clamp(2rem,4vw,2.75rem)] leading-[1.04] font-semibold">
                Support, stated honestly
              </h2>
              <p className="mt-3 max-w-2xl text-fg-soft">
                Each format reports its real status. Rule counts come from the running server and only include
                rules with positive and negative tests.
              </p>
            </div>
            <Link to="/docs#formats" className="text-sm font-medium text-accent hover:underline">
              Read the support matrix
            </Link>
          </div>
          <div className="panel mt-10 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-line text-left text-xs text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Format</th>
                  <th className="px-5 py-3 font-medium">Versions</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Tested rules</th>
                </tr>
              </thead>
              <tbody>
                {caps.data
                  ? caps.data.adapters.map((c) => (
                      <tr key={c.id} className="border-b border-line last:border-0">
                        <td className="px-5 py-3 font-medium">{c.label}</td>
                        <td className="px-5 py-3 text-fg-soft">{c.versions}</td>
                        <td className="px-5 py-3">
                          <SupportBadge status={c.status} />
                        </td>
                        <td className="tabular px-5 py-3 text-fg-soft">
                          {c.protocol && c.rules.registered
                            ? `${c.rules.tested} of ${c.rules.registered}`
                            : '—'}
                        </td>
                      </tr>
                    ))
                  : Array.from({ length: 6 }, (_, i) => (
                      <tr key={i}>
                        <td colSpan={4} className="px-5 py-2">
                          <Skeleton className="h-6" />
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- limits */}
      <section className="border-b border-line bg-sunken/40">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,6fr)]">
          <div>
            <ShieldCheck className="size-6 text-accent" />
            <h2 className="display mt-4 text-[clamp(2rem,4vw,2.75rem)] leading-[1.04] font-semibold">
              What JKY-Radar will not claim
            </h2>
            <p className="mt-3 text-fg-soft">
              Trust comes from stating the limits. These are shown in every report too.
            </p>
          </div>
          <ul className="space-y-4">
            {LIMITATIONS.map((l) => (
              <li key={l} className="border-l-2 border-line-strong pl-4 text-fg-soft">
                {l}
              </li>
            ))}
            <li className="border-l-2 border-line-strong pl-4 text-fg-soft">
              Secrets found in uploaded collections are redacted before storage, and uploads are never sent to
              third parties or language models.
            </li>
          </ul>
        </div>
      </section>

      {/* ------------------------------------------------------------- CTA: the scope again, at rest */}
      <section className="scope-band relative overflow-hidden">
        <svg
          viewBox="-100 -100 200 200"
          className="pointer-events-none absolute top-1/2 right-[-12rem] hidden w-[38rem] -translate-y-1/2 md:block"
          aria-hidden
        >
          {[30, 50, 70, 88].map((r) => (
            <circle key={r} r={r} fill="none" stroke="var(--scope-grid)" strokeWidth="0.5" />
          ))}
          <line x1="-94" y1="0" x2="94" y2="0" stroke="var(--scope-grid)" strokeWidth="0.4" />
          <line x1="0" y1="-94" x2="0" y2="94" stroke="var(--scope-grid)" strokeWidth="0.4" />
        </svg>
        <div className="relative mx-auto max-w-7xl px-4 py-24 sm:px-6">
          <h2 className="display-hero max-w-3xl text-[clamp(2.6rem,6vw,4.6rem)]">
            Run your first comparison in two minutes.
          </h2>
          <p className="mt-5 max-w-xl text-[color:var(--scope-text-soft)]">
            Create a workspace, upload two versions, and read the verdict.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link
              to="/register"
              className="scope-btn-primary inline-flex h-12 items-center rounded-lg px-6 text-[15px] font-semibold transition-colors"
            >
              Create a free workspace
            </Link>
            <Link
              to="/docs"
              className="scope-btn-secondary inline-flex h-12 items-center rounded-lg px-6 text-[15px] font-medium transition-colors"
            >
              Read the docs
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
