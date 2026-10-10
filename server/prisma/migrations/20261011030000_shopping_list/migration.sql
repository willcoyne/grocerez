-- database/07: the group's one active shopping list. The rows for a group ARE the list (no lists table).

CREATE TYPE "list_reason" AS ENUM ('preference', 'manual');

CREATE TABLE "shopping_list_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "group_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "reason" "list_reason" NOT NULL,
    "wanted_by" UUID[] NOT NULL DEFAULT '{}',
    "quantity_text" TEXT,
    "allergen_flags" JSONB NOT NULL DEFAULT '[]',
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "checked_by" UUID,
    "checked_at" TIMESTAMPTZ,
    "scanned_product_id" UUID, -- FK to products is added when database/08 lands on this branch
    "added_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "shopping_list_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shopping_list_items_checked_check" CHECK ("checked" OR ("checked_by" IS NULL AND "checked_at" IS NULL))
);

CREATE UNIQUE INDEX "shopping_list_items_group_id_item_id_key" ON "shopping_list_items"("group_id", "item_id");
CREATE INDEX "shopping_list_items_group_id_checked_idx" ON "shopping_list_items"("group_id", "checked");

ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_checked_by_fkey" FOREIGN KEY ("checked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
