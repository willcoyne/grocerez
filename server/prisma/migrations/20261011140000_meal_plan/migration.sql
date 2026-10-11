-- Week calendar (challenge 01 §13): one planned dinner per date per group, written by agent apply or by hand.
-- `meal` is a PlanMeal (contracts/agent.ts) with `date` set. A swap run stores the planned meal it replaces.
-- grocerez_app gets access through ALTER DEFAULT PRIVILEGES (prisma/sql/app-role.sql), as for every table.

-- CreateEnum
CREATE TYPE "meal_slot" AS ENUM ('dinner');

-- AlterTable
ALTER TABLE "agent_runs" ADD COLUMN     "replace_planned_meal_id" UUID;

-- CreateTable
CREATE TABLE "planned_meals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "group_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "slot" "meal_slot" NOT NULL DEFAULT 'dinner',
    "meal" JSONB NOT NULL,
    "agent_run_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "planned_meals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "planned_meals_meal_is_object" CHECK (jsonb_typeof("meal") = 'object')
);

-- CreateIndex
CREATE INDEX "planned_meals_group_id_date_idx" ON "planned_meals"("group_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "planned_meals_group_id_date_slot_key" ON "planned_meals"("group_id", "date", "slot");

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_replace_planned_meal_id_fkey" FOREIGN KEY ("replace_planned_meal_id") REFERENCES "planned_meals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_meals" ADD CONSTRAINT "planned_meals_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_meals" ADD CONSTRAINT "planned_meals_agent_run_id_fkey" FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_meals" ADD CONSTRAINT "planned_meals_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
