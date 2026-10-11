import { config } from "../config.js";
import type { Item } from "../contracts/items.js";
import { prisma } from "../db.js";
import { itemsRepo, searchRowToItem } from "../modules/items/repo.js";
import { EMBED_BATCH_MAX, QUERY_INSTRUCTION, embed, embeddingModel, embeddingsConfigured, toVectorLiteral } from "./embeddings.js";
import { logger } from "./logger.js";

/**
 * Semantic fallback for ingredient verification: the nearest catalog item (cosine distance over item embeddings)
 * when it is within SEMANTIC_INGREDIENT_MAX_DISTANCE. Results are cached in-process and embed calls from concurrent
 * lookups are coalesced into batches of EMBED_BATCH_MAX. Any failure (or no embeddings) → null, i.e. "not verified".
 */
export type SemanticHit = { item: Item; distance: number };

const cache = new Map<string, Promise<SemanticHit | null>>();
let pending: { text: string; resolve: (v: number[] | null) => void }[] = [];
let scheduled = false;

async function flush() {
  scheduled = false;
  const all = pending;
  pending = [];
  for (let i = 0; i < all.length; i += EMBED_BATCH_MAX) {
    const chunk = all.slice(i, i + EMBED_BATCH_MAX);
    try {
      const vectors = await embed(chunk.map((c) => QUERY_INSTRUCTION + c.text), { retries: 4 });
      chunk.forEach((c, j) => c.resolve(vectors[j]));
    } catch (err) {
      logger.warn({ err: String(err) }, "ingredient embedding failed; treating as unverified");
      chunk.forEach((c) => c.resolve(null));
    }
  }
}

function embedBatched(text: string): Promise<number[] | null> {
  return new Promise((resolve) => {
    pending.push({ text, resolve });
    if (!scheduled) {
      scheduled = true;
      setTimeout(() => void flush(), 15);
    }
  });
}

async function lookup(text: string): Promise<SemanticHit | null> {
  const vector = await embedBatched(text);
  if (!vector) return null;
  const row = await itemsRepo.nearest(prisma, toVectorLiteral(vector), vector.length, embeddingModel()).catch(() => null);
  if (!row) return null;
  return { item: searchRowToItem(row), distance: row.distance };
}

/** The nearest catalog item for an ingredient and its distance (callers apply the threshold); null when unavailable. */
export function semanticIngredient(ingredient: string): Promise<SemanticHit | null> {
  const text = ingredient.trim().replace(/\s+/g, " ").toLowerCase();
  if (!text || !embeddingsConfigured()) return Promise.resolve(null);
  const key = `${embeddingModel()}:${text}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = lookup(text);
    cache.set(key, hit);
    // A failed embedding (null) must not be remembered: drop it so a later call can retry.
    const p = hit;
    void p.then((h) => {
      if (!h && cache.get(key) === p) cache.delete(key);
    });
    if (cache.size > 20_000) cache.delete(cache.keys().next().value!);
  }
  return hit;
}

/** Nearest item within the configured threshold, or null. */
export const semanticVerified = async (ingredient: string): Promise<SemanticHit | null> => {
  const hit = await semanticIngredient(ingredient);
  return hit && hit.distance <= config.SEMANTIC_INGREDIENT_MAX_DISTANCE ? hit : null;
};

/** Test hook: forget cached lookups. */
export const clearSemanticIngredientCache = () => cache.clear();
