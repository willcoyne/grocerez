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

## 02-auth

- **Schema created here** (no database work existed): `prisma/migrations/*_init` (only the `pgcrypto`, `pg_trgm`,
  `fuzzystrmatch` extensions from `database/01`) and `*_users_profile` (`users`, `allergen` enum, `user_allergens`,
  `user_diets` with the diet CHECK list), exactly per `database/02-users`. Prisma models: `User`, `UserAllergen`,
  `UserDiet` (`user.allergens`, `user.diets`). Added `db:migrate`, `db:reset`, `db:studio` scripts. The database builder
  owns these from here; `database/01` and `database/02` checkboxes were left for them to verify.
- **Name and picture are only set on first sign-in.** The plan says to update email, name, and picture on every login,
  but `display_name` is user-editable (`PATCH /me`) and `avatar_url` may become an S3 key (backend/11), so overwriting them
  would undo the user's edits. Email is still refreshed on every login (lower-cased; it drives invite matching).
- **`User` response shape** (`contracts/auth.ts`): `{id, email, displayName, avatarUrl, zipCode}`. `googleSub` and
  timestamps are never returned.
- **`DELETE /me` returns the deleted `User` (200)**, matching the contract row literally. The owner handover from
  `database/11` is left to backend/03, since groups don't exist yet (marked with a `ponytail:` comment in `users/service.ts`).
- **`PATCH /me`** accepts `zipCode: null` to clear it, validates US ZIPs (`12345` or `12345-6789`), trims `displayName`
  (1-80 chars), and rejects unknown keys with 400.
- **Auth gate is global.** `requireAuth` runs on all of `/api` after the public routers (`/health`, `/auth/google`, and
  `/dev/*` outside production), so new routers are protected by default and unknown `/api` paths return 401 (not 404)
  without a token. It also returns 401 if the JWT's user no longer exists (one `count` query per request) and only accepts HS256.
- **`/dev/login-as/:userId`** is public (it is a login) and only mounted when `NODE_ENV !== "production"`.
- **Rate limit** on `/auth/google`: 20/min per IP via `express-rate-limit`, returning `429 RATE_LIMITED` in the standard
  error shape. Behind a proxy (backend/12) `app.set("trust proxy", 1)` is needed or every client shares one IP.
- **Google verification** lives in `lib/google.ts` (`verifyGoogleIdToken`), which tests replace with `vi.mock`. Any
  verification failure or `email_verified !== true` returns `401 UNAUTHENTICATED`.
- **Test note:** with vitest 5, a `mockRejectedValue` on the Google stub that is still queued or persistent when the test
  ends is reported as a test failure, so the rate-limit test uses resolved tokens instead.
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
## 11 (partial, parallel)

Built while 02 was in progress, so nothing is mounted and no checkboxes are ticked.

- **Done:** `lib/s3.ts` (`S3Client`, `presignPut` with 5-minute expiry, `presignGet` with 1-hour expiry),
  `contracts/uploads.ts`, `modules/uploads/{service,router}.ts` for `POST /uploads/presign`, and `test/uploads.test.ts`
  (stubbed presigner, no AWS calls). The contract matches the table: `{contentType, purpose}` -> `{uploadUrl, key}`.
- **`content-type` is a signed header** (`signableHeaders`). By default the presigner leaves it out of the signature, which
  would let a client PUT `text/html` (or anything else) to an image key. Now S3 rejects a PUT whose `Content-Type`
  doesn't match the approved type. The app must send exactly the `contentType` it asked for.
- **Keys are always generated by the server** (`${purpose}/${userId}/${uuid}.${ext}`). Extra body fields (`key`,
  `filename`, ...) are stripped by zod. A `userId` that isn't `[A-Za-z0-9_-]{1,64}` is refused (401) because it ends up in the key.
- **No size limit.** The plan doesn't give one, and a presigned PUT can't enforce a byte range. If we need one, switch to
  a presigned POST with a `content-length-range` condition.
- **No service/repo split.** There's no DB access yet, so the module has only `service.ts` and `router.ts`.
- **Remaining:** mount `uploadsRouter` under `/api` behind `requireAuth` in `app.ts` (after 02 lands). Endpoints that accept
  `avatarKey`/`photoKey` must check that the key starts with `avatar/${req.user.id}/` or `item-photo/${req.user.id}/` so
  users can't claim each other's objects. Add DB columns for stored keys (`users.avatar_s3_key`, cabinet `photo_s3_key`,
  product image key) if the schema doesn't have them. Also still to do: step 5 (copy Open Food Facts images to
  `products/{productId}.jpg`), step 6 (swap keys for presigned GET URLs in responses), and AWS bucket/IAM/CORS setup (steps 1-2).
