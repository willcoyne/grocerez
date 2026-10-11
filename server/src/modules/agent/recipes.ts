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
import { BROWSE_MIN_COVERAGE, rankByKitchenFit, rankForBrowse, termsRegex, type Ranked } from "./recipeRanking.js";
import { recipeRepo, type DinnerFilter, type EmbedTodo, type RecipeRow } from "./recipeRepo.js";
import { catalogMatch, isUnverified } from "./safety.js";

const dinnerFilter = (): DinnerFilter => ({
  mainCourse: config.RECIPE_MAIN_COURSE,
  excludedCourse: config.RECIPE_EXCLUDED_COURSE,
  nonDinnerTitle: config.RECIPE_NON_DINNER_TITLE,
});

/** recipeCategory as stored: trimmed, lower-cased, de-duplicated. */
const cleanCourse = (course: string[]) => [...new Set(course.map((c) => c.trim().toLowerCase()).filter(Boolean))];

const toResult = ({ r, uses }: Ranked<RecipeRow>) => ({
  id: r.id, url: r.url, site: r.site, title: r.title, imageUrl: r.imageUrl, minutes: r.minutes, servings: r.servings,
  ingredientLines: r.ingredientLines, ingredients: r.ingredients, course: r.course, distance: r.distance, uses,
});

export { rankByKitchenFit, rankForBrowse } from "./recipeRanking.js";

/** SQL candidate pool = limit × this, so the re-ranking has room. */
const CANDIDATE_POOL = 6;
/** Browse: rows ranked in TS at most (the SQL prefilter orders by its approximation first). */
const BROWSE_CAP = 300;
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

/** Drops recipes whose title/lines/ingredients conflict with any member's diet (conflicts() per member, as in safety.ts). */
function dietSafe<R extends RecipeRow>(rows: R[], members: { diets: Parameters<typeof conflicts>[1] }[]): R[] {
  const dieters = members.filter((m) => m.diets.length > 0);
  return rows.filter((r) => {
    const text = [r.title, ...r.ingredientLines, ...r.ingredients].join("\n");
    return dieters.every((m) => conflicts(text, m.diets, []).length === 0);
  });
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

type Facts = { allergens: Allergen[]; unverified: string[] };

/**
 * Per recipe: allergens = keyword table over the title, lines and ingredient names ∪ defaultAllergens of each
 * ingredient's VERIFIED catalog match (exact, whole-word or semantic, as in safety.ts); unverified = the ingredient
 * names no catalog match (and no keyword) vouches for. One lookup per distinct ingredient name.
 */
async function recipeFacts(recipes: IndexedRecipe[]): Promise<Map<string, Facts>> {
  const names = [...new Set(recipes.flatMap((r) => r.ingredients.map(normalize)).filter(Boolean))];
  const catalog = new Map<string, { allergens: Allergen[]; verified: boolean }>();
  await mapLimit(names, LOOKUP_CONCURRENCY, async (n) => {
    const v = (await catalogMatch(n)).verified;
    catalog.set(n, { allergens: v?.defaultAllergens ?? [], verified: !isUnverified(n, v) });
  });
  const out = new Map<string, Facts>();
  for (const r of recipes) {
    const found = new Set<Allergen>([
      ...[r.title, ...r.ingredientLines, ...r.ingredients].flatMap((t) => allergensInText(t)),
      ...r.ingredients.flatMap((i) => catalog.get(normalize(i))?.allergens ?? []),
    ]);
    const unverified = [...new Set(r.ingredients.filter((i) => normalize(i) && catalog.get(normalize(i))?.verified === false))];
    out.set(r.url, { allergens: [...found].sort(), unverified });
  }
  return out;
}

export const recipeIndex = {
  /**
   * POST /internal/recipes. Upsert by url; allergens = keyword table over the title, lines and ingredient names
   * ∪ defaultAllergens of each ingredient's VERIFIED catalog match (exact or whole-word, as in safety.ts).
   * Embeds inline when Akamai is configured; otherwise (or on an Akamai error) the backfill job does it later.
   */
  async ingest(recipes: IndexedRecipe[]): Promise<{ upserted: number; embedded: number }> {
    const byUrl = new Map(recipes.map((r) => [r.url, r])); // a repeated url in one batch: last wins
    const facts = await recipeFacts([...byUrl.values()]);

    const model = embeddingModel();
    const todo: EmbedTodo[] = [];
    for (const r of byUrl.values()) {
      const f = facts.get(r.url)!;
      const row = await recipeRepo.upsert(r, cleanCourse(r.course), f.allergens, f.unverified, model);
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

  /**
   * Backfill: computes allergens + unverified for rows never verified (verified_at IS NULL). `all` redoes every row
   * (after a catalog or threshold change). Safe to run repeatedly.
   */
  async verifyMissing(all = false): Promise<{ done: number; unverified: number }> {
    const progress = { done: 0, unverified: 0 };
    let after = "00000000-0000-0000-0000-000000000000";
    for (;;) {
      const batch = await recipeRepo.verifyBatch(all, after, 100);
      if (batch.length === 0) return progress;
      after = batch[batch.length - 1].id;
      const facts = await recipeFacts(batch);
      await recipeRepo.setFacts(batch.map((b) => ({ id: b.id, ...facts.get(b.url)! })));
      progress.done += batch.length;
      progress.unverified += batch.filter((b) => facts.get(b.url)!.unverified.length > 0).length;
    }
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
    if (body.browse) return this.browse(groupId, body);
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
      recipeRepo.nearest(vector, model, excluded, body.limit * CANDIDATE_POOL, dinnerFilter()),
      recipeRepo.cabinetNames(groupId),
    ]);
    if (rows.length === 0) return { recipes: [], available: await recipeRepo.hasEmbedded(model) };

    const ranked = rankByKitchenFit(dietSafe(rows, members), body.mustUse, cabinet, body.query).slice(0, body.limit);
    return { available: true, recipes: ranked.map(toResult) };
  },

  /**
   * Browse mode (spec §12.1): "what can we make" without a query embedding. ONE SQL query prefilters safe main courses
   * that mention a mustUse item or roughly cover ≥ 40% from the cabinet (≤ 300 rows), then TS scores them by kitchen
   * fit + mustUse and diversifies (≤ 2 per site, no near-duplicates). distance = 0. `query` is only logged.
   * available=false only when the index is empty (no embeddings needed).
   */
  async browse(groupId: string, body: RecipeSearchBody): Promise<RecipeSearchResponse> {
    const [members, cabinet] = await Promise.all([agentRepo.members(groupId), recipeRepo.cabinetNames(groupId)]);
    const excluded = [...new Set(members.flatMap((m) => m.allergens))];
    const rows = await recipeRepo.browse(
      excluded, dinnerFilter(), termsRegex(body.mustUse), termsRegex(cabinet), BROWSE_MIN_COVERAGE, BROWSE_CAP,
    );
    logger.info({ groupId, query: body.query, candidates: rows.length }, "recipe browse");
    if (rows.length === 0) return { recipes: [], available: await recipeRepo.hasAny() };
    const ranked = rankForBrowse(dietSafe(rows, members), body.mustUse, cabinet, body.limit);
    return { available: true, recipes: ranked.map(toResult) };
  },
};
