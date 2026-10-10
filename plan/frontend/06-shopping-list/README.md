# 06 — Shopping List (in-store checklist)

**Goal:** The screen people use in the store: a live shared checklist with allergen flags, check-offs that save immediately, and "finish trip".
**Board:** "User goes to store" · "user interface with a shopping checklist" · "user buys items on shopping list, checks off bought items (can scan smartlabel for each item)" ·
"front end check off on the shopping list, can apply once done and persistently saved in database" · "bought items are added to cabinet, then it is cleared from shopping list"

**Depends on:** 04, 05, `backend/06`, `backend/07`

## Steps

1. **List tab:** `GET /groups/:gid/shopping-list`, shown in sections by category (aisle order comes from the server).
   - Row: big checkbox · item name · quantity · "for Ian, Will" (`wantedBy`) · **AllergenBadge** for each flag ("⚠ peanuts — Will").
   - Checked rows move to the bottom of their section, struck through, with "✓ by Carson".
   - Header: "12 items · 4 checked" + a pull-to-refresh.
2. **Check-off:** tap → **optimistic** toggle → `PATCH {checked}`. TanStack mutation with `retry: 3`. While retrying, show a small
   "syncing" dot on the row. Undo by tapping again.
3. **Scan while shopping:** a scan icon on each row → Scanner (`07`) in "match this item" mode → `PATCH {checked:true, scannedProductId}`.
   If the scanned product's allergens conflict with a member's, show a warning sheet before checking.
4. **Add item:** a "+" in the header → ItemPicker → `POST shopping-list` (manual, "we're out of X"). Manual rows show a "added by Ian" tag and can be swiped to delete.
5. **Finish trip** (sticky bottom button, enabled when anything is checked): confirm sheet "Move 4 checked items to the cabinet?" →
   `POST /complete` → success toast "4 items added to cabinet" → invalidate the list + cabinet.
6. **Live sync:** subscribe to `shopping-list:changed` → invalidate. **Fallback:** if the socket is disconnected, `refetchInterval: 5000` while this screen is focused.
7. **Empty state:** "Nothing to buy 🎉. Everything you all want is in the cabinet."
8. **Price strip** (after M4): "Est. $34–$41" chip in the header → Prices modal (`09`).

## Done when

- [ ] Two phones in the same group see each other's check-offs within a second
- [ ] Airplane mode → check an item → back online → the check-off syncs
- [ ] Finish trip empties the checked rows and they appear in the cabinet with expiration pills
  — rows move to the cabinet as In stock (verified in mock, `loop.e2e`); expiration pills are out of the MVP (DESIGN.md §10). The two-phone and airplane-mode checks need the backend and a device.
