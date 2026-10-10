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

### 2026-10-10 · 03 · `groups.created_by` on user delete
- **Plan said:** `created_by uuid FK → users` (no `ON DELETE`).
- **Did:** nullable, `ON DELETE SET NULL`.
- **Why:** `DELETE /me` (11) must succeed and the household must survive; ownership lives in `group_members.role`, not `created_by`.

### 2026-10-10 · 03 · Extra invite CHECKs
- **Did:** `CHECK (email = lower(btrim(email)) AND email <> '')` (plan: `email = lower(email)`, plus "trimmed" in the notes), and
  `CHECK ((status = 'pending') = (responded_at IS NULL))`. Also `groups.name` can't be blank.
- **Backend impact:** re-inviting must upsert with `ON CONFLICT (group_id, email) DO UPDATE SET status='pending', responded_at=NULL`;
  accept/decline/revoke must set `responded_at = now()` in the same update.

### 2026-10-10 · 04 · Exact normalization rules
- **Plan said:** lowercase → trim → collapse whitespace → strip punctuation except `&` → drop trailing plural `s`/`es` with a small exceptions list.
- **Did (precise rules, see the SQL comment and `server/prisma/fixtures/normalize-cases.json`, 55 cases):**
  accents are folded with a fixed `translate()` table (`jalapeño` → `jalapeno`); apostrophes are **deleted** (`Lay's` → `lays`);
  every other non-`[a-z0-9& ]` character becomes a **space** (`half-and-half` → `half and half`); then collapse + trim.
  Only the **last word** is de-pluralized: `es` is dropped only after `ch|sh|x|z|ss|o` (`tomatoes` → `tomato`, `glasses` → `glass`,
  but `grapes` → `grape`, `cheeses` → `cheese`); otherwise one `s` is dropped if the word is longer than 3 and doesn't end in `ss`/`us`.
  No `ies` → `y` rule (`raspberries` → `raspberrie`), because it breaks `cookies` → `cooky`; trigram search covers the gap.
  The function is idempotent (checked for every fixture case).
- **Why:** "drop es" on every word would turn `grapes` into `grap`; keeping the rule tiny makes the TS port trivial to keep identical.

### 2026-10-10 · 04 · Constraints tie stored names to the SQL function
- **Did:** `CHECK (items.normalized_name = normalize_item_name(name))` and `CHECK (item_aliases.alias_normalized = normalize_item_name(alias_normalized))`,
  plus non-empty and ≤ 200 chars (levenshtein() errors past 255). `category` is CHECK-constrained to the 11 listed values,
  `default_allergens` is `NOT NULL DEFAULT '{}'`, `shelf_life_days > 0` when set.
- **Backend impact:** if `lib/normalize.ts` ever drifts from SQL, inserts fail loudly instead of creating duplicate items.
  The backend may also skip TS normalization on insert and write `normalize_item_name(${name})` in a tagged `$queryRaw`.

### 2026-10-10 · 04 · `search_items(q, max_results = 5)` SQL function
- **Plan said:** "Matching query (wrapped by the backend's `GET /items/search`)".
- **Did:** implemented the query as a `STABLE` SQL function returning
  `(match, item_id, name, normalized_name, category, default_allergens text[], shelf_life_days, similarity, distance)`.
  It normalizes `q` itself, checks exact name/alias first, then uses `%` (GIN-indexable, threshold pinned to 0.3 via the
  function's `SET` clause) plus an explicit `similarity > 0.3`, takes the best hit per item across name and aliases, and labels
  every row `suggested` or `none` from the best candidate. Zero rows = `none` with no candidates.
  Backend call: ``prisma.$queryRaw`SELECT * FROM search_items(${q})` ``.
- **Why:** one tested implementation of the matching rule; the backend can't accidentally build it with string concatenation.

### 2026-10-10 · 04 · GIN indexes and the 20 ms check
- **Did:** the two `gin_trgm_ops` indexes are declared in `schema.prisma` (`@@index(..., type: Gin)`) so Prisma doesn't see them as drift.
- **Measured:** on the seeded 213-item catalog the planner correctly prefers a seq scan (3 pages); `search_items('cherios')` runs in ~1.3 ms.
  With `enable_seqscan = off` the plan is `Bitmap Index Scan on items_name_trgm` / `item_aliases_trgm`. With 50,000 extra rows
  (inserted, `VACUUM ANALYZE`d, then deleted) the planner chooses `Bitmap Index Scan on items_name_trgm` on its own
  (0.04 ms) and `search_items` takes 0.9 ms.

### 2026-10-10 · 04 · Catalog file and seed registration
- **Did:** `server/prisma/seed/items.json` (213 items) is created here (04 step 6) and loaded by `prisma/seed.ts`, which upserts on
  `normalized_name` using the SQL function. Prisma 7 reads the seed command from `prisma.config.ts` → `migrations.seed`
  (the `package.json` `"prisma": {"seed": ...}` key from the plan is no longer used).
- `npm run db:check:normalize` checks the SQL function against the fixture.

