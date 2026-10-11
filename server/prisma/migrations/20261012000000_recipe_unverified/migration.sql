-- Ingredients that stay unverifiable against the catalog (exact, whole-word, or semantic match), computed at ingest and
-- by the verifyRecipes backfill. Allergy households exclude recipes with any (search SQL: cardinality(unverified) > 0).
-- verified_at NULL = not computed yet (the backfill picks those up).

-- AlterTable
ALTER TABLE "recipes" ADD COLUMN "unverified" TEXT[] NOT NULL DEFAULT '{}',
ADD COLUMN "verified_at" TIMESTAMPTZ(6);
