# 08 — Product Data Cache (SmartLabel / barcode)

**Goal:** Store branded product info (nutrition, ingredients, allergens) once, globally, the first time anyone scans it.
**Board:** "smart label contains … nutrition/health-score, allergies, calorie tracking, name" · "Anything smartlabel related (webscraping the qr code links)" (deterministic)

**Depends on:** 04

## Steps

1. Enum `product_source`: `smartlabel | openfoodfacts | manual`.
2. `products` (global):
   | column | type | notes |
   |---|---|---|
   | id | uuid PK | |
   | item_id | uuid FK → items | generic item this product belongs to ("Honey Nut Cheerios" → Cheerios) |
   | gtin | text UNIQUE NULL | UPC/EAN barcode digits |
   | smartlabel_url | text UNIQUE NULL | URL encoded in the QR code |
   | brand | text | |
   | name | text NOT NULL | |
   | serving_size | text | |
   | calories_per_serving | numeric | |
   | nutrition | jsonb | `{fat_g, sat_fat_g, sodium_mg, carbs_g, sugar_g, protein_g, …}` |
   | ingredients | text | |
   | allergens | allergen[] DEFAULT '{}' | "contains" |
   | may_contain | allergen[] DEFAULT '{}' | "may contain / processed in a facility with" |
   | health_score | text | e.g. Nutri-Score letter (from Open Food Facts) |
   | image_s3_key | text | |
   | source | product_source NOT NULL | |
   | raw | jsonb | original scraped/API payload for debugging |
   | fetched_at | timestamptz NOT NULL | refresh if older than 30 days |
   - CHECK: at least one of `gtin`, `smartlabel_url` is not null (or `source = 'manual'`).
3. Allergen checks for list items use `products.allergens` when a product is linked, otherwise `items.default_allergens`.
4. Migration name: `products`.

## Done when

- [x] Scanning the same barcode twice reads from the cache (only one row exists)
- [x] A product can be looked up by `gtin` or `smartlabel_url`
