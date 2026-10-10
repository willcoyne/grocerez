# GrocerEZ API break tests: M2 (03 groups/invites, 04 preferences, 05 cabinet, 06 list engine, 07 realtime)

Target: commit `71d76ff` (branch `will`). Tests: `server/test/break/m2/`. Run with
`cd server && npx vitest run test/break/m2` against the local Postgres (shared DB, never reset; every test creates
and deletes its own users, groups and items). No external service is called (Resend has no key, so it's a no-op; S3
presigning is local signing only).

Result: 57 tests, 47 pass, 10 fail. Every failing test is labelled `[DEFECT M2-xx]`. **No Critical or High findings:**
cross-household isolation held on every route and path variant tried.

## Summary

Fix pass: all 57 M2 tests pass on the fix branch (full suite 446/446). The fix pass also found a check-off vs
regenerate race: the "check-off racing a cabinet add" guard test failed once. It's fixed by making `generate()`'s delete
re-check `checked = false`. Details are in `plan/backend/DECISIONS.md` under "M2 break fixes".

| ID | Severity | Area | Title | Test file | Status |
|---|---|---|---|---|---|
| M2-06 | Medium | Realtime (07) | Upper-case group ids split Socket.IO rooms: members miss events, and a removed member keeps receiving them | `realtime.test.ts` | Fixed: canonical lower-case group id in `requireGroupMember` and one `room()` helper in `lib/realtime.ts` |
| M2-07 | Medium | Catalog (04) | Any user can alias any unrelated text to any item, for every household | `catalog.test.ts` | Fixed: `aliasOf` must be a fuzzy suggestion for the text, else `400 ALIAS_NOT_SUGGESTED` |
| M2-01 | Medium | Validation | A NUL byte in any stored string gives `500 INTERNAL` (7 routes) | `validation.test.ts` | Already fixed on `will` (M1 B-04, central control-char rejection) |
| M2-02 | Medium | Concurrency (04) | Concurrent DELETE/PATCH of one preference gives `500` (P2025 not handled) | `concurrency.test.ts` | Fixed: shared `orNull` in preferences repo, so the service returns `404 PREFERENCE_NOT_FOUND` |
| M2-08 | Low | Validation (06) | An unknown `scannedProductId` gives `500` once the products FK exists (it does in the shared DB now) | `validation.test.ts` | Already fixed on `will` (06x08: `404 PRODUCT_NOT_FOUND`) |
| M2-04 | Low | Concurrency (04) | Two concurrent `PUT /me/dietary` from one user: one gets `409 CONFLICT` | `concurrency.test.ts` | Fixed: lock the user row (`FOR UPDATE`) in the dietary transaction |
| M2-05 | Low | Cabinet (05/11) | `photoKey` regex has an unescaped `.`, so keys that `/uploads/presign` never issued are accepted | `validation.test.ts` | Fixed: escaped `.` in the photoKey regex (avatarKey was already right) |
| M2-03 | Low | List engine (06) | Allergen flag `displayName` goes stale after `PATCH /me` | `engine.property.test.ts` | Fixed: flag names resolved at read time in `listRepo.load` |

---

## M2-06 (Medium): upper-case group ids split Socket.IO rooms

**Repro** (`realtime.test.ts`, the two `[DEFECT M2-06]` tests):
1. Owner A and member M are in group `g`. M's socket joins `group:join {groupId: g}` (lower case).
2. A calls `POST /api/groups/<G upper-cased>/shopping-list {itemId}`. The response is 200.
3. M receives nothing. The event went to room `group:<UPPER>`.

Second case: ex-member X calls `group:join {groupId: <G upper-cased>}`. The ack is `{ok:true}` and X joins room
`group:<UPPER>`. The owner then removes X (`DELETE /groups/g/members/X`). `kickFromGroup` only empties `group:<lower>`,
so when anyone later calls a REST route with the upper-case id, X still gets `cabinet:changed` and
`shopping-list:changed`.

**Expected:** backend/07 step 5 says removed members stop receiving the group's events, and members get every change
within 1 s. **Actual:** `requireGroupMember` and `group:join` accept any-case UUIDs (`z.uuid()` plus Postgres's
case-insensitive uuid compare) and use the raw string as the room name. The leak is limited to `{groupId, by}` signals,
not data.

**Fix:** canonicalize `groupId` (`.toLowerCase()`) in `requireGroupMember` (set `req.membership.groupId`) and in the
`group:join`/`group:leave` handlers, or have `emitGroup`/`kickFromGroup` lower-case it.

## M2-07 (Medium): global alias poisoning

**Repro** (`catalog.test.ts`): Mallory (any household) searches `"peanut butter cookies <t>"`, and Apples is not
suggested. She calls `POST /api/items {name: "peanut butter cookies <t>", aliasOf: <Apples id>}` and gets 200. Alice, in
an unrelated household, then searches the same text and gets `{match:"exact", results:[Apples]}`, with no "Did you
mean". **Expected:** backend/04 step 3 says `aliasOf` means "the user confirmed a suggestion", and GAPS #9/#10 make the
catalog shared. Free text should only become an alias of an item the search actually suggested for it. **Actual:** any
text can be aliased to any item. The alias is permanent, global, and has no undo route, so allergen-relevant text can
silently resolve to an item with different `defaultAllergens`.

**Fix:** in `items/service.create`, accept `aliasOf` only if `itemsRepo.fuzzy(normalized)` returns that item within the
suggestion threshold (otherwise 400), and consider making aliases per-group or moderated.

## M2-01 (Medium): NUL byte gives 500

**Repro** (`validation.test.ts`): send `"bad\u0000value"` as `POST /groups {name}`, `PATCH /groups/:id {name}`,
`POST /items {name}`, preference `quantityText`/`note`, cabinet `quantityText`, or list `quantityText`. Each returns
`500 {"error":{"code":"INTERNAL"}}` and logs an "unhandled error". **Expected:** 400 `VALIDATION_ERROR` (backend/01
error contract, and the attack list says no 500s for client input). **Actual:** Postgres rejects `0x00` in `text`, and
`errorHandler` doesn't map it. The body has no stack or internals, so this is a robustness issue, not a leak.

**Fix:** add a shared zod refinement, such as `.refine(s => !s.includes("\0"))`, to every free-text field in
`contracts/*`, or strip control characters in a shared `text()` helper.

## M2-02 (Medium): concurrent preference writes give 500

**Repro** (`concurrency.test.ts`): send two `DELETE /groups/g/preferences/:id` and one `PATCH` on the same row at the
same time (one user on two devices, or a double tap). 14 of 24 responses were `500 INTERNAL`. The same 500 shows up
when `PATCH` of a `one_time` preference races finish trip, which deletes that row. **Expected:** one 204, the rest
`404 PREFERENCE_NOT_FOUND` (backend/04 step 4). **Actual:** `assertOwn` runs outside the transaction, and
`preferencesRepo.update/delete` throw Prisma `P2025`, which `errorHandler` turns into 500 (cabinet and list repos already
wrap this in `orNull`).

**Fix:** wrap `preferencesRepo.update/delete` with the same `orNull` used in `cabinet/repo.ts` and 404 on null, or move
`assertOwn` inside `withList` and map P2025 to 404 globally in `errorHandler`.

## M2-08 (Low): unknown scannedProductId gives 500

**Repro** (`validation.test.ts`): `PATCH /groups/g/shopping-list/:id {checked:true, scannedProductId: <random uuid>}`
returns `500`. During this run another agent applied migration `20261011050000_product_fks` to the shared DB, which adds
the FK `scanned_product_id → products`. **This also makes two of the builder's own tests in `test/shopping-list.test.ts`
fail with 500.** Without the FK, the dangling id is stored silently. **Expected:** `404 PRODUCT_NOT_FOUND`
(DECISIONS 06 already notes the 08 merge must validate it). **Fix:** check `products` before the update, and map
Prisma `P2003` to 4xx in `errorHandler`.

## M2-04 (Low): concurrent PUT /me/dietary gives 409

**Repro** (`concurrency.test.ts`): send two simultaneous `PUT /me/dietary` from one user with overlapping allergens.
Half return `409 CONFLICT "A record with these values already exists"`. **Expected:** both succeed, last write wins
(backend/04 step 5 says it "replaces both sets"). **Actual:** the batch `deleteMany` + `createMany` transactions race on
the unique key. **Fix:** use `createMany({skipDuplicates: true})`, or lock the user row (`SELECT … FOR UPDATE`) first.

## M2-05 (Low): photoKey regex wildcard

**Repro** (`validation.test.ts`): `PATCH cabinet/:id {photoKey: "item-photo/<me>/<uuid>Xjpg"}` returns 200.
**Expected:** the key must match exactly the shape `/uploads/presign` issues (DECISIONS 05/11). **Actual:**
`cabinet/service.ts` builds the regex from a template literal, where `\.` becomes a plain `.` (any character). The key
still has to sit under the caller's own prefix, so another user's key can't be attached. `users/service.ts` gets this
right with `\\.`. **Fix:** use `\\.` in the template.

## M2-03 (Low): stale displayName in allergen flags

**Repro** (`engine.property.test.ts`): member M has a peanut allergy and is flagged on Peanut Butter. M calls
`PATCH /me {displayName: "Renamed Person"}`. `GET shopping-list` still shows the old name in `allergenFlags`.
`wantedBy`/`checkedBy` are resolved live, but flags store a snapshot. **Expected:** GAPS #12 shows a red badge "with the
member's name". **Fix:** resolve flag names at `load()` time, as `wantedBy` does, or regenerate the user's groups on a
`displayName` change.

---

## Areas covered with no defect found

- **#1 Cross-household (all pass):** user B against all 25 `/groups/<g1>/*` routes (404, standard shape, no group-1
  strings in bodies, and a DB snapshot of group 1 unchanged). Group-1 preference, cabinet, list, invite and member ids
  under `/groups/<g2>/…` (10 routes, all 404, unchanged). Accept/decline of another household's invite. Path variants:
  upper case, `/API/GROUPS`, double slashes, trailing slash, `%2F`, braces, no hyphens, `./`, `../`, `;`. Removed members
  lose access. Non-owner owner-only actions get 403. Within a group, editing another member's preference gets 403.
- **#3 Invites (all pass):** someone else's invite (even the group owner's own) can't be accepted. Casing and
  whitespace in the email match. Revoked/declined/double-accept give 404, and revoking a non-pending invite gives 409.
  Inviting an existing member (any casing) or yourself gives 409. Removal revokes, and a re-invite is a fresh pending
  invite. Invites of a deleted group disappear. Non-owner, non-inviter revoke gives 403. Known vs unknown email
  responses are identical (status, body keys, headers), and median timing ratio is < 1.5. The rate limit gives 429
  `RATE_LIMITED` on the 21st invite, per user, and also stops re-sending to one address.
- **#4 Engine (all pass except M2-03):** a fast-check property (30 runs: 1–4 members, random allergens, preferences,
  in_stock/running_low cabinet, manual/checked rows) checks `list == union(prefs) − in_stock ∪ manual ∪ checked`, exact
  `wantedBy`, allergen flags for every member, preserved reason/checked, and idempotency. A finish-trip property (20
  runs) checks that exactly the checked rows move, only their `one_time` prefs are deleted, other cabinet rows are
  untouched, and manual rows survive. Examples: ran out with/without preference, running low then back in stock (a
  checked row survives), staple vs one_time across a full loop, and flags following join/leave/dietary changes.
- **#5 Concurrency (except M2-02/M2-04):** two concurrent finish trips (6 items moved exactly once). Un-check vs finish
  trip (always exactly one of cabinet/list). 20 interleaved toggles from two shoppers (row stays valid). Check-off vs
  cabinet add of the same item (25 tries, never lost; theoretical window noted in the test). 5 simultaneous accepts
  (exactly one 200). Accept vs revoke/decline, and accept vs removal (member ⇔ accepted every time).
- **#6 Validation (except M2-01/05/08):** 8 bad value types × 20 fields, extra/spoofed fields (`checkedBy`, `role`,
  `groupId`, `__proto__`), missing fields, array bodies, 100k-element arrays, > 1 MB body (413), malformed JSON, 7
  malformed ids × 13 `:id` routes (all 4xx, no 500), unknown UUIDs (404), query arrays/enums, SQL-ish/wildcard/unicode
  `/items/search` input (≤ 5 results, < 3 s, no 500), unicode/emoji round-trip, and invalid dates.
- **#8 Realtime (except M2-06):** the handshake rejects missing, non-string, garbage, wrong-signature, `alg:none`,
  expired and deleted-user tokens. Foreign users can't join by any id spelling. Malformed `group:join` payloads don't
  crash or disconnect. REST events reach only that group's sockets. Removed, leaving and deleted (`DELETE /me`) members
  stop receiving. `invites:changed` goes only to the invitee.
- **#11 Logs:** the real server ran as a child process with `NODE_ENV=development` (pino at info) through the whole M2
  flow, including a 500. No JWTs, signatures, `JWT_SECRET`, cookies, invite emails, member emails or preference notes
  were logged (`authorization`/`cookie` are redacted, and the 500 log has no request body). Informational: pino-http logs
  the full URL, so `/items/search?q=<typed text>` is logged verbatim, along with `remoteAddress`.

## Skipped and why

- M1 items (HTTP auth/JWT edge cases, Google token checks, `/dev/login-as` in production, SSRF, AI, uploads): out of
  scope for M2 per instructions, and covered on the M1 branch. Only the Socket.IO handshake was re-checked, because
  it's part of 07.
- The race of `group:join` vs member removal (join reads the role before the removal commits, then joins after
  `kickFromGroup`) is theoretical. The window is microseconds and couldn't be reproduced deterministically. Suggested
  hardening: re-check membership after `socket.join`.
- Multi-instance Socket.IO (redis adapter) is out of scope (single instance, 07 step 7).
