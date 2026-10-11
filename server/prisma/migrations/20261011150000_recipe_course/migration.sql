-- Recipe course (challenge 01 §12.1): the page's schema.org recipeCategory, lower-cased ("main course", "side dish").
-- Search keeps main courses only; '{}' (the site doesn't say) falls back to the title non-dinner filter.
-- Existing rows get '{}' until the crawler re-fetches them (--refresh).

-- AlterTable
ALTER TABLE "recipes" ADD COLUMN "course" TEXT[] NOT NULL DEFAULT '{}';
