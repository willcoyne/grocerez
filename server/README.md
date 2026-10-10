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
| `db:reset` | drops all data, re-runs every migration, then runs the seed |
| `db:seed` | `prisma db seed` (idempotent) |
| `db:studio` | `prisma studio` |

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
