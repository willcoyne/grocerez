-- database/06: the group's cabinet ("what we have"). Running out deletes the row; it is not a status.

CREATE TYPE "stock_status" AS ENUM ('in_stock', 'running_low');
CREATE TYPE "expiration_source" AS ENUM ('manual', 'estimated');

CREATE TABLE "cabinet_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "group_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "product_id" UUID, -- FK to products is added by database/08 (table doesn't exist yet)
    "status" "stock_status" NOT NULL DEFAULT 'in_stock',
    "quantity_text" TEXT,
    "location" TEXT,
    "purchased_at" TIMESTAMPTZ,
    "expires_at" DATE,
    "expiration_source" "expiration_source",
    "photo_s3_key" TEXT, -- backend/11: item-photo/<userId>/<uuid>.<ext>, presigned into photoUrl
    "added_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "cabinet_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cabinet_items_location_check" CHECK ("location" IN ('fridge', 'freezer', 'pantry', 'other'))
);

CREATE UNIQUE INDEX "cabinet_items_group_id_item_id_key" ON "cabinet_items"("group_id", "item_id");
CREATE INDEX "cabinet_items_group_id_expires_at_idx" ON "cabinet_items"("group_id", "expires_at");

ALTER TABLE "cabinet_items" ADD CONSTRAINT "cabinet_items_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cabinet_items" ADD CONSTRAINT "cabinet_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cabinet_items" ADD CONSTRAINT "cabinet_items_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
