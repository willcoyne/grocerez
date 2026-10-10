# 06 — Shopping List Engine

**Goal:** The core of the app: compute `shopping list = (∪ member preferences) − cabinet`, flag allergens,
save check-offs as they happen, and move bought items into the cabinet.
**Board:** "generate shopping list based on preferences lists (union of all users' preferences)" ·
"Levenshtein distance, preferences set − cabinet set" · "allergens are flagged" ·
"check off … persistently saved" · "adds checked off shopping list items to cabinet set in database, clear checked off items in shopping list" ·
"same query as generating the original shopping list"

**Depends on:** 04, 05, `database/07`

## Set logic (deterministic)

```
desired   = { item_id → wanted_by[] }  from preferences GROUP BY item_id           (union)
have      = { item_id } from cabinet_items WHERE status = 'in_stock'
needed    = desired − have                                                       (difference)
list      = needed  ∪  existing manual rows  ∪  existing checked rows             (never lose in-progress state)
```

Fuzzy matching (Levenshtein) happens **when items are entered** (`04`), so set operations here compare IDs exactly.

## Steps

1. `service.generate(groupId)`. **One function, used everywhere** (initial list, after preference/cabinet changes, after ran out):
   1. Load `desired`, `have`, the members' allergens, and the current list rows in one transaction.
   2. For each `item_id` in `needed`, **upsert** a row: `reason='preference'`, `wanted_by`, `quantity_text` (combine members' quantity notes),
      and `allergen_flags` (step 3). Leave `checked` alone on existing rows.
   3. **Allergen flags:** `itemAllergens = linked product.allergens ∪ may_contain` (if a product has been scanned), otherwise `items.default_allergens`.
      For each member (all members, not only those who want it), add `{userId, displayName, allergen}` for each allergen in `itemAllergens ∩ member.allergens`.
   4. **Remove** rows where `reason='preference' AND checked=false AND item_id NOT IN needed`
      (someone removed the preference, or the item is back in stock).
   5. Keep `manual` rows and `checked` rows as they are.
   6. Send `shopping-list:changed`. Return the list.
2. `GET /groups/:groupId/shopping-list`: rows joined with item name/category, sorted by **category** (store-aisle order:
   produce, bakery, meat, seafood, dairy, frozen, pantry, snacks, beverages, household, other), then name.
3. `POST /groups/:groupId/shopping-list {itemId, quantityText?}`: manual add ("we're out of X"). Upsert with `reason='manual'`.
4. `PATCH /groups/:groupId/shopping-list/:id {checked, scannedProductId?}`: sets or clears `checked_by` and `checked_at` and links the scanned product.
   Saved immediately, so a second shopper sees it live.
5. `DELETE /groups/:groupId/shopping-list/:id`: remove a manual row. For a preference row, return 409 and tell the client to remove the preference instead.
6. **Finish trip:** `POST /groups/:groupId/shopping-list/complete`, in **one transaction**:
   1. Select all `checked = true` rows.
   2. Upsert each into `cabinet_items`: `status='in_stock'`, `purchased_at=now()`, `product_id = scanned_product_id`,
      `expires_at` = estimate (`09`) with `expiration_source='estimated'`.
   3. Delete the `one_time` preferences for those items (so they don't come back when they run out).
   4. Delete the checked list rows.
   5. Run `generate(groupId)` (should be a no-op unless something changed during the trip).
   6. Return `{movedToCabinet}` and send `cabinet:changed` + `shopping-list:changed`.
7. Unit tests on `generate` with the seeded 4-user example (`database/10`): the expected list is Tostitos, Lay's, Oreos.
   Also test that a checked row survives regeneration, and that a removed preference drops its unchecked row.

## Done when

- [x] The seeded demo produces the expected list
- [x] Two phones checking items at the same time end up with the same state
- [x] "Finish trip" moves exactly the checked items and nothing else
