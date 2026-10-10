# 04 — Item Catalog & Fuzzy Matching

**Goal:** One shared catalog of generic grocery items, so "Cheerios", "cheerio", and "Cherrios" all
resolve to the **same item ID**. Then `preferences − cabinet` is an exact set difference on IDs.
**Board:** "Levenshtein distance, preferences set − cabinet set" · "with a big enough user database you could cache items"

**Depends on:** 01

## Why this exists

Set difference on raw strings fails on typos and plurals. Fuzzy matching happens **once, when
an item is entered** (the user confirms "Did you mean Cheerios?"). After that everything
compares IDs, which is fast and predictable.

## Steps

1. `items` (global, not per group):
   | column | type | notes |
   |---|---|---|
   | id | uuid PK | |
   | name | text NOT NULL | display name, e.g. "Cheerios" |
   | normalized_name | text UNIQUE NOT NULL | output of `normalize()` below |
   | category | text | `produce, dairy, meat, seafood, bakery, pantry, frozen, snacks, beverages, household, other` |
   | default_allergens | allergen[] DEFAULT '{}' | e.g. milk for "Milk" |
   | shelf_life_days | int | used to estimate expiration (backend/09) |
   | created_by | uuid FK → users NULL | null = seeded |
   | created_at | timestamptz | |
2. `item_aliases (id, item_id FK ON DELETE CASCADE, alias_normalized text UNIQUE)`. When a user confirms a
   fuzzy suggestion, the backend saves the typed text as an alias, so the next match is exact.
3. Normalization (one function, used by both the SQL function and the backend; keep them identical):
   lowercase → trim → collapse whitespace → strip punctuation except `&` → drop a trailing plural `s` / `es`
   (keep a small exceptions list: `hummus`, `asparagus`, `swiss`, …).
   Add SQL `CREATE FUNCTION normalize_item_name(text) RETURNS text IMMUTABLE`.
4. Indexes for fast fuzzy search:
   ```sql
   CREATE INDEX items_name_trgm ON items USING gin (normalized_name gin_trgm_ops);
   CREATE INDEX item_aliases_trgm ON item_aliases USING gin (alias_normalized gin_trgm_ops);
   ```
5. Matching query (wrapped by the backend's `GET /items/search`), in this order:
   1. Exact match on `items.normalized_name` or `item_aliases.alias_normalized` → return immediately (`match: "exact"`).
   2. Otherwise return the top 5 candidates where `similarity(normalized_name, $q) > 0.3`,
      ordered by `levenshtein(normalized_name, $q)` ascending, then similarity descending.
   3. If the best candidate has `levenshtein ≤ 2` (or `≤ 1` for names under 5 characters), mark it `match: "suggested"`.
   4. Otherwise `match: "none"` → the app offers "Create new item".
6. Seed ~200 common grocery items with category, allergens, and shelf life (see `10-seed-data`).

## Done when

- [ ] Searching `"cherios"` suggests Cheerios; `"Cheerios!"` is an exact match
- [ ] Confirming a suggestion creates an alias, and the next search is exact
- [ ] Search runs under 20 ms on the seeded catalog (`EXPLAIN ANALYZE` uses the GIN index)
