# Security and privacy

## Threat model in one paragraph

Users upload untrusted contract documents and expect their workspace data to be private. The main risks are cross-tenant access, session theft or forgery, malicious documents (parser bombs, prototype pollution, remote references used for SSRF, ReDoS), leaking secrets embedded in collections, and resource exhaustion.

## Controls

| Area             | Control                                                                                                                                                                                                                                                   | Where                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Passwords        | argon2id (19 MiB, t=2), uniform error and timing for unknown users                                                                                                                                                                                        | `apps/api/src/modules/auth.js`              |
| Sessions         | 32-byte opaque token, stored as SHA-256, HttpOnly, SameSite=Lax, Secure in production, TTL, rotation on login, revoke-all via `sessionVersion`                                                                                                            | `middleware/auth.js`                        |
| CSRF             | Session-bound HMAC token in `X-CSRF-Token` equal to the cookie; Origin/Referer allow-list; signed anonymous tokens                                                                                                                                        | `middleware/auth.js`                        |
| Authorisation    | Every resource resolved through its stored workspace and the caller's active membership; 404 for non-members, 403 for insufficient role; self-approval forbidden by policy                                                                                | `services/access.js`, `modules/analyses.js` |
| CI tokens        | Project-scoped, `jkyr_` + 32 random bytes, stored as SHA-256, shown once; default 90-day expiry; revocable; one generic 401 for every invalid case; creator's membership and role re-checked on every call; usable only on `/ci/*`, which ignores cookies | `modules/tokens.js`                         |
| Headers          | helmet: strict CSP (no inline scripts, `frame-ancestors 'none'`), nosniff, referrer policy, no `x-powered-by`; `no-store` on private responses                                                                                                            | `app.js`                                    |
| Input validation | Zod for params, query and bodies; JSON body limit; multer file size/count limits; extension allow-list; strict UTF-8 decoding; path separators rejected in file names                                                                                     | `packages/shared`, `modules/projects.js`    |
| Parsing          | Byte cap, NUL rejection, depth and node limits, bounded alias expansion, no YAML custom tags or merge keys, duplicate keys rejected, `__proto__` stored as own property, GraphQL `maxTokens`                                                              | `packages/radar-adapters/src/parse`         |
| SSRF             | Remote `$ref` never fetched; URL import not implemented and refused at startup in production                                                                                                                                                              | adapters, `config/env.js`                   |
| ReDoS            | Regex `pattern`s are compared as strings and never executed                                                                                                                                                                                               | `radar-core/schema/compare.js`              |
| Secrets          | Credential-like values and secret-named keys redacted before hashing and storage; logs scrub sensitive keys and never contain contract content                                                                                                            | `redact.js`, `lib/logger.js`                |
| Scripts          | Postman pre-request and test scripts are never executed                                                                                                                                                                                                   | Postman adapter                             |
| Isolation        | Analyses run in worker threads with heap and wall-clock limits; bounded concurrency; quotas per workspace and project                                                                                                                                     | `services/analysis-runner.js`               |
| Rate limiting    | Auth, upload, analysis and global limits                                                                                                                                                                                                                  | `app.js`                                    |
| Audit            | Append-only events for uploads, analyses, reviews, overrides, policy and membership changes, exports; immutability hooks on reviews, findings, versions and audit records                                                                                 | `models/index.js`, `services/audit.js`      |
| Output           | React escapes all contract text; no `dangerouslySetInnerHTML`; reports downloaded as attachments                                                                                                                                                          | web, `modules/analyses.js`                  |

## Verified by tests

`apps/api/test/api.test.js`, `apps/api/test/ci-tokens.test.js` and `tests/security/security.test.js` cover: CI token hashing, expiry, revocation, cross-project isolation and creator access loss, CSRF rejection, cross-origin rejection, cookie flags, horizontal (IDOR) access to every resource type, vertical escalation by viewers and reviewers, self-approval, block overrides, immutability of versions/findings/audit, remote `$ref` never fetched, secret redaction, upload validation (duplicate, invalid, wrong protocol, traversal names, oversized), XSS payloads served inertly, operator-injection payloads, rate limiting, and cache headers. `packages/radar-adapters/test/adversarial.test.js` covers 26 malicious or malformed documents.

## Known gaps

- Rate limiting and the analysis queue are in-process; a multi-instance deployment needs a shared store.
- No email verification or password recovery.
- MFA is not implemented.
- Dependency auditing runs in CI (`npm audit --omit=dev --audit-level=high`).

## Reporting

Please report vulnerabilities privately to the repository owner rather than opening a public issue.
