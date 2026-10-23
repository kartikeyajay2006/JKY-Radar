import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router';
import { Search } from 'lucide-react';
import { PROTOCOL_LABEL, SEVERITY_LABEL, type FindingSeverity, type Protocol } from '@jky/radar-core';
import { Input, Select } from '@/components/ui/field';
import { ErrorState, Skeleton } from '@/components/ui/primitives';
import { SeverityBadge, SupportBadge } from '@/components/radar/badges';
import { useCapabilities, useRules } from '@/lib/queries';
import { cn } from '@/lib/cn';

const NAV = [
  ['overview', 'Overview'],
  ['quickstart', 'Quick start'],
  ['formats', 'Support matrix'],
  ['rules', 'Rule catalog'],
  ['gate', 'Release gate'],
  ['impact', 'Consumer impact'],
  ['security', 'Security and privacy'],
  ['limitations', 'Limitations'],
  ['api', 'REST API and CLI'],
] as const;

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="scroll-mt-24 border-t border-line pt-10 text-2xl font-semibold first:border-0 first:pt-0"
    >
      {children}
    </h2>
  );
}

function RuleCatalog() {
  const rules = useRules();
  const [q, setQ] = useState('');
  const [protocol, setProtocol] = useState('');
  const [severity, setSeverity] = useState('');
  const list = useMemo(
    () =>
      (rules.data ?? []).filter(
        (r) =>
          (!protocol || r.protocols.includes(protocol as Protocol)) &&
          (!severity || r.severity === severity) &&
          (!q || `${r.id} ${r.title} ${r.description}`.toLowerCase().includes(q.toLowerCase())),
      ),
    [rules.data, q, protocol, severity],
  );
  useEffect(() => {
    if (!rules.data || !window.location.hash) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: 'center' });
  }, [rules.data]);
  if (rules.error) return <ErrorState error={rules.error} />;
  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" />
          <Input
            className="pl-8"
            placeholder="Search rule id, title or description"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search rules"
          />
        </div>
        <div className="sm:w-56">
          <Select
            value={protocol}
            onChange={(e) => setProtocol(e.target.value)}
            aria-label="Filter by protocol"
          >
            <option value="">All protocols</option>
            {(Object.keys(PROTOCOL_LABEL) as Protocol[])
              .filter((p) => p !== 'postman3')
              .map((p) => (
                <option key={p} value={p}>
                  {PROTOCOL_LABEL[p]}
                </option>
              ))}
          </Select>
        </div>
        <div className="sm:w-48">
          <Select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            aria-label="Filter by severity"
          >
            <option value="">All severities</option>
            {(Object.keys(SEVERITY_LABEL) as FindingSeverity[]).map((s) => (
              <option key={s} value={s}>
                {SEVERITY_LABEL[s]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <p className="text-xs text-muted">
        {rules.data ? `${list.length} of ${rules.data.length} rules` : 'Loading rules'}
      </p>
      {rules.isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        <ul className="divide-y divide-line rounded-[var(--radius-panel)] border border-line">
          {list.map((r) => (
            <li key={r.id} id={r.id} className="scroll-mt-28 p-4 target:bg-accent-soft">
              <div className="flex flex-wrap items-center gap-2">
                <code className="text-[13px] font-medium">{r.id}</code>
                <SeverityBadge severity={r.severity} />
                {!r.tested && (
                  <span className="rounded-[4px] border border-review/30 px-1.5 py-0.5 text-xs text-review">
                    untested safety net
                  </span>
                )}
                {r.evidence === 'heuristic' && (
                  <span className="rounded-[4px] border border-line px-1.5 py-0.5 text-xs text-muted">
                    heuristic evidence
                  </span>
                )}
              </div>
              <h3 className="mt-1.5 font-medium">{r.title}</h3>
              <p className="mt-1 text-sm text-fg-soft">{r.description}</p>
              <dl className="mt-2 grid grid-cols-1 gap-1 text-sm sm:grid-cols-[120px_1fr]">
                <dt className="text-muted">Why risky</dt>
                <dd>{r.impact}</dd>
                <dt className="text-muted">Fix</dt>
                <dd>{r.recommendation}</dd>
                {r.example && (
                  <>
                    <dt className="text-muted">Example</dt>
                    <dd className="font-mono text-xs">
                      {r.example.before} <span className="text-muted">becomes</span> {r.example.after}
                    </dd>
                  </>
                )}
                <dt className="text-muted">Applies to</dt>
                <dd className="text-xs text-fg-soft">
                  {r.protocols.map((p) => PROTOCOL_LABEL[p]).join(', ')}
                </dd>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function DocsPage() {
  const caps = useCapabilities();
  const loc = useLocation();
  const [active, setActive] = useState('overview');
  useEffect(() => {
    document.title = 'Docs · JKY-Radar';
    const target = loc.pathname.endsWith('/rules') ? 'rules' : loc.hash.slice(1);
    if (target) setTimeout(() => document.getElementById(target)?.scrollIntoView(), 50);
  }, [loc.pathname, loc.hash]);
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setActive(e.target.id)),
      { rootMargin: '-30% 0px -60% 0px' },
    );
    NAV.forEach(([id]) => {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, []);

  return (
    <div className="mx-auto grid grid-cols-1 max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[200px_minmax(0,1fr)]">
      <nav className="hidden lg:block" aria-label="Documentation sections">
        <ul className="sticky top-24 space-y-0.5 text-sm">
          {NAV.map(([id, label]) => (
            <li key={id}>
              <a
                href={`#${id}`}
                className={cn(
                  'block rounded-md px-2.5 py-1.5 text-fg-soft hover:text-fg',
                  active === id && 'bg-raised font-medium text-fg',
                )}
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <article className="max-w-3xl space-y-6 leading-relaxed">
        <H2 id="overview">JKY-Radar documentation</H2>
        <p className="text-fg-soft">
          JKY-Radar is an API contract compatibility analyser. You give it two versions of a contract
          document; it reports which differences break existing clients, which might, which need human review,
          and which are safe. It works on documents only: it never calls your APIs and never fetches remote
          references.
        </p>
        <p className="text-fg-soft">
          “OpenAPI” is the open API description standard, unrelated to any AI company. JKY-Radar is
          vendor-neutral: contracts from your own services, GitHub, Stripe, internal platforms or anyone else
          are analysed the same way, as long as they use a supported format.
        </p>

        <H2 id="quickstart">Quick start</H2>
        <ol className="list-decimal space-y-2 pl-5 text-fg-soft">
          <li>Create an account. A private workspace is created for you.</li>
          <li>Create a project and choose its contract format.</li>
          <li>
            Upload or paste the version currently in production as the baseline, then the proposed version as
            the candidate. Format is detected from the content; you can override it.
          </li>
          <li>
            Open Compare, pick both versions and run the analysis. Results, the release gate and exports
            appear when it completes.
          </li>
          <li>
            Register the applications that consume the API to see who each change affects, then record a
            review decision.
          </li>
        </ol>

        <H2 id="formats">Support matrix</H2>
        <p className="text-fg-soft">
          Parsing, semantic comparison and breaking-change classification are separate capability levels.
          Values below come from the running server.
        </p>
        {caps.isLoading ? (
          <Skeleton className="h-64" />
        ) : caps.error ? (
          <ErrorState error={caps.error} />
        ) : (
          <div className="space-y-3">
            {caps.data!.adapters.map((c) => (
              <div key={c.id} className="panel p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{c.label}</h3>
                  <SupportBadge status={c.status} />
                  <span className="text-xs text-muted">{c.versions}</span>
                  {c.protocol && (
                    <span className="ml-auto text-xs text-muted">
                      {c.rules.tested} tested of {c.rules.registered} rules
                    </span>
                  )}
                </div>
                <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
                  <div>
                    Parse: <span className="text-fg-soft">{c.levels.parse}</span>
                  </div>
                  <div>
                    Semantic diff: <span className="text-fg-soft">{c.levels.semanticDiff}</span>
                  </div>
                  <div>
                    Classification: <span className="text-fg-soft">{c.levels.classification}</span>
                  </div>
                  <div>
                    Formats: <span className="text-fg-soft">{c.formats.join(', ')}</span>
                  </div>
                </dl>
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-fg-soft">
                  {c.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        <H2 id="rules">Rule catalog</H2>
        <p className="text-fg-soft">
          Rule IDs are immutable. Each has a fixed severity, a documented rationale and at least one positive
          and one negative test, except where marked.
        </p>
        <RuleCatalog />

        <H2 id="gate">Release gate</H2>
        <p className="text-fg-soft">The default policy evaluates in this order:</p>
        <ol className="list-decimal space-y-1.5 pl-5 text-fg-soft">
          <li>
            <strong className="text-fg">Block</strong> when any finding is breaking (after explicit, justified
            overrides).
          </li>
          <li>
            <strong className="text-fg">Inconclusive</strong> when coverage is unknown, or a change landed in
            a construct that is not decided formally.
          </li>
          <li>
            <strong className="text-fg">Warn</strong> for potentially breaking or needs-review findings, or
            when coverage is partial.
          </li>
          <li>
            <strong className="text-fg">Pass</strong> only when nothing needs action and coverage is full.
          </li>
        </ol>
        <p className="text-fg-soft">
          Admins can change actions per severity and add rule overrides with a written justification.
          Overrides change the gate, never the finding. Every policy change creates a new revision that is
          stored with each analysis.
        </p>

        <H2 id="impact">Consumer impact</H2>
        <p className="text-fg-soft">
          Impact is computed from consumers you register and the operations they declare (for example{' '}
          <code>GET /orders/{'{id}'}</code>, <code>Book.isbn</code>, <code>pkg.Service/Method</code> or a
          channel address). JKY-Radar does not observe traffic, so it reports <em>known</em> impact (exact
          dependency), <em>potential</em> impact (related or contract-wide changes) and risky changes with no
          registered dependent, which can still break unregistered clients.
        </p>

        <H2 id="security">Security and privacy</H2>
        <ul className="list-disc space-y-1.5 pl-5 text-fg-soft">
          <li>
            Sessions are opaque, server-side and stored as hashes; cookies are HttpOnly and SameSite=Lax.
            State-changing requests require a session-bound CSRF token.
          </li>
          <li>Passwords are hashed with argon2id.</li>
          <li>
            Every workspace resource is authorised through its stored workspace; other workspaces return “not
            found”.
          </li>
          <li>
            Secret-looking values (tokens, API keys, Authorization headers, private keys) are redacted before
            storage.
          </li>
          <li>
            Remote $ref and URL imports are never fetched. Postman scripts are never executed. YAML aliases,
            depth and size are bounded.
          </li>
          <li>Analyses run in an isolated worker thread with memory and time limits.</li>
          <li>Reviews, policy changes, uploads and exports are written to an append-only audit log.</li>
        </ul>

        <H2 id="limitations">Limitations</H2>
        <ul className="list-disc space-y-1.5 pl-5 text-fg-soft">
          {(caps.data?.limitations ?? []).map((l) => (
            <li key={l}>{l}</li>
          ))}
          <li>Protobuf analysis is single-file; imported definitions are not resolved.</li>
          <li>
            AsyncAPI support is experimental and uses a structural parser rather than the official parser.
          </li>
          <li>Postman v3 multi-file collections and URL imports are not supported.</li>
          <li>Password recovery by email is not implemented.</li>
        </ul>

        <H2 id="api">REST API and CLI</H2>
        <p className="text-fg-soft">
          All endpoints live under <code>/api/v1</code> and return <code>{'{ data, meta? }'}</code> or{' '}
          <code>{'{ error: { code, message, details?, requestId } }'}</code>.
        </p>
        <pre className="overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-code p-4 text-[12.5px] leading-relaxed">
          {`GET  /api/v1/capabilities              supported formats and tested rule counts
GET  /api/v1/rules                     the full rule catalog
POST /api/v1/projects/:pid/versions    upload (JSON body or multipart "file")
POST /api/v1/projects/:pid/analyses    { baselineId, candidateId, options }
GET  /api/v1/analyses/:aid/findings    ?severity=&ruleId=&search=&page=
GET  /api/v1/analyses/:aid/impact
GET  /api/v1/analyses/:aid/report      ?format=json|md|pdf`}
        </pre>
        <p className="text-fg-soft">The same engine runs offline from the repository:</p>
        <pre className="overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-code p-4 text-[12.5px]">
          {`npm run radar -- compare old.yaml new.yaml --format text
npm run radar -- compare old.graphql new.graphql --format json --fail-on warn`}
        </pre>
        <p className="text-sm text-muted">
          Exit code 1 means the gate failed, 2 means the input could not be parsed.
        </p>
      </article>
    </div>
  );
}
