-- database/08: global product cache (SmartLabel / Open Food Facts), shared by every group.

CREATE TYPE "product_source" AS ENUM ('smartlabel', 'openfoodfacts', 'manual');

CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "item_id" UUID,
    "gtin" TEXT,
    "smartlabel_url" TEXT,
    "brand" TEXT,
    "name" TEXT NOT NULL,
    "serving_size" TEXT,
    "calories_per_serving" DECIMAL,
    "nutrition" JSONB,
    "ingredients" TEXT,
    "allergens" "allergen"[] NOT NULL DEFAULT '{}',
    "may_contain" "allergen"[] NOT NULL DEFAULT '{}',
    "health_score" TEXT,
    "image_s3_key" TEXT,
    "source" "product_source" NOT NULL,
    "raw" JSONB,
    "fetched_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "products_identifier" CHECK ("gtin" IS NOT NULL OR "smartlabel_url" IS NOT NULL OR "source" = 'manual')
);

CREATE UNIQUE INDEX "products_gtin_key" ON "products"("gtin");
CREATE UNIQUE INDEX "products_smartlabel_url_key" ON "products"("smartlabel_url");
CREATE INDEX "products_item_id_idx" ON "products"("item_id");

ALTER TABLE "products" ADD CONSTRAINT "products_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
