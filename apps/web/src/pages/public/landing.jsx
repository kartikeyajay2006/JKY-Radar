import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { FileCode2, GitCompareArrows, Scale, ShieldCheck, Users } from 'lucide-react';
import { LIMITATIONS } from '@jky/radar-core';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/primitives';
import { GateBadge, SupportBadge } from '@/components/radar/badges';
import { useCapabilities, useDemoAnalyses } from '@/lib/queries';
import { Playground } from '@/features/landing/playground';
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

export default function Landing() {
  const caps = useCapabilities();
  const demos = useDemoAnalyses();
  const [result, setResult] = useState(null);
  useEffect(() => {
    document.title = 'JKY-Radar · Know what breaks before you ship';
  }, []);
  const example = result?.findings.find((f) => f.severity === 'breaking') ?? result?.findings[0];

  return (
    <div>
      {/* ------------------------------------------------------------- hero */}
      <section className="relative border-b border-line">
        <div
          className="hairline-grid pointer-events-none absolute inset-0 opacity-[0.35] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
          aria-hidden
        />
        <div className="relative mx-auto grid grid-cols-1 max-w-7xl gap-10 px-4 pt-14 pb-16 sm:px-6 lg:grid-cols-[minmax(0,5.2fr)_minmax(0,6.8fr)] lg:gap-12 lg:pt-20 lg:pb-24">
          <div className="flex flex-col justify-center">
            <h1 className="text-[42px] leading-[1.03] font-semibold tracking-[-0.035em] sm:text-[54px] lg:text-[52px] xl:text-[60px]">
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
            <p className="mt-6 max-w-md text-sm text-muted">
              Works with OpenAPI, Swagger 2.0, GraphQL, Postman, JSON Schema, Protocol Buffers and AsyncAPI
              documents from any vendor. No API keys, no calls to your services.
            </p>
          </div>
          <div className="min-w-0">
            <Playground onResult={setResult} />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- explainability */}
      <section className="border-b border-line">
        <div className="mx-auto grid grid-cols-1 max-w-7xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,6fr)]">
          <div>
            <h2 className="text-[32px] leading-tight font-semibold">
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
              Live: this is the first finding from the console above.
            </p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- pipeline (a real sequence) */}
      <section className="border-b border-line bg-sunken/30">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <h2 className="max-w-2xl text-[32px] leading-tight font-semibold">How a verdict is reached</h2>
          <p className="mt-3 max-w-2xl text-fg-soft">
            The same deterministic pipeline runs in the browser console above, in the server and in the CLI.
            Identical inputs always produce identical findings and fingerprints.
          </p>
          <ol className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-panel)] border border-line bg-line md:grid-cols-5">
            {PIPELINE.map((s, i) => (
              <li key={s.title} className="bg-surface p-5">
                <span className="font-mono text-xs text-accent">{String(i + 1).padStart(2, '0')}</span>
                <h3 className="mt-3 font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ------------------------------------------------------------- gate + impact */}
      <section className="border-b border-line">
        <div className="mx-auto grid grid-cols-1 max-w-7xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2">
          <div>
            <h2 className="text-[32px] leading-tight font-semibold">
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
            <h2 className="text-[32px] leading-tight font-semibold">Know who you are about to break</h2>
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

      {/* ------------------------------------------------------------- formats */}
      <section className="border-b border-line" id="formats">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <h2 className="text-[32px] leading-tight font-semibold">Support, stated honestly</h2>
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
      <section className="border-b border-line bg-sunken/30">
        <div className="mx-auto grid grid-cols-1 max-w-7xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,6fr)]">
          <div>
            <ShieldCheck className="size-6 text-accent" />
            <h2 className="mt-4 text-[32px] leading-tight font-semibold">What JKY-Radar will not claim</h2>
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
      <section>
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-4 py-20 sm:px-6 md:flex-row md:items-center">
          <div>
            <h2 className="text-[32px] leading-tight font-semibold">
              Run your first comparison in two minutes.
            </h2>
            <p className="mt-2 text-fg-soft">
              Create a workspace, upload two versions, and read the verdict.
            </p>
          </div>
          <div className="flex gap-3">
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
