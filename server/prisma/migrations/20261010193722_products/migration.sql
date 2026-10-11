-- CreateEnum
CREATE TYPE "product_source" AS ENUM ('smartlabel', 'openfoodfacts', 'manual');

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "item_id" UUID NOT NULL,
    "gtin" TEXT,
    "smartlabel_url" TEXT,
    "brand" TEXT,
    "name" TEXT NOT NULL,
    "serving_size" TEXT,
    "calories_per_serving" DECIMAL(65,30),
    "nutrition" JSONB,
    "ingredients" TEXT,
    "allergens" "allergen"[] DEFAULT ARRAY[]::"allergen"[],
    "may_contain" "allergen"[] DEFAULT ARRAY[]::"allergen"[],
    "health_score" TEXT,
    "image_s3_key" TEXT,
    "source" "product_source" NOT NULL,
    "raw" JSONB,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_gtin_key" ON "products"("gtin");

-- CreateIndex
CREATE UNIQUE INDEX "products_smartlabel_url_key" ON "products"("smartlabel_url");

-- CreateIndex
CREATE INDEX "products_item_id_idx" ON "products"("item_id");

-- AddForeignKey
ALTER TABLE "cabinet_items" ADD CONSTRAINT "cabinet_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_scanned_product_id_fkey" FOREIGN KEY ("scanned_product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ════════════════════════════════════════════════════════════════════════════
-- Hand-written
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE "products" ALTER COLUMN "allergens" SET NOT NULL;
ALTER TABLE "products" ALTER COLUMN "may_contain" SET NOT NULL;
ALTER TABLE "products" ADD CONSTRAINT "products_identifier_chk"
  CHECK ("gtin" IS NOT NULL OR "smartlabel_url" IS NOT NULL OR "source" = 'manual');
ALTER TABLE "products" ADD CONSTRAINT "products_gtin_digits_chk" CHECK ("gtin" ~ '^[0-9]{8,14}$');
ALTER TABLE "products" ADD CONSTRAINT "products_calories_chk" CHECK ("calories_per_serving" >= 0);

-- Allergens for a list item: a linked product's allergens ∪ may_contain (the product scanned while checking off,
-- else the product the group last bought for that item), otherwise the catalog's default_allergens.
CREATE OR REPLACE FUNCTION item_allergens_for(p_group_id uuid, p_item_id uuid) RETURNS allergen[]
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(
    (SELECT ARRAY(SELECT DISTINCT a FROM unnest(pr.allergens || pr.may_contain) a ORDER BY a)
     FROM products pr
     WHERE pr.id = coalesce(
       (SELECT s.scanned_product_id FROM shopping_list_items s WHERE s.group_id = p_group_id AND s.item_id = p_item_id),
       (SELECT c.product_id         FROM cabinet_items c       WHERE c.group_id = p_group_id AND c.item_id = p_item_id))),
    (SELECT i.default_allergens FROM items i WHERE i.id = p_item_id))
$fn$;
