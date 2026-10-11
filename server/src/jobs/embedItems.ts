import { prisma } from "../db.js";
import { embeddingModel, embeddingsConfigured } from "../lib/embeddings.js";
import { logger } from "../lib/logger.js";
import { itemsService } from "../modules/items/service.js";

/** Embeds catalog items that have no embedding for the current Akamai model. Safe to run repeatedly. */
export async function backfillItemEmbeddings(): Promise<number> {
  if (!embeddingsConfigured()) {
    logger.info("Akamai embeddings not configured; skipping item embedding backfill");
    return 0;
  }
  const count = await itemsService.embedMissing();
  logger.info({ count, model: embeddingModel() }, "item embeddings backfilled");
  return count;
}

// `npm run embeddings:backfill`
if (import.meta.url === `file://${process.argv[1]}`) {
  backfillItemEmbeddings()
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      logger.error({ err: String(err) }, "item embedding backfill failed");
      await prisma.$disconnect();
      process.exit(1);
    });
}
