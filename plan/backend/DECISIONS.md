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
- **Remaining:** `recalls`/`recall_matches` tables (database/09), `jobs/importRecalls.ts` + `node-cron` `"0 6 * * *"`
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
  - Step 5, copying Open Food Facts images to `products/{productId}.jpg`, belongs with backend/08 (no `products` table or
    scan route yet).
  - Steps 1-2 (bucket, IAM, CORS) are manual AWS setup; instructions are in `server/README.md`.
  - "Done when" boxes are unticked: the member list doesn't exist until 03 (and needs `toUser()`), and "bucket not
    publicly readable" can only be checked once the real bucket exists.
- **Shared dev DB note:** `npm run db:migrate` (`migrate dev`) asked to reset the shared DB because the main tree had
  applied a groups migration this branch doesn't have yet. Applied this migration with `npx prisma migrate deploy`
  instead (no reset). After merging, `migrate dev` works again.

## 08 (partial, parallel)

Built in a separate worktree while 02-07 were in progress, so only the standalone external-service layer exists. No
route, model, migration, or `app.ts` change. README boxes stay unticked.

Done (`server/src/modules/products/`, tests in `server/test/products.clients.test.ts`, no network):
- `common.ts`: `ProductData` (matches the `products` columns), `ALLERGENS`, `mapAllergens()` keyword table, capped body
  reader. `"wheat"` maps to both `wheat` and `gluten`; barley/rye/spelt map to `gluten`.
- `smartlabel.ts`: `fetchSmartLabelPage(url, {fetch, lookup})` and `parseSmartLabel(html)`.
  - SSRF: https only, no credentials, default port only, no IP-literal hosts, host must be `smartlabel.org`,
    `*.smartlabel.org` or `smartlabel.labelinsight.com`. Redirects use `redirect: "manual"` and every hop (max 5) is
    re-checked against the allowlist and a DNS check that refuses private/loopback/link-local/CGNAT/multicast/
    IPv4-mapped addresses. 5 s timeout for the whole chain, 2 MB body cap.
  - Known gap: fetch re-resolves DNS after the check (rebinding window). Low risk with a hostname allowlist; pin the IP
    via an undici dispatcher if needed.
  - Parser is one generic parser (schema.org JSON-LD first, then label-text heuristics), not one per template, because no
    real SmartLabel pages could be saved yet (step 8, robots.txt/terms, not done). The fixture
    `server/test/fixtures/smartlabel/generic-cereal.html` is hand-written. Returns `{product: null, gtin}` when the page
    isn't a usable label, so the service can fall back to Open Food Facts.
- `openFoodFacts.ts`: `lookupOpenFoodFacts(gtin, {fetch})`. GTIN must be 8-14 digits (checked before fetching). Response
  validated with zod. Per-serving values when OFF has `energy-kcal_serving`, otherwise per 100 g with
  `servingSize: "100 g"`. OFF grams are converted for `_mg` keys. Nutri-Score letter goes to `healthScore`. Unknown
  barcode (404 or `status: 0`) or no product name returns `null`.
- Errors: a disallowed `qrUrl` or malformed `gtin` is `400 VALIDATION_ERROR`. Upstream failures (timeout, non-2xx,
  disallowed redirect, private IP, oversized or malformed body) are `502 UPSTREAM_ERROR`, a new code that the frontend
  should show as "couldn't fetch product info".

Remaining for 08: `POST /products/scan` route + zod contract (exactly one of `qrUrl`/`gtin`), 30 req/min per-user rate
limit (`express-rate-limit`), the `products` cache table/migration (database/08) and repo with the 30-day `fetched_at`
check, linking to a catalog item via `/items/search` logic (category from `categoriesTags`), S3 image copy (11), saving
`raw`, robots.txt/terms check, real-page fixtures plus brand hosts for the allowlist, and the "Done when" checks.
Needed from the team: a contact email for the User-Agent (`GrocerEZ/0.1 (+email)`); it's currently just `GrocerEZ/0.1`.
## 10 (partial, parallel)

Built only the standalone AI layer while 02–07 are built elsewhere. No routes, models, migrations, or changes to
`app.ts` / `schema.prisma` / `package.json` / `config.ts`.

**Done**
- `src/modules/ai/client.ts`: `callStructured()` sends one `client.beta.messages.create` call with model `claude-opus-5-5`,
  `thinking: adaptive`, explicit `effort` (`low` for recipes, `medium` for prices), structured outputs through
  `betaZodOutputFormat`, and `betas: ["server-side-fallback-2026-07-01"]` + `fallbacks: "default"`. It uses a 60 s timeout and
  `maxRetries: 0`, so 60 s is the total time allowed. It checks `stop_reason` before reading content and continues
  `pause_turn` up to 3 times. Every failure (API, rate limit, timeout, refusal, `max_tokens`, bad JSON, failed zod check)
  becomes `503 AI_UNAVAILABLE`. The client can be injected: `AiClient` covers only `beta.messages.create`.
- `src/modules/ai/service.ts`: `suggestRecipes()` and `estimatePrices()` take plain inputs. The routes will read the DB and
  pass the data in. `buildRecipeContext()` is deterministic: items expiring within 3 days, plus the union of all members'
  diets and allergens.
- `src/modules/ai/allergens.ts`: the deterministic allergen keyword table. It ignores phrases like "dairy-free" and plant
  milks/butters. backend/08 should import this table instead of writing a second one.
- `src/contracts/ai.ts`: request schemas, model-output schemas (`strictObject`, so extra fields cause a 503), and response schemas.
- `test/ai.test.ts`: 18 unit tests with a stubbed client and no network.

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
- **Not verified with a real key:** structured outputs combined with `web_search_20260209` in one request. Check this
  once `ANTHROPIC_API_KEY` is available.

**Remaining for 10**
- Routes `POST /groups/:groupId/recipes/suggest` and `POST /groups/:groupId/shopping-list/prices`, behind `requireGroupMember`
  and mounted in `app.ts`.
- `price_estimates` table (`database/09`): 24 h cache read, upsert with `model = AI_MODEL`, and totals across cached and fresh rows.
- ZIP fallback to `users.zip_code`, otherwise 400.
- Rate limit: 10 recipe requests per hour per group.
- Map `missingItems` to catalog items through the `/items/search` logic ("Add missing to list").
- Ticking the README boxes, and route tests with supertest.
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
