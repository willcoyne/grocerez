# 11 — Security & Backups

**Goal:** Make the "secure database" from the board concrete.

**Depends on:** all schema folders

## Steps

1. **Roles:** create an app role `grocerez_app` with only `SELECT, INSERT, UPDATE, DELETE` on app tables
   (no `DROP` or `CREATE`). Migrations run as a separate owner role. The server's `DATABASE_URL` uses `grocerez_app` in production.
2. **SSL:** require it in production (`?sslmode=require` in `DATABASE_URL`).
3. **Group scoping:** every group-owned table has `group_id`. Every query in the backend goes through a
   repository function that takes `groupId` after the membership check (`backend/03`). No raw
   `findMany` calls without a group filter.
   *Stretch:* Postgres row-level security with `SET app.current_user_id` per request.
4. **Injection:** use Prisma's query builder, or `$queryRaw` with tagged templates only. Never string-concatenate SQL
   (this matters for the fuzzy search query).
5. **Personal data:** store only what Google gives us (sub, email, name, picture). Never log tokens or emails.
   `DELETE /me` removes the user (cascades preferences and memberships). If they were a group's only owner, ownership passes to the longest-standing member.
6. **Backups:** Railway and Cloud SQL both have automatic daily backups. Turn them on and test a restore once before the demo.
   Locally: `pg_dump grocerez > backup.sql` before any risky migration.
7. **Secrets:** `DATABASE_URL` lives only in `.env` (git-ignored) and the host's secret settings.

## Done when

- [x] The production app role can't drop tables *(verified on the local container with `server/prisma/sql/app-role.sql`. DROP/ALTER/TRUNCATE/CREATE/CREATE EXTENSION and reading `_prisma_migrations` are all denied. The same script still has to be run against production.)*
- [x] A grep for `$queryRawUnsafe` returns nothing *(also `$executeRawUnsafe`)*
- [ ] A restore from backup has been tested once *(local only so far: `pg_dump -Fc` restored into a scratch database with identical row counts, 11 migrations, and working `normalize_item_name()` / `search_items()`. Production backups are **not** turned on and no production restore has been tested, because no production database exists yet. Do this at deploy time (backend/12).)*
