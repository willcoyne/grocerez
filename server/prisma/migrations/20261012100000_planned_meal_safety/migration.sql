-- Safety result of the meal when it was written (null = saved before this was recorded).
ALTER TABLE "planned_meals" ADD COLUMN "safety" JSONB;
