import { prisma } from "../db.js";
import { logger } from "../lib/logger.js";
import { recipeIndex } from "../modules/agent/recipes.js";

/**
 * Computes `allergens` + `unverified` (ingredients no catalog match vouches for, semantic fallback included) for
 * recipes never verified. `all` redoes every row. Safe to run repeatedly; runs at startup after the embedding backfill.
 */
export async function backfillRecipeVerification(all = false): Promise<{ done: number; unverified: number }> {
  const res = await recipeIndex.verifyMissing(all);
  logger.info(res, "recipe verification backfilled");
  return res;
}

// `npm run verify:recipes [-- --all]`
if (import.meta.url === `file://${process.argv[1]}`) {
  backfillRecipeVerification(process.argv.includes("--all"))
    .then(async (res) => {
      const [{ total, bad }] = await prisma.$queryRaw<{ total: number; bad: number }[]>`
        SELECT count(*)::int AS total, count(*) FILTER (WHERE cardinality(unverified) > 0)::int AS bad FROM recipes`;
      console.log(JSON.stringify({ ...res, total, stillUnverified: bad }));
      await prisma.$disconnect();
    })
    .catch(async (err) => {
      logger.error({ err: String(err) }, "recipe verification backfill failed");
      await prisma.$disconnect();
      process.exit(1);
    });
}
