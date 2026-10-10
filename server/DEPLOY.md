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
- `NODE_ENV=production` is baked in, so `/api/dev/login-as` is **not mounted**.

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

Not available yet: the seed script is owned by `plan/database` and doesn't exist on this branch. `/dev/login-as`
stays off in production; if the demo needs it, it must first be guarded with a `DEMO_KEY` header (not built).

## Monitoring

Host logs are pino JSON (one line per request; `Authorization`/`Cookie` redacted). `/api/health` runs `SELECT 1`
and is the host health check.

## Demo checklist

Two phones, cellular data, deployed API.

- [ ] Two phones signed in as different users in the same group (auth + groups/invites built; needs deploy + Google client IDs)
- [ ] Phone A adds a preference, the list updates on phone B (needs backend/04, 06)
- [ ] Check off items while shopping, finish trip, items appear in the cabinet with expiration dates (needs 05, 06)
- [ ] Mark Oreos "ran out", they come back on the list (needs 05, 06)
- [ ] Scan a SmartLabel / barcode, see calories and allergens and an allergen badge for a member (needs 08 finished)
- [ ] Recipe suggestions from expiring items; price estimate for the list (needs 10 finished)
- [ ] Recall alert shown (seeded) (needs 09 finished + seed)
