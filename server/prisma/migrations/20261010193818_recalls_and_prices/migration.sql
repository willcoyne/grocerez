-- CreateTable
CREATE TABLE "recalls" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "product_description" TEXT NOT NULL,
    "reason" TEXT,
    "classification" TEXT,
    "firm" TEXT,
    "distribution" TEXT,
    "report_date" DATE,
    "status" TEXT,
    "raw" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recalls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recall_matches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recall_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "cabinet_item_id" UUID NOT NULL,
    "score" REAL NOT NULL,
    "dismissed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recall_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_estimates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "item_id" UUID NOT NULL,
    "zip_code" TEXT NOT NULL,
    "low_cents" INTEGER NOT NULL,
    "high_cents" INTEGER NOT NULL,
    "typical_cents" INTEGER,
    "unit" TEXT,
    "sources" JSONB,
    "model" TEXT,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_estimates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recalls_external_id_key" ON "recalls"("external_id");

-- CreateIndex
CREATE INDEX "recalls_product_description_trgm" ON "recalls" USING GIN ("product_description" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "recall_matches_cabinet_item_id_idx" ON "recall_matches"("cabinet_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "recall_matches_recall_id_cabinet_item_id_key" ON "recall_matches"("recall_id", "cabinet_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "price_estimates_item_id_zip_code_key" ON "price_estimates"("item_id", "zip_code");

-- CreateIndex
CREATE UNIQUE INDEX "cabinet_items_id_group_id_key" ON "cabinet_items"("id", "group_id");

-- AddForeignKey
ALTER TABLE "recall_matches" ADD CONSTRAINT "recall_matches_recall_id_fkey" FOREIGN KEY ("recall_id") REFERENCES "recalls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_matches" ADD CONSTRAINT "recall_matches_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_matches" ADD CONSTRAINT "recall_matches_cabinet_item_id_group_id_fkey" FOREIGN KEY ("cabinet_item_id", "group_id") REFERENCES "cabinet_items"("id", "group_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_estimates" ADD CONSTRAINT "price_estimates_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ════════════════════════════════════════════════════════════════════════════
-- Hand-written
-- ════════════════════════════════════════════════════════════════════════════
-- Active (not dismissed) matches per group: the alerts query.
CREATE INDEX "recall_matches_active_idx" ON "recall_matches" ("group_id") WHERE "dismissed_at" IS NULL;

ALTER TABLE "recall_matches" ADD CONSTRAINT "recall_matches_score_chk" CHECK ("score" >= 0 AND "score" <= 1);
ALTER TABLE "recalls" ADD CONSTRAINT "recalls_source_chk" CHECK ("source" IN ('openfda', 'demo'));
ALTER TABLE "price_estimates" ADD CONSTRAINT "price_estimates_cents_chk"
  CHECK ("low_cents" >= 0 AND "low_cents" <= "high_cents"
         AND ("typical_cents" IS NULL OR ("typical_cents" BETWEEN "low_cents" AND "high_cents")));
ALTER TABLE "price_estimates" ADD CONSTRAINT "price_estimates_zip_chk" CHECK ("zip_code" ~ '^[0-9]{5}$');
