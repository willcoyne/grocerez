# 09 — Expiration Tracking & Recall Alerts

**Goal:** Know when cabinet items expire, and warn the household when something they own may be recalled.
**Board:** "ELEVATED FEATURES — EXPIRATION DATE TRACKING, FOOD OUTBREAKS" · "expiration date" (deterministic)

**Depends on:** 05, 06, 08, `database/06`, `database/09`

## Expiration

SmartLabel / product data does **not** include the expiration date of the specific package you bought (see `GAPS.md` #13).
So:

1. `lib/expiration.ts` → `estimateExpiration(item, purchasedAt)` = `purchasedAt + items.shelf_life_days` (falling back to a per-category default:
   produce 7, dairy 10, meat 3, seafood 2, bakery 5, frozen 120, pantry 365, snacks 90, beverages 180, household → none).
2. `finishTrip` (`06`) and manual cabinet adds (`05`) save the estimate with `expiration_source='estimated'`.
3. The user can override it on the item screen → `PATCH cabinet {expiresAt}` sets `expiration_source='manual'`.
4. *(Stretch)* Read the printed date from a photo using Claude vision: send the image and ask for `{date}` as structured output.

## Recalls / outbreaks

1. `jobs/importRecalls.ts`, `node-cron` `"0 6 * * *"` (daily at 6am):
   `GET https://api.fda.gov/food/enforcement.json?search=report_date:[{since}+TO+{today}]&limit=100`
   (`since` = the last import date, starting 30 days back). Page with `skip`. Upsert into `recalls` by `recall_number`.
   An openFDA API key is optional (it raises the rate limit). Store it in `OPENFDA_API_KEY` if used.
2. Matching (same job, after import): for each recall imported in the last 30 days, compare its `product_description` against
   cabinet items' `items.name` and `products.brand + ' ' + products.name` using `similarity()`. If the score is ≥ 0.35 **and**
   the brand (when known) appears in the description, insert into `recall_matches`.
   These are flagged **"possible match, check your package"**. Never delete items automatically.
3. Re-run matching for a single item whenever an item is added to the cabinet (cheap, and catches old recalls).

## Alerts API

1. `GET /groups/:groupId/alerts` →
   - `expiring`: cabinet items with `expires_at` within 3 days (including already expired), sorted soonest first.
   - `recalls`: matches that haven't been dismissed, with recall reason, classification, firm, and the openFDA link.
2. `POST /groups/:groupId/alerts/recalls/:matchId/dismiss`.
3. Send `cabinet:changed` when new matches are created, so the app's alerts badge refreshes.

## Done when

- [x] Every bought item has an expiration date (estimated or manual)
- [x] The seeded fake recall shows up as an alert and can be dismissed
- [x] The import job runs twice without creating duplicates
