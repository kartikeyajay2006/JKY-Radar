# Decision record

Short architecture decision records. Each lists the decision, the reason, and the trade-off accepted.

1. **MERN in plain JavaScript with JSDoc types.** The project is MongoDB, Express, React and Node written in JavaScript (ES2023 modules, `.js`/`.jsx`). Types are expressed as JSDoc (`@typedef`, `@param`, `@import`) and verified by `tsc --checkJs` in `npm run typecheck`; there are no TypeScript source files. The code base was first written in TypeScript and converted mechanically, with all tests re-run afterwards.
2. **Modular monolith, pure engine packages.** One deployable API. The engine has no Express or Mongoose imports, so it is unit-testable and reused by the browser playground and the CLI.
3. **npm workspaces, no build step for Node code.** Packages export their JavaScript source directly; the API and CLI run with plain `node` (`node --watch` in development). Only the React app has a build (Vite).
4. **Node 22 LTS in CI and the Render blueprint.** The brief names Node 24; the code has no 24-only APIs and `engines` is `>=22.12`. Node 22 is what was available and verified locally; Node 24 can be selected by changing `NODE_VERSION`.
5. **Own JSON parser, `yaml` for YAML.** Source positions for every JSON pointer, duplicate-key rejection and depth/node limits are needed for diagnostics and safety; `JSON.parse` provides none of these.
6. **graphql-js as parser and safety net, own coordinate-level differ.** graphql-js `findBreakingChanges` descriptions are strings; an own walker gives structured before/after values and source locations. Any graphql-js breaking or dangerous change not matched by a JKY rule is surfaced as `GQL_UPSTREAM_UNMATCHED` so nothing is silently dropped.
7. **AsyncAPI uses an own structural parser (experimental).** `@asyncapi/parser` pulls in a large toolchain and can resolve remote references. The status is labelled experimental instead of claiming full support.
8. **Protobuf via protobufjs, single file.** Imports are not resolved; the limitation is reported as an ignored construct and the adapter is partial.
9. **Postman v3 unsupported.** Multi-file archive ingestion needs careful path-traversal and size handling that was not built; v3 documents are detected and rejected with guidance.
10. **Rules have fixed severity.** Context-dependent behaviour is expressed as separate rule IDs (`REQ_PROPERTY_REMOVED` vs `REQ_PROPERTY_REMOVED_STRICT`). Heuristic inputs (Postman) cap severity and tag the finding instead of mutating rule definitions.
11. **Coverage is categorical.** No percentage scores; `full`, `partial` or `unknown` with reasons and the tested-rule count.
12. **Opaque sessions over JWT.** Server-side sessions are revocable; tokens are stored as SHA-256 hashes; cookies are HttpOnly and SameSite=Lax.
13. **CSRF: session-bound HMAC token plus Origin check.** Recomputable from a per-session salt, so reloads do not need rotation; anonymous requests use a signed double-submit token.
14. **Same-origin deployment by default.** The API serves the built SPA (`SERVE_WEB=true`), which avoids third-party cookie and CORS pitfalls. Split hosting is documented as an alternative.
15. **Secrets redacted before storage.** Protected raw storage is not offered; the hash is of the redacted content and the redaction lines are shown to the uploader.
16. **No remote fetching at all.** URL import is not implemented and `ENABLE_REMOTE_URL_IMPORT=true` is rejected at startup in production.
17. **Worker-thread isolation in production.** A heap limit and wall-clock timeout per analysis; inline mode exists for tests and is documented.
18. **Idempotent analyses.** The input hash covers both content hashes, engine, rule, adapter and policy versions, and options; repeating a request returns the stored analysis.
19. **Self-approval forbidden by default; block overrides need rationale.** Enforced server-side; overrides never rewrite findings.
20. **Demo seeded by running the engine.** The public demo is produced from fixtures at startup, keyed by a hash of fixtures and engine versions, so it can never show hand-written results.
