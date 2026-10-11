# 01 — Setup & Migrations

**Goal:** Every teammate can run one command and have the same Postgres schema locally.

**Depends on:** `backend/01-server-setup` (the `server/` package exists).

## Steps

1. Add `server/docker-compose.yml` with a `postgres:16` service:
   - `POSTGRES_USER=grocerez`, `POSTGRES_PASSWORD=grocerez`, `POSTGRES_DB=grocerez`, port `5432`, named volume `pgdata`.
2. Add `DATABASE_URL=postgresql://grocerez:grocerez@localhost:5432/grocerez` to `server/.env.example`.
3. In `server/`: `npm i -D prisma` and `npm i @prisma/client`, then run `npx prisma init`.
4. In `schema.prisma`, set `previewFeatures = ["postgresqlExtensions"]` and
   `extensions = [pgcrypto, pg_trgm, fuzzystrmatch]` on the datasource.
   - `pgcrypto` provides `gen_random_uuid()`
   - `pg_trgm` provides trigram `similarity()` and the `%` operator, with GIN indexes for fast fuzzy search
   - `fuzzystrmatch` provides `levenshtein(a, b)`, the board's matching algorithm
5. Create the first migration: `npx prisma migrate dev --name init`.
6. Add npm scripts to `server/package.json`:
   - `db:up` → `docker compose up -d`
   - `db:migrate` → `prisma migrate dev`
   - `db:reset` → `prisma migrate reset` (drops data, re-runs migrations and the seed)
   - `db:studio` → `prisma studio`
7. For SQL that Prisma can't express (partial unique indexes, GIN trigram indexes, functions), run
   `npx prisma migrate dev --create-only`, then add the SQL to the generated `migration.sql`.
8. Document the workflow in `server/README.md`: pull → `npm run db:migrate` → start the server.

## Done when

- [x] `npm run db:up && npm run db:migrate` works on a fresh clone
- [x] `SELECT levenshtein('recieve','receive'), similarity('cheerio','cheerios');` returns `2` and a value above 0.5
- [x] Migrations are committed; `.env` is git-ignored
