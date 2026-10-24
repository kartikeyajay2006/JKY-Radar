# Status

Last updated: 2026-10-24. This file lists what is implemented and verified, what is partial, and what is not built. Claims are backed by the commands under **Evidence**.

## Done

### Engine (`packages/radar-core`, `packages/radar-adapters`, `packages/radar-cli`)

- Canonical, protocol-aware model; immutable versioned rule registry with **157 rules**, 156 of which have positive and negative tests (`GQL_UPSTREAM_UNMATCHED` is an untested safety net, labelled as such).
- Bounded JSON (own parser with positions) and YAML parsing; structural format detection with user override and mismatch detection; secret redaction.
- Adapters: OpenAPI 3.0/3.1 (supported), OpenAPI 3.2 (partial), Swagger 2.0 (supported), GraphQL SDL and introspection (supported, with graphql-js safety net), Postman v2.1 (partial, capped severities), JSON Schema draft-04 to 2020-12 with selectable polarity (supported), manual REST (supported), Protobuf/gRPC (partial), AsyncAPI 2.x/3.x (experimental), cross-format HTTP (experimental, opt-in).
- Direction-aware schema comparison, dialect normalisation (3.0 `nullable` = 3.1 `type: null`), cycle-safe local `$ref`, conservative `allOf` merge, explicit needs-review for composition, regex, unmodelled keywords and unresolved refs.
- Coverage (categorical), release gate with justified overrides, consumer impact, JSON/Markdown reports, deterministic fingerprints, operation alias mapping.
- Offline CLI with gate exit codes, plus `radar check` to gate a release through the server with a CI token.

### Backend (`apps/api`)

- Registration, login, logout, revoke-all; argon2id; opaque hashed sessions; session-bound CSRF; helmet with strict CSP; rate limits; `no-store` for private data.
- Workspaces, invitations, five roles, tenant authorisation through stored resource chains.
- Immutable spec versions with SHA-256 raw and normalised hashes, duplicate detection, diagnostics with line numbers, multipart and JSON uploads.
- Analysis runner: idempotent input hash, bounded concurrency, worker-thread isolation with heap and time limits, persisted stages, resumption on startup.
- Findings pagination, facets, search; impact; sources for the compare view; reviews with self-approval rule and block overrides; versioned policies; notifications; append-only audit; analytics overview.
- Reports: JSON, Markdown, branded PDF (pdfkit, no browser runtime).
- Project-scoped CI tokens (hashed, expiring, revocable, creator access re-checked per call) and `POST /ci/check`, which uploads a candidate and returns the release gate in one call.
- Public read-only demo seeded idempotently by running the engine on fixtures.

### Frontend (`apps/web`)

- Landing page with a live 3D radar (three.js) drawn from the engine running in the browser, demo, docs with rule catalog, sign in, registration, 403/404/error screens.
- App shell with workspace switcher, breadcrumbs, command palette (Ctrl/⌘ K for pages, projects, recent analyses, workspaces and actions), notifications, theme toggle; overview analytics, projects, versions (upload, paste, manual builder), compare (format compatibility, polarity, cross-format opt-in, rename mapping), analysis (findings explorer, compare view with source highlights, impact graph and table, coverage and diagnostics, reviews, Radar Replay metadata, exports), consumers, policies, CI access (create, copy once, revoke), activity and audit, notifications, settings and members.
- Light and dark themes, keyboard focus, reduced motion, accessible confirmation dialogs, mobile layouts without horizontal scroll, WCAG 2.1 AA (axe) on public pages.

### Delivery

- GitHub Actions CI (typecheck, lint, Prettier, tests against MongoDB, build, support-matrix drift check, Playwright, dependency audit).
- Render blueprint, Dockerfile and docker-compose (image verified locally), CLI pull-request gate example.

## Partial or experimental (by design, labelled in the product)

- OpenAPI 3.2: QUERY and additionalOperations compared; `itemSchema`, `$self`, `querystring` parameters, tag hierarchy are not.
- Postman v2.1: requests, query/header keys, variables, body shape and auth compared; responses are unknown, severities capped at potentially breaking.
- Protobuf: single file; imports, custom options and extensions not resolved; editions parsed but feature semantics not modelled.
- AsyncAPI: own structural parser; bindings and traits only checked for changes; non-JSON payload formats not compared.
- Cross-format HTTP comparison: lossy projection, coverage always partial.

## Not implemented

- Postman Collection v3 multi-file ingestion (detected and rejected with guidance).
- Import from URL (no server-side fetching at all).
- GitHub OAuth sign-in. Tokens are per project; there are no workspace-wide or fine-grained scopes.
- Password recovery, email verification, MFA.
- Multi-instance deployment (rate limits and the analysis queue are in-process).
- Live deployment: no hosted URL is claimed. `docs/DEPLOYMENT.md` lists the exact steps.

## Evidence

Run locally on Node 22.22, npm 11, MongoDB 7 (Docker), Chromium 156 (Playwright 1.64; `PW_CHROMIUM_PATH` can point at a system Chrome):

| Command                             | Result                                                                                                                                                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                 | JSDoc types check clean in all workspaces (`tsc --checkJs`)                                                                                                                                                                                                   |
| `npm run lint`                      | 0 errors, 0 warnings                                                                                                                                                                                                                                          |
| `npm run format:check`              | all files formatted                                                                                                                                                                                                                                           |
| `npm test`                          | 14 files, **494 tests passed** (437 engine/CLI, 57 API integration, CI token and security against real MongoDB)                                                                                                                                               |
| `npm run test:e2e`                  | **23 passed**: full journey (register → project → uploads → analysis → filter → consumer → impact → review → PDF → CI token → pipeline gate → command palette), invalid upload diagnostics, public demo, mobile layout, axe WCAG 2.1 AA on 5 pages × 2 themes |
| `npm run build`                     | web app builds with Vite; API runs from source                                                                                                                                                                                                                |
| `npm run docs:matrix`               | 157 rules, 15 fixture pairs, no drift                                                                                                                                                                                                                         |
| `npm audit --omit=dev`              | 0 vulnerabilities                                                                                                                                                                                                                                             |
| `docker build -t jky-radar .` + run | health OK, SPA served, demo seeded through the compiled worker                                                                                                                                                                                                |
| GitHub Actions CI                   | green on `main` (run 40096937827: verify job incl. Playwright, and dependency audit)                                                                                                                                                                          |

## Risks

- In-process rate limits and queue assume a single instance.
- Free hosting tiers sleep; analyses survive restarts but the first request is slow.
- Rule semantics for composition and regex deliberately stop at "needs review"; teams must review those findings.
