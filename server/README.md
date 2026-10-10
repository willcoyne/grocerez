# GrocerEZ server

Right now this package only contains the database layer (Prisma schema, migrations, seed).
The Express API is added on top of it by `plan/backend/`.

## Database workflow

Requires Docker and Node 22+.

```bash
cd server
npm install
cp .env.example .env          # first time only
npm run db:up                 # start Postgres 16 (docker compose, waits until healthy)
npm run db:migrate            # apply migrations (prisma migrate dev)
npm run db:generate           # generate the Prisma Client into generated/prisma
```

Day to day: **pull → `npm run db:migrate` → `npm run db:generate` → start the server.**

| Script | What it does |
|---|---|
| `db:up` | `docker compose up -d --wait` |
| `db:migrate` | `prisma migrate dev` (applies new migrations, creates one if the schema changed) |
| `db:generate` | `prisma generate` (Prisma 7 no longer runs this automatically after migrate) |
| `db:reset` | `prisma migrate reset --force && prisma db seed`: drops all data, re-runs every migration, then seeds |
| `db:seed` | `prisma db seed` (idempotent) |
| `db:studio` | `prisma studio` |
| `db:app-role` | creates/updates the least-privilege `grocerez_app` role (`prisma/sql/app-role.sql`) |
| `db:check:normalize` | checks SQL `normalize_item_name()` against `prisma/fixtures/normalize-cases.json` |
| `db:check:demo` | prints the demo group's generated shopping list and `PASS`/`FAIL` (`prisma/seed/check-demo-list.sql`) |

### Writing SQL Prisma can't express

Extensions, GIN trigram indexes, CHECK constraints, partial indexes and SQL functions are written by hand:

```bash
npx prisma migrate dev --create-only --name <name>   # creates an empty / partial migration.sql
# edit prisma/migrations/<timestamp>_<name>/migration.sql
npx prisma migrate dev                                # applies it
```

Never edit a migration that has already been applied. Add a new one.

### Running SQL

`psql` does not need to be installed on the host:

```bash
docker compose exec postgres psql -U grocerez -d grocerez
```

## What lives in the database

- **Item matching:** `normalize_item_name(text)` (IMMUTABLE) and `search_items(q)`. Call it only as
  ``prisma.$queryRaw`SELECT * FROM search_items(${q})` ``. `lib/normalize.ts` must pass `prisma/fixtures/normalize-cases.json`.
- **Shopping list:** `generate_shopping_list(groupId)` = (union of preferences) − (in-stock cabinet), with allergen flags. Returns the number of rows changed.
- **Triggers:** check-off stamping on `shopping_list_items`, and owner handoff when a group's last owner leaves.
- **Demo seed:** group `00000000-0000-4000-8000-000000000001` ("Hack Midwest House"), users `...0101` to `...0104`.
  The pending invite goes to `teammate@example.com`. **Before the demo, run `DEMO_INVITE_EMAIL=<real Google email> npm run db:seed`.**

See `plan/database/DECISIONS.md` for every deviation from the plan.

## Security & backups (plan/database/11)

- **Roles:** migrations and the seed run as the owner (`MIGRATE_DATABASE_URL`, falling back to `DATABASE_URL`, read by
  `prisma.config.ts`). The API connects as `grocerez_app`, which has only `SELECT/INSERT/UPDATE/DELETE` on app tables and no access to
  `_prisma_migrations`. It can't create, alter, drop or truncate. Production:
  `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -v app_password="$GROCEREZ_APP_PASSWORD" -f prisma/sql/app-role.sql`
  after `npx prisma migrate deploy`.
- **SSL:** production URLs must end in `?sslmode=require` (see `.env.example`).
- **Queries:** Prisma's query builder or tagged-template `$queryRaw`/`$executeRaw` only. `$queryRawUnsafe` / `$executeRawUnsafe` are banned.
  Every group-owned table has `group_id`. Repository functions take `groupId` after the membership check.
- **Backups:**
  - Local, before any risky migration:
    `docker compose exec -T postgres pg_dump -U grocerez -d grocerez -Fc > backup.dump` (git-ignored).
  - Restore into a scratch database to check it:
    `docker compose exec -T postgres createdb -U grocerez grocerez_restore && docker compose exec -T postgres pg_restore -U grocerez -d grocerez_restore --no-owner < backup.dump`.
  - Production: turn on the host's automatic daily backups (Railway / Cloud SQL) and test one restore before the demo.
- **Secrets:** `DATABASE_URL` / `MIGRATE_DATABASE_URL` only in `.env` (git-ignored) and the host's secret settings.
