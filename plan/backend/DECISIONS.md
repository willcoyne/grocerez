# Backend Decisions

Choices made while implementing `plan/backend/` where the plan was unclear, outdated, or had to be adapted.
Format: date · folder · what the plan said · what was done · why.

## Decisions

### 2026-10-10 · 01 · Versions and build layout
- **Did:** Express **5.3**, zod **4.6**, vitest **4.1**, socket.io 4.8, pino 10, TypeScript 7.0.2 (already pinned by the database builder).
  Express 5 forwards rejected promises to the error handler, so routes are plain `async` functions.
  `npm run build` compiles `src/` **and** the generated Prisma client (`generated/prisma`, `.ts` files) with `tsconfig.build.json`,
  so the entry point is `dist/src/index.js` (`npm start`).
- **Why:** current stable releases; the Prisma 7 generator emits TypeScript, which must be compiled alongside the app.

### 2026-10-10 · 01 · Which env variables are required
- **Plan said:** crash at startup if anything in the list is missing (including `ANTHROPIC_API_KEY`, AWS keys).
- **Did:** `DATABASE_URL`, `JWT_SECRET` (≥ 16 chars) and `GOOGLE_CLIENT_IDS` are always required. `ANTHROPIC_API_KEY`, `AWS_REGION`,
  `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` are required only when `NODE_ENV=production`; in development/test the
  routes that need them return `503 NOT_CONFIGURED`. Added optional `CORS_ORIGINS`, `CONTACT_EMAIL`, `ENABLE_JOBS`, `RESEND_FROM`,
  `OPENFDA_API_KEY`, `DEMO_KEY`. Startup prints every missing/invalid variable and exits with code 1.
- **Why:** the team has no Anthropic/AWS accounts yet; the M2 loop must run locally without them. Production still fails fast.

### 2026-10-10 · 01 · Error codes beyond the plan
- Malformed JSON → `400 VALIDATION_ERROR`; body over 1 MB → `413 PAYLOAD_TOO_LARGE`; Prisma `P2025` → `404 NOT_FOUND`; unknown route → `404 NOT_FOUND`;
  anything else → `500 INTERNAL` (logged, no details returned). Validation errors include `details: [{path, message}]`.

### 2026-10-10 · 01 · Tests use a separate database
- Tests run with vitest + supertest against a real Postgres database, `grocerez_test` by default (`TEST_DATABASE_URL`).
  `test/globalSetup.ts` runs `prisma migrate deploy` + `prisma db seed` on it before every run and refuses any URL that isn't a `*_test` database.
  Files run serially (`fileParallelism: false`). Tests create their own users/groups with random ids, except the engine test,
  which reads the seeded demo group.

### 2026-10-10 · 02 · Profile refresh on login
- **Plan said:** upsert by `google_sub`, "update email, name, and picture on each login".
- **Did:** email (trimmed + lower-cased, required by the DB CHECK) and picture refresh on every login; `displayName` is set from
  Google only when the user is created (fallback: the part of the email before `@`).
- **Why:** otherwise a name changed through `PATCH /me` would be overwritten at every sign-in.

### 2026-10-10 · 02 · Auth details
- An unverified Google email returns `401 EMAIL_NOT_VERIFIED` (bad/expired token: `401 UNAUTHENTICATED`). No user row is written.
- `requireAuth` also checks the user row still exists, so tokens of a deleted account (`DELETE /me`) stop working immediately.
  It is mounted once for every `/api` route after `/health`, `/auth/google` and `/dev/*`, so unknown `/api/*` paths answer 401 to anonymous callers.
- `DELETE /me` runs in one transaction: delete the user (memberships + preferences cascade; the `owner_handoff` trigger promotes the
  longest-standing member), delete groups left with no members, regenerate the remaining groups' lists; then emits
  `group:changed` / `preferences:changed` / `shopping-list:changed` and disconnects the user's sockets.
- `PATCH /me` accepts `zipCode: null` to clear it; ZIP must be 5 digits (the `price_estimates` CHECK uses the same rule).
- `POST /api/dev/login-as/:userId` returns `{token, user}` like `/auth/google`. Mounted when `NODE_ENV !== "production"`; in production
  only when `DEMO_KEY` is set, and then it requires header `x-demo-key` (backend/12 step 4). Seeded ids: `00000000-0000-4000-8000-000000000101`…`0104`.
- Google verification lives in `src/lib/google.ts` (`google.verifyIdToken`), which tests stub with `vi.spyOn`.

### 2026-10-10 · 03 · Groups and invites details
- **Response shapes:** `Group = {id, name, role (caller's), memberCount, createdAt}`; `GET /groups/:groupId` adds
  `members[] = {id, displayName, email, avatarUrl, role, joinedAt}`. `Invite = {id, groupId, email, status, invitedBy:{id,displayName}|null,
  createdAt, respondedAt}`; `GET /me/invites` adds `group:{id, name, memberCount}`. `POST /groups` and `POST .../invites` return **201**.
- **Error codes:** non-member / malformed group id → `404 NOT_FOUND`; owner-only route → `403 FORBIDDEN`; invite not pending or not the
  caller's email → `404 INVITE_NOT_FOUND`; revoking a non-pending invite → `409 INVITE_NOT_PENDING`; inviting a member → `409 ALREADY_MEMBER`;
  removing yourself → `400 CANNOT_REMOVE_SELF` (use leave); invites over 20/hour per user → `429 RATE_LIMITED`.
- **Status transitions are conditional** (`UPDATE ... WHERE status = 'pending'`) so two concurrent accept/decline/revoke calls can't both win.
- **Accepting regenerates the list** (the new member's allergens change the allergen flags), as do leave and remove-member.
- **Leave:** the explicit preference delete is kept (it's a no-op because the composite FK cascades). Owner promotion is the database
  `owner_handoff` trigger; the backend only deletes the group when nobody is left.
- **Remove member** revokes that person's invite row in the group whatever its status (normally `accepted`), so the old invite can't be re-used.
- **Email (step 13, stretch) is implemented but off by default:** `src/lib/email.ts` posts to Resend when `RESEND_API_KEY` is set
  (sender `RESEND_FROM`), fire-and-forget, sent for known and unknown emails alike so the response and timing don't differ.

### 2026-10-10 · 04 · Item search reuses `search_items()`
- `GET /items/search` calls the database's `search_items(q)` (tagged `$queryRaw`) instead of re-implementing the query. Empty-after-normalize
  or missing `q` → `400 VALIDATION_ERROR`. Zero rows → `{match:"none", results:[]}`; otherwise `match` is the function's label for the best
  candidate and `results` are all candidates (best first), so for `suggested` the app shows `results[0]` as "Did you mean…?".
- `Item = {id, name, normalizedName, category, defaultAllergens, shelfLifeDays}`.
- `lib/normalize.ts` is a line-by-line port of `normalize_item_name()`; the test checks all fixture cases plus extra inputs against the SQL function.

### 2026-10-10 · 04 · `POST /items` details
- Without `aliasOf`: if the normalized name (or an alias) already exists, returns that item with **200**; otherwise creates it (**201**),
  `category` defaults to `"other"`. `normalized_name` is computed by SQL in the insert (`ON CONFLICT DO NOTHING`), so races return the existing row.
- With `aliasOf`: unknown item → 404; the text already normalizes to that item → 200; the text already means a **different** item
  (its name or another alias) → `409 NAME_TAKEN`; otherwise the alias is stored (201) and the target item is returned.

### 2026-10-10 · 04 · Preferences response
- **Plan said:** "`all` adds `wantedBy` names".
- **Did:** every `Preference` row includes `user: {id, displayName}` (for both `me` and `all`), plus the full `item`. `POST` returns 201 when
  created and 200 when it updated the existing `(group, user, item)` row. Unknown `itemId` → 404. Rows from another group → 404; another
  member's row → 403.
- Every preference write and the regeneration run in **one transaction** (`withRegeneration`), then `preferences:changed` is emitted, plus
  `shopping-list:changed` when the list actually changed.
- `PUT /me/dietary` dedupes values, returns them sorted, and regenerates every group the user belongs to in the same transaction.

### 2026-10-10 · 05 · Cabinet details
- `CabinetItem = {id, groupId, itemId, item:{id,name,category}, product:{id,brand,name,imageUrl}|null, status, quantityText, location,
  purchasedAt, expiresAt ("YYYY-MM-DD"), expirationSource, addedBy, createdAt, updatedAt}`. Dates in bodies are `YYYY-MM-DD`.
- `POST /cabinet` upserts on `(group, item)`, always sets `status = in_stock`, returns 201 (created) / 200 (updated). Missing `expiresAt`:
  keeps an existing date, otherwise estimates it (`lib/expiration.ts`, the 09 rule) with `expiration_source = 'estimated'`; household items get none.
  A given `expiresAt` is `manual`. `PATCH {expiresAt: null}` clears date and source (the DB requires both or neither).
- Every cabinet write that can change "have" runs with the regeneration in one transaction and emits `cabinet:changed` (+ `shopping-list:changed` if the list changed).
- **`DELETE /cabinet/:id` (thrown away) does not regenerate**, as the plan says. Note: because the list is `preferences − cabinet`, the next
  regeneration triggered by anything else will add the item back if someone still has it as a preference. That is the set rule, not a bug.
- `cabinetHooks.afterAdd` is the hook where 09 runs recall matching for a newly added item.

### 2026-10-10 · 06 · `generate()` reuses the SQL `generate_shopping_list()`
- Verified the database function against backend/06 step 1: (1.1) reads preferences, in-stock cabinet, member allergens and current rows in
  one transaction; (1.2) upserts needed rows with `reason='preference'`, `wanted_by`, combined `quantity_text` and never touches `checked`;
  (1.3) flags = linked product `allergens ∪ may_contain` (scanned product, else the cabinet's product) else `items.default_allergens`, for
  **all** members; (1.4) deletes unchecked `preference` rows no longer needed; (1.5) keeps manual and checked rows (only their
  `wanted_by`/flags are refreshed). It returns a row count, not the list, so the service wraps it: `src/modules/shopping-list/engine.ts`
  `regenerate(tx, groupId)` is the single generation step used by every write; `withRegeneration()` runs a write + regenerate in one
  transaction and emits after commit; `shoppingListService.generate()` returns the sorted list (step 1.6).
- **Concurrency fix:** `generate_shopping_list()` takes a per-group advisory lock, but a transaction that first updates a list row and then
  regenerates could deadlock with another doing the same (its `INSERT … ON CONFLICT` locks conflicting rows). Every regenerating transaction
  now takes the same advisory lock **first** (`lockGroup`, sorted order for several groups). Tested with 6 concurrent check-offs from two
  users and two concurrent finish-trip calls (items move exactly once).

### 2026-10-10 · 06 · List response and rules
- `ShoppingListItem = {id, groupId, itemId, item:{id,name,category}, reason, wantedBy:[{userId, displayName}], quantityText,
  allergenFlags:[{userId, displayName, allergen}], checked, checkedBy, checkedAt, scannedProductId, addedBy, createdAt, updatedAt}`.
  The DB stores `wanted_by` as ids; the API adds display names (a former member shows as "Former member").
- `GET` sorts by aisle order (produce, bakery, meat, seafood, dairy, frozen, pantry, snacks, beverages, household, other; NULL = other), then name.
- Manual add: upsert with `reason='manual'` (an existing preference row becomes manual so it survives), 201 created / 200 updated, then
  regenerates so `wanted_by`/flags are filled. Unknown item → 404.
- `PATCH {checked, scannedProductId?}`: the backend sets `checked`/`checked_by`; the DB trigger stamps/clears `checked_at`. Linking a product
  regenerates (its allergens can change the flags). Unknown product → 404.
- `DELETE` a preference row → `409 PREFERENCE_ROW`. Deleting a manual row regenerates, so if someone still wants the item it reappears as a preference row.
- Finish trip: cabinet upsert sets `status in_stock`, `purchased_at now()`, `product_id` = scanned product (kept if none scanned),
  the row's `quantity_text`, and an estimated expiration (household/unknown: none). One-time preferences for the bought items are deleted
  for **all** members of the group. Then the checked rows are deleted and the list regenerated, all in one transaction under the group lock.
- The seeded demo list is Bread, Lay's, Milk, Oreos, Peanut Butter, Tostitos (the board items Tostitos, Lay's, Oreos plus the
  seed's staples; database/10), with Milk flagged for User 3 and Peanut Butter for User 4.

### 2026-10-10 · 07 · Socket.IO details
- Connect with `io(API_URL, { auth: { token: appJwt } })`. Invalid/expired token or deleted user → connection refused with error message
  `UNAUTHENTICATED`. Every socket joins `user:<id>`.
- `group:join {groupId}` and `group:leave {groupId}` accept an **ack callback**: `{ok:true}` or `{ok:false, error:{code:"NOT_FOUND", message}}`
  (non-member, unknown or malformed id; same "don't reveal" rule as REST). Clients should re-send `group:join` after reconnecting.
- Group-room payloads are `{groupId, by}`. Personal-room events: `invites:changed {groupId}` (invited, revoked, accepted, declined, removed) and
  `group:changed {groupId, by}` (you were removed, the group was deleted) so the app can refresh its group switcher.
- Leaving, removal and group deletion make the affected sockets leave the group room (`fetchSockets()`); `DELETE /me` disconnects the user's sockets.
- Single instance only (no Redis adapter), per step 7.

### 2026-10-10 · 08 · SmartLabel reality check (step 8) and parsers
- **robots.txt (checked 2026-10-10):** `smartlabel.org` allows all user agents (`Disallow:` empty, `Crawl-delay: 10`).
  `smartlabel.generalmills.com/robots.txt` returns the app's HTML page (no robots rules). `smartlabel.labelinsight.com` has no robots.txt (404).
  We fetch one page per scan, cache for 30 days, and identify as `GrocerEZ/0.1 (+CONTACT_EMAIL)`.
- **Real pages are JavaScript shells:** the General Mills SmartLabel page (`smartlabel.generalmills.com/<GTIN-14>`) contains no label data in
  its HTML; nutrition is loaded by scripts. It does contain the GTIN (`#hdnGTINId` and the URL path). Saved as
  `server/test/fixtures/smartlabel/generalmills-shell-00016000275287.html`. The parser returns `template: "gtin-only"` and the scan continues
  with the barcode path (plan step 3.5), so scanning a General Mills cereal QR returns calories + allergens from Open Food Facts
  (verified live: Cheerios → 140 kcal/serving, `gluten`). The product row keeps both `smartlabel_url` and `gtin`.
- **Template parsers:** `jsonld` (schema.org `Product` + `NutritionInformation`) and `sections` (server-rendered page with a nutrition
  table and Contains/May contain lines). No real server-rendered SmartLabel page was found, so their fixtures are **synthetic** (marked in
  the files). Add a saved real page + parser when one is found.
- **Host allowlist:** `smartlabel.org`, `www.smartlabel.org`, any `*.smartlabel.org`, `smartlabel.labelinsight.com`, `smartlabel.generalmills.com`
  (`src/lib/smartlabel.ts`). QR links may be `http`; they are canonicalized to `https` (no port, credentials or fragment) and that string is the cache key.
  Redirects are followed **manually** (max 5) and every hop must be https on an allowlisted host; anything else → `400 HOST_NOT_ALLOWED`.
  Response bodies are capped at 2 MB, 5 s timeout.
- **GTINs are stored as GTIN-14** (left-padded) so UPC-A, EAN-13 and SmartLabel GTIN-14 scans of the same product share one cache row.
  Open Food Facts is queried with the EAN-13 form.
- **Errors:** both or neither of `qrUrl`/`gtin` → 400; unknown product → `404 PRODUCT_NOT_FOUND`; Open Food Facts / SmartLabel unreachable →
  `502 UPSTREAM_UNAVAILABLE` (a stale cached row is returned instead when there is one); more than 30 scans/min/user → 429.
- **Response:** `Product = {id, itemId, item:{id,name,category}, gtin, smartlabelUrl, brand, name, servingSize, caloriesPerServing, nutrition, ingredients,
  allergens, mayContain, healthScore, imageUrl, source, fetchedAt}`. `nutrition` keys: `basis` ("serving" or "100g"), `fat_g`, `sat_fat_g`, `sodium_mg`,
  `carbs_g`, `sugar_g`, `protein_g`, `fiber_g` when known. `imageUrl` is the S3 copy when present (11), else the Open Food Facts image URL.
- **Item linking (step 5):** exact match on the full name, then the brand (the catalog has brand items like Cheerios/Oreos), then shorter word
  runs (longest, rightmost first), then the full name's "suggested" match; otherwise a new item is created with the category guessed from
  `categories_tags`. Open Food Facts `en:corn` and other non-major allergens are ignored; OFF `en:nuts` → `tree_nuts`.
- The allergen keyword table (`src/lib/allergens.ts`) excludes phrases such as "peanut butter", "coconut milk", "nutmeg", "rice flour".
