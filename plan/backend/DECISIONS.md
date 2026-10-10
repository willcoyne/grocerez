# Backend Decisions

Choices made while implementing `plan/backend` where the plan was silent or unclear.

## 01-server-setup

- **Prisma pinned to 6.x** (`prisma` / `@prisma/client` 6.19.3). npm's `latest` tag for `prisma` is an 8.0 release
  candidate, and Prisma 7+ moves the datasource URL into `prisma.config.ts` and requires driver adapters. 6.x matches
  `plan/database/01-setup-migrations` as written (`url = env("DATABASE_URL")`, `previewFeatures`, `prisma-client-js`).
  The database builder may upgrade later.
- **Minimum database pieces created here** because no database work existed: `server/docker-compose.yml` (exactly as in
  `database/01` step 1) and a `server/prisma/schema.prisma` with only the generator and datasource, no models, so
  `GET /api/health` can run `SELECT 1`. Extensions, the `init` migration, and the `db:migrate`/`db:reset`/`db:studio`
  scripts are left to `database/01`. Only `db:up` was added, since tests need Postgres.
- **ESM** (`"type": "module"`, NodeNext), so relative imports use `.js` suffixes.
- **Socket.IO and cron are not attached in `index.ts` yet.** They belong to backend/07 and backend/09.
- **`JWT_SECRET` must be at least 32 characters.** Other required variables only need to be non-empty.
- **CORS** allows `http://localhost:8081` (Expo web dev server). Native apps send no `Origin` header, so CORS doesn't apply to them.
- **Extra error mappings** beyond the plan's list, all using the standard error shape: malformed JSON returns
  `400 VALIDATION_ERROR`, a body over 1 MB returns `413 PAYLOAD_TOO_LARGE`, unknown routes return `404 NOT_FOUND`, and
  unhandled errors return `500 INTERNAL` with a generic message (details are logged only).
- **Logging** comes from `lib/logger.ts` (pino). The `Authorization` and `Cookie` headers are redacted. It is silent when `NODE_ENV=test`.
- **`contracts/common.ts`** holds the `ErrorResponse` and `HealthResponse` schemas.

## 02-auth

- **Schema created here** (no database work existed): `prisma/migrations/*_init` (only the `pgcrypto`, `pg_trgm`,
  `fuzzystrmatch` extensions from `database/01`) and `*_users_profile` (`users`, `allergen` enum, `user_allergens`,
  `user_diets` with the diet CHECK list), exactly per `database/02-users`. Prisma models: `User`, `UserAllergen`,
  `UserDiet` (`user.allergens`, `user.diets`). Added `db:migrate`, `db:reset`, `db:studio` scripts. The database builder
  owns these from here; `database/01` and `database/02` checkboxes were left for them to verify.
- **Name and picture are only set on first sign-in.** The plan says to update email, name, and picture on every login,
  but `display_name` is user-editable (`PATCH /me`) and `avatar_url` may become an S3 key (backend/11), so overwriting them
  would undo the user's edits. Email is still refreshed on every login (lower-cased; it drives invite matching).
- **`User` response shape** (`contracts/auth.ts`): `{id, email, displayName, avatarUrl, zipCode}`. `googleSub` and
  timestamps are never returned.
- **`DELETE /me` returns the deleted `User` (200)**, matching the contract row literally. The owner handover from
  `database/11` is left to backend/03, since groups don't exist yet (marked with a `ponytail:` comment in `users/service.ts`).
- **`PATCH /me`** accepts `zipCode: null` to clear it, validates US ZIPs (`12345` or `12345-6789`), trims `displayName`
  (1-80 chars), and rejects unknown keys with 400.
- **Auth gate is global.** `requireAuth` runs on all of `/api` after the public routers (`/health`, `/auth/google`, and
  `/dev/*` outside production), so new routers are protected by default and unknown `/api` paths return 401 (not 404)
  without a token. It also returns 401 if the JWT's user no longer exists (one `count` query per request) and only accepts HS256.
- **`/dev/login-as/:userId`** is public (it is a login) and only mounted when `NODE_ENV !== "production"`.
- **Rate limit** on `/auth/google`: 20/min per IP via `express-rate-limit`, returning `429 RATE_LIMITED` in the standard
  error shape. Behind a proxy (backend/12) `app.set("trust proxy", 1)` is needed or every client shares one IP.
- **Google verification** lives in `lib/google.ts` (`verifyGoogleIdToken`), which tests replace with `vi.mock`. Any
  verification failure or `email_verified !== true` returns `401 UNAUTHENTICATED`.
- **Test note:** with vitest 5, a `mockRejectedValue` on the Google stub that is still queued or persistent when the test
  ends is reported as a test failure, so the rate-limit test uses resolved tokens instead.
## 09 (partial, parallel)

Built standalone while 02-07 were in progress elsewhere. No routes, models, migrations, cron, or app wiring.

- **Done:** `src/lib/expiration.ts` (`estimateExpiration`, category shelf-life table; `household`/`other`/unknown → `null`),
  `src/modules/recalls/openfda.ts` (`fetchRecalls` with injectable `fetch`, `skip` paging, zod-validated rows, malformed
  rows dropped, 404 = no results, `redirect: "error"`, 15s timeout; `recallLink`), `src/modules/recalls/match.ts`
  (pure `matchRecalls`, pg_trgm-compatible `similarity` / `strictWordSimilarity`, whole-word `brandAppears`).
  Tests: `test/recalls.test.ts` (stubbed fetch, no network or DB).
- **Matching uses `strict_word_similarity`, not `similarity()`.** Whole-string `similarity("baby spinach", <long recall
  description>)` stays well under 0.35 even for an exact hit, so the plan's rule would almost never match. The score is
  the best over item name, aliases, and `brand + ' ' + productName`, each against the best whole-word run of the
  description. When the SQL version is written, use `strict_word_similarity(name, product_description) >= 0.35` so it
  agrees with the JS function.
- **Brand gate** is a case-insensitive whole-word check ("Valley" does not match "Valleyview").
- **Alert link:** openFDA has no per-recall web page, so `recallLink` returns the API query for that `recall_number`.
- **Remaining (done, see "09-expiration-recalls" below):** `recalls`/`recall_matches` tables (database/09), `jobs/importRecalls.ts` + `node-cron` `"0 6 * * *"`
  wiring in `index.ts` (upsert by `external_id`, last-import tracking), per-item re-match on cabinet add, saving
  estimates in `finishTrip`/cabinet add and `expiration_source`, `GET /groups/:groupId/alerts`, `POST .../dismiss`,
  `cabinet:changed` emit, `OPENFDA_API_KEY` in config/.env.example, the Done-when checks.
## 11-file-storage-s3 (avatar path done; photo/product parts wait on 05/08)

- **Done:** `lib/s3.ts` (`S3Client`, `presignPut` with 5-minute expiry, `presignGet` with 1-hour expiry),
  `contracts/uploads.ts`, `modules/uploads/{service,router}.ts` for `POST /uploads/presign`, mounted in `app.ts` after
  `requireAuth` (it reads `req.userId`). `PATCH /me {avatarKey}` and presigned `avatarUrl` in every `User` response.
  Tests: `test/uploads.test.ts` (router in isolation) and `test/avatar.test.ts` (real app + Postgres, presigners stubbed
  with `vi.mock`, no AWS calls).
- **`content-type` is a signed header** (`signableHeaders`). By default the presigner leaves it out of the signature, which
  would let a client PUT `text/html` (or anything else) to an image key. Now S3 rejects a PUT whose `Content-Type`
  doesn't match the approved type. The app must send exactly the `contentType` it asked for.
- **Keys are always generated by the server** (`${purpose}/${userId}/${uuid}.${ext}`). Extra body fields (`key`,
  `filename`, ...) are stripped by zod. A `userId` that isn't `[A-Za-z0-9_-]{1,64}` is refused (401) because it ends up in the key.
- **`avatarKey` must match exactly** `^avatar/<own userId>/<uuid>.(jpg|png|webp)$` (the shape presign issues), not just the
  prefix, so `..` segments, other users' keys and `item-photo/` keys are `400 VALIDATION_ERROR`. `null` clears it. The
  server does not check the object exists in S3 (no HEAD call); a key that was never uploaded just yields a broken image.
- **Schema:** new migration `20261010230000_users_avatar_key` adds nullable `users.avatar_s3_key` (Prisma `avatarKey`).
  Existing migrations untouched.
- **`avatarUrl` resolution:** the stored key is never returned. `users/service.toUser()` returns a presigned GET URL when
  `avatar_s3_key` is set, otherwise `avatar_url` (the Google picture seeded at first login). Auth responses
  (`/auth/google`, dev login) go through the same function. Later endpoints that embed users (group members, 03) must
  call `toUser()` too, or the member list shows the Google picture instead of the upload.
- **No size limit.** The plan doesn't give one, and a presigned PUT can't enforce a byte range. If we need one, switch to
  a presigned POST with a `content-length-range` condition.
- **No uploads repo.** The presign endpoint has no DB access, so the module has only `service.ts` and `router.ts`.
- **Frontend must update:** `PATCH /me` now also accepts `avatarKey` (string from `POST /uploads/presign` with
  `purpose: "avatar"`, or `null` to remove). Flow: presign -> `PUT uploadUrl` with header `Content-Type` equal to the
  requested `contentType` -> `PATCH /me {avatarKey: key}`. `avatarUrl` in `User` expires after 1 hour; refetch `/me`
  (or the member list) rather than caching the URL long-term. The contract table row for `/me` is updated.
- **Remaining:**
  - Cabinet `photoKey` (`PATCH cabinet {photoKey}`, `item-photo/<userId>/` check, `photo_s3_key` column, presigned GET in
    cabinet responses) belongs with backend/05 (cabinet doesn't exist yet).
  - Step 5, copying Open Food Facts images to `products/{productId}.jpg`: done in backend/08 (see that section).
  - Steps 1-2 (bucket, IAM, CORS) are manual AWS setup; instructions are in `server/README.md`.
  - "Done when" boxes are unticked: the member list doesn't exist until 03 (and needs `toUser()`), and "bucket not
    publicly readable" can only be checked once the real bucket exists.
- **Shared dev DB note:** `npm run db:migrate` (`migrate dev`) asked to reset the shared DB because the main tree had
  applied a groups migration this branch doesn't have yet. Applied this migration with `npx prisma migrate deploy`
  instead (no reset). After merging, `migrate dev` works again.

## 08-smartlabel-product-data

Client layer (`common.ts`, `smartlabel.ts`, `openFoodFacts.ts`, tests in `test/products.clients.test.ts`) was built
first in a parallel worktree; the route, table and image copy were added on top. A separate fix pass owns the
SmartLabel parser (break findings B-02, B-06, B-12, B-13), so this step did not touch `smartlabel.ts`/`common.ts`.

- **Schema:** new migration `20261011020000_products` (enum `product_source`, table `products` exactly per
  database/08, `CHECK products_identifier`: `gtin` or `smartlabel_url` set unless `source = 'manual'`). Applied with
  `npx prisma migrate deploy` on the shared DB (no reset). `item_id` is **nullable, `ON DELETE SET NULL`**: a product
  whose name has no letters/digits can't be linked, and deleting a catalog item shouldn't delete cached scans.
  `allergens`/`may_contain` are `NOT NULL DEFAULT '{}'` like `items.default_allergens`.
- **Route:** `POST /api/products/scan` in `modules/products/{router,service,repo}.ts`, contract
  `src/contracts/products.ts` (`ScanProductBody`, `Product`), mounted behind `requireAuth`. Body is strict; exactly one
  of `qrUrl` (max 2048) / `gtin` (8-14 digits), else `400 VALIDATION_ERROR`. 30 requests/min per user
  (`express-rate-limit`, keyed on `req.userId`, runs before validation so junk requests count) -> `429 RATE_LIMITED`.
- **Flow:** `qrUrl` is checked against the SmartLabel allowlist first (400, nothing fetched), then the cache is read by
  the normalized URL (`new URL().toString()`), `gtin` by digits. A row with `fetched_at` under 30 days is returned as-is.
  Otherwise SmartLabel page -> parser; if the parser returns no product but found a GTIN -> Open Food Facts; nothing
  usable -> `404 PRODUCT_NOT_FOUND` (new code). Upstream failures stay `502 UPSTREAM_ERROR`, **except when a stale row
  exists: then the stale row is returned** (better than an error for a 30-day cache).
- **One row per product:** upsert keyed by `gtin` when known, else `smartlabel_url`. A QR scan that resolves to a GTIN
  stores both, so a later barcode scan of the same product is a cache hit. If an older GTIN-less row holds the same
  URL, it is deleted in the same transaction (keeps `smartlabel_url` unique). A refresh never clears an existing
  `smartlabel_url` or `item_id`.
- **Item link (step 5):** product name (cut to 100 chars) through `items/service.search()`; `exact` or `suggested` ->
  first result; otherwise `items/service.create()` with a category guessed from OFF `categories_tags` (keyword rules,
  most specific tag first, `en:plant-based-foods-and-beverages` ignored, default `other`). Only done when the product
  has no `item_id` yet. Created items have `created_by` = the scanning user.
- **`raw`:** the OFF JSON as received; for SmartLabel `{url, html}` with the HTML cut to 100,000 chars (enough to
  debug a parser miss without storing 2 MB per row). `raw` is never returned by the API.
- **Product images (11 step 5):** `modules/products/image.ts`. `fetchProductImage()` allows only https, no credentials,
  default port, no IP literals, host `openfoodfacts.org` / `*.openfoodfacts.org`; every redirect hop is re-checked and
  must resolve only to public addresses (same `isPrivateAddress()` BlockList as SmartLabel); 5 s timeout; jpeg/png/webp
  only; 5 MB cap. Then `lib/s3.putObject("products/{productId}.jpg", ...)` and `image_s3_key` is set. Best effort: a
  failed copy is logged and the scan still succeeds with `imageUrl: null`. SmartLabel `og:image` URLs (brand CDNs) are
  not on the image allowlist, so SmartLabel products have no image until a brand CDN is added. `imageUrl` in `Product` is
  a presigned GET (1 hour), never the key.
  - `guardedFetch()` in `image.ts` duplicates the redirect/DNS loop in `fetchSmartLabelPage` (left untouched because of
    the parallel parser fix). Follow-up: make `fetchSmartLabelPage` call `guardedFetch` after that merges.
- **robots.txt (step 8):** `smartlabel.org/robots.txt` is `User-agent: * / Disallow:` (crawling allowed) with
  `Crawl-delay: 10`; one fetch per URL per 30 days is well under that. `smartlabel.labelinsight.com/robots.txt` is a 404
  (no restrictions stated). Terms of use not reviewed; someone on the team should read them before the demo.
- **Tests:** `test/products.test.ts` (29, real app + Postgres; global `fetch`, `node:dns/promises` and S3 stubbed):
  validation, auth, non-SmartLabel/IP/http `qrUrl` refused without fetching, OFF path with item creation + S3 copy,
  exact-match item link, cache hit (no fetch, one row), 30-day refresh and stale fallback, 404/502, SmartLabel page +
  cache, SmartLabel -> OFF fallback (then barcode scan is a cache hit), SSRF redirect refused, image copy skipped for
  off-host / redirected / private-DNS images, rate limit per user, `guessCategory`, `fetchProductImage` guard cases.
  Also checked live once (not in the suite): `lookupOpenFoodFacts("0016000275287")` returned Cheerios with 140 kcal and
  the image downloaded through `fetchProductImage`.
- **Done when:** "plain UPC returns OFF data" (live OFF lookup + route tests) and "second scan is cached" are ticked.
  "Real SmartLabel QR returns calories + allergens" is **not** ticked: no real SmartLabel page has been saved as a
  fixture yet and brand hosts haven't been added to the allowlist; that needs a real box scanned by the team.
- **Frontend must update:** `Product` shape is now defined in `src/contracts/products.ts` (`id, itemId, gtin,
  smartlabelUrl, brand, name, servingSize, caloriesPerServing, nutrition, ingredients, allergens, mayContain,
  healthScore, imageUrl, source, fetchedAt`). New error codes on `/products/scan`: `404 PRODUCT_NOT_FOUND` (show "no
  info for this product, add it manually"), `502 UPSTREAM_ERROR` ("couldn't fetch product info, try again"),
  `429 RATE_LIMITED`. The contract table row itself is unchanged.
- **Needed from the team:** a contact email for the User-Agent (`GrocerEZ/0.1 (+email)`), real SmartLabel QR scans
  (save the HTML into `server/test/fixtures/smartlabel/` and add any brand hosts to `ALLOWED_HOSTS`), and the real S3
  bucket (see 11) for image copies to land.

## 10-agentic-ai

**Layout**
- `src/modules/ai/client.ts`: `callStructured()` sends one `client.beta.messages.create` call with model `claude-opus-5-5`,
  `thinking: adaptive`, explicit `effort` (`low` for recipes, `medium` for prices), structured outputs through
  `betaZodOutputFormat`, and `betas: ["server-side-fallback-2026-07-01"]` + `fallbacks: "default"`. It uses a 60 s timeout and
  `maxRetries: 0`, so 60 s is the total time allowed. It checks `stop_reason` before reading content and continues
  `pause_turn` up to 3 times. Every failure (API, rate limit, timeout, refusal, `max_tokens`, bad JSON, failed zod check)
  becomes `503 AI_UNAVAILABLE`. The client can be injected: `AiClient` covers only `beta.messages.create`.
- `src/modules/ai/service.ts`: `suggestRecipes()` and `estimatePrices()` take plain inputs (Claude sees only data, never
  the DB). `buildRecipeContext()` is deterministic: items expiring within 3 days (from `cabinet_items.expires_at`
  directly, not 09's alert code), plus the union of all members' diets and allergens. `suggestForGroup()` /
  `pricesForGroup()` are the route handlers: read the DB through `repo.ts`, call the AI functions, write only validated rows.
- `src/modules/ai/repo.ts`: cabinet, members' diets/allergens and list rows (all scoped by `groupId`), the user's ZIP, and
  the `price_estimates` cache (global, keyed by item + ZIP).
- `src/modules/ai/router.ts`: both routes. Mounted in `app.ts` after `requireGroupMember` and **before**
  `shoppingListRouter`, so `/shopping-list/prices` can never be read as `/shopping-list/:id` (that router has no
  `POST /:id` today, but order keeps it safe if one is added). The allergen table lives in `src/lib/allergens.ts` (shared with 08).
- `src/contracts/ai.ts`: request schemas, model-output schemas (`strictObject`, so extra fields cause a 503), and response schemas.
- Tests: `test/ai.test.ts` (18 unit tests) and `test/ai.routes.test.ts` (19 supertest tests against Postgres; Claude
  stubbed with `vi.mock` of `getAiClient`, no network).

**Schema:** migration `20261011050200_price_estimates` adds only `price_estimates` (database/09 step 3): `UNIQUE (item_id,
zip_code)`, `item_id` FK `ON DELETE CASCADE` (a cache row should never block deleting an item), plus hand-written CHECKs
`zip_code ~ '^[0-9]{5}$'` and `0 <= low <= typical <= high`. The plan's single `recalls_and_prices` migration was split
because the recalls tables were built concurrently (`20261011050100_recalls`). Note: this migration was first applied to
the shared dev DB as `20261011050000_price_estimates`, which collided with `20261011050000_product_fks`; the folder was
renamed and the `_prisma_migrations` row updated in place (no reset). Other dev DBs that applied the old name need the
same one-line `UPDATE _prisma_migrations SET migration_name = '20261011050200_price_estimates' WHERE migration_name =
'20261011050000_price_estimates'`.

**Routes**
- Both bodies are optional (no body = defaults). `maxRecipes` 1–5 (default 3), `mustUseExpiring` default true; `zipCode`
  must be 5 digits. Invalid → `400 VALIDATION_ERROR`. Non-members → `404 NOT_FOUND` (from `requireGroupMember`).
- **Recipe rate limit:** 10 requests per hour per group (`express-rate-limit`, in-memory, keyed by `groupId`), counted
  before validation and including requests that fail. Over → `429 RATE_LIMITED`. An empty cabinet returns `[]` without
  calling Claude (still counted). No caching, per the plan.
- **"Add missing to list":** every `missingItems` name is run through the same `search()` used by `GET /items/search`.
  An `exact` or `suggested` match returns `results[0]`; `none` (or a name with no letters/digits) returns `item: null`.
  The app adds a matched item with the existing `POST /groups/:groupId/shopping-list {itemId}` (manual row); unmatched
  names can go through `POST /items` first.
- **Prices:** ZIP = body, then `users.zip_code`, else `400 ZIP_REQUIRED` ("Set a ZIP code in your profile or send
  zipCode"), checked before anything else. Every shopping-list row (checked or not; it's the trip cost) is priced.
  Rows with a `price_estimates` row for (item, ZIP) under 24 h old come from cache; the rest go to Claude in **one**
  request (none if everything is cached or the list is empty). Valid fresh rows are upserted with `model = claude-opus-5-5`
  and `fetched_at = now()`; stale rows are overwritten. Totals = sum of `lowCents` / `highCents` over cached + fresh
  priced items. Items in list order. Any Claude failure → `503 AI_UNAVAILABLE` and nothing is written.
- **Frontend must update (additive):** each `Recipe` in the response also has
  `missingItemMatches: [{name, item: Item | null}]`, and the prices response also has `unpricedItemIds: string[]`
  (list items with no usable estimate, excluded from the totals). Both are now in the contract table in
  `plan/backend/README.md`; nothing was removed or renamed. Label every price as an **estimate** (`estimate: true`).

**Choices**
- **Recipe checks:** a recipe is **dropped**, not labeled, if any of its text mentions a forbidden allergen.
  Diets add implied exclusions: vegan → milk, eggs, fish, shellfish; vegetarian → fish, shellfish; dairy_free → milk;
  gluten_free → gluten, wheat. Other diet rules (keto, halal, kosher, low_sodium) are enforced by the prompt only.
  Recipes with `minutes`/`servings` ≤ 0 or no steps are dropped. Names in `usesCabinetItems` that aren't in the cabinet
  are moved to `missingItems`. With `mustUseExpiring`, recipes that use no expiring item are dropped.
- **Price checks:** these happen per row, so one bad row does not fail the whole call. A row is dropped if it has a
  negative price, is out of order (not `low ≤ typical ≤ high`), is over $500, has an unknown `itemId`, or is a duplicate.
  Dropped items are returned in `unpricedItemIds`. Only http(s) `sourceUrls` are kept. The model echoes `itemId`
  (not only `itemName`) so rows match reliably. If every web search returned an error block, the call returns 503.
- **ZIP location:** `user_location` in the SDK has no `postal_code`, so the request sends `country: "US"` and puts the ZIP in the prompt.
- **Response shape:** each priced item has `{itemId, itemName, lowCents, typicalCents, highCents, unit, sourceUrls, estimate: true}`.
  This fills in the contract's `items[]` and does not change the contract table.
- **Needs a real `ANTHROPIC_API_KEY` to verify** (all stubbed in tests): structured outputs combined with
  `web_search_20260209` in one request; the `server-side-fallback-2026-07-01` beta + `fallbacks: "default"` being accepted;
  the "demo list prices in under 30 seconds" Done-when item (left unticked); real recipe/price quality.
- **Skipped:** Kroger Products API alternative (plan marks it optional). Rate-limit store is per process.
## 03-groups-invites + 07-realtime-sync

- **Schema created here** (no database branch existed): migration `*_groups_and_invites` with `groups`, `group_members`,
  `group_invites`, enums `group_role` / `invite_status`, the indexes and `UNIQUE (group_id, email)` from `database/03`, plus
  `CHECK (email = lower(email))` added by hand to the SQL. `groups.created_by` is nullable with `ON DELETE SET NULL` (the plan
  gives no delete rule; without one, deleting a user who created a group would fail). `database/03` checkboxes are left for
  the database builder to verify.
- **`requireGroupMember` is mounted once in `app.ts` on `/api/groups/:groupId`**, before every router, so routers added
  later (04-06, 09, 10) are covered without remembering to add it. Non-members and malformed ids both get
  `404 NOT_FOUND "Group not found"`. It sets `req.membership = {groupId, role}`. `requireOwner` returns `403 FORBIDDEN`.
- **Status codes / error codes** (the contract table doesn't list them): `POST /groups` and `POST /groups/:groupId/invites`
  return **201**. Revoking by someone who is neither owner nor inviter is `403 FORBIDDEN`; revoking a non-pending invite is
  `409 INVITE_NOT_PENDING`; an invite id from another group is `404 INVITE_NOT_FOUND`. Removing yourself via
  `DELETE /members/:userId` is `400 VALIDATION_ERROR` (use `/leave`); removing a non-member is `404 NOT_FOUND`.
  Invite rate limit (20/h per user, in-memory) returns `429 RATE_LIMITED`.
- **Response shapes** (`contracts/groups.ts`): `Group = {id, name, role, memberCount, createdAt}` (role = caller's role),
  `GroupDetail = Group & {members: [{id, displayName, email, avatarUrl, role}]}`,
  `Invite = {id, groupId, email, status, invitedBy: {id, displayName} | null, createdAt, respondedAt}`,
  `/me/invites` items add `group: {id, name, memberCount}`. Nothing in `Invite` depends on whether the email has an account.
- **Invite email is trimmed before validation**, then lower-cased (the plan validates first). No Gmail dot/`+tag` stripping.
- **Accept / revoke / decline use conditional updates** (`WHERE status = 'pending'`), and accept, leave, remove and
  `DELETE /me` take a `SELECT ... FOR UPDATE` lock on the group row. A revoke or member removal that commits first makes a
  concurrent accept return 404, and two owners leaving at once can't leave the group ownerless.
- **Removing a member** sets their invite row (any status) to `revoked`. Re-inviting resets the same row to `pending`.
- **Leave/remove preference cleanup is deferred to backend/04**: `preferences` doesn't exist yet. 04 should give the table a
  composite FK `(group_id, user_id) → group_members ON DELETE CASCADE`, so the existing membership delete removes them in the
  same transaction with no extra code.
- **`DELETE /me` owner handover** (deferred from 02) is done: in one transaction it runs the same `removeMember` as leave for
  each of the user's groups (promote the longest-standing member if they were the last owner, delete the group if they were
  the last member), then deletes the user.
- **Invite email (step 13) is done** in `lib/email.ts` via Resend's HTTP API (no SDK). No-op without `RESEND_API_KEY`; errors
  are logged, never returned. Sender is Resend's shared `onboarding@resend.dev`, which only delivers to the Resend account
  owner; a verified sending domain is needed for real use.
- **Realtime** (`lib/realtime.ts`): `attachRealtime(server, origins)` in `index.ts`; handshake uses the same
  `userIdFromToken` as `requireAuth` (extracted in `middleware/auth.ts`), failing with `connect_error` `"UNAUTHENTICATED"`.
  Helpers for later steps: `emitGroup(groupId, event, byUserId)`, `emitUser(userId, event, payload)`,
  `kickFromGroup(groupId, userId)`, `closeGroupRoom(groupId)`. All are no-ops when Socket.IO isn't attached (REST tests).
- **Frontend notes (additive, not contract changes):** `group:join` / `group:leave` accept an optional ack callback that
  receives `{ok: boolean}` (`ok: false` for non-members or a bad id). Invites created/revoked and membership changes also emit
  `group:changed` to the group room (so invite lists refresh). A removed or leaving user gets `group:changed {groupId, by}` in
  their personal `user:<id>` room so their group list refreshes. `invites:changed` has an empty payload `{}`.
- **Member objects go through `toUser` in `users/service.ts`** (the single DB-row to public-User mapping that backend/11 extends with presigned avatar URLs), then are narrowed to `{id, displayName, email, avatarUrl, role}`.
- **Skipped:** redis adapter (07 step 7, single instance). The polling fallback (07 step 6) needs no API work.

## M1 break fixes (test-reports/backend.md)

- **Control characters (B-04):** `validate` rejects any string in the parsed body, query or params that has a C0
  control character other than tab/LF/CR (or DEL) with `400 VALIDATION_ERROR` "Text must not contain control
  characters". This covers every current and future text field without touching each contract.
- **Visible names (B-09):** `visibleName(max)` in `contracts/common.ts` (trim, 1..max, must have a character outside
  `\p{Cf}`/whitespace). Used for `PATCH /me displayName` and group names. Format characters are only rejected when
  nothing else is there, so emoji ZWJ sequences still work. A Google `name` with no visible characters falls back to
  the email local part on first login.
- **P2025 (B-05):** `errorHandler` maps Prisma "record not found" to `404 NOT_FOUND` (a row deleted between the auth
  check and the write, e.g. concurrent `DELETE /me`).
- **Google email collision (B-08):** Google has just verified the address for this `sub`, so another row still holding
  it is stale. In the login transaction its email is parked at `stale+<userId>@invalid`, then the upsert runs. The stale
  account keeps its id, groups and data, and gets its real email back if its owner signs in again. Pending invites
  keyed by email now follow the current verified owner.
- **`/dev/login-as` (B-07):** only users whose `google_sub` starts with `seed-` (database/10). Others get
  `404 NOT_FOUND`. The `DEMO_KEY` header from backend/12 is left for 12 (the route is still not mounted in production).
- **Access log (B-10):** the pino-http `req` serializer drops `query` and strips the query string from `url`, so
  `?token=` (Socket.IO handshakes) and search text never reach the logs.
- **S3 presign (B-16):** `S3Client` uses `requestChecksumCalculation` / `responseChecksumValidation: "WHEN_REQUIRED"`, so
  presigned PUT URLs carry no CRC32 of an empty body. Still worth one real PUT once AWS keys exist.
- **SmartLabel parser:**
  - B-02: allergens come from every `Contains[:] ...` statement on the page, including one at the end of the
    ingredients paragraph, cut at the next period. "Contains 2% or less of" / "contains less than" are skipped.
  - B-13: visible text is extracted with an iterative DOM walk (cheerio's recursive `.text()` overflowed the stack at
    about 5,000 nested elements).
  - B-12: JSON-LD `servingSize` must be a string and `calories` a string or number; calories must be finite and >= 0.
    Open Food Facts numbers must also be >= 0.
  - B-06: `safeImageUrl` in `products/common.ts` keeps only `https:` image URLs with a hostname (no IP literal,
    credentials or port), for both SmartLabel and Open Food Facts. The backend/11 copy-to-S3 step must still fetch
    through the DNS/private-IP guard, manual redirects, a size cap and an image host allowlist.
  - B-11: the IPv6 blocklist also covers `::/96` (IPv4-compatible), `::ffff:0:0:0/96` (IPv4-translated),
    `64:ff9b:1::/48` (local NAT64) and `2002::/16` (6to4).
- **Deferred:** B-01, B-03, B-14 (allergen keyword tables and recipe diet checks) wait for the allergen consolidation
  happening on `main`.

## Allergen consolidation (B-01, B-03, B-14)

- **One table:** `src/lib/allergens.ts` keeps the only allergen keyword table, keyed by the `allergen` enum
  (`contracts/ai.ts`). `mapAllergens(text)` (08 scan parsing: SmartLabel `Contains:` and Open Food Facts tags) and
  `findAllergens(texts, forbidden)` (10 recipe re-check) share one matcher. `products/common.ts` no longer has its own
  `ALLERGENS`/`mapAllergens` (it re-exports the `Allergen` type). `modules/ai/allergens.ts` is deleted.
- **Matching:** whole words plus an optional plural, case- and accent-insensitive. "X-free" phrases are ignored. Plant
  milks and butters keep only the plant word ("nut butter" becomes tree nuts, "peanut butter" becomes peanuts, and
  neither counts as dairy). Wheat words also count as gluten. Compound words (buttermilk, crabmeat, catfish, cheesecake)
  and derived foods (custard, aioli, pesto, Nutella, hummus, teriyaki, seitan, panko, Worcestershire, Caesar, satay, ...)
  are listed explicitly rather than matched as substrings, so "eggplant", "butternut" and "crabapple" don't match.
  The table errs toward flagging: "pesto" as milk and tree nuts, and "soy sauce"/"teriyaki"
  as wheat. 08's old table only flagged milk for "butter", so a `Contains:` line saying "peanut butter" is now peanuts only.
- **Diets in code (B-14):** `findDietConflicts(texts, diets)` drops recipes for vegetarian (meat, poultry, gelatin, lard),
  vegan (the same plus honey), halal (pork, lard, gelatin) and kosher (pork; kosher also implies the `shellfish`
  exclusion). The implied allergens from before still apply (vegan: milk, eggs, fish, shellfish; vegetarian: fish,
  shellfish). Keto, low_sodium, halal alcohol rules and kosher meat/dairy mixing are still prompt-only.
- **Not done:** using the table on SmartLabel ingredient text as a fallback when there's no `Contains:` line (B-02
  follow-up). With "flour", "cream" and similar words it would mislabel many products ("rice flour", "cream of tartar"),
  so `allergens` stays tied to the label's declared statement. Recipes for vegan households that say "vegan butter" or
  "vegan mayo" are still dropped; neutralizing "vegan X" phrases can be added if that shows up.
- **False-positive exceptions (follow-up):** whole-phrase exceptions in `normalize()` now drop the wheat/milk word from
  gluten-free flours and staples ("rice/almond/coconut/corn/chickpea/potato/tapioca/cassava/buckwheat/oat
  flour|noodle|pasta|tortilla") and "cream of tartar", keeping the base word, so "almond flour" is tree nuts only and
  "rice flour" is nothing. "Coconut milk" was already not milk. Oat flour is treated as not wheat (cross-contact is
  the label's job).

## Single guarded fetch (08 follow-up)

- `products/guardedFetch.ts` now holds the only SSRF guard: private-address blocklist (incl. IPv6 forms), `checkUrl`,
  and `guardedFetch(start, allowHost, accept, read, deps, label)`. `fetchSmartLabelPage` and `fetchProductImage` both
  use it; `smartlabel.ts` re-exports `isPrivateAddress`. The body `read` callback runs inside the guard's try and
  timeout, so a stalled or aborted image body is now a 502 like a stalled page (before, only the page read was wrapped).
## 04-preferences

- **Schema created here** (no database branch existed), two new migrations, nothing earlier touched:
  - `20261011000000_item_catalog`: `items`, `item_aliases`, the two GIN `gin_trgm_ops` indexes and SQL
    `normalize_item_name()` per `database/04`, plus CHECKs for the category list and non-empty normalized names.
    `items.created_by` is `ON DELETE SET NULL`. No seed (that's `database/10`); tests create the items they need.
  - `20261011000100_preferences`: `recurrence` enum and `preferences` per `database/05`, except the group/user FKs are one
    **composite FK `(group_id, user_id) → group_members ON DELETE CASCADE`** instead of separate FKs to `groups`/`users`.
    Leave, removal, `DELETE /me` and group delete all already delete the membership row in a transaction, so preferences
    go with it and no extra backend code is needed (`database/05` step 4 asked for a backend delete). `item_id` is
    `ON DELETE RESTRICT`. Applied with `prisma migrate deploy`; `prisma migrate diff` against the schema shows no drift.
  - `database/04` and `database/05` checkboxes are left for the database builder (EXPLAIN / timing not checked).
- **Normalization rules** (`lib/normalize.ts` = SQL function, checked by `test/normalize.test.ts`): lowercase, strip every
  char that isn't a letter/digit/whitespace/`&` (so `Ice-Cream` → `icecream`, `2% Milk` → `2 milk`), collapse whitespace,
  trim, then de-pluralize only the last word: kept if ≤ 3 chars, ending in `ss`/`us`, or in the exceptions list
  (`hummus, asparagus, swiss, couscous, molasses, citrus, octopus, species`); `-es` is dropped after `ss|x|z|ch|sh|o`
  (`tomatoes` → `tomato`, `peaches` → `peach`), otherwise just `-s` (`oranges` → `orange`, `cheeses` → `cheese`).
- **Fuzzy search** uses `normalized_name % q` (same as `similarity > 0.3`, but it can use the GIN index), items only (not
  aliases). Suggestion threshold: levenshtein ≤ 2, or ≤ 1 when the normalized query is under 5 characters. `q` is capped
  at 100 chars (fuzzystrmatch's `levenshtein` rejects inputs over 255). A `q` that normalizes to empty is 400.
- **`POST /items`** returns **200** (not 201), because a name that already resolves exactly (item or alias) returns the
  existing item; creation is an `ON CONFLICT` upsert so a race returns the same row. With `aliasOf`, an unknown item is
  `404 ITEM_NOT_FOUND`; if the typed text already resolves exactly, no alias is added. `category` must be one of the
  `database/04` list (400 otherwise).
- **Preferences:** `POST` is an upsert on `(group, user, item)` and returns **200**; unknown `itemId` is
  `404 ITEM_NOT_FOUND`. `PATCH`/`DELETE` on another member's row is `403 FORBIDDEN`; an id not in this group is
  `404 PREFERENCE_NOT_FOUND`. `quantityText`/`note` accept `null` to clear. `?userId=all` returns every member's rows,
  each with `wantedBy: string[]` (display names of all members wanting that item); `me` (default) omits `wantedBy`.
  `Preference = {id, groupId, userId, item: Item, quantityText, recurrence, note, createdAt, updatedAt, wantedBy?}`,
  `Item = {id, name, category, defaultAllergens, shelfLifeDays}`. Every write emits `preferences:changed`.
- **Dietary:** `PUT /me/dietary` requires both arrays (strict), dedupes them, and replaces both sets in one transaction.
  Enums in `contracts/dietary.ts` (allergens taken from the Prisma enum, diets equal to the `user_diets` CHECK list).
- **Not done: shopping-list regeneration** (step 4 and the dietary part of step 5). `generate(groupId)` belongs to backend/06,
  which doesn't exist yet; the call sites are marked with `ponytail:` comments in `preferences/service.ts` and
  `users/service.ts`. The second "Done when" box stays unticked until 06.
- **Allergen keyword tables not consolidated:** 04 needed no keyword logic (items carry `default_allergens`), so the
  duplicate tables in `products/common.ts` and `ai/allergens.ts` were left alone.

## 12-deployment

Everything that doesn't need a cloud account is built and verified locally. Nothing deployed; no cloud resources created.

- **Image:** `server/Dockerfile` (multi-stage, `node:22-slim`, OpenSSL for Prisma, non-root `node` user) + `.dockerignore`.
  Migrations run on container start (`npx prisma migrate deploy && exec node dist/index.js`), as step 1 says; safe because
  the service runs as exactly 1 instance (step 3). The runtime keeps dev dependencies because the `prisma` CLI is a
  devDependency (upgrade path: move it to `dependencies`, `npm prune --omit=dev`). Verified 2026-10-10: against an empty
  scratch database all 12 migrations apply and `/api/health` returns `{"ok":true}`; against the local dev DB "No pending
  migrations"; with `api.fda.gov` unreachable and no `OPENFDA_API_KEY`, the startup recall import logs `recall import failed`
  and the server keeps serving.
- **`TRUST_PROXY`** (optional hop count, default 0) sets `trust proxy` so rate limits see the client IP. `1` on Railway / Cloud Run.
- **`CORS_ORIGINS`** (optional, comma-separated, default `http://localhost:8081`) replaces the hard-coded `EXPO_DEV_ORIGINS`
  and feeds both Express CORS and Socket.IO. Only an Expo web build needs it.
- **`DEMO_KEY`** (optional, min 32 chars, empty = unset). Step 4: in production `/api/dev/login-as` stays unmounted unless
  `DEMO_KEY` is set; then it is mounted behind `X-Demo-Key: <DEMO_KEY>` (sha256 + `timingSafeEqual`), else
  `401 UNAUTHENTICATED`. Outside production the route is unchanged (no header), so the frontend's `__DEV__` demo list keeps
  working locally. Not a contract change (the dev route isn't in the contract table). **Frontend note:** a build that uses the
  demo list against the deployed API must send `X-Demo-Key`.
- **CI** (step 6): `.github/workflows/server-ci.yml`, on PRs to `main` touching `server/`: `npm ci`, `prisma validate`,
  `prisma migrate deploy` against a `postgres:16` service, `npm run build` (tsc), `npx vitest run`. `npx vitest run` instead
  of `npm test` (`vitest`) so it never depends on CI detection to skip watch mode. Not run on GitHub yet.
- `server/DEPLOY.md`: image usage, env var table, Railway steps, Cloud Run + Cloud SQL alternative, seeding/`DEMO_KEY`, CI,
  monitoring, and the demo checklist with exactly what each item needs.
- **Known flake (fixed, see "Fix: recall import race, matching precision"):** `test/alerts.test.ts` "importRecalls job" failed once in a full parallel run with
  `recall_matches_cabinet_item_id_fkey`: the import matches across all groups, and another test file deleted a cabinet
  item between the match query and `createManyAndReturn` (`modules/recalls/repo.ts:52`). Same race exists in production
  (a user deletes a cabinet item mid-import fails that run; it retries at the next start / 06:00). Fix: do the match +
  insert as one `INSERT ... SELECT ... ON CONFLICT DO NOTHING`, or retry on P2003.

**Remaining (needs accounts / devices)**
- Step 2/5: the Railway (or Cloud Run) deploy, public URL into `EXPO_PUBLIC_API_URL`, host health check on `/api/health`.
- Step 4: `npx prisma db seed` against prod. No seed exists on this branch (`plan/database/10-seed-data`, database owner).
- Step 7 demo checklist and "Done when": all need the deployed API and phones; left unchecked in the README.

## 05-cabinet

- **Schema:** new migration `20261011010000_cabinet` per `database/06` (`stock_status`, `expiration_source`, `cabinet_items`,
  `UNIQUE (group_id, item_id)`, index `(group_id, expires_at)`), plus a `location` CHECK (`fridge|freezer|pantry|other`) and
  the backend/11 column `photo_s3_key`. `product_id` is a plain nullable uuid with **no FK yet**: `products` doesn't exist on
  this branch. database/08 must add `FOREIGN KEY (product_id) REFERENCES products(id)` (suggest `ON DELETE SET NULL`).
  `item_id` is `ON DELETE RESTRICT`, `added_by` is nullable `ON DELETE SET NULL`. Applied with `prisma migrate deploy`;
  `migrate diff` DB vs schema is empty. `database/06` boxes are left for the database builder (the EXPLAIN check wasn't run).
- **`CabinetItem`** (`contracts/cabinet.ts`) = `{id, groupId, item: Item, productId, status, quantityText, location,
  purchasedAt, expiresAt ("YYYY-MM-DD"), expirationSource, photoUrl, addedBy, createdAt, updatedAt}`. Step 1's product join
  (brand, image) is **left to 08**: it should add `product: {brand, imageUrl} | null` in `toCabinetItem`.
- **POST** is an upsert returning **200** (like preferences). Unknown `itemId` is `404 ITEM_NOT_FOUND`. Re-adding an existing
  row sets `status` back to `in_stock` and only overwrites location / quantity / expiry when they're sent, so a hand-set date
  isn't replaced by an estimate. Without `expiresAt`, a new row gets `estimateExpiration(item, now)` with
  `expiration_source='estimated'` (household/other → `null`/`null`). `expiresAt: null` means "no date". `purchased_at` stays
  null for manual adds (it's set by 06's finish trip).
- **PATCH:** `expiresAt` sets `expiration_source='manual'`; `null` clears both. `photoKey` must match exactly
  `^item-photo/<caller's userId>/<uuid>.(jpg|png|webp)$` (else `400 VALIDATION_ERROR`); `null` removes it. Responses give a
  presigned GET in `photoUrl` (1 h), never the key. Unknown id or one from another group is `404 CABINET_ITEM_NOT_FOUND`.
- **Regeneration hook:** `generate()` doesn't exist yet, so `regenerate(groupId, tx)` at the top of
  `modules/cabinet/service.ts` is a marked no-op. **06 replaces its body with `generate(groupId, tx)`.** It already runs inside
  the write's transaction on: POST (adding changes "have"), PATCH with `status`, and ran-out when the item is wanted.
  `shopping-list:changed` is emitted after commit in those cases, `cabinet:changed` on every write. `cabinetRepo.haveItemIds`
  is the `database/06` step 4 "have" query for 06 to use.
- **Ran out** deletes the row and returns `{requeued: true}` if any member of the group has a preference for the item, all in
  one transaction. A concurrent second ran-out gets 404.
- **DELETE `/cabinet/:id`** (step 5) returns 204 and does not regenerate. Note for 06: since the list is
  `preferences − have`, the next regeneration triggered by anything else will still list a deleted item that someone wants.
- **Not ticked:** the "Done when" loop (ran out → list → bought → cabinet) needs 06's list and finish trip. The cabinet half is
  tested (`test/cabinet.test.ts`: ran out + wanted → requeued and out of "have"; re-add → back in "have"; running low → still
  in the cabinet and out of "have").
- **Skipped from 09:** re-running recall matching on cabinet add (09 step 3 of recalls) waits for the recalls tables.
- **Frontend must update:** `DELETE /groups/:groupId/cabinet/:id` (204) added to the contract table (it was in 05's README
  but missing from the table). `PATCH cabinet` accepts `photoKey` (from `POST /uploads/presign {purpose: "item-photo"}`, or
  `null`), and `CabinetItem` has `photoUrl`, which expires after 1 hour.

## 06-shopping-list-engine

- **Schema:** new migration `20261011030000_shopping_list` per `database/07` (`list_reason`, `shopping_list_items`,
  `UNIQUE (group_id, item_id)`, index `(group_id, checked)`), plus a CHECK that `checked_by`/`checked_at` are null when
  unchecked. `checked_by`/`added_by` are `ON DELETE SET NULL`, `item_id` `RESTRICT`, `group_id` `CASCADE`.
  **`scanned_product_id` is a plain nullable uuid with no FK** (`products` isn't on this branch). The 08 merge must add
  `FOREIGN KEY (scanned_product_id) REFERENCES products(id) ON DELETE SET NULL` (same as `cabinet_items.product_id`) and
  validate `scannedProductId` in PATCH (`404 PRODUCT_NOT_FOUND`). Applied with `migrate deploy`; `migrate diff` DB vs
  schema shows only the other agent's `products` table. `database/07` boxes ticked (both covered by `test/shopping-list.test.ts`).
- **One generator:** `generate(groupId, tx)` in `modules/shopping-list/service.ts`, called inside the caller's transaction by:
  POST `/generate`, manual add, list DELETE, finish trip, cabinet POST / PATCH status / ran-out / DELETE, preference
  POST / PATCH / DELETE, `PUT /me/dietary` (each of the user's groups), invite accept, leave / member removal, `DELETE /me`.
  Callers emit `shopping-list:changed` after commit. The set math is a pure `setMath()` covered by a fast-check property test.
  Idempotent: rows are only written when `wantedBy` / `quantityText` / `allergenFlags` actually change.
- **Concurrency:** every list-changing transaction goes through `inListTx`, which takes the **group row lock**
  (`groupsRepo.lock`, `SELECT … FOR UPDATE`, the lock 03 already uses for membership) **first**, so list, cabinet,
  preference and membership writers serialize per group with one lock order. Finish trip additionally selects the checked
  rows `FOR UPDATE`, so a racing un-check waits and then 404s if the row was moved (or wins and stays unchecked). PATCH
  (check-off) doesn't take the group lock: it's a single-row last-write-wins update.
- **Generation details:** `quantityText` on preference rows = distinct members' quantity notes joined with `", "`; manual rows
  keep their own. `wantedBy` and `allergenFlags` are refreshed on **every** surviving row (manual and checked too), since
  they're facts about the group, not in-progress state; `reason`, `checked*`, `scanned_product_id` are never touched.
  Allergen flags use `items.default_allergens` only (no `products` table here, marked `ponytail:` in `shopping-list/repo.ts`;
  08 merge: use the scanned product's `allergens ∪ may_contain` when `scanned_product_id` is set). Exact enum match
  (`wheat` doesn't imply `gluten`).
- **Manual add** (`POST /shopping-list`) is an upsert returning **200** (like preferences/cabinet). An item already listed by
  preference becomes `reason='manual'` (so it survives losing its preference); `quantityText` is overwritten only when sent.
  Unknown `itemId` → `404 ITEM_NOT_FOUND`.
- **PATCH** `{checked: true}` sets `checked_by`/`checked_at` (re-checking by someone else overwrites them) and sets
  `scanned_product_id` when sent. `{checked: false}` clears all three unless a `scannedProductId` is sent. Unknown id or a row
  in another group → `404 LIST_ITEM_NOT_FOUND`.
- **DELETE** `/shopping-list/:id`: manual rows → 204 (and regenerate, so a manual row for an item someone wants comes back as
  a preference row). Preference rows → `409 LIST_ITEM_IS_PREFERENCE` **only while someone still wants the item**; an orphaned
  checked preference row (preference removed while checked) can be deleted.
- **Finish trip:** checked rows → cabinet upsert with `status='in_stock'`, `purchased_at=now()`,
  `expires_at = estimateExpiration(item, now)` / `expiration_source='estimated'` (both null when there is no basis, e.g.
  household). This overwrites an older hand-set date (it's a new purchase). `product_id` is set only when the row was
  scanned, so an unscanned re-buy keeps the known product. `one_time` preferences for moved items are deleted (staples
  stay, so ran out requeues them). Emits `cabinet:changed`, `preferences:changed` and `shopping-list:changed` when anything
  moved. `{movedToCabinet: 0}` when nothing is checked.
- **05 follow-up decided:** `DELETE /cabinet/:id` now regenerates too (and emits `shopping-list:changed`): since the list is
  `preferences − have`, a wanted item comes back immediately instead of at some later regeneration. Ran out now always
  regenerates (`requeued` still = someone wants it).
- **Regeneration on membership changes** (beyond the plan): accept, leave, removal and `DELETE /me` regenerate inside the
  existing locked transaction, so a new member's allergens are flagged and a leaver's preferences drop off the list.
- **`ShoppingListItem`** (`contracts/shoppingList.ts`) = `{id, groupId, item: Item, reason, wantedBy: {userId, displayName}[],
  quantityText, allergenFlags: {userId, displayName, allergen}[], checked, checkedBy: {userId, displayName} | null,
  checkedAt, scannedProductId, addedBy: {userId, displayName} | null, createdAt, updatedAt}`. GET sorts by aisle
  (produce, bakery, meat, seafood, dairy, frozen, pantry, snacks, beverages, household, other/none), then name.
- **Seeded demo test:** `database/10`'s seed doesn't exist on this branch, so `test/shopping-list.test.ts` builds the same
  4-user group (prefs, allergens, Cheerios in stock, Oreos running low) in `beforeEach` and asserts Tostitos, Lay's, Oreos.
- **Frontend must update:** `DELETE /cabinet/:id` of an item someone wants now puts it back on the list (expect
  `shopping-list:changed`). `ShoppingListItem` shape above (names are included, no member lookup needed). Manual add returns
  200, not 201. List DELETE on a wanted preference row is `409 LIST_ITEM_IS_PREFERENCE` (tell the user to remove the preference).

## 06x08 product wiring

- **Schema:** new migration `20261011050000_product_fks` adds `cabinet_items.product_id → products ON DELETE SET NULL` and
  `shopping_list_items.scanned_product_id → products ON DELETE SET NULL` (deferred by 05 and 06). Dangling ids written
  before the FK existed are nulled first. Its timestamp equals the concurrent `20261011050000_price_estimates`; the names
  differ and the two are independent, so order doesn't matter. Applied with `migrate deploy` (no reset).
- **Check-off:** `PATCH /shopping-list/:id` with a `scannedProductId` that isn't a product → `404 PRODUCT_NOT_FOUND`, nothing
  written. When the scanned product changes (a `scannedProductId` is sent, or un-checking clears it) the update runs in
  `inListTx` and regenerates, so the row's allergen flags are right in the response. A plain check-off stays lock-free.
- **Allergen flags:** a row with a scanned product is flagged by that product's `allergens ∪ may_contain` **instead of**
  `items.default_allergens` (the label of the exact package beats the generic catalog guess); unscanned rows keep the catalog.
- **Cabinet product join (05 step 1):** `CabinetItem.product = {brand, imageUrl} | null` (`imageUrl` is a presigned GET, 1 h).
- **Frontend must update:** `CabinetItem` gains `product: {brand, imageUrl} | null`. Check-off can return
  `404 PRODUCT_NOT_FOUND` (scan again / check off without the product).

## 09-expiration-recalls

- **Schema:** new migration `20261011050100_recalls`: `recalls` and `recall_matches` exactly per `database/09` steps 1-2
  (GIN trigram index on `product_description`, `UNIQUE (recall_id, cabinet_item_id)`, all three FKs `ON DELETE CASCADE`),
  plus an index on `report_date` and `(group_id, dismissed_at)`, plus `job_runs (name PK, last_success_at)` for last-import
  tracking. `price_estimates` is the concurrent agent's separate migration, so the plan's single `recalls_and_prices`
  name isn't used. `database/09` boxes are left for the database builder (both behaviors are covered by `test/alerts.test.ts`).
- **Import job** (`src/jobs/importRecalls.ts`): `since` = `job_runs.last_success_at` (first run: 30 days back), `until` =
  now; the window is inclusive, so the boundary day is fetched twice and the upsert by `external_id` absorbs it. The date
  only advances after a successful fetch + upsert. Then matching runs for recalls with `report_date` in the last 30 days
  against every cabinet. `node-cron` `"0 6 * * *"` (server time) is wired in `index.ts` only (tests import `app.ts`), and
  `index.ts` also runs one import at startup if the last success is over a day old, so a fresh deploy has alerts before 6am.
  Failures are logged, never thrown into the server. `OPENFDA_API_KEY` is optional (config + `.env.example`).
- **Matching in SQL:** `strict_word_similarity` (per the earlier decision) on item name, aliases, and
  `brand + ' ' + product name`, best score ≥ 0.35; the whole-word brand gate is `brandAppears()` from `match.ts` in JS.
  The pure JS `matchRecalls` stays as the reference implementation. New matches are `createManyAndReturn(skipDuplicates)`.
  Known ceiling: a two-word item name matches on one shared word (`Cheese Crackers` vs any recall mentioning "cheese"
  scores 0.44). That's what the plan's threshold gives; the alerts are worded "possible match, check your package".
  Raise the threshold or require every item word if the demo shows too much noise. (Done: all-words gate, see "Fix: recall import race,
  matching precision".)
- **Per-item re-match** runs inside the write's transaction on cabinet `POST` **and finish trip** (bought items are cabinet
  adds), against **all** stored recalls (catches old ones). A dismissed match stays dismissed on re-add (same row,
  `UNIQUE (recall_id, cabinet_item_id)`). A ran-out + re-buy creates a new cabinet row, so the alert can come back.
- **`cabinet:changed`:** the job emits it to every group that got a new match with `by: "system"` (no user did it).
  Cabinet add / finish trip already emit it. Dismiss emits it too (other members' badges refresh).
- **Alerts API** (`contracts/alerts.ts`): `GET /groups/:groupId/alerts` → `{expiring: CabinetItem[], recalls: RecallAlert[]}`.
  `expiring` = `expires_at <= today + 3` (UTC calendar days, already expired included), soonest first then name.
  `RecallAlert = {id (matchId), cabinetItemId, item: Item, score, createdAt, recall: {externalId, productDescription,
  reason, classification, firm, distribution, reportDate ("YYYY-MM-DD"), status, link}}`, newest match first.
  `POST /groups/:groupId/alerts/recalls/:matchId/dismiss` → 204; scoped by `groupId` (another group's match id is
  `404 RECALL_MATCH_NOT_FOUND`, a bad uuid 400). Re-dismissing is a 204 no-op.
- **Expiration:** finish trip and cabinet add already save the estimate (`expiration_source='estimated'`) and PATCH sets
  `manual` (05/06). "Every bought item has an expiration date" is ticked with the plan's exception: categories with no
  default (household, other, none) get no date. The Claude vision stretch (step 4) is not built.
- **Seeded fake recall:** `database/10`'s seed doesn't exist on this branch, so the test inserts it. When the seed lands,
  it should add one recall whose `product_description` contains a seeded cabinet item's name (and brand, if scanned).
- **Checked live once** (not in the suite): `fetchRecalls` for the last 30 days returned 62 real recalls.
- **Frontend must update:** `RecallAlert` shape above; dismiss can return `404 RECALL_MATCH_NOT_FOUND`. Show recall alerts
  as "possible match, check your package"; `link` is the openFDA API query for that recall number (no human page exists).

## M2 break fixes (test-reports/backend-m2.md)

- **M2-01, M2-08:** already fixed on `will` before this pass (central control-char rejection from M1 B-04; 06x08 returns
  `404 PRODUCT_NOT_FOUND`). The break tests pass unchanged.
- **M2-06 group id casing:** `requireGroupMember` lower-cases `:groupId` into `req.membership.groupId`, and every Socket.IO
  room name goes through one `room()` helper in `lib/realtime.ts` that lower-cases (join, leave, emit, kick, close).
  Event payloads carry the lower-case `groupId`.
- **M2-07 aliases:** `POST /items {aliasOf}` only stores an alias if `aliasOf` is one of the fuzzy candidates for that text
  within the same "Did you mean" distance threshold `search` uses. Otherwise `400 ALIAS_NOT_SUGGESTED`, nothing written.
  Text that already resolves exactly still returns the `aliasOf` item without writing. Aliases stay global (GAPS #10);
  per-group or moderated aliases weren't built.
- **M2-02 preference races:** `preferencesRepo.update/delete` map P2025 to null (shared `orNull` in `lib/errors.ts`, which
  cabinet and list repos now use too), and the service answers `404 PREFERENCE_NOT_FOUND`. The global P2025 to
  `404 NOT_FOUND` mapping in `errorHandler` stays as the fallback.
- **M2-04 `PUT /me/dietary`:** an interactive transaction takes `SELECT ... FOR UPDATE` on the user row first, so concurrent
  PUTs serialize: last write wins, no 409.
- **M2-05:** cabinet `photoKey` regex now escapes the `.` (`\.` in the template literal). `avatarKey` was already right.
- **M2-03:** allergen flag `displayName` is resolved at read time from `userId` (like `wantedBy`). The stored JSON keeps
  its snapshot name, which is used only if the user no longer exists.
- **Check-off vs regenerate race (found while running the M2 suite, not in the report):** `generate()` deleted rows it
  had read as unchecked, so a lock-free check-off that committed in between was deleted after returning 200. The delete
  now also filters on `checked: false`, which Postgres re-checks at delete time.
- **Frontend must update:** `POST /items {name, aliasOf}` can return `400 ALIAS_NOT_SUGGESTED`. Send `aliasOf` only for the
  item the search suggested for exactly that typed text. If you get this error, fall back to the "add as new" flow.

## Fix: recall import race, matching precision

- **Race fixed at the root:** `recallsRepo.match` is now one `INSERT INTO recall_matches ... SELECT ... FOR KEY SHARE OF
  c, r ON CONFLICT (recall_id, cabinet_item_id) DO NOTHING RETURNING group_id`. A single INSERT ... SELECT alone still
  races (the FK check sees a delete that commits after the statement's snapshot); `FOR KEY SHARE` makes a concurrent
  delete either wait or have its row skipped. Covers the daily import and the per-item re-match (cabinet add, finish
  trip), which share this function. Brand gate moved from JS into the same SQL. Test: `alerts.test.ts` "a cabinet item
  deleted while matching runs" (fails with `recall_matches_cabinet_item_id_fkey` without the lock).
- **Matching precision:** a candidate name (item name, alias, `brand + product name`) qualifies only if its
  `strict_word_similarity` >= 0.35 **and** every significant word (>= 3 chars, not `and/the/with/for`) appears as a
  whole word in the description, allowing one trailing "s" either way. Score = best qualifying name. "Cheese Crackers"
  no longer matches "Sliced cheese"; "Baby Spinach" still matches inside a long description. Same rule in JS
  (`match.ts` `allWordsAppear`/`matchRecalls`) and SQL (`~ '\m<stem>s?\M'`). Known ceiling: only "s" plurals pair
  ("berries" vs "berry" won't). A brand with no letters/digits no longer gates (was: rejected everything).
- **Test isolation:** `importRecalls({ job })` names the `job_runs` row (default `import-recalls`); `alerts.test.ts` uses
  `import-recalls-<tag>`. Its recall descriptions now include the test's item tag, since item names carry it and the
  all-words gate requires it.
- No API contract change.
