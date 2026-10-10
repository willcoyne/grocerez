# Database Decisions

Choices made while implementing `plan/database/` where the plan was unclear, outdated, or had to be adapted.
Format: date · folder · what the plan said · what was done · why.

## Notes for the backend builder

- **`server/` was created by the database builder** with only what the database needs: `package.json`
  (`type: module`), `tsconfig.json` (`strict`, `NodeNext`), `docker-compose.yml`, `.env.example`, `.gitignore`,
  `prisma.config.ts`, `prisma/`. When doing `backend/01-server-setup`, **add to** these files instead of re-running `npm init`.
  Express, zod, etc. are not installed yet.
- **Prisma 7 client import path:** the client is generated to `server/generated/prisma` (git-ignored, run `npm run db:generate`).
  Import it with `import { PrismaClient } from "../generated/prisma/client.js"` (adjust the relative path), not from `@prisma/client`.
- **Prisma 7 needs a driver adapter:** `new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })`
  with `import { PrismaPg } from "@prisma/adapter-pg"`. See `server/prisma/seed.ts` for a working example.
- **Normalization fixture:** `server/prisma/fixtures/normalize-cases.json` lists inputs and the exact output of the SQL
  `normalize_item_name()`. `lib/normalize.ts` must produce the same output for every case; load it in a vitest test.

## Decisions

### 2026-10-10 · 01 · Prisma version and config
- **Plan said:** `npm i -D prisma`, `npx prisma init`, set `previewFeatures = ["postgresqlExtensions"]` + `extensions` on the datasource.
- **Did:** pinned `prisma`, `@prisma/client`, `@prisma/adapter-pg` to exactly **7.10.0** (latest stable; npm's `latest` tag currently
  points at an 8.0 release candidate, which was avoided). Prisma 7 moved the connection URL out of `schema.prisma` into
  `server/prisma.config.ts` (`datasource.url = process.env.DATABASE_URL`, loaded with `dotenv/config`) and uses the new
  `prisma-client` generator with `output = "../generated/prisma"`. `postgresqlExtensions` **is still a preview feature in 7.10**
  (validation fails without it), so it is set on the generator block and `extensions = [pgcrypto, pg_trgm, fuzzystrmatch]` on the datasource.
- **Why:** follow the installed version's actual requirements; a release candidate is not a safe base for a hackathon demo.

### 2026-10-10 · 01 · Generated client and scripts
- **Plan said:** `db:migrate` → `prisma migrate dev`, `db:reset` → `prisma migrate reset` (re-runs the seed).
- **Did:** Prisma 7's `migrate dev` no longer runs `prisma generate`, so a `db:generate` script was added. `db:up` uses
  `docker compose up -d --wait` so the following migrate doesn't race the container start. TypeScript is pinned to 7.0.2 (current stable).
- **Why:** keep the "one command" promise true on Prisma 7.

### 2026-10-10 · 01 · Port
- Host port 5432 was free, so the container uses the planned `5432` and `DATABASE_URL` is unchanged.
  If a teammate already runs Postgres locally, change the left side of `ports:` in `docker-compose.yml` (e.g. `"5433:5432"`) and the port in `.env`.

### 2026-10-10 · 02 · Email CHECK on users
- **Plan said:** `users.email` is "lower-cased" (no constraint listed).
- **Did:** added `CHECK (email = lower(btrim(email)))` on `users`, same rule as `group_invites`. The backend must
  `trim().toLowerCase()` Google's email before writing it.
- **Why:** invite matching (03) is `group_invites.email = users.email`; both sides must be normalized the same way or matching silently fails.

### 2026-10-10 · 02 · `src/db.ts`
- **Did:** added `server/src/db.ts` (the PrismaClient singleton named in `backend/01`) because the Prisma 7 client needs the
  `@prisma/adapter-pg` driver adapter and the seed/checks needed one. The backend builder can keep or move it.

