# 04 — Personal Dashboard & Preferences

**Goal:** Each user's own dashboard: what they want from the store (staples and this-week items) plus their dietary needs.
**Board:** MVP "Users, in their personal dashboard have their dietary preferences, restrictions, and what groceries they want for a given week" ·
"users creates their preferences, dietary restrictions"

**Depends on:** 03, `backend/04-preferences`

## Steps

1. **ItemPicker modal** (reused by preferences, cabinet, and manual list adds; build it first):
   1. Search input, debounced 250 ms → `GET /items/search?q=`.
   2. `exact` → show the item and add it on tap.
   3. `suggested` → show **"Did you mean Cheerios?"** with [Yes] / [No, add "Cherrios" as new].
      Yes → `POST /items {name: typed, aliasOf: suggestion.id}` (saves the alias). No → `POST /items {name}` with a category picker.
   4. `none` → list of similar items + "Create 'X'" row.
   5. Returns the chosen `Item` to whichever screen opened it.
2. **Me tab → "My list" section:**
   - Two segments: **Staples** (always keep stocked) and **This week** (`one_time`).
   - Each row: item name, quantity text, note, swipe to delete, tap to edit (quantity, note, recurrence).
   - "+ Add" → ItemPicker → `POST /groups/:gid/preferences {itemId, recurrence}`.
   - Show a small "In cabinet ✓" / "On list" tag per row (from the cabinet and list queries) so users can see the set math happening.
3. **Me tab → "Dietary" section:** chip multi-selects for diets and allergens (values from `@contracts/dietary`) → `PUT /me/dietary`.
   Note under it: "Your allergens are flagged on your household's shopping list."
4. **Group tab → "Everyone's wants"** (read-only): `GET preferences?userId=all`, grouped by item, with "wanted by: Ian, Will" chips.
   This makes the board's union visible.
5. Use optimistic updates for add and delete. Invalidate `shopping-list` after each write (the server has regenerated it).

## Done when

- [x] Typing "cherios" offers Cheerios; picking it adds it to my staples — verified in mock mode (`me` + `loop.e2e` tests)
- [x] Adding a staple that's not in the cabinet makes it show up on the List tab for everyone — verified in mock mode (engine tests); live update across phones needs the backend
