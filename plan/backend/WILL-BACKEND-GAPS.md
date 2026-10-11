# Will's backend vs Carson's backend: what Carson's lacks

Carson's backend (`server/` on `origin/carson`) was adopted. Will's backend is kept at git tag `will-backend`
(commit `016644d`). Both follow `plan/backend/`. This file lists the features, fixes and hardening in Will's backend that
are **missing or weaker** in Carson's, so they can be ported.

How this was checked: every entry in `will-backend:plan/backend/DECISIONS.md` and every fixed break-test finding in
`will-backend:test-reports/backend.md` (B-xx), `backend-m2.md` (M2-xx) and `backend-m3m4.md` (M3-xx) was compared
against Carson's code in `server/src` and `server/prisma/migrations`, by reading the code. "Unverified" means the
conclusion comes from reading the code, with no test run. Carson's own `test-reports/backend.md` lists several of these
as open ("Not covered" section). Those notes are cited where they agree.

Status: **Missing** = no equivalent. **Partial** = some protection, with a gap. **Present-differently** = covered
another way (listed for completeness).

## Summary

Ranked: security and data-integrity gaps first, then robustness, then ops.

| ID | Area | Feature / fix (Will's ref) | Severity | Status in Carson's | Will's file |
|---|---|---|---|---|---|
| G-01 | Uploads | Presigned PUT pins the CRC32 of an empty body (B-16) | High | Missing | `will-backend:server/src/lib/s3.ts` |
| G-02 | List allergens | A product's allergens replace the catalog's allergens, so a product with no allergen data clears the flags (M3-10) | High | Missing | `will-backend:server/src/modules/shopping-list/repo.ts` |
| G-03 | AI recipes | Recipe check ignores `default_allergens` and product allergens; fuzzy missing-item match can return an allergen item (M3-16, M3-17) | High | Missing | `will-backend:server/src/modules/ai/service.ts`, `ai/repo.ts` |
| G-04 | Allergens | Keyword table: derived foods, compounds, plurals, accents; the re-check skips steps and summary (B-01, B-03) | High | Partial | `will-backend:server/src/lib/allergens.ts` |
| G-05 | SmartLabel | Uses the first "contains" match, so "Contains 2% or less of" hides the real allergen statement (B-02) | High | Missing | `will-backend:server/src/modules/products/smartlabel.ts` |
| G-06 | Uploads | `Content-Type` is not signed into the presigned PUT | Medium | Missing | `will-backend:server/src/lib/s3.ts` |
| G-07 | Auth | `/dev/login-as` works for any user (not only seed users); demo key compared without constant time and has no minimum length (B-07) | Medium | Missing | `will-backend:server/src/modules/auth/router.ts`, `auth/service.ts` |
| G-08 | AI prices | Global price-cache poisoning by household item names / quantity text (M3-13) | Medium | Missing | `will-backend:server/src/modules/ai/service.ts`, migration `20261012010000_match_norm_item_trust` |
| G-09 | Realtime / limits | Group id isn't lower-cased: rooms split, a removed member can miss the kick, per-group rate limits can be bypassed (M2-06, M3-06, M3-14) | Medium | Missing | `will-backend:server/src/middleware/requireGroupMember.ts`, `lib/realtime.ts` |
| G-10 | Catalog | Alias poisoning: any user can alias any unused text to any item, for every household (M2-07) | Medium | Missing | `will-backend:server/src/modules/items/service.ts` |
| G-11 | Validation | Control characters (NUL) in input, OFF data, openFDA rows or model output cause a 500 (B-04, M2-01, M3-04, M3-12) | Medium | Missing | `will-backend:server/src/middleware/validate.ts`, `products/common.ts` |
| G-12 | Product cache | A scan overwrites a fresh shared row (allergens lost for every household); URL/GTIN row merge (M3-01, M3-02) | Medium | Missing | `will-backend:server/src/modules/products/repo.ts` |
| G-13 | SmartLabel | Deep-nesting crash or slowdown; wrong JSON-LD types; negative numbers (B-12, B-13, M3-19) | Medium | Missing | `will-backend:server/src/modules/products/smartlabel.ts`, `openFoodFacts.ts` |
| G-14 | Recalls | One bad openFDA row fails the whole import, every day (M3-07) | Medium | Missing | `will-backend:server/src/modules/recalls/openfda.ts`, `recalls/repo.ts` |
| G-15 | Recalls | No overlap window, so recalls published late are never imported (M3-08) | Medium | Missing | `will-backend:server/src/jobs/importRecalls.ts` |
| G-16 | Recalls | Brand spelling (apostrophes, accents, parent brands) causes false negatives (M3-09) | Medium | Partial | `will-backend:server/src/modules/recalls/match.ts`, `recalls/repo.ts` |
| G-17 | Recalls | Match INSERT…SELECT races with a cabinet delete (no `FOR KEY SHARE`) | Low | Partial | `will-backend:server/src/modules/recalls/repo.ts` |
| G-18 | SSRF | No DNS / private-IP check (incl. IPv6 forms that embed IPv4); relies on the host allowlist alone (B-11) | Low | Missing | `will-backend:server/src/modules/products/guardedFetch.ts` |
| G-19 | SSRF | Size caps are applied after the whole body is buffered | Low | Partial | `will-backend:server/src/modules/products/common.ts`, `image.ts` |
| G-20 | Image copy | Accepts any `image/*` (SVG too) and stores it as `.jpg` | Low | Partial | `will-backend:server/src/modules/products/image.ts` |
| G-21 | Auth | Email held by a stale row: sign-in fails with 409, a permanent lockout (B-08) | Low | Missing | `will-backend:server/src/modules/users/repo.ts` |
| G-22 | Validation | Display names and group names made only of invisible characters (B-09) | Low | Missing | `will-backend:server/src/contracts/common.ts` |
| G-23 | Auth | JWT with a non-UUID `sub` causes a 500 (Carson's own API-AUTH-2, still open) | Low | Missing | `will-backend:server/src/modules/users/repo.ts` (`exists`) |
| G-24 | Validation | Impossible calendar dates (`2026-13-01` → 500, `2026-02-30` rolls over) | Low | Missing | `will-backend:server/src/contracts/cabinet.ts` |
| G-25 | Logs | Access log keeps query strings (search text) (B-10) | Low | Partial | `will-backend:server/src/app.ts` |
| G-26 | Concurrency | Concurrent `PUT /me/dietary` gives 409 when the user has no groups (M2-04) | Low | Partial | `will-backend:server/src/modules/users/repo.ts` |
| G-27 | AI prices | Price-row sanity: $500 cap, `unit` length, source URL limits (M3-12) | Low | Partial | `will-backend:server/src/modules/ai/service.ts` |
| G-28 | Scan | Two concurrent first scans of one code: the product insert can 409 (M3-05) | Low | Partial (unverified) | `will-backend:server/src/modules/products/repo.ts` |
| G-29 | List | Allergen-flag `displayName` stays stale after `PATCH /me` (M2-03) | Low | Partial | `will-backend:server/src/modules/shopping-list/repo.ts` |
| G-30 | Errors | Specific 404 codes (`PREFERENCE_NOT_FOUND`, `CABINET_ITEM_NOT_FOUND`, ...) and P2025 handling in repos (M2-02) | Low | Present-differently | `will-backend:server/src/lib/errors.ts` |
| G-31 | Deploy | `TRUST_PROXY` is hard-coded to 1 | Low | Partial | `will-backend:server/src/config.ts`, `app.ts` |
| G-32 | Deploy | CI workflow | n/a | Missing | `will-backend:.github/workflows/server-ci.yml` |
| G-33 | Deploy | `DEPLOY.md` (env table, Railway / Cloud Run, demo checklist) | n/a | Missing | `will-backend:server/DEPLOY.md` |
| G-34 | Recalls | Import at startup when the last success is over a day old; `job_runs` tracking | Low | Missing | `will-backend:server/src/jobs/importRecalls.ts` |
| G-35 | Cabinet | `DELETE /cabinet/:id` regenerates the list | n/a | Present-differently | `will-backend:server/src/modules/cabinet/service.ts` |

Counts: 22 Missing, 11 Partial, 2 Present-differently.

## Details

### G-01 Presigned PUT checksum (B-16, High)
Carson's `lib/s3.ts` builds `S3Client` with no checksum options. The installed `@aws-sdk/client-s3` is 3.1149, which is
past 3.729, where the default became `WHEN_SUPPORTED`. So presigned PUT URLs carry `x-amz-checksum-crc32` of an empty
body, and every real upload (avatar or item photo) fails.
**Port:** add `requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED"` to the
`S3Client` options.

### G-02 Scanned/cabinet product clears catalog allergen flags (M3-10, High)
SQL `item_allergens_for()` (migration `20261010193722_products`) returns
`coalesce(product.allergens || may_contain, items.default_allergens)`. An empty product array isn't NULL, so an Open
Food Facts product with no allergen data removes every flag. This applies to the scanned product and also to the
cabinet's linked product. DB-04 stops products of other items but not this case.
**Port:** in a new migration, return `default_allergens || product.allergens || product.may_contain` (union, deduped).

### G-03 Recipe check ignores structured allergen data (M3-16, M3-17, High)
`aiRepo.recipeContext` sends only cabinet item names. `conflicts()` matches keywords in recipe text only. A "Snickers"
item with `default_allergens = {peanuts}` passes for a peanut-allergic member. `missingItems` maps "suggested" matches
with no allergen check, so "Oat milk" can map to "Goat milk" for a milk-allergic household.
**Port:** load `default_allergens ∪ product.allergens ∪ may_contain` per cabinet item. Leave forbidden items out of the
prompt. Drop recipes that name them, or whose missing item exactly matches a catalog item with a forbidden allergen.
Return `itemId: null` for suggested matches that carry one.

### G-04 Allergen keyword coverage (B-01, B-03, High)
Carson's `lib/allergens.ts` has phrase exclusions (peanut butter, coconut milk, rice flour). It lacks derived foods and
compounds: pesto, hummus, aioli, custard, teriyaki, panko, seitan (gluten only), Worcestershire, Caesar, satay, Nutella,
crabmeat, catfish, cheesecake, pasta/bread → wheat, parmesan, mayo. It also lacks generic plural and accent handling.
"X-free" isn't neutralized ("dairy-free" flags milk). The recipe check text omits `steps`, `summary` and
`allergenWarnings` (Carson's report notes this too).
**Port:** merge Will's table and `normalize()` exceptions into `lib/allergens.ts`. Run `conflicts()` over all recipe
text fields.

### G-05 SmartLabel "Contains" statements (B-02, High)
`allergenLines()` in `lib/smartlabel.ts` takes the first `/contains\s*:?.../` match. "Contains 2% or less of …" (or any
earlier "contains") wins, and the real `Contains: Milk, Soy` is missed. For JSON-LD pages it then falls back to keyword
matching on the ingredient text.
**Port:** collect every `Contains[:]` statement, skip "contains 2% or less" / "contains less than", and cut at the next
period (Will's `smartlabel.ts`).

### G-06 Content-Type not signed (Medium)
Carson's `DECISIONS.md` says the PUT "is signed for that Content-Type", but `s3-request-presigner` adds `content-type`
to `unsignableHeaders` unless it's listed in `signableHeaders`. This was checked in `node_modules`. A client can PUT
`text/html` to an image key.
**Port:** pass `signableHeaders: new Set(["content-type"])` to `getSignedUrl` in `presignPut`.

### G-07 Dev/demo login (B-07, Medium)
`usersService.loginAs` signs in **any** existing user. With `DEMO_KEY` set in production, anyone with the key can
impersonate real accounts; member ids are visible in `GET /groups/:id`. This is Carson's own API-AUTH-1, still open.
The key check is `!==`, not constant time, and `DEMO_KEY` has no minimum length. `NODE_ENV` defaults to `development`,
so a deploy that forgets it mounts the route with no key, for any user, and CORS allows any origin. The Dockerfile does
set `NODE_ENV=production`.
**Port:** restrict to `google_sub LIKE 'seed-%'` (`findSeeded`), compare SHA-256 digests with `timingSafeEqual`,
require `DEMO_KEY` ≥ 32 chars, and make `NODE_ENV` required.

### G-08 Price-cache poisoning (M3-13, Medium)
`price_estimates` is global per (item, ZIP). Carson prices every list item, including user-created catalog names and
the household's `quantityText`, in one prompt and caches the result for all households. One household's text can steer
prices served to others.
**Port:** add `items.user_created` (Will's migration: column + insert trigger + backfill). Cache only
`user_created = false` items, priced in a prompt holding only their names plus a validated ZIP. Price user-created items
in a separate, uncached call. Keep `quantityText` out of cached prompts.

### G-09 Group id casing (M2-06, M3-06, M3-14, Medium)
`requireGroupMember` uses `req.params.groupId` as typed (Postgres matches uuids case-insensitively). `groupRoom()` and
`perGroup()` keys don't lower-case it. Effects: a socket that joined `group:ABC…` misses events emitted to
`group:abc…`; `evictFromGroupRoom` from a differently-cased URL doesn't kick a removed member; the recipe (10/h) and
price (20/h) limits reset when the URL case changes.
**Port:** lower-case in `requireGroupMember` and in `groupRoom()`.

### G-10 Alias poisoning (M2-07, Medium)
`POST /items {name, aliasOf}` stores any text not already taken as a global alias of any item. `NAME_TAKEN` blocks only
existing names. A user can make "milk" in every household resolve to an unrelated item, if that name isn't taken yet,
or any new spelling.
**Port:** store the alias only if `aliasOf` is among the fuzzy candidates `search_items()` returns for that text within
the suggestion threshold, else `400 ALIAS_NOT_SUGGESTED`.

### G-11 Control characters (B-04, M2-01, M3-04, M3-12, Medium)
Carson's `validate` only parses. A NUL in any stored string (display name, notes, quantity text, item name) reaches
Postgres and returns `500 INTERNAL` (Carson's report notes this too). The same happens with NULs in OFF product data,
openFDA rows (see G-14) and model `unit`/`sourceUrls`.
**Port:** Will's `hasControlChars` walk in `validate()` (400 for C0 except tab/LF/CR, and DEL), plus `stripControl` on
OFF/SmartLabel/openFDA data before writes, plus rejecting model price rows with control characters.

### G-12 Product cache merge (M3-01, M3-02, Medium)
`save()` in `modules/products/service.ts` overwrites the row it finds by GTIN, including `allergens`/`may_contain` and
`source`, even when that row is fresh. A SmartLabel page naming barcode G overwrites G's shared row for every
household. If a GTIN-less URL row and a GTIN row both exist, updating the GTIN row with the URL breaks the unique key
(likely a 409; unverified).
**Port:** Will's `productsRepo.save`: fresh rows are only enriched (fill empty fields, union allergens, keep source),
stale rows are refreshed in place, and when merging, cabinet/list product ids are re-pointed before the URL row is
deleted.

### G-13 SmartLabel parser robustness (B-12, B-13, M3-19, Medium)
No depth guard before `cheerio.load` and `$("body").text()`. A deeply nested page can overflow the stack or block the
event loop for seconds (unverified on Carson's cheerio version; Will measured both). `clean(n.servingSize)` throws on a
non-string, which gives a 500 (Carson's report notes this). `num()` accepts negative calories and nutrients; OFF
`round()` accepts negatives.
**Port:** Will's `tooDeep()` (depth > 128 → "not a label page"), type checks on JSON-LD fields, and finite ≥ 0 numbers.

### G-14 Recall import per-row tolerance (M3-07, Medium)
`fdaDate` checks 8 digits but not a real date (`20261399` → Invalid Date → Prisma throws). NULs aren't stripped. Rows
are upserted in a loop with no try, so one bad row aborts the import, and the matching step never runs. The same row
comes back every day, so imports stop for good.
**Port:** validate `report_date` as a real calendar day, strip control characters, and catch/log/count failures per row.

### G-15 Late-published recalls (M3-08, Medium)
`since` = the latest stored `report_date`. openFDA publishes weekly with `report_date`s days in the past, so those rows
fall before `since` and are never fetched.
**Port:** `since = last success − 14 days` (the upsert by recall number and `ON CONFLICT` on matches make the overlap
idempotent).

### G-16 Recall brand normalization (M3-09, Medium)
The brand gate is `strpos(lower(description), lower(brand))`. "Trader Joe's" vs "TRADER JOES", "Kellogg's" vs
"Kellogg" and "Häagen-Dazs" vs "Haagen-Dazs" fail. The gate also passes when the recalling firm contains the brand,
which catches some parent-brand cases. Item names are compared as `normalized_name` against a description that is only
lower-cased, and aliases aren't matched. Carson uses `strict_word_similarity ≥ 0.6` instead of Will's ≥ 0.35 +
all-words rule. That is a defensible alternative, tuned on live data; it isn't listed as a gap.
**Port:** Will's `match_norm()` (`unaccent` + lower + drop apostrophes) on both sides, and the word-wise brand gate
(every word, or a first word of 4+ letters, optional trailing "s").

### G-17 Recall match race (Low)
`recallsRepo.match` is a single `INSERT … SELECT … ON CONFLICT DO NOTHING` without `FOR KEY SHARE OF c, r`. Will found
that this still races: a cabinet delete committing mid-statement causes an FK violation. In the daily job that fails
the run (logged); per-item matching swallows it.
**Port:** add `FOR KEY SHARE OF c, r` to the SELECT.

### G-18 DNS / private-IP guard (B-11, Low)
`fetchAllowlisted` checks scheme, host allowlist, port and credentials on every redirect hop, but never resolves DNS.
`*.smartlabel.org` is a wildcard, so a subdomain pointing at an internal IP, or DNS rebinding, isn't caught.
**Port:** Will's `guardedFetch` (`dns.lookup(all)` per hop, `BlockList` covering RFC 1918, link-local, loopback, CGNAT,
`::/96`, `::ffff:0:0:0/96`, `64:ff9b:1::/48`, `2002::/16`, ...).

### G-19 Streaming size caps (Low)
SmartLabel uses `res.text()` and then `slice(0, 2_000_000)`. The image copy uses `arrayBuffer()` and then checks 5 MB.
OFF JSON has no cap. A large response is fully buffered first (Carson's report notes this).
**Port:** check `content-length`, then read through `getReader()` and abort past the cap (Will's `common.ts`/`image.ts`).

### G-20 Image copy content type (Low)
`copyProductImage` accepts any `image/*` (SVG included), stores it as `products/{id}.jpg` with that content type, and
serves it through a presigned GET.
**Port:** allow only `image/jpeg|png|webp`.

### G-21 Stale-email handover (B-08, Low)
`users.email` is `@unique`, and `upsertFromGoogle` upserts by `google_sub` only. If another row still holds the address
(reassigned Workspace address, or the old owner changed their Google email), sign-in hits P2002 → `409 CONFLICT` every
time.
**Port:** in one transaction, park the other row's email at `stale+<id>@invalid`, then upsert.

### G-22 Invisible names (B-09, Low)
`displayName` and group `name` are `trim().min(1)`, so zero-width and bidi-control-only names pass. A Google name with
no visible characters is stored as-is.
**Port:** Will's `visibleName(max)` refine (`/[^\p{Cf}\p{Z}\s]/u`), plus the email-local-part fallback at first login.

### G-23 Non-UUID JWT `sub` (Low)
`verifyAppToken` accepts any string `sub`. `requireAuth`'s `findUnique` then throws, which gives a 500. The Socket.IO
handshake has the same path. This needs the secret, so it's hardening only (Carson's API-AUTH-2, still open).
**Port:** require `z.uuid()` on `sub` in `verifyAppToken`.

### G-24 Impossible calendar dates (Low)
`CalendarDate` is a regex only. `fromCalendarDate("2026-13-01")` gives Invalid Date → 500, and `2026-02-30` is stored
as March 2 (Carson's report notes both).
**Port:** use `z.iso.date()` (zod 4 checks real days).

### G-25 Query strings in the access log (B-10, Low)
The pino-http serializer logs `req.url` with its query string, so `/items/search?q=…` text is logged. The Socket.IO
token travels in `auth`, not in the URL, so tokens aren't exposed.
**Port:** `url.split("?")[0]` in the serializer.

### G-26 Dietary PUT race (M2-04, Low)
`putDietary` serializes through the group advisory locks. A user with no groups takes no lock, so two concurrent PUTs
can both insert and one gets a 409.
**Port:** `SELECT … FROM users WHERE id = $1 FOR UPDATE` first.

### G-27 Price-row sanity (M3-12, Low)
Carson drops unknown ids, negatives and out-of-order rows (good), but allows up to $100,000 per item. `unit` allows 100
chars with control characters (see G-11). It keeps 5 http(s) URLs with no control-character check.
**Port:** Will's limits ($500 cap, `unit` ≤ 40 chars and clean, URLs ≤ 2048 chars and clean, max 10).

### G-28 Concurrent first scans (M3-05, Low, unverified)
Catalog item creation is race-safe (`ON CONFLICT DO NOTHING`), but `productsRepo.create` isn't. Two concurrent first
scans of one GTIN can both miss the cache and one insert gets P2002 → 409.
**Port:** `INSERT … ON CONFLICT (gtin) DO UPDATE/NOTHING`, then read the row.

### G-29 Stale names in allergen flags (M2-03, Low)
`allergen_flags` stores `displayName` as a snapshot, and `toListItem` returns it as stored. `PATCH /me` doesn't
regenerate, so a renamed member's badge keeps the old name until something else regenerates. `wantedBy` is resolved at
read time, so it's fine.
**Port:** resolve flag names from `memberNames` in `toListItem`, as `wantedBy` does.

### G-30 Specific 404 codes (M2-02, Present-differently)
Carson maps P2025 to `404 NOT_FOUND` globally, so races don't 500. Its `notFound()` helper always uses the code
`NOT_FOUND`, where Will has `PREFERENCE_NOT_FOUND`, `CABINET_ITEM_NOT_FOUND`, `LIST_ITEM_NOT_FOUND`,
`RECALL_MATCH_NOT_FOUND` and `ITEM_NOT_FOUND`. Port only if the app needs to tell these apart; the current app checks
only `NOT_FOUND`.

### G-31 TRUST_PROXY (Low)
`app.set("trust proxy", 1)` is hard-coded. Run without a proxy (local Docker, a bare VM), a client can spoof
`X-Forwarded-For` and get around the per-IP limits on `/auth/google` and `/dev/login-as`.
**Port:** a `TRUST_PROXY` env var (hop count, default 0).

### G-32 CI workflow (Missing)
There's no `.github/workflows` on `origin/carson`, and the merge deletes `server-ci.yml`.
**Port:** restore Will's workflow (Postgres 16 service, `npm ci`, `prisma validate`, `migrate deploy`, build,
`npx vitest run`). Adjust for Carson's `grocerez_test` guard, seed step and Prisma 7 `prisma.config.ts`.

### G-33 DEPLOY.md (Missing)
Carson's `server/README.md` covers Docker and backups briefly. There's no env table, Railway / Cloud Run steps,
`DEMO_KEY` / seeding notes or demo checklist.
**Port:** bring over `will-backend:server/DEPLOY.md`, updated for Carson's env names (`ENABLE_JOBS`,
`MIGRATE_DATABASE_URL`, `AKAMAI_*`, `CONTACT_EMAIL`).

### G-34 Startup recall import (Low)
Carson schedules only `0 6 * * *` (when `ENABLE_JOBS`). A fresh deploy has no recall alerts until the next 06:00, and
there's no last-success record (it uses the max `report_date`).
**Port:** a `job_runs` row, plus a run at startup when the last success is over a day old.

### G-35 Cabinet DELETE regenerates (Present-differently)
Carson follows the plan (no regeneration on throw-away), so a wanted item comes back only at the next regeneration.
Will regenerates right away. This is a product choice, not a defect.

## Already covered in Carson's (no action)

Checked and equivalent or better: alg `none` / HS256-only, tokens of deleted users rejected (REST and socket), P2025 →
404, the API contract additions (`avatarKey`, `photoKey` with an escaped-dot regex and a DB CHECK (M2-05, M3-18),
`DELETE /cabinet/:id`, `CabinetItem.product`, `missingItems[{itemId, match}]` in place of `missingItemMatches`,
`missingItemIds` in place of `unpricedItemIds`; the app already uses Carson's shapes), `PRODUCT_ITEM_MISMATCH` (409, and
enforced in the DB by DB-04), the unknown `scannedProductId` → 404 (M2-08), finish trip vs check-off vs regenerate
(group advisory lock on every list write, plus a DB trigger), kick on removal (except casing, G-09), structured outputs
plus `stop_reason` handling plus 503 mapping (also 422 `AI_REFUSED`, 502 `AI_BAD_OUTPUT`), rate limits on recipes and
prices (except casing), deterministic diet rules (B-14, broader than Will's), GTIN normalization (M3-03, as GTIN-14 with
check digit), race-safe catalog item creation (M3-05), the redirect re-check and https/port/credential checks, B-06
(the SmartLabel image is never fetched, and the OFF copy is limited to OFF hosts with redirects refused), `CORS_ORIGINS`
(production only), the Dockerfile (non-root, migrate on start), the uploads router reading `req.userId` (B-15).

## Carson-only (context)

Things Carson's backend has that Will's lacked:
- Semantic item search: Akamai embeddings plus generated item descriptions and product types, a `related[]` field in
  search results, and a startup backfill (`lib/embeddings.ts`, `jobs/embedItems.ts`).
- Household time zones (`groups.time_zone`, DB-08), used for "today", expiry estimates and alerts.
- GTIN-14 storage with check-digit validation and UPC-E expansion (DB-07).
- Seed data (`prisma/seed.ts`, demo users `…0101`–`0104`, a demo recall) and a test DB guard (`*_test` only).
- DB-level integrity: `owner_handoff` trigger with concurrency fix (DB-01, DB-09), product↔item link constraint
  (DB-04), list advisory-lock trigger (DB-02), member scrub from list rows on leave/delete (DB-03), Unicode
  normalization (DB-06), better search labels (DB-05, DB-11), an app DB role separate from the migration role.
- Item linking for scans tries brand and sub-phrases ("Honey Nut Cheerios" → Cheerios).
- Graceful `503 NOT_CONFIGURED` when AWS/Anthropic keys are missing outside production; startup lists every bad env var.
- `DELETE /me` disconnects the user's sockets; socket acks carry error codes; invite responses are timing-equal for
  known and unknown emails.
- Pescatarian and keto diet keyword checks; `EMAIL_NOT_VERIFIED` code; validation `details[]` in error bodies.
