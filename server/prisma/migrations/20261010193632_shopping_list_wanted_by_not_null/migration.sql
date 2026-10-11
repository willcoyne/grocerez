-- shopping_list_items.wanted_by must be NOT NULL (plan/database/07). Prisma scalar lists are created nullable.
UPDATE "shopping_list_items" SET "wanted_by" = '{}' WHERE "wanted_by" IS NULL;
ALTER TABLE "shopping_list_items" ALTER COLUMN "wanted_by" SET NOT NULL;
