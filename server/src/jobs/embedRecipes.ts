import { prisma } from "../db.js";
import { embeddingModel, embeddingsConfigured } from "../lib/embeddings.js";
import { logger } from "../lib/logger.js";
import { recipeIndex } from "../modules/agent/recipes.js";

/** Embeds indexed recipes that have no embedding for the current Akamai model. Safe to run repeatedly. */
export async function backfillRecipeEmbeddings(): Promise<number> {
  if (!embeddingsConfigured()) {
    logger.info("Akamai embeddings not configured; skipping recipe embedding backfill");
    return 0;
  }
  const count = await recipeIndex.embedMissing();
  logger.info({ count, model: embeddingModel() }, "recipe embeddings backfilled");
  return count;
}

// `npm run embeddings:recipes`
if (import.meta.url === `file://${process.argv[1]}`) {
  backfillRecipeEmbeddings()
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      logger.error({ err: String(err) }, "recipe embedding backfill failed");
      await prisma.$disconnect();
      process.exit(1);
    });
}
