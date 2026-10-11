# 06 — Cabinet (what the group has)

**Goal:** The shared set of items the household currently has, with stock status and expiration.
**Board:** "cabinet — what we have already" · "database upload to cabinet set that is shared between all users in group" · "mark that they are running low or ran out"

**Depends on:** 03, 04 (and 08 for `product_id`, nullable until then)

## Steps

1. Enum `stock_status`: `in_stock | running_low`.
   (**"Ran out" is not a status.** Running out deletes the row, as the board says: "remove from cabinet if ran out".)
2. Enum `expiration_source`: `manual | estimated`.
3. `cabinet_items`:
   | column | type | notes |
   |---|---|---|
   | id | uuid PK | |
   | group_id | uuid FK → groups ON DELETE CASCADE | |
   | item_id | uuid FK → items | |
   | product_id | uuid FK → products NULL | set when bought by scanning a SmartLabel / barcode |
   | status | stock_status NOT NULL DEFAULT 'in_stock' | |
   | quantity_text | text | |
   | location | text | `fridge, freezer, pantry, other` (optional "map out cabinet") |
   | purchased_at | timestamptz | |
   | expires_at | date NULL | |
   | expiration_source | expiration_source NULL | |
   | added_by | uuid FK → users | |
   | created_at / updated_at | timestamptz | |
   - `UNIQUE (group_id, item_id)`. One row per item per group in the MVP (buying it again updates the row).
   - Index `(group_id, expires_at)` for the "expiring soon" query.
4. "Have" set used by list generation: `SELECT item_id FROM cabinet_items WHERE group_id = $1 AND status = 'in_stock'`.
   Because `running_low` items aren't in "have", they go back on the list automatically.
5. Migration name: `cabinet`.

## Done when

- [x] Setting an item to `running_low` removes it from the "have" query
- [x] Deleting the row (ran out) also removes it from "have"
- [x] The "expiring in the next 3 days" query uses the index
