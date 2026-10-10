# 07 — Shopping List

**Goal:** Store the generated list so check-offs are saved as they happen and shared live between shoppers.
**Board:** "shopping list — preference list subtracted by cabinet, allergens are flagged" · "check off … persistently saved in database (so they can check them off as they get the items)"

**Depends on:** 05, 06

## Steps

1. Enum `list_reason`: `preference | manual`.
   - `preference`: added by generation (`preferences − cabinet`).
   - `manual`: someone tapped "we're out of X" / "add to list" for an item nobody has in their preferences.
2. `shopping_list_items`:
   | column | type | notes |
   |---|---|---|
   | id | uuid PK | |
   | group_id | uuid FK → groups ON DELETE CASCADE | |
   | item_id | uuid FK → items | |
   | reason | list_reason NOT NULL | |
   | wanted_by | uuid[] NOT NULL DEFAULT '{}' | member IDs from the preference union |
   | quantity_text | text | |
   | allergen_flags | jsonb NOT NULL DEFAULT '[]' | `[{"userId": "...", "allergen": "peanuts"}]` |
   | checked | boolean NOT NULL DEFAULT false | |
   | checked_by | uuid FK → users NULL | |
   | checked_at | timestamptz NULL | |
   | scanned_product_id | uuid FK → products NULL | SmartLabel scanned while checking off |
   | added_by | uuid FK → users NULL | for manual items |
   | created_at / updated_at | timestamptz | |
   - `UNIQUE (group_id, item_id)`. Generation upserts, so it never creates duplicates.
   - Index `(group_id, checked)`.
3. One group has **one active list** (the MVP's "one large grocery list"). There's no `lists` table,
   because the rows for a group *are* the list. A `shopping_trips` history table is a stretch goal.
4. Migration name: `shopping_list`.

## Done when

- [ ] Running generation twice in a row changes nothing (it upserts and doesn't duplicate)
- [ ] Toggling `checked` sets and clears `checked_by` and `checked_at`
