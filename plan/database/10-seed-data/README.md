# 10 — Seed Data

**Goal:** One command produces a demo-ready database, including the board's handwritten example of
4 users with overlapping snack preferences.

**Depends on:** 02–09

## Steps

1. Create `server/prisma/seed.ts` and register it in `package.json` → `"prisma": { "seed": "tsx prisma/seed.ts" }`.
2. **Catalog:** load `server/prisma/seed/items.json` (~200 common items). Each item has `name`, `category`,
   `default_allergens`, and `shelf_life_days`. Base shelf life on USDA FoodKeeper values
   (e.g. milk 7, eggs 21, bread 5, chicken 2, cereal 180, chips 60).
3. **Demo group "Hack Midwest House"** with 4 users (fake `google_sub` values, prefixed `seed-`):
   | user | preferences (from the board sketch) | allergens |
   |---|---|---|
   | User 1 | Cheerios | — |
   | User 2 | Tostitos, Cheerios | — |
   | User 3 | Lay's, Oreos | milk |
   | User 4 | Oreos, Lay's | peanuts |
   Union = {Cheerios, Tostitos, Lay's, Oreos}.
4. **Cabinet:** Cheerios (`in_stock`) and Oreos (`running_low`, expires in 2 days).
   → The generated list should be **Tostitos, Lay's, Oreos**, which shows union, difference, and running-low in one screen.
5. Add a few staples with allergens (Milk, Peanut Butter, Bread) so allergen badges show up on the list.
6. Add one fake recall that fuzzy-matches a cabinet item, so the alert UI can be demoed offline.
7. Add one **pending invite** from User 1 to a teammate's real email, so the accept flow can be shown live.
8. Make the seed **idempotent**: upsert by `normalized_name` / `google_sub`, so `npx prisma db seed` can run repeatedly.
9. Add a dev-only backend route `POST /dev/login-as/:userId` (disabled when `NODE_ENV=production`) so the
   demo can switch between seeded users without Google accounts.

## Done when

- [ ] `npm run db:reset` produces the demo state
- [ ] Generating the demo group's list returns exactly Tostitos, Lay's, Oreos (+ any staples not in the cabinet)
