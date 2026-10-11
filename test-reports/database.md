# Database break test report

**Date:** 2026-10-10. **Target:** the 12 `db:` commits (through `91a9d23`): Prisma 7.10, PostgreSQL 16, 11 migrations, seed.
**Tests:** `server/test/db-break/*.test.ts` (vitest). Run them with `npm run test:db-break` from `server/` against a **local** database that
has been migrated and seeded. `helpers.ts` refuses any non-local `DATABASE_URL`.
**Result:** 203 tests. 166 pass (rules the database does enforce), 35 fail (the defects below), 1 skipped (TS normalize comparison, see below), 1 todo.
Every test tagged `[DB-xx]` is a defect, and its failure is the proof.

How the database was set up: a throwaway `postgres:16` container on port 5434 (`docker compose -p grocerez-break`), then
`prisma migrate deploy` + `prisma db seed` + `prisma/sql/app-role.sql`. The migrations test builds its own scratch database,
`grocerez_break_fresh`, and drops it when it finishes. `prisma migrate reset` was **not** used: Prisma 7 refuses it from an agent
without user consent. A "reset" here means `DROP DATABASE … WITH (FORCE)` + `CREATE` + `migrate deploy` + seed.

## Fix status (2026-10-10, branch `worktree-agent-a4dc6d870be5fd66d`)

Scope: DB-04 and the Medium findings. DB-09, DB-11 and DB-14 were fixed before the scope was cut; the other Low
findings are skipped. After the fixes: break suite **209 passed, 11 failed, 1 todo (221)** (the fixture grew by 18
cases); before: 167 passed, 35 failed, 1 todo (203). No previously passing test regressed. Backend suite: 164/164.
Fixture data changed in break tests (assertions untouched): the DB-04 tests' product GTINs `99999999` / `99999998`
had invalid check digits and are now `99999995` / `99999988`, because DB-07 makes the database reject bad check digits.

**DB-02 note.** The break test sends the competing `generate_shopping_list()`, waits until it is blocked, runs the trip's
regeneration, and then awaits the competing call *before* committing the trip. With correct serialization the competing call
can only finish after the trip commits, so the test hangs until its 120 s timeout (it could only finish before when Postgres
aborted one side with 40P01). The same scenario with the trip committing first was run: both transactions commit, no deadlock,
and the list is correct.

## Summary

| ID | Severity | Area | Title | Test file | Status |
|---|---|---|---|---|---|
| DB-04 | **High** | Constraints / allergens | A cabinet or list row can link to a product of a *different* item, which removes allergen badges | `constraints.test.ts` | Fixed (migration `product_item_link`: triggers, 23503) |
| DB-01 | Medium | Concurrency / owner handoff | Two members leaving at the same time can leave a group with no owner | `concurrency.test.ts` | Fixed (migration `owner_handoff_concurrency`) |
| DB-02 | Medium | Concurrency / list generation | Finish trip and a concurrent `generate_shopping_list()` deadlock (40P01) | `concurrency.test.ts` | Fixed (migration `list_lock_and_member_cleanup`). Break test still fails: it awaits the blocked transaction before committing the trip, which can only end in a deadlock abort. See note below |
| DB-03 | Medium | Cascades / privacy | `DELETE /me` and leaving a group leave the user's id, name and allergy in `shopping_list_items` | `cascades.test.ts` | Fixed (migration `list_lock_and_member_cleanup`) |
| DB-05 | Medium | Fuzzy search | `search_items` labels **every** candidate `suggested`, including ones 12 edits away | `search.test.ts` | Fixed (migration `search_labels`) |
| DB-06 | Medium | Normalization | Non-ASCII letters are deleted: `Ｍｉｌｋ`→`''`, `Weißbier`→`wei bier`, `ﬁg`→`g`, Cyrillic and CJK →`''` | `normalize.test.ts` | Fixed (migration `normalize_unicode`). `Œufs` test expects `oeufs`, but the plan's plural rule gives `oeuf` (like `ﬁg Newtons` → `fig newton`); test left as is |
| DB-07 | Medium | Constraints / product cache | One barcode can be stored as 12/13/14-digit GTINs (duplicate cache rows); no check-digit validation | `constraints.test.ts` | Fixed (migration `gtin14` + `normalizeGtin`) |
| DB-08 | Medium | Time | No household time zone, so "today" is the server's UTC date and expiry dates are off by one in US evenings | `time.test.ts` | Fixed (migration `group_time_zone` + backend). 2nd test needs the *session* TimeZone to be local, which contradicts the passing test that asserts it is UTC; the fix uses `groups.time_zone` explicitly instead |
| DB-09 | Low | Constraints | Demoting the only owner leaves a group with zero owners | `constraints.test.ts` | Fixed (done in `owner_handoff_concurrency` before the scope cut) |
| DB-10 | Low | Seed | Re-seeding doesn't undo a rehearsal (extra member kept); changing the invite email leaves two pending invites | `migrations.test.ts` | Skipped (scope cut) |
| DB-11 | Low | Fuzzy search | Short-word false positives (`pea`→Pears, `batter`/`bitter`→Butter); transpositions (`mlik`, `oero`) return nothing | `search.test.ts` | Fixed (done in `search_labels` before the scope cut) |
| DB-12 | Low | Constraints | Product identifier CHECK accepts `smartlabel_url = ''`; `calories_per_serving` accepts NaN/Infinity | `constraints.test.ts` | Skipped (scope cut). The NaN/Infinity test now passes only because its fixture GTINs fail the DB-07 check digit |
| DB-13 | Low | Constraints | `users.email` / `display_name` can be blank; `users.zip_code` is unvalidated | `constraints.test.ts` | Skipped (scope cut) |
| DB-14 | Low | Normalization | `&` spacing gives two normalized names (`mac&cheese` vs `mac & cheese`) | `normalize.test.ts` | Fixed (done in `normalize_unicode` before the scope cut) |
| DB-15 | Low | Fuzzy search / perf | With 6,000 items the planner seq-scans at least one trigram table (search is still ~7 ms) | `search.test.ts` | Skipped (scope cut; `random_page_cost = 1.1` was tried and did not change the plan) |
| DB-16 | Low | Security | App role can still create TEMP tables and `pg_temp` functions | `security.test.ts` | Skipped (scope cut) |
| DB-17 | Low | Security | `app-role.sql` silently falls back to the public password `grocerez_app` | `security.test.ts` | Skipped (scope cut) |

---

## Findings

### DB-04 (High): product links aren't tied to the row's item, so allergen badges can disappear
**Repro** (`constraints.test.ts`): a user with a milk allergy wants Milk. Create an Oreos product (`allergens = {wheat,soy}`) and insert
`cabinet_items (item_id = Milk, product_id = <Oreos product>, status = 'running_low')`, then call `generate_shopping_list`.
**Expected:** the insert is rejected. Plan 08 step 3 / backend 06 step 1.3 say allergen checks use the **linked product** of that item.
**Actual:** the insert succeeds. `item_allergens_for()` then uses the Oreos product's allergens for Milk, so Milk's `allergen_flags` is
`[]` and the milk-allergic member gets **no badge on Milk**. The same applies to `shopping_list_items.scanned_product_id`
(a Peanut Butter row can point at an Oreos product).
**Fix:** add `UNIQUE (id, item_id)` on `products` and composite FKs `(product_id, item_id) → products (id, item_id)` from `cabinet_items` and
`(scanned_product_id, item_id)` from `shopping_list_items` (`MATCH SIMPLE` keeps NULL links working).

### DB-01 (Medium): concurrent leaves skip the owner handoff
**Repro** (`concurrency.test.ts`): group with A (owner), then B and C (members, in join order).
1. T_B: `DELETE` B's membership (not committed yet).
2. T_A: `DELETE` A's membership. The trigger picks B (still visible) and blocks on B's row.
3. T_B commits, so T_A's `UPDATE` hits a deleted row and updates nothing. T_A commits.

Result: C is the only member and the group has **0 owners**. A second test has two owners leave at once. Each transaction still sees
the other owner, so neither hands off, and the remaining member is again left with no owner.
**Expected:** plan 11 step 5, "ownership passes to the longest-standing member".
**Actual:** a group nobody can manage (owner-only routes: delete group, remove member).
**Fix:** in `group_members_owner_handoff()`, first lock the group row (`SELECT … FROM groups WHERE id = OLD.group_id FOR UPDATE`) to
serialize membership changes per group, then re-check owners and promote. Or make the promotion a loop that retries when it updates 0 rows.

### DB-02 (Medium): deadlock between finish trip and a concurrent regeneration
**Repro** (`concurrency.test.ts`). The finish-trip transaction (backend 06 step 6) upserts the cabinet row, deletes the checked list rows,
then calls `generate_shopping_list`. Between the delete and that call, a second transaction calls `generate_shopping_list(g)`. It takes
the advisory lock and blocks on the deleted row. The trip then waits for the advisory lock, and Postgres aborts one transaction with
**`40P01 deadlock detected`**.
**Expected:** DECISIONS 07 says the per-group advisory lock serializes generation, and backend 06 says "two phones … end up with the same state".
**Actual:** the lock is taken in the middle of the caller's transaction, after other row locks. That's a lock-order inversion.
**Fix:** take the same per-group advisory lock at the **start** of every transaction that writes `shopping_list_items` (expose a
`lock_group_list(group)` helper, or have finish-trip call it first). Alternatively, have the backend retry on 40P01.

### DB-03 (Medium): deleted or departed users stay on the list (PII)
**Repro** (`cascades.test.ts`): a household whose list has Peanut Butter flagged for "Peanut Kid" (peanuts). Run `DELETE FROM users WHERE id = <kid>`.
**Expected:** plan 11 step 5, `DELETE /me` removes the user. Plan 11 also says to store only what Google gives us.
**Actual:** the user's UUID stays in `shopping_list_items.wanted_by`, and `allergen_flags` still holds
`{"userId": …, "displayName": "Peanut Kid", "allergen": "peanuts"}`, which is health data. Leaving a group (deleting the membership) has the same result.
These copies are only cleared if someone regenerates the list of **every** group the user was in, and the database doesn't do that.
**Fix:** add an `AFTER DELETE` trigger on `group_members` that calls `generate_shopping_list(OLD.group_id)`. It also fires on the user
cascade. Or compute flags and `wanted_by` at read time instead of copying them into rows.

### DB-05 (Medium): every search candidate is labelled `suggested`
**Repro** (`search.test.ts`): `search_items('Peanut buter')` returns Peanut Butter (distance 1), Peanuts (6), Butter (7), and
Reese's Peanut Butter Cups (12). **All four** have `match = 'suggested'`.
**Expected:** backend 04 step 2.4, "The best result within the distance threshold gives `match:"suggested"`; any other results give
`match:"none"` and are returned as 'similar' options."
**Actual:** the label is computed from `min(dist) OVER ()`, so it's copied to every row. Backend 08 step 5 links a scanned product to "the
`exact` or `suggested` item", so a caller that picks any `suggested` row can link to an item 12 edits away.
**Fix:** label only the first row (`row_number() OVER (ORDER BY dist, sim DESC) = 1 AND dist <= threshold`), and set the others to `'none'`.

### DB-06 (Medium): normalization deletes letters it doesn't know
**Repro** (`normalize.test.ts`):

| Input | Actual output |
|---|---|
| `Ｍｉｌｋ` (full-width) | `''` |
| `ﬁg Newtons` | `g newton` |
| `Weißbier` | `wei bier` |
| `Œufs` | `ufs` |
| `Молоко` | `''` |
| `豆腐` | `''` |

**Expected:** plan 04 step 3 says "strip **punctuation** except &". Letters aren't punctuation.
**Actual:** every character outside `[a-z0-9& ]` that isn't in the fixed `translate()` table becomes a space. So items with non-Latin names
can't be created at all (the CHECK forbids an empty name, and backend 04 returns 400), and some names are mangled.
**Fix:** apply NFKC first (`normalize(input, NFKC)` in PG16; `String.prototype.normalize('NFKC')` in TS), use `unaccent` or a larger
fold table (ß→ss, œ→oe, æ→ae), and strip only `[[:punct:]]` instead of everything that isn't `[a-z0-9]`. Update the fixture so the TS port follows.

### DB-07 (Medium): the same barcode can be cached as several products
**Repro** (`constraints.test.ts`): insert products with `gtin` `016000275287` (UPC-A), `0016000275287` (EAN-13) and `00016000275287`
(GTIN-14) for the same item. All three are accepted. A wrong check digit (`016000275288`) is accepted too.
**Expected:** plan 08, "Scanning the same barcode twice reads from the cache (only one row exists)". iOS and Android scanners report UPC-A
as 13 and 12 digits respectively, so two phones in one household create two rows.
**Fix:** store GTINs as GTIN-14 (left-pad with zeros, `CHECK (gtin ~ '^[0-9]{14}$')`) and add a check-digit CHECK, or normalize in the
backend and add `CHECK (length(gtin) = 14)`.

### DB-08 (Medium): "today" is the server's UTC date
**Repro** (`time.test.ts`): `information_schema` shows no time-zone column on `users` or `groups`, and the session `TimeZone` is `Etc/UTC`.
At 9 pm CDT on Oct 10 (02:00 UTC Oct 11), `current_date` is Oct 11. Effects:
- The documented "expiring" query (`expires_at <= current_date + 3`) reports milk that expires Oct 10 as already expired.
- An estimated expiry (`purchased_at::date + 7`) for an evening purchase lands on Oct 18 instead of Oct 17.
- The seed's "expires in 2 days" uses the UTC date as well.

This affects US users every evening (7 pm to midnight Central).
**Expected:** backend 09, "expiring within 3 days", meaning the household's days.
**Fix:** add `groups.time_zone text NOT NULL DEFAULT 'America/Chicago'` (validated against `pg_timezone_names`). Compute "today" as
`(now() AT TIME ZONE g.time_zone)::date` and estimates as `(purchased_at AT TIME ZONE g.time_zone)::date + shelf_life_days`.

### DB-09 (Low): a group can end up with zero owners
**Repro:** `UPDATE group_members SET role = 'member'` on the only owner succeeds, and the handoff trigger only fires on `DELETE`.
**Expected:** plan 11 step 5 and backend 03 assume every group has an owner.
**Fix:** extend the trigger to `AFTER UPDATE OF role`, or use a deferred constraint trigger that requires at least one owner while the group has members.

### DB-10 (Low): re-seeding doesn't fully reset a rehearsal
**Repro** (`migrations.test.ts`, on a scratch database):
1. A teammate (`teammate@example.com`) accepts the demo invite and becomes a member.
2. `prisma db seed` runs again. The demo group now has **5** members, and the invite is back to `pending` for someone who is already a member, so the live accept flow can't be shown again.
3. Seeding with `DEMO_INVITE_EMAIL=Real.Teammate@Gmail.com` leaves **two** pending demo invites (the placeholder and the real one).

**Expected:** DECISIONS 10, "re-seeding also undoes anything clicked during a rehearsal", and plan 10 step 7, one pending invite.
**Fix:** in the seed transaction, delete demo-group members not in `DEMO_USERS` and every demo-group invite other than `DEMO_INVITE_EMAIL`.

### DB-11 (Low): fuzzy search false positives and blind spots
**Repro** (`search.test.ts`):
- `pea` is `suggested` as **Pears** (distance 1), even though "Frozen Peas" exists.
- `batter` and `bitter` are `suggested` as **Butter**.
- The transpositions `mlik` and `oero` return **no rows at all**, not even as "similar" options, because trigram similarity is below 0.3 before Levenshtein is ever applied.

These follow from the plan's thresholds, so they are spec-level, but they are what the attack list asked to look for.
**Fix:** for queries of 6 characters or fewer, require `similarity >= 0.5` to call a result `suggested`, prefer whole-word containment
(`word_similarity`), and use a Damerau (OSA) distance or add a small `levenshtein`-only fallback for short queries.

### DB-12 (Low): weak product CHECKs
**Repro:** a `smartlabel` product with `smartlabel_url = ''` and no GTIN passes `products_identifier_chk`.
`calories_per_serving = 'NaN'` and `'Infinity'` pass `>= 0`, because NaN sorts above every number in Postgres.
**Fix:** add `CHECK (smartlabel_url ~ '^https?://')` and `CHECK (calories_per_serving < 'Infinity')`.

### DB-13 (Low): blank or unvalidated profile fields
**Repro:** `users.email = ''` and `display_name = '  '` are accepted. `group_invites` forbids an empty email, but `users` doesn't.
`users.zip_code = 'KC MO'` is accepted, while `price_estimates.zip_code` requires `^[0-9]{5}$`, so that user can never get a cached price.
**Fix:** add `CHECK (email <> '')`, `CHECK (btrim(display_name) <> '')` and `CHECK (zip_code ~ '^[0-9]{5}$')`.

### DB-14 (Low): `&` spacing splits catalog names
**Repro:** `normalize('Mac&Cheese') = 'mac&cheese'`, but `normalize('Mac & Cheese') = 'mac & cheese'`. Likewise `M&M's` and `M & M's`.
Search still suggests the other spelling (trigrams ignore `&`), but exact matching and the UNIQUE constraint treat them as different items.
**Fix:** before collapsing spaces, add `regexp_replace(s, '\s*&\s*', ' & ', 'g')`, and add both spellings to the fixture.

### DB-15 (Low): GIN index isn't chosen at 6,000 items
**Repro** (`search.test.ts`): add about 6,000 realistic store-brand items plus aliases, `ANALYZE`, then `EXPLAIN ANALYZE` the candidate
query. At least one side (the alias table in this run) uses a **Seq Scan**. With `enable_seqscan = off`, the index is about 3× faster
(2 ms vs 6.6 ms). `search_items` still takes about 7 ms, so the 20 ms target is met (that test passes).
**Expected:** plan 04 Done-when, "`EXPLAIN ANALYZE` uses the GIN index".
**Fix:** none needed now. Re-check when the catalog grows. If it matters, lower `random_page_cost` (SSD hosts) or check the GIN cost estimate for `%`.

### DB-16 (Low): app role can still CREATE (temp objects)
**Repro** (`security.test.ts`): as `grocerez_app`, `CREATE TEMP TABLE scratch(x int)` and `CREATE FUNCTION pg_temp.f() …` both succeed.
All the other DDL attempts (DROP, TRUNCATE, ALTER, CREATE TABLE/SCHEMA/EXTENSION/ROLE, replacing functions, disabling triggers, reading
`_prisma_migrations`, COPY to a file, `pg_read_file`, `session_replication_role`) are denied.
**Expected:** plan 11 step 1, "no DROP or CREATE".
**Fix:** add `REVOKE TEMPORARY ON DATABASE <db> FROM PUBLIC` to `app-role.sql`, plus an explicit `GRANT TEMPORARY` to the owner if migrations need it.

### DB-17 (Low): app-role script falls back to a public password
**Repro:** `prisma/sql/app-role.sql` runs `\set app_password 'grocerez_app'` when `-v app_password` is missing, and only `\echo`es a warning.
Running the production command without the variable gives the production role a password that is published in the repo.
**Fix:** when `app_password` isn't set, exit with an error unless something like `-v local_dev=1` is passed.

---

## Attack areas

| # | Area | Covered | Notes |
|---|---|---|---|
| 1 | Constraints | Yes | Duplicate membership, preference, cabinet row and invite, invite email case/whitespace, product identifiers, allergens and diets, negative or NULL values, check-off consistency all hold. Defects: DB-04, 07, 09, 12, 13. |
| 2 | Cascades and orphans | Yes | Users, groups, items (RESTRICT in use, cascade when unused), cabinet rows → recall matches, products → SET NULL all behave as documented. Cross-group recall matches are impossible. Defect: DB-03. An empty group after the last member leaves is documented as the backend's job (DECISIONS 11), so it isn't counted. |
| 3 | Normalization | Partly | All 55 fixture cases pass, and so do idempotency, a 5,000-string random fuzz, plural edge cases (`hummus`, `glasses`, `cheeses`, `s`), whitespace, emoji, 1 MB input and NULL. Defects: DB-06, DB-14. **TS comparison pending:** `server/src/lib/normalize.ts` doesn't exist yet. The test is written and skips itself until that file appears; re-run it then. Any mismatch is High. |
| 4 | Fuzzy search | Yes | Typos, short queries, `%`/`_`/quotes/injection strings, 1 MB input, NULL, aliases, 6k-item timing. Defects: DB-05, 11, 15. |
| 5 | Set logic | Yes | All pass. The hand-computed union and difference equal the generated list (Tostitos, Lay's, Oreos + Milk, Peanut Butter, Bread), badges are correct, running low, ran out, restock, a member with zero preferences, a group with zero members, checked and manual rows, and no cross-group leakage. `db:check:demo` prints PASS. |
| 6 | Concurrency | Yes | Preference, cabinet and invite-accept races and double generation are safe. Defects: DB-01, DB-02. |
| 7 | Migrations | Yes | All 11 migrations apply from empty, `migrate diff --from-config-datasource --to-schema` shows no drift, seeding twice changes nothing, and two drop-and-recreate resets give the same state. `prisma migrate reset` itself was not run (it needs user consent; see the header). Defect: DB-10. |
| 8 | Security | Yes | The app role is denied 20 kinds of DDL and privileged operations, statement_timeout is 15 s, there are no SECURITY DEFINER functions, and there is no `$queryRawUnsafe`/`$executeRawUnsafe`/`Prisma.raw` or string-built SQL in `src/` and `prisma/`. Defects: DB-16, DB-17. Not tested: SSL and production backups (no production database exists yet). |
| 9 | Time | Yes | `date` arithmetic is DST-proof, and the expiring query's boundaries (today, expired, +3, +4) are correct. Defect: DB-08. |
