import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { FileCode2, GitCompareArrows, Scale, ShieldCheck, Users } from 'lucide-react';
import { LIMITATIONS } from '@jky/radar-core';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/primitives';
import { GateBadge, SupportBadge } from '@/components/radar/badges';
import { useCapabilities, useDemoAnalyses } from '@/lib/queries';
import { Playground } from '@/features/landing/playground';
import { FindingDetail } from '@/features/analysis/finding-detail';

// three.js loads in its own chunk so the page text appears before the 3D scene.
const Radar3D = lazy(() => import('@/features/landing/radar-3d'));

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

/** @type {Record<GateDecision, [string, string]>} */
const GATE_TEXT = {
  pass: ['Pass', 'text-safe'],
  warn: ['Warn', 'text-potential'],
  block: ['Block', 'text-breaking'],
  inconclusive: ['Inconclusive', 'text-inconclusive'],
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
  cmd: 'text-fg',
  head: 'text-accent',
  soft: 'text-muted',
  blank: '',
  brk: 'text-breaking',
  pot: 'text-potential',
  ok: 'text-safe',
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
  const radarFindings = useMemo(
    () =>
      result ? result.findings.filter((f) => f.severity !== 'informational') : result === null ? [] : null,
    [result],
  );
  const gate = result ? GATE_TEXT[result.gate.decision] : null;

  return (
    <div>
      {/* ------------------------------------------------------------- hero */}
      <section className="relative overflow-hidden border-b border-line">
        <div
          className="hairline-grid pointer-events-none absolute inset-0 opacity-[0.35] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
          aria-hidden
        />
        <div
          className="radar-glow pointer-events-none absolute top-1/2 right-[-8rem] hidden size-[52rem] -translate-y-1/2 lg:block"
          aria-hidden
        />
        <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-10 px-4 pt-14 pb-16 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-12 lg:pt-20 lg:pb-24">
          <div>
            <h1 className="hero-title text-[42px] font-semibold sm:text-[54px] xl:text-[62px]">
              Know what breaks
              <br />
              before you ship.
            </h1>
            <p className="mt-6 max-w-[34rem] text-[17px] leading-relaxed text-fg-soft">
              JKY-Radar compares two versions of an API contract and tells you which changes will break the
              clients already calling it, why, and which of your teams depend on them.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/register">
                <Button variant="primary" size="lg">
                  Create a free workspace
                </Button>
              </Link>
              <Link to="/demo">
                <Button variant="secondary" size="lg">
                  Open the demo analyses
                </Button>
              </Link>
            </div>

            {/* live readout of the engine run the radar is drawing */}
            <dl className="mt-10 grid max-w-[34rem] grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5 sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted">Release gate</dt>
                <dd className={`mt-1 text-lg font-semibold ${gate?.[1] ?? ''}`}>{gate?.[0] ?? '…'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Findings</dt>
                <dd className="tabular mt-1 text-lg font-semibold">{radarFindings?.length ?? '…'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Analysed in</dt>
                <dd className="tabular mt-1 text-lg font-semibold">{result ? `${ms} ms` : '…'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Coverage</dt>
                <dd className="mt-1 text-lg font-semibold capitalize">{result?.coverage.level ?? '…'}</dd>
              </div>
            </dl>
            <p className="mt-5 max-w-[34rem] text-sm text-muted">
              Live: the real engine runs in your browser on the Orders API release in the{' '}
              <a href="#console" className="font-medium text-accent underline-offset-4 hover:underline">
                console below
              </a>
              . Edit the contract there and the radar redraws. Nothing leaves this page.
            </p>
          </div>

          <div className="mx-auto w-full max-w-[40rem] min-w-0">
            <Suspense
              fallback={
                <div>
                  <Skeleton className="aspect-[1.32] w-full rounded-full opacity-40" />
                  <Skeleton className="mt-3 h-[78px]" />
                </div>
              }
            >
              <Radar3D findings={radarFindings} />
            </Suspense>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- console */}
      <section id="console" className="scroll-mt-16 border-b border-line">
        <div className="mx-auto max-w-7xl px-4 pt-20 pb-16 sm:px-6">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <h2 className="display text-[30px] leading-tight font-semibold sm:text-[34px]">
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
            <h2 className="display text-[28px] leading-tight font-semibold sm:text-[32px]">
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
          <h2 className="display max-w-2xl text-[28px] leading-tight font-semibold sm:text-[32px]">
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
            <h2 className="display text-[28px] leading-tight font-semibold sm:text-[32px]">
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
            <h2 className="display text-[28px] leading-tight font-semibold sm:text-[32px]">
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
            <h2 className="display text-[28px] leading-tight font-semibold sm:text-[32px]">
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
          <div className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-code shadow-[var(--shadow)]">
            <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
              <span className="size-2.5 rounded-full bg-line-strong" />
              <span className="size-2.5 rounded-full bg-line-strong" />
              <span className="size-2.5 rounded-full bg-line-strong" />
              <span className="ml-2 font-mono text-xs text-muted">pull-request check</span>
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
              <h2 className="display text-[28px] leading-tight font-semibold sm:text-[32px]">
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
            <h2 className="display mt-4 text-[28px] leading-tight font-semibold sm:text-[32px]">
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

      {/* ------------------------------------------------------------- CTA */}
      <section className="relative overflow-hidden">
        <svg
          viewBox="-100 -100 200 200"
          className="pointer-events-none absolute top-1/2 right-[-10rem] hidden w-[34rem] -translate-y-1/2 text-line md:block"
          aria-hidden
        >
          {[30, 50, 70, 88].map((r) => (
            <circle key={r} r={r} fill="none" stroke="currentColor" strokeWidth="0.5" />
          ))}
          <line x1="-94" y1="0" x2="94" y2="0" stroke="currentColor" strokeWidth="0.4" />
          <line x1="0" y1="-94" x2="0" y2="94" stroke="currentColor" strokeWidth="0.4" />
        </svg>
        <div className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <h2 className="display max-w-2xl text-[30px] leading-tight font-semibold sm:text-[36px]">
            Run your first comparison in two minutes.
          </h2>
          <p className="mt-3 max-w-xl text-fg-soft">
            Create a workspace, upload two versions, and read the verdict.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/register">
              <Button variant="primary" size="lg">
                Create a free workspace
              </Button>
            </Link>
            <Link to="/docs">
              <Button variant="secondary" size="lg">
                Read the docs
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
