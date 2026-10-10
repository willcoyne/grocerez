-- CreateEnum
CREATE TYPE "list_reason" AS ENUM ('preference', 'manual');

-- CreateTable
CREATE TABLE "shopping_list_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "group_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "reason" "list_reason" NOT NULL,
    "wanted_by" UUID[] DEFAULT ARRAY[]::UUID[],
    "quantity_text" TEXT,
    "allergen_flags" JSONB NOT NULL DEFAULT '[]',
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "checked_by" UUID,
    "checked_at" TIMESTAMPTZ(6),
    "scanned_product_id" UUID,
    "added_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shopping_list_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shopping_list_items_group_id_checked_idx" ON "shopping_list_items"("group_id", "checked");

-- CreateIndex
CREATE UNIQUE INDEX "shopping_list_items_group_id_item_id_key" ON "shopping_list_items"("group_id", "item_id");

-- AddForeignKey
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_checked_by_fkey" FOREIGN KEY ("checked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ════════════════════════════════════════════════════════════════════════════
-- Hand-written: check-off consistency, and the list generation functions.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_allergen_flags_array_chk"
  CHECK (jsonb_typeof("allergen_flags") = 'array');
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_checked_at_chk"
  CHECK ("checked" = ("checked_at" IS NOT NULL));
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_checked_by_chk"
  CHECK ("checked" OR "checked_by" IS NULL);

-- Checking a row stamps checked_at (the backend supplies checked_by); unchecking clears checked_by and checked_at.
CREATE FUNCTION shopping_list_items_check_stamp() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.checked THEN
    IF TG_OP = 'INSERT' OR NOT OLD.checked THEN
      NEW.checked_at := coalesce(NEW.checked_at, now());
    END IF;
  ELSE
    NEW.checked_by := NULL;
    NEW.checked_at := NULL;
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER shopping_list_items_check_stamp
  BEFORE INSERT OR UPDATE OF checked, checked_by, checked_at ON "shopping_list_items"
  FOR EACH ROW EXECUTE FUNCTION shopping_list_items_check_stamp();

-- Allergens that apply to an item for a group's list. 07: the catalog's default_allergens.
-- (Migration `products` (08) replaces this to prefer a linked product's allergens ∪ may_contain.)
CREATE FUNCTION item_allergens_for(p_group_id uuid, p_item_id uuid) RETURNS allergen[]
LANGUAGE sql STABLE AS $fn$
  SELECT i.default_allergens FROM items i WHERE i.id = p_item_id
$fn$;

-- [{userId, displayName, allergen}] for every member of the group (not only those who want it) whose allergens intersect.
CREATE FUNCTION allergen_flags_for(p_group_id uuid, p_allergens allergen[]) RETURNS jsonb
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(
           jsonb_agg(jsonb_build_object('userId', u.id, 'displayName', u.display_name, 'allergen', ua.allergen)
                     ORDER BY u.display_name, u.id, ua.allergen),
           '[]'::jsonb)
  FROM group_members m
  JOIN users u           ON u.id = m.user_id
  JOIN user_allergens ua ON ua.user_id = u.id
  WHERE m.group_id = p_group_id
    AND ua.allergen = ANY (p_allergens)
$fn$;

-- needed = (∪ member preferences) − (cabinet items with status 'in_stock'), with who wants each item and their quantity notes.
CREATE FUNCTION needed_items(p_group_id uuid)
RETURNS TABLE (item_id uuid, wanted_by uuid[], quantity_text text)
LANGUAGE sql STABLE AS $fn$
  SELECT p.item_id,
         array_agg(DISTINCT p.user_id ORDER BY p.user_id),
         string_agg(DISTINCT p.quantity_text, ', ' ORDER BY p.quantity_text)
  FROM preferences p
  WHERE p.group_id = p_group_id
    AND NOT EXISTS (
      SELECT 1 FROM cabinet_items c
      WHERE c.group_id = p_group_id AND c.item_id = p.item_id AND c.status = 'in_stock')
  GROUP BY p.item_id
$fn$;

-- generate_shopping_list(group): backend/06 step 1 in one statement batch. Returns the number of rows it changed
-- (0 = the list was already up to date, so running it twice in a row changes nothing).
--   * upsert every needed item (reason 'preference'; an existing manual row keeps reason and its own quantity),
--     never touching `checked`
--   * delete unchecked 'preference' rows that are no longer needed
--   * refresh wanted_by / allergen_flags on the remaining manual and checked rows
-- Serialized per group with a transaction-level advisory lock. Call it inside the caller's transaction.
CREATE FUNCTION generate_shopping_list(p_group_id uuid) RETURNS integer
LANGUAGE plpgsql VOLATILE AS $fn$
DECLARE
  n_upserted  integer;
  n_deleted   integer;
  n_refreshed integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('generate_shopping_list:' || p_group_id::text, 0));

  INSERT INTO shopping_list_items AS s (group_id, item_id, reason, wanted_by, quantity_text, allergen_flags)
  SELECT p_group_id, n.item_id, 'preference', n.wanted_by, n.quantity_text,
         allergen_flags_for(p_group_id, item_allergens_for(p_group_id, n.item_id))
  FROM needed_items(p_group_id) n
  ON CONFLICT (group_id, item_id) DO UPDATE
    SET wanted_by      = EXCLUDED.wanted_by,
        quantity_text  = CASE WHEN s.reason = 'manual' THEN coalesce(s.quantity_text, EXCLUDED.quantity_text)
                              ELSE EXCLUDED.quantity_text END,
        allergen_flags = EXCLUDED.allergen_flags,
        updated_at     = now()
    WHERE (s.wanted_by, s.allergen_flags,
           CASE WHEN s.reason = 'manual' THEN coalesce(s.quantity_text, EXCLUDED.quantity_text) ELSE EXCLUDED.quantity_text END)
          IS DISTINCT FROM
          (EXCLUDED.wanted_by, EXCLUDED.allergen_flags, s.quantity_text);
  GET DIAGNOSTICS n_upserted = ROW_COUNT;

  DELETE FROM shopping_list_items s
  WHERE s.group_id = p_group_id
    AND s.reason = 'preference'
    AND NOT s.checked
    AND s.item_id NOT IN (SELECT n.item_id FROM needed_items(p_group_id) n);
  GET DIAGNOSTICS n_deleted = ROW_COUNT;

  UPDATE shopping_list_items s
     SET wanted_by = x.wanted_by, allergen_flags = x.flags, updated_at = now()
    FROM (
      SELECT s2.id,
             coalesce((SELECT array_agg(DISTINCT p.user_id ORDER BY p.user_id)
                       FROM preferences p WHERE p.group_id = p_group_id AND p.item_id = s2.item_id),
                      '{}'::uuid[]) AS wanted_by,
             allergen_flags_for(p_group_id, item_allergens_for(p_group_id, s2.item_id)) AS flags
      FROM shopping_list_items s2
      WHERE s2.group_id = p_group_id
        AND s2.item_id NOT IN (SELECT n.item_id FROM needed_items(p_group_id) n)
    ) x
   WHERE s.id = x.id
     AND (s.wanted_by, s.allergen_flags) IS DISTINCT FROM (x.wanted_by, x.flags);
  GET DIAGNOSTICS n_refreshed = ROW_COUNT;

  RETURN n_upserted + n_deleted + n_refreshed;
END
$fn$;
