# 04 — Preferences, Item Search & Dietary Profile

**Goal:** Let each user build their personal want-list for a group from the shared catalog, and save their diets and allergens.
**Board:** "users creates their preferences, dietary restrictions" · "database upload to personal user preference list for group"

**Depends on:** 03, `database/04`, `database/05`

## Steps

1. `lib/normalize.ts`: the **same** normalization as the SQL `normalize_item_name()` (see `database/04`).
   Add a unit test that runs both on a list of tricky inputs and checks they agree.
2. **`GET /items/search?q=`** (shared by preferences, cabinet, and manual list adds):
   1. `q` = normalize(input). If it's empty, return 400.
   2. Exact match on `items.normalized_name` or `item_aliases.alias_normalized` → `{match:"exact", results:[item]}`.
   3. Otherwise run the trigram + `levenshtein()` query from `database/04` with `$queryRaw` (tagged template).
   4. The best result within the distance threshold gives `match:"suggested"`; any other results give `match:"none"` and are returned as "similar" options.
3. **`POST /items {name, category?, aliasOf?}`**:
   - If `aliasOf` is given, the user confirmed a suggestion. Insert an `item_aliases` row for normalize(name) → `aliasOf`, and return that item.
   - Otherwise create a new item (`created_by = req.userId`). If the normalized name already exists (race), return the existing item.
4. **Preferences CRUD** (`requireGroupMember`):
   - `GET /groups/:groupId/preferences?userId=me|all`. `all` adds `wantedBy` names, which the group screen uses.
   - `POST` creates or updates on `(group, user, item)`. `PATCH` / `DELETE` work only on the caller's own rows (otherwise 403).
   - After any write, send a `preferences:changed` socket event and **regenerate the shopping list** (`06`'s `generate(groupId)`),
     so the list always reflects current preferences.
5. **Dietary profile:** `GET /me/dietary`, `PUT /me/dietary {diets[], allergens[]}`. This replaces both sets in one transaction.
   The enum values come from `contracts/dietary.ts` (zod enums matching the DB enums).
   A dietary change also triggers regeneration for every group the user is in (allergen flags change).
6. Tests: a typo gives a suggestion; confirming creates an alias; a user can't edit someone else's preference.

## Done when

- [ ] Entering "cherios" leads to "Did you mean Cheerios?", and confirming it stores an alias
- [ ] Adding or removing a preference updates the group's shopping list right away
