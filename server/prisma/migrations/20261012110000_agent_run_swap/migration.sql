-- A swap run stays a swap run after its target meal is deleted (replace_planned_meal_id is SET NULL on delete).
ALTER TABLE "agent_runs" ADD COLUMN "is_swap" BOOLEAN NOT NULL DEFAULT false;
UPDATE "agent_runs" SET "is_swap" = true WHERE "replace_planned_meal_id" IS NOT NULL;
