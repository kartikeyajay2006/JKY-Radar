# REST API (v1)

Base path `/api/v1`. JSON in and out. Successful responses: `{ "data": ..., "meta"?: ... }`. Errors: `{ "error": { "code", "message", "details"?, "requestId" } }` with conventional status codes (400, 401, 403, 404, 409, 413, 415, 422, 429, 500).

**Authentication:** opaque session cookie `jky_sid` (HttpOnly, SameSite=Lax, Secure in production) set by register/login.
**CSRF:** every `POST/PUT/PATCH/DELETE` needs the `X-CSRF-Token` header equal to the `jky_csrf` cookie. Get a token from `GET /auth/csrf`, `GET /auth/session` or the register/login response. Cross-origin `Origin` headers are rejected.
**Authorisation:** resources are resolved through their stored workspace and the caller's membership. Non-members receive 404; members without the required role receive 403.
**Caching:** private responses are `Cache-Control: no-store`; only `/demo/*`, `/capabilities` and `/rules` are cacheable.

## Public

| Method | Path                                                                              | Description                                                       |
| ------ | --------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| GET    | `/health`                                                                         | `{ status, db, engineVersion }` (no secrets)                      |
| GET    | `/capabilities`                                                                   | Formats, statuses, tested rule counts, limits, roles, limitations |
| GET    | `/rules`                                                                          | Full rule catalog                                                 |
| GET    | `/demo/analyses`                                                                  | Published demo analyses                                           |
| GET    | `/demo/analyses/:aid` (`/findings`, `/impact`, `/sources`, `/reviews`, `/report`) | Read-only demo detail                                             |

## Auth

| Method | Path               | Body / notes                                                                      |
| ------ | ------------------ | --------------------------------------------------------------------------------- |
| GET    | `/auth/csrf`       | Returns `{ csrfToken }`                                                           |
| GET    | `/auth/session`    | `SessionDTO` or `null`                                                            |
| GET    | `/auth/me`         | `SessionDTO` or 401                                                               |
| POST   | `/auth/register`   | `{ email, password (≥10, letters + digit), name }` → creates a personal workspace |
| POST   | `/auth/login`      | `{ email, password }` → rotates the session                                       |
| POST   | `/auth/logout`     | Deletes the session                                                               |
| POST   | `/auth/logout-all` | Revokes every session of the user                                                 |
| PATCH  | `/auth/me`         | `{ name?, preferences?: { theme } }`                                              |

## Workspaces and members

| Method        | Path                                    | Min role                                   |
| ------------- | --------------------------------------- | ------------------------------------------ |
| GET           | `/workspaces`                           | member                                     |
| POST          | `/workspaces`                           | any user (`{ name }`)                      |
| GET, PATCH    | `/workspaces/:wid`                      | VIEWER / ADMIN                             |
| GET           | `/workspaces/:wid/members`              | VIEWER                                     |
| POST          | `/workspaces/:wid/invitations`          | ADMIN (`{ email, role }`, user must exist) |
| PATCH, DELETE | `/workspaces/:wid/members/:mid`         | ADMIN (members may remove themselves)      |
| GET           | `/invitations`                          | own pending invitations                    |
| POST          | `/invitations/:mid/accept` · `/decline` | invitee                                    |
| GET           | `/workspaces/:wid/overview`             | VIEWER, analytics from persisted data      |
| GET           | `/workspaces/:wid/analyses?page=`       | VIEWER                                     |
| GET           | `/workspaces/:wid/audit?page=`          | ADMIN                                      |

## Projects, versions, analyses

| Method     | Path                                         | Min role            | Notes                                                                                                                                                                                                        |
| ---------- | -------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET, POST  | `/workspaces/:wid/projects`                  | VIEWER / MAINTAINER | `?search=`; `{ name, protocol, description? }`                                                                                                                                                               |
| GET, PATCH | `/projects/:pid`                             | VIEWER / MAINTAINER |                                                                                                                                                                                                              |
| GET        | `/projects/:pid/versions`                    | VIEWER              |                                                                                                                                                                                                              |
| POST       | `/projects/:pid/versions`                    | MAINTAINER          | JSON `{ label, content, fileName?, protocol?, notes? }` or multipart `file` + `label`; 409 on duplicate content, 413 too large, 415 bad file, 422 invalid with `details.diagnostics[]` (code, message, line) |
| GET        | `/versions/:vid`, `/versions/:vid/content`   | VIEWER              | content is the redacted stored text                                                                                                                                                                          |
| GET        | `/projects/:pid/entities`                    | VIEWER              | operation keys from the latest version (for dependency autocomplete)                                                                                                                                         |
| POST       | `/projects/:pid/analyses`                    | MAINTAINER          | `{ baselineId, candidateId, options? }` → 202 queued, or 200 with `cached: true` for identical inputs                                                                                                        |
| GET        | `/projects/:pid/analyses`                    | VIEWER              | paginated                                                                                                                                                                                                    |
| GET        | `/analyses/:aid`                             | VIEWER              | state, stage, gate, coverage, versions, hashes, timings                                                                                                                                                      |
| GET        | `/analyses/:aid/findings`                    | VIEWER              | `?page&pageSize&severity=&ruleId=&entity=&search=`; `meta.facets`                                                                                                                                            |
| GET        | `/analyses/:aid/impact`                      | VIEWER              | known / potential / unmatched                                                                                                                                                                                |
| GET        | `/analyses/:aid/sources`                     | VIEWER              | both contract texts for the compare view                                                                                                                                                                     |
| GET        | `/analyses/:aid/report?format=json\|md\|pdf` | VIEWER              | attachment download                                                                                                                                                                                          |
| GET, POST  | `/analyses/:aid/reviews`                     | VIEWER / REVIEWER   | `{ decision: approve\|reject\|request_changes\|comment, rationale, overrideBlock? }`                                                                                                                         |

Analysis options: `jsonSchemaPolarity` (`request` or `response`), `allowCrossFormat`, `includeInformational`, `operationAliases` (baseline key → candidate key).

## Consumers and policy

| Method        | Path                                | Min role                                                 |
| ------------- | ----------------------------------- | -------------------------------------------------------- |
| GET, POST     | `/projects/:pid/consumers`          | VIEWER / MAINTAINER                                      |
| PATCH, DELETE | `/consumers/:cid`                   | MAINTAINER                                               |
| POST          | `/consumers/:cid/dependencies`      | MAINTAINER (`{ operationKey, evidenceSource?, notes? }`) |
| DELETE        | `/consumers/:cid/dependencies/:did` | MAINTAINER                                               |
| GET           | `/projects/:pid/policy`             | VIEWER (`{ current, history }`)                          |
| PUT           | `/projects/:pid/policy`             | ADMIN (creates a new revision)                           |

## Notifications

| Method | Path                                         |
| ------ | -------------------------------------------- |
| GET    | `/notifications?unread=true` (`meta.unread`) |
| PATCH  | `/notifications/:nid/read`                   |
| POST   | `/notifications/read-all`                    |

Rate limits: 600 requests/min per IP overall, 30 auth attempts per 15 minutes, 30 uploads and 20 analyses per minute per user.
