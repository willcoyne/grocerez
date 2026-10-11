# 02 — Users, Diets & Allergens

**Goal:** Store Google-authenticated users plus their personal dietary profile.
**Board:** "user make account" · "Google authentication" · "users creates their preferences, dietary restrictions"

**Depends on:** 01

## Steps

1. Create the `users` table:
   | column | type | notes |
   |---|---|---|
   | id | uuid PK | |
   | google_sub | text UNIQUE NOT NULL | Google's stable user ID (`sub` claim). **Never key on email.** |
   | email | text UNIQUE NOT NULL | lower-cased |
   | display_name | text NOT NULL | from Google, editable |
   | avatar_url | text | Google picture or S3 key |
   | zip_code | text | optional; used for price estimates |
   | created_at / updated_at | timestamptz | |
2. Create the allergen enum `allergen` with the 9 major U.S. allergens:
   `milk, eggs, fish, shellfish, tree_nuts, peanuts, wheat, soy, sesame`, plus `gluten` (common request).
3. Create `user_allergens (user_id FK → users ON DELETE CASCADE, allergen allergen, PK(user_id, allergen))`.
4. Create `user_diets (user_id FK, diet text, PK(user_id, diet))`, where `diet` is checked against a fixed list:
   `vegetarian, vegan, pescatarian, keto, halal, kosher, low_sodium, dairy_free, gluten_free`.
   (A text column with a CHECK constraint makes it easy to add diets later.)
5. Add `user_allergens` and `user_diets` as Prisma relations on `User`.
6. Migration name: `users_profile`.

## Done when

- [x] Inserting a user with a duplicate `google_sub` fails
- [x] Deleting a user cascades their diets and allergens
- [x] Prisma Client exposes `user.allergens` and `user.diets`
