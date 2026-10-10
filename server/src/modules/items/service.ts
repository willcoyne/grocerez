import { prisma, type Db } from "../../db.js";
import type { CreateItemBody, Item, ItemSearchResponse } from "../../contracts/items.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { embed, embeddingModel, embeddingsConfigured, embedQuery, itemEmbeddingText, toVectorLiteral } from "../../lib/embeddings.js";
import { config } from "../../config.js";
import { logger } from "../../lib/logger.js";
import { normalize } from "../../lib/normalize.js";
import { itemsRepo, searchRowToItem, toItem } from "./repo.js";

/** Akamai's embeddings endpoint accepts at most 16 inputs per request. */
const EMBED_BATCH_MAX = 16;

const emptyName = () => badRequest("Item name is empty after normalization", "VALIDATION_ERROR");

export const itemsService = {
  /** GET /items/search: exact name/alias → "exact"; close trigram/levenshtein hit → "suggested"; else "none" + similar items. */
  async search(q: string, db: Db = prisma): Promise<ItemSearchResponse> {
    const n = normalize(q);
    if (!n) throw emptyName();
    const rows = await itemsRepo.search(db, q);
    const results = rows.map(searchRowToItem);
    const related = await this.related(n, results.map((r) => r.id), db);
    if (rows.length === 0) return { match: "none", results: [], related };
    return { match: rows[0].match, results, related };
  },

  /** Semantic neighbours of a (normalized) query via Akamai embeddings. Never fails the search: errors → []. */
  async related(normalizedQuery: string, excludeIds: string[], db: Db = prisma, limit = 5) {
    if (!embeddingsConfigured()) return [];
    try {
      const vector = await embedQuery(normalizedQuery);
      const rows = await itemsRepo.related(
        db, toVectorLiteral(vector), vector.length, embeddingModel(), excludeIds, config.SEMANTIC_MAX_DISTANCE, limit,
      );
      return rows.map(searchRowToItem);
    } catch (err) {
      logger.warn({ err: String(err) }, "semantic item search failed");
      return [];
    }
  },

  /** Embeds one item right after it's added. Best effort: the item exists either way, and startup backfills misses. */
  async embedItem(item: { id: string; name: string; category: string | null }) {
    if (!embeddingsConfigured()) return;
    try {
      const [vector] = await embed([itemEmbeddingText(item)]);
      await itemsRepo.setEmbedding(prisma, item.id, toVectorLiteral(vector), embeddingModel());
    } catch (err) {
      logger.warn({ err: String(err), itemId: item.id }, "item embedding failed");
    }
  },

  /** Embeds every item that has no embedding for the current model, in batches. Returns how many were embedded. */
  async embedMissing(batchSize = EMBED_BATCH_MAX): Promise<number> {
    if (!embeddingsConfigured()) return 0;
    let total = 0;
    for (;;) {
      const batch = await itemsRepo.missingEmbeddings(prisma, embeddingModel(), batchSize);
      if (batch.length === 0) return total;
      const vectors = await embed(batch.map(itemEmbeddingText));
      for (const [i, item] of batch.entries()) {
        await itemsRepo.setEmbedding(prisma, item.id, toVectorLiteral(vectors[i]), embeddingModel());
      }
      total += batch.length;
    }
  },

  /**
   * POST /items. With aliasOf: the user confirmed a suggestion → store normalize(name) as an alias and return that item.
   * Without: create the item (or return the existing one if the name/alias already exists).
   */
  async create(userId: string, body: CreateItemBody): Promise<{ item: Item; created: boolean }> {
    const n = normalize(body.name);
    if (!n) throw emptyName();
    const result = await prisma.$transaction(async (tx): Promise<{ item: Item; created: boolean }> => {
      const existing = await itemsRepo.findExact(tx, n);
      if (body.aliasOf) {
        const target = await itemsRepo.findById(tx, body.aliasOf);
        if (!target) throw notFound("Item");
        if (existing) {
          if (existing.id === target.id) return { item: toItem(target), created: false };
          throw conflict(`"${body.name}" already means ${existing.name}`, "NAME_TAKEN");
        }
        const pointsTo = await itemsRepo.addAlias(tx, body.name, target.id);
        if (pointsTo !== target.id) throw conflict(`"${body.name}" already means another item`, "NAME_TAKEN");
        return { item: toItem(target), created: true };
      }
      if (existing) return { item: toItem(existing), created: false };
      const { item, created } = await itemsRepo.createOrGet(tx, body.name, body.category ?? "other", userId);
      return { item: toItem(item), created };
    });
    // Only brand-new items need an embedding (aliases point at an existing, already-embedded item).
    if (result.created && !body.aliasOf) await this.embedItem(result.item);
    return result;
  },

  /**
   * Shared "resolve free text to a catalog item" used by product scans (08) and recipe missing items (10):
   * exact or suggested → that item; otherwise create it (if createIfMissing).
   */
  async resolve(name: string, opts: { category?: string; createdBy?: string | null; createIfMissing?: boolean } = {}) {
    if (!normalize(name)) return null;
    const res = await this.search(name);
    if (res.match !== "none" && res.results[0]) return { item: res.results[0], match: res.match };
    if (!opts.createIfMissing) return null;
    const { item, created } = await itemsRepo.createOrGet(prisma, name.trim().slice(0, 200), opts.category ?? "other", opts.createdBy ?? null);
    if (created) await this.embedItem(item);
    return { item: toItem(item), match: "created" as const };
  },
};
