-- DB-07 (break test report): one barcode could be cached as 12/13/14-digit GTINs (duplicate product rows), and
-- wrong check digits were accepted.
-- Now products.gtin is always a GTIN-14 with a valid GS1 check digit. A BEFORE trigger left-pads 8/12/13-digit
-- input with zeros (UPC-A 016000275287 → 00016000275287), so every form of one code hits the same UNIQUE value.
-- The backend canonicalizes too (src/lib/openfoodfacts.ts normalizeGtin, incl. UPC-E → UPC-A expansion).

CREATE FUNCTION gtin_check_digit_ok(g text) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $fn$
  SELECT g ~ '^[0-9]{14}$'
     AND (10 - (SELECT sum(substr(g, i, 1)::int * CASE WHEN i % 2 = 1 THEN 3 ELSE 1 END)
                FROM generate_series(1, 13) i) % 10) % 10 = substr(g, 14, 1)::int
$fn$;

CREATE FUNCTION canonical_gtin(raw text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $fn$
  SELECT CASE WHEN raw ~ '^([0-9]{8}|[0-9]{12,14})$' THEN lpad(raw, 14, '0') ELSE raw END
$fn$;

-- Existing rows. Invalid codes: drop the gtin if the row has another identifier, else delete the cached product
-- (links are ON DELETE SET NULL). Duplicates of one code: keep the most recently fetched row.
ALTER TABLE products DROP CONSTRAINT products_gtin_digits_chk;

UPDATE products SET gtin = NULL
WHERE gtin IS NOT NULL AND NOT gtin_check_digit_ok(canonical_gtin(gtin))
  AND (smartlabel_url IS NOT NULL OR source = 'manual');
DELETE FROM products WHERE gtin IS NOT NULL AND NOT gtin_check_digit_ok(canonical_gtin(gtin));

WITH ranked AS (
  SELECT id, item_id, canonical_gtin(gtin) AS g,
         first_value(id) OVER (PARTITION BY canonical_gtin(gtin) ORDER BY fetched_at DESC, id) AS keep_id
  FROM products WHERE gtin IS NOT NULL
), losers AS (
  SELECT r.id, k.id AS keep_id, k.item_id = r.item_id AS same_item
  FROM ranked r JOIN products k ON k.id = r.keep_id WHERE r.id <> r.keep_id
), c AS (
  UPDATE cabinet_items ci SET product_id = CASE WHEN l.same_item THEN l.keep_id END
  FROM losers l WHERE ci.product_id = l.id RETURNING 1
), s AS (
  UPDATE shopping_list_items sl SET scanned_product_id = CASE WHEN l.same_item THEN l.keep_id END
  FROM losers l WHERE sl.scanned_product_id = l.id RETURNING 1
)
SELECT (SELECT count(*) FROM c), (SELECT count(*) FROM s);

DELETE FROM products p
WHERE p.gtin IS NOT NULL AND EXISTS (
  SELECT 1 FROM products k
  WHERE canonical_gtin(k.gtin) = canonical_gtin(p.gtin) AND k.id <> p.id
    AND (k.fetched_at > p.fetched_at OR (k.fetched_at = p.fetched_at AND k.id < p.id)));

UPDATE products SET gtin = canonical_gtin(gtin) WHERE gtin IS DISTINCT FROM canonical_gtin(gtin);

ALTER TABLE products ADD CONSTRAINT products_gtin_chk CHECK (gtin ~ '^[0-9]{14}$' AND gtin_check_digit_ok(gtin));

CREATE FUNCTION products_canonical_gtin() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.gtin := canonical_gtin(NEW.gtin);
  RETURN NEW;
END
$fn$;

CREATE TRIGGER products_canonical_gtin
  BEFORE INSERT OR UPDATE OF gtin ON products
  FOR EACH ROW EXECUTE FUNCTION products_canonical_gtin();
