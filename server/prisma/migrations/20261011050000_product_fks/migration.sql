-- backend 06x08: product FKs deferred by 05 (cabinet) and 06 (shopping list) until products existed.
-- Dangling ids (written before the FK existed) are cleared first so the constraints can be added.
UPDATE "cabinet_items" c SET "product_id" = NULL
  WHERE "product_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "products" p WHERE p."id" = c."product_id");
UPDATE "shopping_list_items" s SET "scanned_product_id" = NULL
  WHERE "scanned_product_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "products" p WHERE p."id" = s."scanned_product_id");

ALTER TABLE "cabinet_items" ADD CONSTRAINT "cabinet_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_scanned_product_id_fkey" FOREIGN KEY ("scanned_product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
