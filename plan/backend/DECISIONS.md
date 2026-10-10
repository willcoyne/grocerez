# Backend Decisions

Choices made while implementing `plan/backend/` where the plan was unclear, outdated, or had to be adapted.
Format: date · folder · what the plan said · what was done · why.

## Decisions

### 2026-10-10 · 01 · Versions and build layout
- **Did:** Express **5.3**, zod **4.6**, vitest **4.1**, socket.io 4.8, pino 10, TypeScript 7.0.2 (already pinned by the database builder).
  Express 5 forwards rejected promises to the error handler, so routes are plain `async` functions.
  `npm run build` compiles `src/` **and** the generated Prisma client (`generated/prisma`, `.ts` files) with `tsconfig.build.json`,
  so the entry point is `dist/src/index.js` (`npm start`).
- **Why:** current stable releases; the Prisma 7 generator emits TypeScript, which must be compiled alongside the app.

### 2026-10-10 · 01 · Which env variables are required
- **Plan said:** crash at startup if anything in the list is missing (including `ANTHROPIC_API_KEY`, AWS keys).
- **Did:** `DATABASE_URL`, `JWT_SECRET` (≥ 16 chars) and `GOOGLE_CLIENT_IDS` are always required. `ANTHROPIC_API_KEY`, `AWS_REGION`,
  `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` are required only when `NODE_ENV=production`; in development/test the
  routes that need them return `503 NOT_CONFIGURED`. Added optional `CORS_ORIGINS`, `CONTACT_EMAIL`, `ENABLE_JOBS`, `RESEND_FROM`,
  `OPENFDA_API_KEY`, `DEMO_KEY`. Startup prints every missing/invalid variable and exits with code 1.
- **Why:** the team has no Anthropic/AWS accounts yet; the M2 loop must run locally without them. Production still fails fast.

### 2026-10-10 · 01 · Error codes beyond the plan
- Malformed JSON → `400 VALIDATION_ERROR`; body over 1 MB → `413 PAYLOAD_TOO_LARGE`; Prisma `P2025` → `404 NOT_FOUND`; unknown route → `404 NOT_FOUND`;
  anything else → `500 INTERNAL` (logged, no details returned). Validation errors include `details: [{path, message}]`.

### 2026-10-10 · 01 · Tests use a separate database
- Tests run with vitest + supertest against a real Postgres database, `grocerez_test` by default (`TEST_DATABASE_URL`).
  `test/globalSetup.ts` runs `prisma migrate deploy` + `prisma db seed` on it before every run and refuses any URL that isn't a `*_test` database.
  Files run serially (`fileParallelism: false`). Tests create their own users/groups with random ids, except the engine test,
  which reads the seeded demo group.
