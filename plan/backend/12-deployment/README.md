# 12 — Deployment & Demo

**Goal:** A public API + database the phones can reach during judging, plus a repeatable demo.

**Depends on:** everything in M2 (M3/M4 optional)

## Steps

1. **Dockerfile** (`server/Dockerfile`): build stage (`npm ci && npx prisma generate && npm run build`) → runtime stage `node:22-slim`
   running `npx prisma migrate deploy && node dist/index.js`.
2. **Target host: Akamai Cloud (Linode); not deployed.** The hackathon gives Akamai Cloud credits, but our Linode
   account was held for review and the review didn't clear in time. So the demo runs on the Docker stack locally
   (root `docker-compose.yml`). Moving it to Linode needs no code changes:
   - Everything is containers: `api` (`server/Dockerfile`, includes the Akamai AI agent and semantic search), `web`
     (`app/Dockerfile`), and `db` (`pgvector/pgvector:pg16-trixie`).
   - **Linode instance:** install Docker, copy the repo, set the secrets in `server/.env`, run `docker compose up -d --build`,
     and put a TLS proxy (Caddy or nginx) in front of ports 8080/3100. Rebuild `web` with
     `EXPO_PUBLIC_API_URL=https://<host>/api`.
   - **LKE (Linode Kubernetes):** push the two images to a registry and run them as Deployments. Use Linode Managed
     Postgres or a StatefulSet with pgvector for the database. Use Linode Object Storage for photos (S3-compatible, so it
     only needs an endpoint setting).
   - Inference stays on Akamai's hosted endpoint (`AKAMAI_BASE_URL`, OpenAI-compatible). Bringing our own inference
     means pointing that URL at a model server on a Linode GPU.
3. **Alternative host: Railway**
   1. New project → add the PostgreSQL plugin (copy its `DATABASE_URL`, add `?sslmode=require`).
   2. Deploy `server/` from GitHub (`main` branch, root `/server`).
   3. Set the env variables from `.env.example`. Generate `JWT_SECRET` with `openssl rand -hex 32`.
   4. Check that the `pg_trgm` / `fuzzystrmatch` extensions are allowed (they are on Railway's Postgres). The init migration enables them.
   5. Use the public URL as `EXPO_PUBLIC_API_URL` in the app.
   - *Alternative:* Google Cloud Run + Cloud SQL (Postgres), using the same Google Cloud project as auth.
3. **Jobs:** the cron jobs run inside the single server instance. Keep the service at **1 instance** so they don't run twice.
4. **Seed production for the demo:** `DATABASE_URL=<prod> npx prisma db seed` (seeded users only. Leave `/dev/login-as` turned off in production
   unless needed for the demo, and if so, guard it with a `DEMO_KEY` header).
5. **Monitoring:** watch the host's logs (pino JSON). `/api/health` is used as the host health check.
6. **CI** (optional, GitHub Actions): on PRs to `main`, run `npm ci && npx prisma validate && npm run build && npm test` in `server/`.
7. **Demo checklist**
   - [ ] Two phones signed in as different users in the same group
   - [ ] Phone A adds a preference → the list updates on phone B
   - [ ] Check off items while shopping → finish trip → items appear in the cabinet with expiration dates
   - [ ] Mark Oreos "ran out" → they come back on the list
   - [ ] Scan a SmartLabel / barcode → calories and allergens, and an allergen badge for a member
   - [ ] Recipe suggestions from expiring items; price estimate for the list
   - [ ] Recall alert shown (seeded)

## Done when

- [ ] A fresh phone on cellular data can sign in and use the deployed API
