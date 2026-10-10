-- database/09 (price_estimates part only): cache for the agentic price lookup (backend/10). Rows older than 24 h are stale.
-- The recalls tables from database/09 land in their own migration.

CREATE TABLE "price_estimates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "item_id" UUID NOT NULL,
    "zip_code" TEXT NOT NULL,
    "low_cents" INTEGER NOT NULL,
    "high_cents" INTEGER NOT NULL,
    "typical_cents" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "model" TEXT NOT NULL,
    "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_estimates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "price_estimates_zip_check" CHECK ("zip_code" ~ '^[0-9]{5}$'),
    CONSTRAINT "price_estimates_range_check" CHECK (0 <= "low_cents" AND "low_cents" <= "typical_cents" AND "typical_cents" <= "high_cents")
);

CREATE UNIQUE INDEX "price_estimates_item_id_zip_code_key" ON "price_estimates"("item_id", "zip_code");

ALTER TABLE "price_estimates" ADD CONSTRAINT "price_estimates_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
