# 01 — Server Setup

**Goal:** A running TypeScript Express server with config validation, error handling, and a health check.
**Board:** "secure database, framework language pending". **Decision: Node.js + TypeScript + Express** (see `GAPS.md` #1).

**Depends on:** nothing

## Steps

1. `mkdir server && cd server && npm init -y`, then install:
   - runtime: `express cors helmet zod dotenv jsonwebtoken google-auth-library @prisma/client socket.io node-cron pino pino-http express-rate-limit @anthropic-ai/sdk @aws-sdk/client-s3 @aws-sdk/s3-request-presigner cheerio`
   - dev: `typescript tsx @types/express @types/node @types/jsonwebtoken @types/cors prisma vitest supertest @types/supertest`
2. Add a `tsconfig.json` (`"strict": true`, `"module": "NodeNext"`, `"outDir": "dist"`).
   Add scripts: `dev` → `tsx watch src/index.ts`, `build` → `tsc`, `start` → `node dist/index.js`, `test` → `vitest`.
3. Folder layout:
   ```
   server/src/
   ├── index.ts            # creates http server, attaches Socket.IO, starts cron jobs
   ├── app.ts              # express app (exported for tests)
   ├── config.ts           # zod-validated env
   ├── db.ts               # PrismaClient singleton
   ├── contracts/          # zod request/response schemas shared with the app
   ├── middleware/         # auth, requireGroupMember, validate, errorHandler
   ├── modules/<feature>/  # router.ts, service.ts, repo.ts per feature
   ├── jobs/               # cron jobs
   └── lib/                # normalize.ts, errors.ts, anthropic.ts, s3.ts
   ```
4. `config.ts`: parse `process.env` with zod and crash at startup if anything is missing. Variables:
   `PORT, DATABASE_URL, JWT_SECRET, GOOGLE_CLIENT_IDS (comma-separated), ANTHROPIC_API_KEY,
   AWS_REGION, S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, APP_LINK_BASE, NODE_ENV`, plus optional `RESEND_API_KEY` (invite emails).
   Commit a `.env.example` with placeholder values. Git-ignore `.env`.
5. Middleware order: `helmet` → `cors` (allow the Expo dev origin) → `express.json({limit:"1mb"})` → `pino-http` → routes → 404 handler → `errorHandler`.
6. `lib/errors.ts`: an `AppError(status, code, message)` class. `errorHandler` turns it, zod errors (`400 VALIDATION_ERROR`),
   and Prisma `P2002` (`409 CONFLICT`) into the standard error shape. Anything else becomes a 500 with the details logged.
7. `middleware/validate.ts`: `validate({body?, query?, params?})` checks the request against zod schemas from `contracts/`.
8. `GET /api/health` → `{ok: true}` after `SELECT 1` succeeds.
9. Vitest + supertest smoke test for `/api/health`.

## Done when

- [x] `npm run dev` serves `/api/health`
- [x] A missing env variable stops startup with a clear message
- [x] An invalid body returns `400 {error:{code:"VALIDATION_ERROR"}}`
