-- CreateEnum
CREATE TYPE "stock_status" AS ENUM ('in_stock', 'running_low');

-- CreateEnum
CREATE TYPE "expiration_source" AS ENUM ('manual', 'estimated');

-- CreateTable
CREATE TABLE "cabinet_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "group_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "product_id" UUID,
    "status" "stock_status" NOT NULL DEFAULT 'in_stock',
    "quantity_text" TEXT,
    "location" TEXT,
    "purchased_at" TIMESTAMPTZ(6),
    "expires_at" DATE,
    "expiration_source" "expiration_source",
    "added_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cabinet_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cabinet_items_group_id_expires_at_idx" ON "cabinet_items"("group_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "cabinet_items_group_id_item_id_key" ON "cabinet_items"("group_id", "item_id");

-- AddForeignKey
ALTER TABLE "cabinet_items" ADD CONSTRAINT "cabinet_items_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cabinet_items" ADD CONSTRAINT "cabinet_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cabinet_items" ADD CONSTRAINT "cabinet_items_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written: rules Prisma can't express
ALTER TABLE "cabinet_items" ADD CONSTRAINT "cabinet_items_location_chk" CHECK ("location" IN ('fridge', 'freezer', 'pantry', 'other'));
ALTER TABLE "cabinet_items" ADD CONSTRAINT "cabinet_items_expiration_pair_chk" CHECK (("expires_at" IS NULL) = ("expiration_source" IS NULL));
