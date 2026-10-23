# Deployment

JKY-Radar deploys as **one Node.js web service** that serves the API and the built SPA from the same origin, plus a **MongoDB** database (MongoDB Atlas recommended). Same-origin hosting keeps cookies first-party and avoids cross-site CSRF complications.

> Nothing has been deployed by the author of this document; the steps below are what to run with your own accounts.

## Environment variables

| Variable                   | Required           | Example / default                           | Notes                                                  |
| -------------------------- | ------------------ | ------------------------------------------- | ------------------------------------------------------ |
| `MONGODB_URI`              | yes                | `mongodb+srv://user:pass@cluster/jky_radar` | Atlas: enable TLS, restrict network access             |
| `SESSION_SECRET`           | yes                | 48+ random bytes                            | Startup fails in production with the dev default       |
| `WEB_ORIGIN`               | yes                | `https://jky-radar.example.com`             | Exact browser origin(s), comma separated               |
| `API_ORIGIN`               | yes                | same as `WEB_ORIGIN` for same-origin        |                                                        |
| `NODE_ENV`                 | yes                | `production`                                | Enables Secure cookies and `upgrade-insecure-requests` |
| `SERVE_WEB`                | for same-origin    | `true`                                      | API serves `apps/web/dist` with SPA fallback           |
| `TRUST_PROXY`              | behind a proxy     | `1`                                         | Correct client IPs for rate limiting                   |
| `PORT`                     | no                 | `4000`                                      | Render sets this automatically                         |
| `MAX_SPEC_BYTES`           | no                 | `2097152`                                   | Upload cap                                             |
| `ANALYSIS_TIMEOUT_MS`      | no                 | `20000`                                     | Worker wall-clock limit                                |
| `ANALYSIS_ISOLATION`       | no                 | `worker`                                    | `inline` only for tests                                |
| `ANALYSIS_CONCURRENCY`     | no                 | `2`                                         | Use `1` on small instances                             |
| `DEMO_SEED_ENABLED`        | no                 | `true`                                      | Idempotent public demo seed at startup                 |
| `ENABLE_REMOTE_URL_IMPORT` | no                 | `false`                                     | Not implemented; must stay false                       |
| `VITE_API_BASE_URL`        | split hosting only | `https://api.example.com`                   | Build-time variable for the SPA                        |

## Render (blueprint)

1. Create a MongoDB Atlas cluster and database user; allow Render's egress IPs (or 0.0.0.0/0 with a strong password if you accept that risk).
2. In Render choose **New → Blueprint**, select this repository; `render.yaml` defines the `jky-radar` web service.
3. When prompted set `MONGODB_URI`, and set `WEB_ORIGIN` and `API_ORIGIN` to the service URL (for example `https://jky-radar.onrender.com`). `SESSION_SECRET` is generated.
4. Deploy. Build: `npm ci && npm run build`; start: `npm start`; health check: `/api/v1/health`.
5. Open the URL; the public demo appears after the first startup seed (a few seconds).

Free instances sleep when idle. JKY-Radar keeps analysis state in MongoDB and re-queues interrupted analyses on startup, so a sleeping instance does not lose work, but the first request after sleep is slow.

## Docker

```bash
docker build -t jky-radar .
docker run -p 4000:4000 \
  -e MONGODB_URI=... -e SESSION_SECRET=... \
  -e WEB_ORIGIN=https://your.domain -e API_ORIGIN=https://your.domain \
  -e NODE_ENV=production jky-radar
```

`docker compose up --build` runs MongoDB and the app locally on http://localhost:4000 (with `NODE_ENV=development` so cookies work over plain HTTP).

## Split hosting (static SPA + API elsewhere)

Possible but not the default. Build the SPA with `VITE_API_BASE_URL=https://api.example.com`, set `WEB_ORIGIN` on the API to the SPA origin, and serve both under the same registrable domain (for example `app.example.com` and `api.example.com`) so SameSite=Lax cookies are still sent. Cross-site hosting on unrelated domains would require `SameSite=None` cookies, which this build deliberately does not use.

## Production checklist

- [ ] `NODE_ENV=production`, strong `SESSION_SECRET`, HTTPS only.
- [ ] `WEB_ORIGIN`/`API_ORIGIN` exactly match the public origin.
- [ ] Atlas user limited to the JKY-Radar database; network access restricted; backups on.
- [ ] `TRUST_PROXY=1` behind Render or another proxy.
- [ ] One instance (rate limits and the analysis queue are in-process).
