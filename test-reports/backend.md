# Backend break test report: M1 pass

**Target:** branch `will` @ `b458296`: 01-server-setup and 02-auth complete, plus standalone (not yet routed) modules
for 08 (SmartLabel/OFF clients), 10 (Claude client/service) and 11 (S3 presign).
**Tests:** `server/test/break/*.break.test.ts` (6 files, 131 tests). Run with `cd server && npx vitest run test/break`.
Tests named `[DEFECT B-xx]` are expected to **fail** until the defect is fixed. All other break tests pass and act as
regression guards. Full suite at time of writing: 232 passed, 35 failed (all 35 are `[DEFECT]` tests).
**Environment:** local Postgres (`localhost:5432`, the existing test DB; break tests only create and delete their own
`users` rows). Google certs, Claude, S3 and SmartLabel are stubbed or served by local in-process HTTP servers. No real
external calls were made.

## Summary

| ID | Severity | Area | Title | Test file |
|---|---|---|---|---|
| B-01 | High | AI (10) | Allergen re-check misses common allergen-containing foods (buttermilk, pesto, hummus, aioli, teriyaki, seitan, panko, crabmeat, ...) | `server/test/break/ai.break.test.ts` |
| B-02 | High | SmartLabel (08) | `Contains:` allergen line is missed when an earlier "Contains 2% or less of" line exists, or when it shares a paragraph with the ingredients | `server/test/break/smartlabel.break.test.ts` |
| B-16 | High | Uploads (11) | Presigned PUT URL includes the CRC32 checksum of an empty body (`x-amz-checksum-crc32=AAAAAA==`), so every real upload will fail | `server/test/break/uploads.break.test.ts` |
| B-04 | Medium | Input validation (02) | `PATCH /me` with a NUL byte in `displayName` returns 500 INTERNAL | `server/test/break/me.break.test.ts` |
| B-06 | Medium | SSRF (08/11) | Parser passes the page's `og:image`/JSON-LD image URL through unchecked (`http://169.254.169.254/...`, `file://`), and plan 11 step 5 has the server download it | `server/test/break/smartlabel.break.test.ts` |
| B-13 | Medium | SmartLabel (08) | 25 KB of nested `<div>`s crashes `parseSmartLabel` with `RangeError: Maximum call stack size exceeded` | `server/test/break/smartlabel.break.test.ts` |
| B-14 | Medium | AI (10) | Vegetarian/vegan households get meat recipes (beef, chicken, bacon); no deterministic diet check | `server/test/break/ai.break.test.ts` |
| B-15 | Medium | Uploads (11) | Uploads router reads `req.user.id`, but `requireAuth` sets `req.userId`, so mounting it per plan returns 401 for every user | `server/test/break/uploads.break.test.ts` |
| B-03 | Low | SmartLabel (08) | `mapAllergens` misses compound words (`buttermilk`, `crabmeat`); the 08 and 10 keyword tables have diverged | `server/test/break/smartlabel.break.test.ts` |
| B-05 | Low | Auth (02) | Concurrent `DELETE /me` (or `PATCH` racing `DELETE`) returns 500 | `server/test/break/me.break.test.ts` |
| B-07 | Low | Auth (02) | `/dev/login-as` can impersonate any user, not only seeded demo users | `server/test/break/me.break.test.ts` |
| B-08 | Low | Auth (02) | Google sign-in returns 409 (permanent lockout) when the account's email is held by another (stale) row | `server/test/break/me.break.test.ts` |
| B-09 | Low | Input validation (02) | `displayName` can be made only of invisible characters (`​`, `⁠`, `‮`) | `server/test/break/me.break.test.ts` |
| B-10 | Low | Logs | Access log records the full URL, so a token passed as `?token=` is written to the logs | `server/test/break/logs.break.test.ts` |
| B-11 | Low | SSRF (08) | IP blocklist misses IPv6 forms that embed private IPv4 (`::a9fe:a9fe`, `64:ff9b:1::/48`, `2002::/16`, `::ffff:0:0/96`) | `server/test/break/smartlabel.break.test.ts` |
| B-12 | Low | SmartLabel (08) | Wrong JSON-LD types reach `ProductData` (object `servingSize`, negative calories) | `server/test/break/smartlabel.break.test.ts` |

No Critical findings. Cross-household access can't be tested yet because no group routes exist.

## Findings

### B-01 (High): AI recipe allergen re-check is easy to slip past
- **Repro:** `ai.break.test.ts` › "deterministic allergen re-check". A stubbed Claude returns, for example,
  `{title:"Buttermilk pancakes", missingItems:["buttermilk"]}` for a household with a `milk` allergy. The same happens for
  custard (milk), aioli (eggs), pesto, Nutella or "nut butter" (tree nuts), hummus (sesame), teriyaki (soy), seitan (gluten),
  panko (wheat), Worcestershire (fish) and crabmeat (shellfish).
- **Expected:** the recipe is dropped or labeled. **Actual:** it comes back unchanged. `\bbutter\b`/`\bmilk\b` don't match
  "buttermilk", and dish or condiment names aren't in the table. The plant-milk rewrite also turns "nut butter" into "nut",
  which matches nothing.
- **Plan:** backend/10 "Re-check each recipe's ingredients against member allergens ... If anything conflicts, drop the recipe
  or label it". Done-when: "Recipes only use allowed ingredients for the group's combined diets and allergens".
- **Fix:** have the output schema require a per-ingredient `containsAllergens: Allergen[]` from the model and treat any overlap
  as a drop. Also add substring matching for compounds and a list of known dishes and condiments to the table, and fail closed.

### B-02 (High): SmartLabel parser misses the real allergen statement
- **Repro:** `smartlabel.break.test.ts` › `[DEFECT B-02]` (two tests).
  1. `<p>Ingredients: ...</p><p>Contains 2% or less of: salt...</p><p>Contains: Milk, Wheat.</p>` returns `allergens: []`.
     `afterLabel(/contains/)` returns the first line that starts with "Contains", which is the ingredient sub-list.
  2. `<p>Ingredients: Enriched wheat flour... Contains: Wheat, Soy.</p>` returns `allergens: []`, because only lines that
     *start* with "Contains" are read.
- **Expected:** `["milk","wheat","gluten"]` and `["wheat","soy","gluten"]`. These products would show no allergen badge for an
  allergic member.
- **Plan:** backend/08 step 3.3 "Extract ... 'Contains:' / 'May contain:' allergen lines". GAPS #12 (allergen flagging).
- **Fix:** scan every line, and text inside lines, for `\bcontains\s*:` (requiring the colon, or skipping "contains N% or less"),
  and union the results. Also running `mapAllergens` over the ingredients text is a cheap safety net.

### B-16 (High): presigned PUT pins an empty-body checksum
- **Repro:** `uploads.break.test.ts` › `[DEFECT B-16]`. `presignPut(...)` returns a URL with
  `x-amz-checksum-crc32=AAAAAA%3D%3D&x-amz-sdk-checksum-algorithm=CRC32`.
- **Expected:** no fixed checksum, so the app can PUT any image. **Actual:** `AAAAAA==` is the CRC32 of zero bytes, and query
  params are part of the SigV4 signature. S3 checks the uploaded body against it, so any non-empty upload should be rejected.
  This is the known behavior of `@aws-sdk/client-s3` ≥ 3.729 flexible checksums. It was not confirmed against real S3 (the
  rules forbid it), so please confirm with one real PUT.
- **Plan:** backend/11 step 4 ("The app `PUT`s the file directly to S3"). Done-when: "An avatar upload goes app → S3 directly".
- **Fix:** construct the client with `new S3Client({ ..., requestChecksumCalculation: "WHEN_REQUIRED" })`. Then check that the
  URL has no `x-amz-checksum-*` params.

### B-04 (Medium): NUL byte in `displayName` returns 500
- **Repro:** `me.break.test.ts` › `[DEFECT B-04]`: `PATCH /api/me {"displayName":"Bob\u0000by"}` with a valid token.
- **Expected:** `400 VALIDATION_ERROR`. **Actual:** `500 INTERNAL`. Postgres rejects `0x00` in `text`, and Prisma raises
  `PrismaClientUnknownRequestError`, which `errorHandler` doesn't map. The same thing will happen to every future free-text
  field (group names, notes, item names, invite emails).
- **Plan:** backend/01 step 6 (zod errors → 400; only unexpected errors are 500).
- **Fix:** reject `\u0000` (and other C0 control characters) in a shared zod string helper used by every contract, or strip them
  globally in `validate`.

### B-06 (Medium): image URL from a scraped page is an SSRF vector for the planned S3 copy
- **Repro:** `smartlabel.break.test.ts` › `[DEFECT B-06]`. A page with
  `<meta property="og:image" content="http://169.254.169.254/latest/meta-data/iam/security-credentials/">` gives back
  `product.imageUrl` set to that URL, unchanged. The same happens for `file:///etc/passwd` and `http://localhost:5432/`.
- **Expected:** null, or an https URL that will go through the same allowlist and DNS guard before any server-side fetch.
  **Actual:** passed through. The qrUrl guard is careful, but the page content (which a SmartLabel brand host or a compromised
  page controls) picks the next URL the server fetches.
- **Plan:** backend/08 step 3.1 ("never fetch arbitrary URLs from the client"), backend/11 step 5 ("download on the server and
  `PutObject`"), and the `ProductData.imageUrl` comment "copied to S3 by the service".
- **Fix:** in `parseSmartLabel` (and `mapOffProduct`), keep only `https:` image URLs. In the 11 copy step, fetch through the same
  `assertPublicHost` + manual-redirect + size-cap path, with an image host allowlist and an `image/*` content-type check.

### B-13 (Medium): deeply nested HTML crashes the parser
- **Repro:** `smartlabel.break.test.ts` › `[DEFECT B-13]`: `parseSmartLabel("<h1>X</h1><p>Calories 1</p>" + "<div>".repeat(5000))`.
- **Expected:** `{product: ..., gtin}` or `{product: null}`. **Actual:** `RangeError: Maximum call stack size exceeded` from
  cheerio's recursive text extraction. 25 KB is far under the 2 MB cap. At 10,000 levels it also burns CPU (about 0.5 s) before
  throwing. Since it isn't an `AppError`, the scan route will return 500.
- **Plan:** backend/08 step 3.5 (fall back to barcode when parsing fails). The 01 error policy.
- **Fix:** wrap `parseSmartLabel` in try/catch that returns `{product: null, gtin: null}`, and reject pages whose nesting depth is
  over about 512 before running the text walk (or extract text with an iterative walk).

### B-14 (Medium): diet rules aren't checked deterministically
- **Repro:** `ai.break.test.ts` › `[DEFECT B-14]`: a vegetarian member gets "Beef tacos" or "Bacon rice", and a vegan member
  gets "Chicken fried rice".
- **Expected:** dropped. **Actual:** returned. `DIET_EXCLUSIONS` maps vegetarian/vegan only to allergen enums (fish/shellfish,
  plus milk/eggs), so meat is never checked.
- **Plan:** backend/10 rule "Set math, allergens ... stay deterministic", and Done-when "Recipes only use allowed ingredients for
  the group's combined diets". DECISIONS says other diets are prompt-only, but vegetarian/vegan are listed as checked.
- **Fix:** add a meat/poultry keyword list (beef, pork, bacon, ham, chicken, turkey, lamb, sausage, gelatin, ...) applied for
  `vegetarian`/`vegan`, and honey for `vegan`.

### B-15 (Medium): uploads router can't be mounted behind `requireAuth`
- **Repro:** `uploads.break.test.ts` › `[DEFECT B-15]`: an Express app with `requireAuth` → `createUploadsRouter()`, called with
  a valid app JWT for a real user.
- **Expected:** 200 with `avatar/<userId>/<uuid>.png`. **Actual:** `401 "Sign in required"` for every user. The router reads
  `req.user?.id`, but `middleware/auth.ts` sets `req.userId`. The module's own tests inject `req.user`, so they hide the bug.
- **Plan:** backend/11 step 4, DECISIONS 11 "mount `uploadsRouter` under `/api` behind `requireAuth`".
- **Fix:** read `req.userId` in the router (and in the DECISIONS key-ownership note), and make the uploads tests go through
  the real `requireAuth`.

### B-03 (Low): `mapAllergens` misses compound words, and the two tables have diverged
- **Repro:** `smartlabel.break.test.ts` › `[DEFECT B-03]`: `mapAllergens("Contains: buttermilk")` → `[]`, and the same for
  `crabmeat`. The 10 table matches "flour", "pasta", "tahini", "ghee" and similar, but 08's doesn't. 08 matches "spelt" for
  gluten, but 10 doesn't.
- **Plan:** backend/10 step 3 ("deterministic allergen keyword table from `08`"). DECISIONS 10 ("backend/08 should import this
  table").
- **Fix:** keep one shared table, imported by both modules, and fix B-01's compounds in it.

### B-05 (Low): races on `/me` return 500
- **Repro:** `me.break.test.ts` › `[DEFECT B-05]`: three parallel `DELETE /api/me` gave `[500, 401, 200]`, and `DELETE` racing
  three `PATCH`es gave a 500. `requireAuth` checks that the user exists, then the handler hits Prisma `P2025`, which isn't mapped.
- **Expected:** 200 once, then 401/404. **Plan:** backend/01 error policy.
- **Fix:** map `P2025` to `404 NOT_FOUND` in `errorHandler`, or use `deleteMany`/`updateMany` and check the count.

### B-07 (Low): dev login can impersonate any user
- **Repro:** `me.break.test.ts` › `[DEFECT B-07]`: `POST /api/dev/login-as/<id of a Google-created user>` → 200 with a token.
- **Expected:** only seeded demo users. **Actual:** any UUID. Any non-production deployment (staging, or a demo box left on
  `NODE_ENV=development`) is an account-takeover backdoor once user IDs show up in member lists (03). In production it is
  correctly not mounted (that test passes).
- **Plan:** backend/02 step 6 ("for seeded demo users"), backend/12 step 4 ("guard it with a `DEMO_KEY` header").
- **Fix:** restrict to seed accounts (for example `google_sub LIKE 'seed-%'`) and require a `DEMO_KEY` header whenever it is mounted.

### B-08 (Low): email collision locks a Google account out
- **Repro:** `me.break.test.ts` › `[DEFECT B-08]`: an existing row holds `x@example.com`, and a *different* Google `sub` signs in
  with `X@EXAMPLE.COM` → `409 CONFLICT` on every attempt.
- **Expected:** sign-in succeeds (Google says this `sub` owns the verified address now). **Actual:** permanent 409 with no way
  out for the user. This comes up when a Workspace address is reassigned or a user changes their Google email to one an old
  account used.
- **Plan:** backend/02 step 2.3 ("Upsert the user by `google_sub`"), DECISIONS 02 ("Email is still refreshed on every login").
- **Fix:** in one transaction, clear or rename the email on the stale row (for example `stale+<id>@invalid`) before the upsert.
  Pending invites keyed by email then follow the current verified owner.

### B-09 (Low): invisible display names
- **Repro:** `me.break.test.ts` › `[DEFECT B-09]`: `displayName` of `"​"`, `"⁠"` or `"‮"` → 200.
- **Expected:** 400. `.trim()` doesn't strip zero-width or bidi-control characters, so a member can show up blank or
  right-to-left-spoofed in member and invite lists.
- **Fix:** strip `\p{Cf}` (format characters) before `trim().min(1)`.

### B-10 (Low): URL tokens land in the access log
- **Repro:** `logs.break.test.ts` › `[DEFECT B-10]`: `GET /api/me?token=<appJwt>` writes the full JWT in `req.url` and `req.query`.
- **Expected:** redacted. The `Authorization` and `Cookie` headers are redacted correctly (that test passes), but backend/07
  Socket.IO clients often send `?token=` on the handshake, and GAPS #26 says "no personal data in logs".
- **Fix:** add a pino-http `serializers.req` that drops `query` and strips the query string from `url` (or redacts `token`/`access_token`).

### B-11 (Low): IPv6 forms that embed IPv4 aren't blocked
- **Repro:** `smartlabel.break.test.ts` › `[DEFECT B-11]`: `isPrivateAddress` returns false for `::a9fe:a9fe`, `::127.0.0.1`,
  `64:ff9b:1::a9fe:a9fe`, `2002:a9fe:a9fe::1`, `::ffff:0:a9fe:a9fe`. (`::ffff:7f00:1` and the other IPv4-mapped forms *are* blocked.)
- **Impact:** only reachable if an allowlisted hostname resolves to one of these, so the risk is low.
- **Fix:** add `::/96`, `::ffff:0:0/96`, `64:ff9b:1::/48` and `2002::/16` (or decode the embedded IPv4 and re-check it), and
  consider allowing only `2000::/3` for IPv6.

### B-12 (Low): wrong-typed JSON-LD values reach `ProductData`
- **Repro:** `smartlabel.break.test.ts` › `[DEFECT B-12]`: JSON-LD `nutrition.servingSize: {value:30}` makes `servingSize` an
  object, and `calories: "-250"` gives `caloriesPerServing: -250`.
- **Impact:** a Prisma type error (500) or a nonsense value once the products upsert exists.
- **Fix:** run the parser output through a zod `ProductData` schema (strings or null, non-negative numbers) before returning it.

## Coverage

| Attack list item | Status | Notes |
|---|---|---|
| 1 Cross-household access | **Skipped** | No `/groups` routes in M1 |
| 2 Auth | Covered | Real `google-auth-library` verification with forged RS256 tokens (only the cert download is stubbed): wrong aud, wrong iss, expired, `email_verified` false or `"true"`, no email, unknown kid, alg none, and HS256/public-key alg confusion all return 401 and create no row. App JWT: HS512, future `nbf`, array or missing `sub`, tampered payload, deleted user on every method → 401. `/dev/login-as` unreachable with `NODE_ENV=production` (401 without a token, 404 with one). Findings B-05, B-07, B-08 |
| 3 Email invites | **Skipped** | Not built (03) |
| 4 Shopping list engine | **Skipped** | Not built (06) |
| 5 Concurrency | Partial | Only `/me` races (B-05). The list, finish trip and invite races wait for 03/06 |
| 6 Input validation | Covered for `/auth/google`, `/me` | Wrong types, nulls, extra fields, >4096 token, 81-char names, arrays, SQL-looking strings (stored verbatim), unicode, malformed JSON (400), >1 MB body (413), unknown route (404), all in the standard shape with no stack. Findings B-04, B-09. `/items/search` doesn't exist yet |
| 7 SSRF / scraping | Covered (unit level) | URL allowlist tricks (userinfo, `#`/`?`/backslash/path tricks, protocol-relative, percent-encoded dot, decimal/hex IPs, `localhost`, `data:`, `file:`), redirect to metadata IP refused before the second fetch, slow-drip body cut off by the whole-chain timeout, 20 MB chunked body and 50 MB gzip bomb stopped at the 2 MB cap (real Node fetch against a local server), DNS failure or empty answer, malformed HTML. Findings B-02, B-06, B-11, B-12, B-13. The scan endpoint's rate limit (30/min) isn't testable, since there's no route. DNS rebinding (check-then-fetch) is the documented accepted risk in DECISIONS 08 and wasn't re-reported |
| 8 Realtime | **Skipped** | Not built (07) |
| 9 AI | Covered (unit level) | Stubbed output: non-JSON, empty, array root, null, extra fields, wrong types, `1e400`, `refusal`, `max_tokens`, null `stop_reason`, missing content, null message, timeout and rate-limit errors all give 503 `AI_UNAVAILABLE`. Real SDK against a local fake API: 500/529/429/401/400, garbage 200 body, HTML 502, connection reset all give 503. Prices: negative, `low > high`, typical out of range, over cap, unknown id dropped and reported unpriced, model `itemName` replaced, `javascript:` URLs removed. Findings B-01, B-14. The SDK's own 60 s timeout firing wasn't exercised end-to-end (a 60 s wait); the timeout error path is covered by the stub. The 10/hour route limit isn't testable without a route |
| 10 Uploads | Covered (unit level) | PUT expiry 300 s, GET 3600 s, signed headers exactly `content-type;host`, no ACL, key format and prefix escape already covered by `test/uploads.test.ts` (content types, `../` purposes, client-supplied `key`/`filename`/`userId` ignored, unsafe userId refused). Findings B-15, B-16. No size limit is a documented choice (DECISIONS 11) and wasn't reported |
| 11 Log leaks | Covered | Real app logger config captured at `info` during sign-in, authenticated calls (normal and odd-cased `Authorization`, `Cookie`), a 500 path, and a failed Claude call: no Google ID token, app JWT, email, `JWT_SECRET`, Anthropic key or AWS secret in the logs. Finding B-10 |

Also not covered: openFDA/expiration (09) modules (not in the M1 scope given), the `/auth/google` rate limit (already covered
by `test/auth.test.ts`; behind a proxy it needs `trust proxy`, as noted in DECISIONS 02).
