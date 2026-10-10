# 05 — Cabinet

**Goal:** Manage the shared "what we have" set, including running low / ran out and sending items back to the list.
**Board:** "OPTIONAL: ability to map out cabinet" · "mark that they are running low or ran out" ·
"assigns marked items back to the shopping list if checked off as ran out or running low, remove from cabinet if ran out" ·
"we are out of something so we have a feature that can add something to a list"

**Depends on:** 04, `database/06`

## Steps

1. `GET /groups/:groupId/cabinet`: rows joined with item (name, category) and product (brand, image).
   Sort by `expires_at NULLS LAST`, then name. Support `?location=` and `?status=` filters.
2. `POST /groups/:groupId/cabinet {itemId, location?, quantityText?, expiresAt?}`: manual "map out cabinet".
   Upsert on `(group, item)`. If `expiresAt` is missing, fill it with an estimate (`09`'s `estimateExpiration(item)`, `expiration_source='estimated'`).
3. `PATCH /groups/:groupId/cabinet/:id {status?, expiresAt?, location?, quantityText?}`
   - Changing to `running_low` regenerates the list (the item drops out of "have", so it shows up on the list if anyone wants it).
   - Changing back to `in_stock` regenerates the list too (removes the item if it isn't checked).
   - Setting `expiresAt` by hand sets `expiration_source='manual'`.
4. `POST /groups/:groupId/cabinet/:id/ran-out`, in a transaction:
   1. Delete the cabinet row.
   2. If the item is in anyone's preferences → regenerate (it comes back with `reason='preference'`) → `{requeued:true}`.
   3. If not → `{requeued:false}`. The app then offers "Add to list anyway?", which calls the manual add (`06`).
5. `DELETE /groups/:groupId/cabinet/:id` removes the item without running it out (e.g. it was thrown away). This does **not** re-add it to the list.
6. Every write sends a `cabinet:changed` event (plus `shopping-list:changed` if regeneration ran).
7. Tests: ran out + in preferences → back on the list; running low → on the list *and* still in the cabinet.

## Done when

- [ ] The board's loop works: ran out → back on the list → bought → back in the cabinet
