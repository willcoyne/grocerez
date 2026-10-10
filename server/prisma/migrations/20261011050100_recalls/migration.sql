-- database/09 steps 1-2 (recall tables only; price_estimates is a separate migration) + recall import tracking.

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

    CONSTRAINT "recalls_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recalls_external_id_key" ON "recalls"("external_id");
CREATE INDEX "recalls_product_description_trgm" ON "recalls" USING GIN ("product_description" gin_trgm_ops);
CREATE INDEX "recalls_report_date_idx" ON "recalls"("report_date");

CREATE TABLE "recall_matches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recall_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "cabinet_item_id" UUID NOT NULL,
    "score" REAL NOT NULL,
    "dismissed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recall_matches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recall_matches_recall_id_cabinet_item_id_key" ON "recall_matches"("recall_id", "cabinet_item_id");
CREATE INDEX "recall_matches_group_id_dismissed_at_idx" ON "recall_matches"("group_id", "dismissed_at");

ALTER TABLE "recall_matches" ADD CONSTRAINT "recall_matches_recall_id_fkey" FOREIGN KEY ("recall_id") REFERENCES "recalls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recall_matches" ADD CONSTRAINT "recall_matches_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recall_matches" ADD CONSTRAINT "recall_matches_cabinet_item_id_fkey" FOREIGN KEY ("cabinet_item_id") REFERENCES "cabinet_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Last successful run per background job (backend/09: the recall import starts from the last import date).
CREATE TABLE "job_runs" (
    "name" TEXT NOT NULL,
    "last_success_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("name")
);
