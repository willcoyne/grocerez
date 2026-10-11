import { prisma, type Db } from "../../db.js";
import type { CreateItemBody, Item, ItemSearchResponse } from "../../contracts/items.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import {
  describeItems,
  embed,
  EMBED_BATCH_MAX,
  embeddingModel,
  embeddingsConfigured,
  embedQuery,
  itemEmbeddingText,
  toVectorLiteral,
  type ItemSemantics,
} from "../../lib/embeddings.js";
import { config } from "../../config.js";
import { logger } from "../../lib/logger.js";
import { normalize } from "../../lib/normalize.js";
import { itemsRepo, searchRowToItem, toItem } from "./repo.js";

/** Background embeds in flight (tests await them with `waitForItemEmbeds`). */
const pendingEmbeds = new Set<Promise<void>>();
export const waitForItemEmbeds = () => Promise.all([...pendingEmbeds]);

/** Keeps only rows within SEMANTIC_RELATIVE_GAP of the closest one (rows are sorted by distance). */
const closest = <T extends { distance: number }>(rows: T[]) =>
  rows.filter((r) => r.distance <= rows[0].distance + config.SEMANTIC_RELATIVE_GAP);

const emptyName = () => badRequest("Item name is empty after normalization", "VALIDATION_ERROR");

export const itemsService = {
  /** GET /items/search: exact name/alias → "exact"; close trigram/levenshtein hit → "suggested"; else "none" + similar items. */
  async search(q: string, db: Db = prisma): Promise<ItemSearchResponse> {
    const n = normalize(q);
    if (!n) throw emptyName();
    const rows = await itemsRepo.search(db, q);
    const results = rows.map(searchRowToItem);
    // A spelling match (Oreos) has a description-based embedding that knows what it is ("chocolate sandwich
    // cookies"), so its neighbours beat embedding the bare typed word. No match → embed what was typed.
    const anchor = rows[0] && rows[0].match !== "none" ? rows[0].item_id : null;
    const related = await this.related(q, results.map((r) => r.id), db, anchor);
    if (rows.length === 0) return { match: "none", results: [], related };
    return { match: rows[0].match, results, related };
  },

  /** Items closest to what was typed by cosine similarity (Akamai embeddings). Never fails the search: errors → []. */
  async related(typed: string, excludeIds: string[], db: Db = prisma, anchorItemId: string | null = null, limit = 8) {
    if (!embeddingsConfigured()) return [];
    try {
      if (anchorItemId) {
        const rows = await itemsRepo.relatedToItem(db, anchorItemId, excludeIds, config.SEMANTIC_ITEM_MAX_DISTANCE, limit);
        if (rows.length > 0) return rows.map(searchRowToItem);
      }
      const vector = await embedQuery(typed);
      const rows = await itemsRepo.related(
        db, toVectorLiteral(vector), vector.length, embeddingModel(), excludeIds, config.SEMANTIC_MAX_DISTANCE, limit,
      );
      return closest(rows).map(searchRowToItem);
    } catch (err) {
      logger.warn({ err: String(err) }, "semantic item search failed");
      return [];
    }
  },

  /**
   * Describes (Akamai chat) then embeds items, saving both. A failed description falls back to "name (category)";
   * a failed embedding throws so callers can decide (startup backfill retries on the next start).
   */
  async describeAndEmbed(
    items: { id: string; name: string; category: string | null; description: string | null; productType: string | null }[],
  ) {
    const undescribed = items.filter((i) => !i.description || !i.productType).map((i) => i.name);
    const semantics = await describeItems(undescribed).catch((err) => {
      logger.warn({ err: String(err) }, "item descriptions failed; embedding names only");
      return new Map<string, ItemSemantics>();
    });
    const withText = items.map((i) => ({
      ...i,
      description: i.description ?? semantics.get(i.name)?.description ?? null,
      productType: i.productType ?? semantics.get(i.name)?.productType ?? null,
    }));
    const vectors = await embed(withText.map(itemEmbeddingText));
    for (const [k, item] of withText.entries()) {
      await itemsRepo.setDescriptionAndEmbedding(
        prisma, item.id, item.productType, item.description, toVectorLiteral(vectors[k]), embeddingModel(),
      );
    }
  },

  /** Describes and embeds one item right after it's added. Best effort: the item exists either way. */
  async embedItem(item: { id: string; name: string; category: string | null }) {
    if (!embeddingsConfigured()) return;
    try {
      await this.describeAndEmbed([{ ...item, description: null, productType: null }]);
    } catch (err) {
      logger.warn({ err: String(err), itemId: item.id }, "item embedding failed");
    }
  },

  /** Runs embedItem without making the caller wait (adding an item stays instant). */
  embedItemInBackground(item: { id: string; name: string; category: string | null }) {
    if (embeddingsConfigured()) {
      const p: Promise<void> = this.embedItem(item).finally(() => pendingEmbeds.delete(p));
      pendingEmbeds.add(p);
    }
  },

  /** Embeds every item that has no embedding for the current model, in batches. Returns how many were embedded. */
  async embedMissing(batchSize = EMBED_BATCH_MAX): Promise<number> {
    if (!embeddingsConfigured()) return 0;
    let total = 0;
    for (;;) {
      const batch = await itemsRepo.missingEmbeddings(prisma, embeddingModel(), batchSize);
      if (batch.length === 0) return total;
      await this.describeAndEmbed(batch);
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
    if (result.created && !body.aliasOf) this.embedItemInBackground(result.item);
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
    if (created) this.embedItemInBackground(item);
    return { item: toItem(item), match: "created" as const };
  },
};
