# 05 — Cabinet

**Goal:** See everything the household has, optionally map it out, and mark items running low or ran out.
**Board:** "cabinet — what we have already" · "OPTIONAL: ability to map out cabinet but you can skip it" ·
"when items run out, you can mark that they are running low or ran out" · "we are out of something so we have a feature that can add something to a list"

**Depends on:** 04 (ItemPicker), `backend/05-cabinet`

## Steps

1. **Cabinet tab:** `GET /groups/:gid/cabinet`, grouped by location (Fridge / Freezer / Pantry / Other), with filter chips including "Expiring soon".
   - Row: name, brand (if scanned), quantity, **expiration pill** (green > 3 days, amber ≤ 3, red expired, "est." label when estimated), status chip.
2. **Row actions** (swipe or long-press menu):
   - **Running low** → `PATCH {status:"running_low"}`. Row shows an amber "Low · on list" chip.
   - **Ran out** → `POST …/ran-out`. If `requeued:false`, show the prompt "Nobody has this in their preferences. Add to shopping list anyway?" → manual add.
     Removing the row uses a short animation + an "Undo" snackbar (undo = `POST cabinet` with the same item).
   - **Back in stock** (for low items) → `PATCH {status:"in_stock"}`.
   - **Remove** (thrown away / mistake) → `DELETE`.
3. **Map out cabinet** (optional onboarding step + "+" button): ItemPicker in a "quick add many" mode (it stays open after each pick)
   with a location selector at the top → `POST cabinet` for each. A "Scan instead" button opens the scanner (`07`).
4. **Empty state:** "Your cabinet is empty. Finish a shopping trip or add what you already have." with [Add items] and [Skip].
5. Tap a row → ItemDetail (`08`).
6. Socket `cabinet:changed` → invalidate the cabinet query.

## Done when

- [x] Marking Oreos "ran out" removes them from the cabinet and they appear on the List tab — verified in mock mode (`loop.e2e`)
- [x] Marking an item "running low" keeps it in the cabinet and adds it to the list — verified in mock mode (engine + cabinet tests)
