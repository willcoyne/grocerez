-- database/05: each member's want-list in a group.

CREATE TYPE "recurrence" AS ENUM ('staple', 'one_time');

CREATE TABLE "preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "group_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity_text" TEXT,
    "recurrence" "recurrence" NOT NULL DEFAULT 'staple',
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "preferences_group_id_user_id_item_id_key" ON "preferences"("group_id", "user_id", "item_id");
CREATE INDEX "preferences_group_id_item_id_idx" ON "preferences"("group_id", "item_id");

-- Composite FK to the membership (not separate FKs to groups/users): leaving, removal, group delete and user delete
-- all cascade through group_members, so a member's preferences go with their membership in the same transaction.
ALTER TABLE "preferences" ADD CONSTRAINT "preferences_group_id_user_id_fkey" FOREIGN KEY ("group_id", "user_id") REFERENCES "group_members"("group_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "preferences" ADD CONSTRAINT "preferences_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
