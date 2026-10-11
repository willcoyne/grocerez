-- CreateEnum
CREATE TYPE "recurrence" AS ENUM ('staple', 'one_time');

-- CreateTable
CREATE TABLE "preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "group_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity_text" TEXT,
    "recurrence" "recurrence" NOT NULL DEFAULT 'staple',
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "preferences_group_id_item_id_idx" ON "preferences"("group_id", "item_id");

-- CreateIndex
CREATE INDEX "preferences_user_id_idx" ON "preferences"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "preferences_group_id_user_id_item_id_key" ON "preferences"("group_id", "user_id", "item_id");

-- AddForeignKey
ALTER TABLE "preferences" ADD CONSTRAINT "preferences_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preferences" ADD CONSTRAINT "preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preferences" ADD CONSTRAINT "preferences_group_id_user_id_fkey" FOREIGN KEY ("group_id", "user_id") REFERENCES "group_members"("group_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preferences" ADD CONSTRAINT "preferences_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
