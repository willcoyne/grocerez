import type { IndexedRecipe } from "../../contracts/agent.js";
import type { Allergen } from "../../contracts/dietary.js";
import { prisma } from "../../db.js";
import { toVectorLiteral } from "../../lib/embeddings.js";

/** Dimension of the production model (Qwen3-Embedding-0.6B); the HNSW index covers exactly these rows. */
export const INDEXED_DIMS = 1024;

export type RecipeRow = {
  id: string;
  url: string;
  site: string;
  title: string;
  imageUrl: string | null;
  minutes: number | null;
  servings: number | null;
  ingredientLines: string[];
  ingredients: string[];
  distance: number;
};

export type EmbedTodo = { id: string; title: string; ingredients: string[] };

/** The recipe index (challenge 01 §12). Global (not group data): written by the crawler, read through search. */
export const recipeRepo = {
  /**
   * Upsert by url. A row keeps its embedding only while title and ingredients (the embedded text) are unchanged.
   * Returns what still needs an embedding for `model`.
   */
  upsert: async (r: IndexedRecipe, allergens: Allergen[], model: string) => {
    const [row] = await prisma.$queryRaw<(EmbedTodo & { needsEmbedding: boolean })[]>`
      INSERT INTO recipes (url, site, title, image_url, minutes, servings, ingredient_lines, ingredients, allergens)
      VALUES (${r.url}, ${r.site}, ${r.title}, ${r.imageUrl}, ${r.minutes}, ${r.servings},
              ${r.ingredientLines}::text[], ${r.ingredients}::text[], ${allergens}::allergen[])
      ON CONFLICT (url) DO UPDATE SET
        site = EXCLUDED.site, title = EXCLUDED.title, image_url = EXCLUDED.image_url, minutes = EXCLUDED.minutes,
        servings = EXCLUDED.servings, ingredient_lines = EXCLUDED.ingredient_lines, ingredients = EXCLUDED.ingredients,
        allergens = EXCLUDED.allergens, crawled_at = now(),
        embedding = CASE WHEN recipes.title = EXCLUDED.title AND recipes.ingredients = EXCLUDED.ingredients
                         THEN recipes.embedding END,
        embedding_model = CASE WHEN recipes.title = EXCLUDED.title AND recipes.ingredients = EXCLUDED.ingredients
                               THEN recipes.embedding_model END,
        embedded_at = CASE WHEN recipes.title = EXCLUDED.title AND recipes.ingredients = EXCLUDED.ingredients
                           THEN recipes.embedded_at END
      RETURNING id, title, ingredients,
                (embedding IS NULL OR embedding_model IS DISTINCT FROM ${model}) AS "needsEmbedding"`;
    return row;
  },

  /** Rows with no embedding for `model` yet (new rows, or the model changed). */
  missingEmbeddings: (model: string, limit: number) =>
    prisma.$queryRaw<EmbedTodo[]>`
      SELECT id, title, ingredients FROM recipes
      WHERE embedding IS NULL OR embedding_model IS DISTINCT FROM ${model}
      ORDER BY created_at LIMIT ${limit}::int`,

  /** Stores a batch of embeddings in ONE statement. */
  setEmbeddings: (rows: { id: string; vector: number[] }[], model: string) =>
    prisma.$executeRaw`
      UPDATE recipes r SET embedding = v.e::vector, embedding_model = ${model}, embedded_at = now()
      FROM unnest(${rows.map((x) => x.id)}::uuid[], ${rows.map((x) => toVectorLiteral(x.vector))}::text[]) AS v(id, e)
      WHERE r.id = v.id`,

  /** Names of what's in the household's cabinet (in stock or running low): the kitchen-fit ranking. */
  cabinetNames: async (groupId: string) =>
    (await prisma.cabinetItem.findMany({ where: { groupId }, select: { item: { select: { name: true } } } })).map((c) => c.item.name),

  hasEmbedded: async (model: string) =>
    (await prisma.$queryRaw<{ ok: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM recipes WHERE embedding_model = ${model}) AS ok`)[0].ok,

  /**
   * Nearest recipes by cosine distance that share NO allergen with `excluded` (array overlap), ONE query.
   * 1024-d (production): the partial HNSW index on (embedding::vector(1024)), with pgvector iterative scans so the
   * allergen filter can't starve the result (relaxed order; callers re-rank anyway). Other dimensions: exact scan.
   */
  nearest: async (
    vector: number[],
    model: string,
    excluded: Allergen[],
    take: number,
    /** config.RECIPE_NON_DINNER_TITLE: filtered in SQL so sauces/desserts don't use up the candidate pool. */
    nonDinnerTitle: string,
  ): Promise<RecipeRow[]> => {
    const v = toVectorLiteral(vector);
    if (vector.length === INDEXED_DIMS) {
      const [, , rows] = await prisma.$transaction([
        prisma.$executeRaw`SET LOCAL hnsw.iterative_scan = relaxed_order`,
        prisma.$executeRaw`SET LOCAL hnsw.ef_search = 100`,
        prisma.$queryRaw<RecipeRow[]>`
          SELECT id, url, site, title, image_url AS "imageUrl", minutes, servings,
                 ingredient_lines AS "ingredientLines", ingredients,
                 (embedding::vector(1024) <=> ${v}::vector(1024))::float8 AS distance
          FROM recipes
          WHERE vector_dims(embedding) = 1024 AND embedding_model = ${model}
            AND NOT (allergens && ${excluded}::allergen[]) AND title !~* ${nonDinnerTitle}
          ORDER BY embedding::vector(1024) <=> ${v}::vector(1024)
          LIMIT ${take}::int`,
      ]);
      return rows;
    }
    return prisma.$queryRaw<RecipeRow[]>`
      SELECT id, url, site, title, image_url AS "imageUrl", minutes, servings,
             ingredient_lines AS "ingredientLines", ingredients,
             (embedding <=> ${v}::vector)::float8 AS distance
      FROM recipes
      WHERE embedding_model = ${model} AND vector_dims(embedding) = ${vector.length}::int
        AND NOT (allergens && ${excluded}::allergen[]) AND title !~* ${nonDinnerTitle}
      ORDER BY embedding <=> ${v}::vector
      LIMIT ${take}::int`;
  },
};
