# Deploying the GrocerEZ API

Plan: `plan/backend/12-deployment`. One container (`server/Dockerfile`) + one Postgres 16. Nothing here creates cloud
resources for you; each step is done once by a team member with access to the account.

## The image

```sh
cd server
docker build -t grocerez-api .
docker run --rm -p 3000:3000 --env-file .env -e DATABASE_URL=postgresql://grocerez:grocerez@host.docker.internal:5432/grocerez grocerez-api
curl http://localhost:3000/api/health   # {"ok":true}
```

- Base `node:22-slim`, runs as the non-root `node` user, listens on `PORT`.
- **Release step:** the container runs `npx prisma migrate deploy` before `node dist/index.js` on every start.
  It's idempotent; if it fails (bad `DATABASE_URL`, failed migration) the container exits and the host shows the error in logs.
- `NODE_ENV=production` is baked in, so `/api/dev/login-as` is **not mounted** unless `DEMO_KEY` is set (see "Seeding").
- Verified locally (2026-10-10): builds; against an empty database it applies all migrations and serves `/api/health`;
  against an up-to-date one it logs "No pending migrations"; with openFDA unreachable and no `OPENFDA_API_KEY` the startup
  recall import logs `recall import failed` and the server keeps serving.

## Environment variables

All are required except where noted. The server exits on start, naming every missing or invalid variable.

| Variable | Value in production |
|---|---|
| `NODE_ENV` | `production` (already set by the image) |
| `PORT` | Railway/Cloud Run inject it; otherwise `3000` |
| `DATABASE_URL` | Host Postgres URL with `?sslmode=require` appended |
| `JWT_SECRET` | `openssl rand -hex 32` (64 chars; minimum 32) |
| `GOOGLE_CLIENT_IDS` | Comma-separated iOS, Android and Web OAuth client IDs (Google Cloud console) |
| `ANTHROPIC_API_KEY` | Anthropic Console key |
| `AWS_REGION`, `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | See "S3 setup" in `README.md` |
| `APP_LINK_BASE` | App deep-link base, `grocerez://` |
| `TRUST_PROXY` | `1` on Railway / Cloud Run (one proxy hop), so rate limits see the client IP. Optional, default off |
| `CORS_ORIGINS` | Optional. Comma-separated browser origins (only an Expo **web** build needs this; native apps send no Origin). Default `http://localhost:8081` |
| `DEMO_KEY` | Optional. Set only if the demo needs `/dev/login-as` on the deployed API (`openssl rand -hex 32`, min 32 chars). Unset after judging |
| `OPENFDA_API_KEY` | Optional. Raises the openFDA rate limit for the daily recall import; works without it |
| `RESEND_API_KEY` | Optional (invite emails, stretch goal) |

## Railway (recommended)

1. New project, add the **PostgreSQL** plugin. Copy its `DATABASE_URL` and append `?sslmode=require`.
   `pg_trgm`, `fuzzystrmatch` and `pgcrypto` are allowed on Railway Postgres; the `init` migration enables them.
2. New service from GitHub, `main` branch, **root directory `/server`**. Railway detects the `Dockerfile`.
3. Set the variables above on the service. `TRUST_PROXY=1`.
4. Settings: **replicas = 1** (cron jobs run in-process and must not run twice), health check path `/api/health`.
5. Generate a public domain. Put `https://<domain>` in the app as `EXPO_PUBLIC_API_URL`.
   Socket.IO uses the same URL; Railway supports WebSockets with no extra config.

## Alternative: Google Cloud Run + Cloud SQL

Same Google Cloud project as the OAuth clients.

1. Cloud SQL for PostgreSQL 16 instance + database + user. Enable the extensions (`cloudsql` allows `pg_trgm`,
   `fuzzystrmatch`, `pgcrypto`; the migration creates them).
2. Build and push: `gcloud builds submit server --tag <region>-docker.pkg.dev/<project>/grocerez/api`.
3. Deploy:
   ```sh
   gcloud run deploy grocerez-api --image <region>-docker.pkg.dev/<project>/grocerez/api \
     --add-cloudsql-instances <project>:<region>:<instance> \
     --min-instances 1 --max-instances 1 --no-cpu-throttling --session-affinity --allow-unauthenticated \
     --set-env-vars TRUST_PROXY=1,APP_LINK_BASE=grocerez://,... \
     --set-secrets JWT_SECRET=jwt-secret:latest,ANTHROPIC_API_KEY=anthropic-key:latest,...
   ```
   `DATABASE_URL=postgresql://USER:PASS@localhost/DB?host=/cloudsql/<project>:<region>:<instance>`.
   `min = max = 1` and `--no-cpu-throttling` keep the in-process cron jobs running exactly once; `--session-affinity`
   keeps Socket.IO polling on one instance.
4. Cloud Run health checks hit the container port; point a startup/liveness probe at `/api/health`.

## Seeding production for the demo

```sh
DATABASE_URL=<prod url> npx prisma db seed
```

**Not available yet:** the seed script (`prisma/seed.ts`, `plan/database/10-seed-data`) is owned by the database builder and
doesn't exist on this branch. Until it lands, the demo group/users/recall must be created by hand or through the app.

`/dev/login-as/:userId` (seeded `seed-*` users only) is off in production. To use it in the demo deployment, set `DEMO_KEY`
on the service; the route is then mounted and every call needs the header `X-Demo-Key: <DEMO_KEY>` (otherwise `401`).
Remove `DEMO_KEY` after the demo.

## CI

`.github/workflows/server-ci.yml` runs on PRs to `main` that touch `server/`: `npm ci`, `prisma validate`,
`prisma migrate deploy` against a Postgres 16 service, `npm run build` (tsc), `npx vitest run`. No secrets needed; the
vitest config stubs every external key.

## Monitoring

Host logs are pino JSON (one line per request; `Authorization`/`Cookie` redacted). `/api/health` runs `SELECT 1`
and is the host health check.

## Demo checklist

Two phones, cellular data, deployed API. **Backend** = the API behind the item is built and covered by tests against
local Postgres. No item is checked: each needs the real deploy, phones with the app, and the accounts listed under it.

Built locally:
- [x] Docker image builds, migrates, serves `/api/health`, survives openFDA being unreachable
- [x] `DEMO_KEY`-guarded `/dev/login-as`, configurable `CORS_ORIGINS`, `TRUST_PROXY`
- [x] CI workflow (runs once the repo is on GitHub)

On phones (all need: Railway or GCP project with Postgres, public URL in `EXPO_PUBLIC_API_URL`, `JWT_SECRET`, and an app build):
- [ ] Two phones signed in as different users in the same group. Backend: auth, groups, email invites. Needs Google OAuth
      iOS/Android/Web client IDs in `GOOGLE_CLIENT_IDS` (or `DEMO_KEY` + the seed for `/dev/login-as`)
- [ ] Phone A adds a preference, the list updates on phone B. Backend: preferences, list engine, Socket.IO
- [ ] Check off items while shopping, finish trip, items appear in the cabinet with expiration dates. Backend: 05, 06
- [ ] Mark Oreos "ran out", they come back on the list. Backend: 05, 06. Needs the seed (or Oreos added by hand)
- [ ] Scan a SmartLabel / barcode, see calories and allergens and an allergen badge for a member. Backend: 08 (Open Food
      Facts / SmartLabel need no key). Needs a phone camera build
- [ ] Recipe suggestions from expiring items; price estimate for the list. Backend: 10. Needs `ANTHROPIC_API_KEY`
- [ ] Recall alert shown (seeded). Backend: 09. Needs the seed's fake recall (`plan/database/10`) or a real openFDA match
- [ ] Photos (avatars, item photos). Backend: 11. Needs the S3 bucket + IAM keys (`AWS_*`, `S3_BUCKET`)
