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

### 2026-10-10 · 05 · Preferences reference the membership row
- **Plan said:** step 4, "When a member leaves the group, delete their preferences in that group (backend transaction, not a cascade,
  because the user row still exists)."
- **Did:** added a composite FK `preferences (group_id, user_id) → group_members (group_id, user_id) ON DELETE CASCADE`
  (in addition to the plain FKs to `groups` and `users`). Deleting the **membership** row cascades that member's preferences in
  that group only; the user row is untouched. It also makes it impossible to store a preference for a non-member.
- **Backend impact:** none required. The leave/remove transaction can still run its explicit `deleteMany` (it will find nothing),
  but it must still regenerate the shopping list afterwards. Insert members before their preferences.
- **Why:** "constraints carry the rules": a preference from someone outside the group should be an impossible state.

### 2026-10-10 · 05 · `preferences.item_id` on item delete
- **Did:** `ON DELETE RESTRICT` (catalog items in use can't be deleted). Same for `cabinet_items`, `shopping_list_items` (06, 07).
  Added an index on `preferences(user_id)` so user-delete cascades don't seq-scan.

### 2026-10-10 · 06 · Cabinet details
- **`product_id`:** 06 comes before `products` (08), so the column is created here without a FK; migration `products` (08) adds
  `cabinet_items.product_id → products ON DELETE SET NULL`.
- **`added_by`:** nullable, `ON DELETE SET NULL` (plan didn't say). The cabinet row belongs to the group, not the adder.
- **CHECKs added:** `location IN ('fridge','freezer','pantry','other')`; `expires_at` and `expiration_source` are both set or both NULL.
- **"Expiring in the next 3 days" query** (uses `cabinet_items_group_id_expires_at_idx`, verified with 200k rows):
  `SELECT ... FROM cabinet_items WHERE group_id = $1 AND expires_at <= current_date + 3 ORDER BY expires_at` (includes already-expired rows).

### 2026-10-10 · 07 · Check-off stamping is enforced in the database
- **Did:** CHECKs `checked = (checked_at IS NOT NULL)` and `checked OR checked_by IS NULL`, plus a `BEFORE INSERT OR UPDATE`
  trigger: checking a row stamps `checked_at = now()` (if not given); unchecking clears `checked_by` and `checked_at`.
  The backend only sets `checked` and `checked_by` (`PATCH .../shopping-list/:id`). `allergen_flags` must be a JSON array (CHECK).
- `scanned_product_id` gets its FK to `products` (`ON DELETE SET NULL`) in migration `products` (08). `checked_by`/`added_by` are `ON DELETE SET NULL`.

### 2026-10-10 · 07 · `generate_shopping_list(group_id)` SQL function (offered to the backend)
- **Plan said:** the backend's `service.generate(groupId)` (backend/06) computes and upserts the list; the database stores it.
- **Did:** to prove "running generation twice changes nothing", the generation is implemented as SQL functions:
  `needed_items(group)` (union − in-stock cabinet, with `wanted_by` and combined `quantity_text`),
  `allergen_flags_for(group, allergens[])` (`[{userId, displayName, allergen}]` for every member, ordered deterministically),
  `item_allergens_for(group, item)` (07: `items.default_allergens`; 08 replaces it to prefer a linked product), and
  `generate_shopping_list(group) → integer` (rows changed). It follows backend/06 steps 1.2–1.5: upserts needed items without
  touching `checked`, deletes unchecked `preference` rows no longer needed, keeps `manual` and checked rows (refreshing their
  `wanted_by` and flags), only writes rows whose values actually changed, and takes a per-group advisory lock.
  An existing `manual` row that becomes needed keeps `reason = 'manual'` and its own `quantity_text`.
- **Backend impact (recommended, not required):** `service.generate` can be
  ``await tx.$executeRaw`SELECT generate_shopping_list(${groupId}::uuid)` `` followed by reading the rows and emitting
  `shopping-list:changed`. If the backend writes its own TS version instead, it must produce the same rows (the seed check in 10 uses this function).
- Prisma scalar lists are created nullable, so a follow-up migration `shopping_list_wanted_by_not_null` sets `wanted_by NOT NULL`
  (the `shopping_list` migration was already applied when this was noticed).

### 2026-10-10 · 08 · Products
- **Did:** `item_id` is required, `ON DELETE RESTRICT`; `cabinet_items.product_id` and `shopping_list_items.scanned_product_id`
  get their FKs here (`ON DELETE SET NULL`). Extra CHECKs: `gtin ~ '^[0-9]{8,14}$'`, `calories_per_serving >= 0`;
  `allergens` / `may_contain` are `NOT NULL DEFAULT '{}'`. Index on `products(item_id)`.
- **Linked product (plan step 3 / backend/06 step 1.3):** `item_allergens_for(group, item)` is replaced to return
  `allergens ∪ may_contain` of the list row's `scanned_product_id`, else the group's `cabinet_items.product_id` for that item,
  else `items.default_allergens`. Scanning is a cache upsert: `prisma.product.upsert({ where: { gtin } ... })` (or `smartlabelUrl`).

