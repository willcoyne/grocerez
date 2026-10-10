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

## 09 (partial, parallel)

Built standalone while 02-07 were in progress elsewhere. No routes, models, migrations, cron, or app wiring.

- **Done:** `src/lib/expiration.ts` (`estimateExpiration`, category shelf-life table; `household`/`other`/unknown → `null`),
  `src/modules/recalls/openfda.ts` (`fetchRecalls` with injectable `fetch`, `skip` paging, zod-validated rows, malformed
  rows dropped, 404 = no results, `redirect: "error"`, 15s timeout; `recallLink`), `src/modules/recalls/match.ts`
  (pure `matchRecalls`, pg_trgm-compatible `similarity` / `strictWordSimilarity`, whole-word `brandAppears`).
  Tests: `test/recalls.test.ts` (stubbed fetch, no network or DB).
- **Matching uses `strict_word_similarity`, not `similarity()`.** Whole-string `similarity("baby spinach", <long recall
  description>)` stays well under 0.35 even for an exact hit, so the plan's rule would almost never match. The score is
  the best over item name, aliases, and `brand + ' ' + productName`, each against the best whole-word run of the
  description. When the SQL version is written, use `strict_word_similarity(name, product_description) >= 0.35` so it
  agrees with the JS function.
- **Brand gate** is a case-insensitive whole-word check ("Valley" does not match "Valleyview").
- **Alert link:** openFDA has no per-recall web page, so `recallLink` returns the API query for that `recall_number`.
- **Remaining:** `recalls`/`recall_matches` tables (database/09), `jobs/importRecalls.ts` + `node-cron` `"0 6 * * *"`
  wiring in `index.ts` (upsert by `external_id`, last-import tracking), per-item re-match on cabinet add, saving
  estimates in `finishTrip`/cabinet add and `expiration_source`, `GET /groups/:groupId/alerts`, `POST .../dismiss`,
  `cabinet:changed` emit, `OPENFDA_API_KEY` in config/.env.example, the Done-when checks.
