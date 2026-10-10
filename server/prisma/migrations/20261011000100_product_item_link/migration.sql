-- DB-04 (break test report): a cabinet row or list row may only link to a product OF THE SAME catalog item.
-- Otherwise item_allergens_for() reads another item's allergens (an Oreos product on the Milk row hides the milk badge).
--
-- Enforced with triggers instead of composite FKs (product_id, item_id) → products (id, item_id): a composite FK
-- can't keep the existing "ON DELETE SET NULL" on product_id alone in a way Prisma's schema can describe
-- (it would also null item_id, which is NOT NULL), and an FK Prisma doesn't know about shows up as drift.
-- The triggers raise SQLSTATE 23503 (foreign_key_violation), like the FK would.

-- Existing mismatched links are dropped (the product stays in the cache; only the wrong link goes).
UPDATE cabinet_items c SET product_id = NULL
  FROM products p WHERE p.id = c.product_id AND p.item_id <> c.item_id;
UPDATE shopping_list_items s SET scanned_product_id = NULL
  FROM products p WHERE p.id = s.scanned_product_id AND p.item_id <> s.item_id;

-- cabinet_items.product_id / shopping_list_items.scanned_product_id must belong to the row's item_id.
-- FOR SHARE blocks a concurrent UPDATE of products.item_id until this transaction ends (and vice versa).
CREATE FUNCTION product_link_matches_item() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_product uuid;
  v_item    uuid;
BEGIN
  -- Separate statements: each table's NEW only has its own column.
  IF TG_TABLE_NAME = 'cabinet_items' THEN
    v_product := NEW.product_id;
  ELSE
    v_product := NEW.scanned_product_id;
  END IF;
  IF v_product IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT p.item_id INTO v_item FROM products p WHERE p.id = v_product FOR SHARE;
  IF NOT FOUND THEN
    RETURN NEW; -- the plain FK reports the missing product
  END IF;
  IF v_item <> NEW.item_id THEN
    RAISE EXCEPTION 'product % belongs to item %, not to the % row''s item %', v_product, v_item, TG_TABLE_NAME, NEW.item_id
      USING ERRCODE = 'foreign_key_violation', CONSTRAINT = TG_TABLE_NAME || '_product_item_match';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER cabinet_items_product_item_match
  BEFORE INSERT OR UPDATE OF product_id, item_id ON cabinet_items
  FOR EACH ROW EXECUTE FUNCTION product_link_matches_item();

CREATE TRIGGER shopping_list_items_product_item_match
  BEFORE INSERT OR UPDATE OF scanned_product_id, item_id ON shopping_list_items
  FOR EACH ROW EXECUTE FUNCTION product_link_matches_item();

-- The other side: a product that is linked from a cabinet or list row can't be moved to a different item.
CREATE FUNCTION products_item_change_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.item_id IS DISTINCT FROM OLD.item_id AND (
       EXISTS (SELECT 1 FROM cabinet_items c WHERE c.product_id = OLD.id)
    OR EXISTS (SELECT 1 FROM shopping_list_items s WHERE s.scanned_product_id = OLD.id)) THEN
    RAISE EXCEPTION 'product % is linked from cabinet or list rows of item %; it can''t move to item %', OLD.id, OLD.item_id, NEW.item_id
      USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'products_item_id_linked';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER products_item_change_guard
  BEFORE UPDATE OF item_id ON products
  FOR EACH ROW EXECUTE FUNCTION products_item_change_guard();

-- Index for the guard's (and ON DELETE SET NULL's) lookups by product.
CREATE INDEX IF NOT EXISTS "cabinet_items_product_id_idx" ON "cabinet_items" ("product_id");
CREATE INDEX IF NOT EXISTS "shopping_list_items_scanned_product_id_idx" ON "shopping_list_items" ("scanned_product_id");
