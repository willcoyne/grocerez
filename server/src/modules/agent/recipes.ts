import { config } from "../../config.js";
import type { RecipeSearchBody, RecipeSearchResponse } from "../../contracts/agent.js";
import type { IndexedRecipe } from "../../contracts/agent.js";
import type { Allergen } from "../../contracts/dietary.js";
import { allergensInText } from "../../lib/allergens.js";
import { conflicts } from "../../lib/diets.js";
import { EMBED_BATCH_MAX, embed, embeddingModel, embeddingsConfigured } from "../../lib/embeddings.js";
import { logger } from "../../lib/logger.js";
import { normalize } from "../../lib/normalize.js";
import { agentRepo } from "./repo.js";
import { recipeRepo, type EmbedTodo } from "./recipeRepo.js";
import { catalogMatch } from "./safety.js";

/**
 * Kitchen-fit ranking (cosine distance units; lower score = better):
 *   score = distance − 0.03·(mustUse items used) − 0.10·(cabinet coverage) + 0.01·max(0, missing − 4)
 * coverage = share of a recipe's ingredients the household already has; missing = how many it doesn't.
 */
export const MUST_USE_BOOST = 0.03;
export const COVERAGE_BOOST = 0.1;
export const MISSING_PENALTY = 0.01;
const MISSING_FREE = 4;
/** SQL candidate pool = limit × this, so the re-ranking has room. */
const CANDIDATE_POOL = 6;
/** Always in a kitchen: neither "covered" nor "missing". */
const STAPLES = new Set(["salt", "pepper", "black pepper", "kosher salt", "sea salt", "water", "ice", "cooking spray"]);

type Ranked<R> = { r: R; uses: string[]; coverage: number; missing: number; score: number };

/**
 * Re-ranks search candidates by how well they fit this kitchen. Names match whole-word in either direction
 * (normalized, as listWriter/safety do): "Boneless Chicken Breast" ⊇ "chicken breast", "Chicken" ⊆ "chicken breast".
 */
export function rankByKitchenFit<R extends { distance: number; ingredients: string[] }>(
  rows: R[],
  mustUse: string[],
  cabinet: string[],
): Ranked<R>[] {
  const pad = (s: string) => ` ${normalize(s)} `;
  const cab = [...new Set(cabinet.map(pad))].filter((c) => c.trim());
  const wants = mustUse.map((name) => ({ name, key: pad(name) })).filter((u) => u.key.trim());
  const matches = (a: string, b: string) => a.includes(b) || b.includes(a);
  return rows
    .map((r) => {
      const names = [...new Set(r.ingredients.map(pad))].filter((n) => n.trim() && !STAPLES.has(n.trim()));
      const have = names.filter((n) => cab.some((c) => matches(n, c))).length;
      const coverage = names.length ? have / names.length : 0;
      const missing = names.length - have;
      const uses = wants.filter((u) => names.some((n) => n.includes(u.key))).map((u) => u.name);
      const score =
        r.distance - MUST_USE_BOOST * uses.length - COVERAGE_BOOST * coverage + MISSING_PENALTY * Math.max(0, missing - MISSING_FREE);
      return { r, uses, coverage, missing, score };
    })
    .sort((a, b) => a.score - b.score);
}
/** Catalog lookups in flight at once during ingest (each is one search_items query). */
const LOOKUP_CONCURRENCY = 8;

/**
 * Query-side instruction for the Qwen3 embedding model (documents are embedded as-is). embedQuery() carries a
 * grocery-item instruction, which is the wrong task for recipes, so search embeds with this one via the same embed().
 */
const RECIPE_QUERY_INSTRUCTION = "Instruct: Given a meal idea, retrieve recipes for that dish or a close variation\nQuery: ";

/** Embedded text for a recipe: "title: ingredient names". */
export const recipeEmbeddingText = (r: { title: string; ingredients: string[] }) => `${r.title}: ${r.ingredients.join(", ")}`;

async function mapLimit<T, R>(xs: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let next = 0;
  const worker = async () => {
    while (next < xs.length) {
      const i = next++;
      out[i] = await fn(xs[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, xs.length) }, worker));
  return out;
}

/** Embeds rows in batches of ≤ EMBED_BATCH_MAX and stores each batch in one UPDATE; counts stored rows in `progress`. */
async function embedRows(rows: EmbedTodo[], progress: { done: number }): Promise<void> {
  const model = embeddingModel();
  for (let i = 0; i < rows.length; i += EMBED_BATCH_MAX) {
    const batch = rows.slice(i, i + EMBED_BATCH_MAX);
    const vectors = await embed(batch.map(recipeEmbeddingText));
    await recipeRepo.setEmbeddings(batch.map((r, j) => ({ id: r.id, vector: vectors[j] })), model);
    progress.done += batch.length;
  }
}

export const recipeIndex = {
  /**
   * POST /internal/recipes. Upsert by url; allergens = keyword table over the title, lines and ingredient names
   * ∪ defaultAllergens of each ingredient's VERIFIED catalog match (exact or whole-word, as in safety.ts).
   * Embeds inline when Akamai is configured; otherwise (or on an Akamai error) the backfill job does it later.
   */
  async ingest(recipes: IndexedRecipe[]): Promise<{ upserted: number; embedded: number }> {
    const byUrl = new Map(recipes.map((r) => [r.url, r])); // a repeated url in one batch: last wins
    const names = [...new Set([...byUrl.values()].flatMap((r) => r.ingredients.map(normalize)).filter(Boolean))];
    const catalog = new Map<string, Allergen[]>();
    await mapLimit(names, LOOKUP_CONCURRENCY, async (n) => {
      catalog.set(n, (await catalogMatch(n)).verified?.defaultAllergens ?? []);
    });

    const model = embeddingModel();
    const todo: EmbedTodo[] = [];
    for (const r of byUrl.values()) {
      const found = new Set<Allergen>([
        ...[r.title, ...r.ingredientLines, ...r.ingredients].flatMap((t) => allergensInText(t)),
        ...r.ingredients.flatMap((i) => catalog.get(normalize(i)) ?? []),
      ]);
      const row = await recipeRepo.upsert(r, [...found].sort(), model);
      if (row.needsEmbedding) todo.push(row);
    }

    const progress = { done: 0 };
    if (todo.length && embeddingsConfigured()) {
      await embedRows(todo, progress).catch((err) =>
        logger.warn({ err: String(err), pending: todo.length - progress.done }, "recipe embedding deferred to the backfill"),
      );
    }
    return { upserted: byUrl.size, embedded: progress.done };
  },

  /** Backfill: embeds every recipe with no embedding for the current model. Safe to run repeatedly. */
  async embedMissing(): Promise<number> {
    if (!embeddingsConfigured()) return 0;
    const progress = { done: 0 };
    for (;;) {
      const batch = await recipeRepo.missingEmbeddings(embeddingModel(), EMBED_BATCH_MAX * 4);
      if (batch.length === 0) return progress.done;
      await embedRows(batch, progress);
    }
  },

  /**
   * POST /groups/:gid/agent/recipes/search. One SQL query: nearest by cosine distance, excluding any recipe whose
   * precomputed allergens overlap a member's allergens and any non-dinner title (config.RECIPE_NON_DINNER_TITLE),
   * limit×6 candidates. Then, in TS, drop recipes whose text conflicts with a member's diet (conflicts() per member,
   * as in safety.ts), re-rank by kitchen fit (rankByKitchenFit: mustUse, cabinet coverage, missing count), take `limit`.
   * available=false (→ the agent falls back to Tavily) when Akamai isn't configured/reachable or nothing is embedded.
   */
  async search(groupId: string, body: RecipeSearchBody): Promise<RecipeSearchResponse> {
    const unavailable: RecipeSearchResponse = { recipes: [], available: false };
    if (!embeddingsConfigured()) return unavailable;
    const model = embeddingModel();
    const [members, vector] = await Promise.all([
      agentRepo.members(groupId),
      embed([RECIPE_QUERY_INSTRUCTION + body.query.toLowerCase()], { retries: 0 }).then(
        ([v]) => v,
        (err) => {
          logger.warn({ err: String(err) }, "recipe query embedding failed");
          return null;
        },
      ),
    ]);
    if (!vector) return unavailable;

    const excluded = [...new Set(members.flatMap((m) => m.allergens))];
    const [rows, cabinet] = await Promise.all([
      recipeRepo.nearest(vector, model, excluded, body.limit * CANDIDATE_POOL, config.RECIPE_NON_DINNER_TITLE),
      recipeRepo.cabinetNames(groupId),
    ]);
    if (rows.length === 0) return { recipes: [], available: await recipeRepo.hasEmbedded(model) };

    const dieters = members.filter((m) => m.diets.length > 0);
    const safe = rows.filter((r) => {
      const text = [r.title, ...r.ingredientLines, ...r.ingredients].join("\n");
      return dieters.every((m) => conflicts(text, m.diets, []).length === 0);
    });
    const ranked = rankByKitchenFit(safe, body.mustUse, cabinet).slice(0, body.limit);

    return {
      available: true,
      recipes: ranked.map(({ r, uses }) => ({
        id: r.id, url: r.url, site: r.site, title: r.title, imageUrl: r.imageUrl, minutes: r.minutes, servings: r.servings,
        ingredientLines: r.ingredientLines, ingredients: r.ingredients, distance: r.distance, uses,
      })),
    };
  },
};
