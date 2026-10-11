import { Prisma } from "../../../generated/prisma/client.js";
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
  course: string[];
  distance: number;
};

export type EmbedTodo = { id: string; title: string; ingredients: string[] };

/** Main courses only (spec §12.1): the regexes from config (RECIPE_MAIN_COURSE / _EXCLUDED_COURSE / _NON_DINNER_TITLE). */
export type DinnerFilter = { mainCourse: string; excludedCourse: string; nonDinnerTitle: string };

/**
 * SQL predicate: a course naming a main keeps the recipe (even with "side dish" too); else an excluded course drops it;
 * else (no course, or one we don't know) the title must pass the non-dinner filter. In SQL so it never eats the pool.
 */
const dinnerOnly = (f: DinnerFilter) => Prisma.sql`(
  array_to_string(course, ' | ') ~* ${f.mainCourse}
  OR (array_to_string(course, ' | ') !~* ${f.excludedCourse} AND title !~* ${f.nonDinnerTitle}))`;

const COLUMNS = Prisma.sql`id, url, site, title, image_url AS "imageUrl", minutes, servings,
  ingredient_lines AS "ingredientLines", ingredients, course`;

/** The recipe index (challenge 01 §12). Global (not group data): written by the crawler, read through search. */
export const recipeRepo = {
  /**
   * Upsert by url. A row keeps its embedding only while title and ingredients (the embedded text) are unchanged.
   * Returns what still needs an embedding for `model`.
   */
  upsert: async (r: IndexedRecipe, course: string[], allergens: Allergen[], model: string) => {
    const [row] = await prisma.$queryRaw<(EmbedTodo & { needsEmbedding: boolean })[]>`
      INSERT INTO recipes (url, site, title, image_url, minutes, servings, ingredient_lines, ingredients, course, allergens)
      VALUES (${r.url}, ${r.site}, ${r.title}, ${r.imageUrl}, ${r.minutes}, ${r.servings},
              ${r.ingredientLines}::text[], ${r.ingredients}::text[], ${course}::text[], ${allergens}::allergen[])
      ON CONFLICT (url) DO UPDATE SET
        site = EXCLUDED.site, title = EXCLUDED.title, image_url = EXCLUDED.image_url, minutes = EXCLUDED.minutes,
        servings = EXCLUDED.servings, ingredient_lines = EXCLUDED.ingredient_lines, ingredients = EXCLUDED.ingredients,
        course = EXCLUDED.course, allergens = EXCLUDED.allergens, crawled_at = now(),
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

  hasAny: async () => (await prisma.$queryRaw<{ ok: boolean }[]>`SELECT EXISTS (SELECT 1 FROM recipes) AS ok`)[0].ok,

  /**
   * Nearest main courses by cosine distance that share NO allergen with `excluded` (array overlap), ONE query.
   * 1024-d (production): the partial HNSW index on (embedding::vector(1024)), with pgvector iterative scans so the
   * filters can't starve the result (relaxed order; callers re-rank anyway). Other dimensions: exact scan.
   */
  nearest: async (vector: number[], model: string, excluded: Allergen[], take: number, f: DinnerFilter): Promise<RecipeRow[]> => {
    const v = toVectorLiteral(vector);
    if (vector.length === INDEXED_DIMS) {
      const [, , rows] = await prisma.$transaction([
        prisma.$executeRaw`SET LOCAL hnsw.iterative_scan = relaxed_order`,
        prisma.$executeRaw`SET LOCAL hnsw.ef_search = 100`,
        prisma.$queryRaw<RecipeRow[]>`
          SELECT ${COLUMNS}, (embedding::vector(1024) <=> ${v}::vector(1024))::float8 AS distance
          FROM recipes
          WHERE vector_dims(embedding) = 1024 AND embedding_model = ${model}
            AND NOT (allergens && ${excluded}::allergen[]) AND ${dinnerOnly(f)}
          ORDER BY embedding::vector(1024) <=> ${v}::vector(1024)
          LIMIT ${take}::int`,
      ]);
      return rows;
    }
    return prisma.$queryRaw<RecipeRow[]>`
      SELECT ${COLUMNS}, (embedding <=> ${v}::vector)::float8 AS distance
      FROM recipes
      WHERE embedding_model = ${model} AND vector_dims(embedding) = ${vector.length}::int
        AND NOT (allergens && ${excluded}::allergen[]) AND ${dinnerOnly(f)}
      ORDER BY embedding <=> ${v}::vector
      LIMIT ${take}::int`;
  },

  /**
   * Browse candidates (spec §12.1), ONE query, no embedding: safe main courses that mention a mustUse item, or whose
   * ingredients roughly cover ≥ minCoverage of themselves from the cabinet (one-direction regex approximation; the
   * caller recomputes exactly). Best approximations first, capped at `cap` rows.
   */
  browse: (
    excluded: Allergen[],
    f: DinnerFilter,
    mustUseRe: string | null,
    cabinetRe: string | null,
    minCoverage: number,
    cap: number,
  ): Promise<RecipeRow[]> => {
    const mustHit = mustUseRe ? Prisma.sql`(array_to_string(r.ingredients, ' | ') ~* ${mustUseRe})` : Prisma.sql`false`;
    const approxCoverage = cabinetRe
      ? Prisma.sql`(SELECT count(*) FROM unnest(r.ingredients) i WHERE i ~* ${cabinetRe})::float8 / GREATEST(cardinality(r.ingredients), 1)`
      : Prisma.sql`0::float8`;
    return prisma.$queryRaw<RecipeRow[]>`
      SELECT ${COLUMNS}, 0::float8 AS distance
      FROM (
        SELECT r.*, ${mustHit} AS must_hit, ${approxCoverage} AS approx_coverage
        FROM recipes r
        WHERE NOT (r.allergens && ${excluded}::allergen[]) AND ${dinnerOnly(f)}
      ) c
      WHERE must_hit OR approx_coverage >= ${minCoverage}::float8
      ORDER BY must_hit DESC, approx_coverage DESC, id
      LIMIT ${cap}::int`;
  },
};
