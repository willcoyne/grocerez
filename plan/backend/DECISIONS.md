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
