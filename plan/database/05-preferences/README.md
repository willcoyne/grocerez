# 05 — Preferences (what each user wants)

**Goal:** Each member's personal "want" list inside a group. The group's preference set is the
**union** of all members' rows.
**Board:** "database upload to personal user preference list for group" · "generate shopping list based on preferences lists (union of all users' preferences)" · MVP: "what groceries they want for a given week"

**Depends on:** 03, 04

## Steps

1. Enum `recurrence`: `staple | one_time`.
   - `staple`: always keep in stock. Comes back on the list every time it runs out.
   - `one_time`: wanted this week only. Deleted from preferences when bought (see `07` and `backend/05`).
2. `preferences`:
   | column | type | notes |
   |---|---|---|
   | id | uuid PK | |
   | group_id | uuid FK → groups ON DELETE CASCADE | |
   | user_id | uuid FK → users ON DELETE CASCADE | who wants it |
   | item_id | uuid FK → items | |
   | quantity_text | text | display only, e.g. "2 gal" |
   | recurrence | recurrence NOT NULL DEFAULT 'staple' | |
   | note | text | "the honey-nut kind" |
   | created_at / updated_at | timestamptz | |
   - `UNIQUE (group_id, user_id, item_id)`. A user can't want the same item twice; two users can.
   - Index `(group_id, item_id)` for the union query.
3. Union query (the backend wraps this):
   ```sql
   SELECT item_id, array_agg(user_id) AS wanted_by
   FROM preferences WHERE group_id = $1 GROUP BY item_id;
   ```
4. When a member leaves the group, delete their preferences in that group (backend transaction, not a cascade,
   because the user row still exists).
5. Migration name: `preferences`.

## Done when

- [x] The union query returns each item once with every member who wants it
- [x] The duplicate (group, user, item) insert is rejected
