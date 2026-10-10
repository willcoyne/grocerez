# 08 — SmartLabel & Product Data

**Goal:** Turn a scanned SmartLabel QR code **or** a UPC barcode into nutrition, calories, ingredients, and allergen data. Cache it globally.
**Board:** "Smart label overlying feature — … nutrition/health-score, allergies, calorie tracking, name" ·
"Anything smartlabel related (webscraping the qr code links)" · "finding out the calories, nutrition info, dietary/allergy/contaminant info" (all **deterministic**)

**Depends on:** 04, `database/08`, 11 (for product images)

## Steps

1. `POST /products/scan {qrUrl?} | {gtin?}`. Exactly one must be set (zod `refine`). Rate-limit to 30 requests/min per user.
2. **Cache first:** look up `products` by `smartlabel_url` or `gtin`. If `fetched_at` is under 30 days old, return the cached row.
3. **SmartLabel path (`qrUrl`):**
   1. Only allow the SmartLabel host list (`smartlabel.org`, `*.smartlabel.org`, `smartlabel.labelinsight.com`, plus brand hosts found while testing).
      This blocks SSRF: never fetch arbitrary URLs from the client.
   2. `fetch` with a 5-second timeout, `User-Agent: GrocerEZ/0.1 (+contact email)`, and redirects followed (the QR codes often redirect).
   3. Parse with `cheerio`. Write **one parser per page template**, and test it against saved HTML files in `server/test/fixtures/smartlabel/`.
      Extract: product name, brand, GTIN/UPC (often on the page), serving size, calories, the nutrient table, ingredients, and "Contains:" / "May contain:" allergen lines.
   4. Map allergen text to the `allergen` enum with a keyword table (`"milk"|"dairy"|"whey"|"casein" → milk`, `"wheat" → wheat`, …).
   5. If parsing fails but a GTIN was found, continue with the barcode path.
4. **Barcode path (`gtin`), the fallback:** see `GAPS.md` #14. Many products have no SmartLabel.
   `GET https://world.openfoodfacts.org/api/v2/product/{gtin}.json`. Map `product_name, brands, nutriments, ingredients_text,
   allergens_tags, traces_tags, nutriscore_grade, image_front_url` to the `products` columns. `source='openfoodfacts'`.
5. **Link to a generic item:** run the product name through `/items/search` logic. Use `exact` or `suggested` → that `item_id`.
   Otherwise create the item with the category guessed from Open Food Facts `categories_tags`.
6. Optionally copy the product image into S3 (`11`) and store `image_s3_key`.
7. Save `raw` JSON for debugging. Upsert the product. Return it.
8. **Before building:** check `robots.txt` and the terms of use for the SmartLabel hosts. If scraping isn't allowed, use the barcode path only.
9. Tests: parser fixtures, allergen keyword mapping, cache hit, rejected non-SmartLabel host.

## Done when

- [ ] Scanning a real SmartLabel QR (e.g. a General Mills cereal box) returns calories + allergens
- [x] Scanning a plain UPC barcode returns data from Open Food Facts
- [x] Scanning it a second time is served from the cache
