# Backend Decisions

Choices made while implementing `plan/backend` where the plan was silent or unclear.

## 01-server-setup

- **Prisma pinned to 6.x** (`prisma` / `@prisma/client` 6.19.3). npm's `latest` tag for `prisma` is an 8.0 release
  candidate, and Prisma 7+ moves the datasource URL into `prisma.config.ts` and requires driver adapters. 6.x matches
  `plan/database/01-setup-migrations` as written (`url = env("DATABASE_URL")`, `previewFeatures`, `prisma-client-js`).
  The database builder may upgrade later.
- **Minimum database pieces created here** because no database work existed: `server/docker-compose.yml` (exactly as in
  `database/01` step 1) and a `server/prisma/schema.prisma` with only the generator and datasource, no models, so
  `GET /api/health` can run `SELECT 1`. Extensions, the `init` migration, and the `db:migrate`/`db:reset`/`db:studio`
  scripts are left to `database/01`. Only `db:up` was added, since tests need Postgres.
- **ESM** (`"type": "module"`, NodeNext), so relative imports use `.js` suffixes.
- **Socket.IO and cron are not attached in `index.ts` yet.** They belong to backend/07 and backend/09.
- **`JWT_SECRET` must be at least 32 characters.** Other required variables only need to be non-empty.
- **CORS** allows `http://localhost:8081` (Expo web dev server). Native apps send no `Origin` header, so CORS doesn't apply to them.
- **Extra error mappings** beyond the plan's list, all using the standard error shape: malformed JSON returns
  `400 VALIDATION_ERROR`, a body over 1 MB returns `413 PAYLOAD_TOO_LARGE`, unknown routes return `404 NOT_FOUND`, and
  unhandled errors return `500 INTERNAL` with a generic message (details are logged only).
- **Logging** comes from `lib/logger.ts` (pino). The `Authorization` and `Cookie` headers are redacted. It is silent when `NODE_ENV=test`.
- **`contracts/common.ts`** holds the `ErrorResponse` and `HealthResponse` schemas.
