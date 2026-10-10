import type { Db } from "../../db.js";
import type { Item as ItemRow } from "../../../generated/prisma/client.js";
import type { Allergen } from "../../contracts/dietary.js";
import type { Item } from "../../contracts/items.js";

export type SearchRow = {
  match: "exact" | "suggested" | "none";
  item_id: string;
  name: string;
  normalized_name: string;
  category: string | null;
  default_allergens: string[];
  shelf_life_days: number | null;
  similarity: number;
  distance: number;
};

export const toItem = (i: ItemRow): Item => ({
  id: i.id,
  name: i.name,
  normalizedName: i.normalizedName,
  category: i.category,
  defaultAllergens: i.defaultAllergens as Allergen[],
  shelfLifeDays: i.shelfLifeDays,
});

export const searchRowToItem = (r: Omit<SearchRow, "match" | "similarity">): Item => ({
  id: r.item_id,
  name: r.name,
  normalizedName: r.normalized_name,
  category: r.category,
  defaultAllergens: r.default_allergens as Allergen[],
  shelfLifeDays: r.shelf_life_days,
});

export const itemsRepo = {
  /** The database/04 matching query (exact → trigram + levenshtein). Normalizes q itself. */
  search: (db: Db, q: string, max = 5) =>
    db.$queryRaw<SearchRow[]>`SELECT * FROM search_items(${q}, ${max}::int)`,

  findById: (db: Db, id: string) => db.item.findUnique({ where: { id } }),

  /** Exact lookup by normalized name or alias. */
  findExact: async (db: Db, normalized: string) => {
    const byName = await db.item.findUnique({ where: { normalizedName: normalized } });
    if (byName) return byName;
    const alias = await db.itemAlias.findUnique({ where: { aliasNormalized: normalized }, include: { item: true } });
    return alias?.item ?? null;
  },

  /** Insert-or-get by normalized name (race-safe). normalized_name is computed by SQL so it always passes the CHECK. */
  createOrGet: async (db: Db, name: string, category: string, createdBy: string | null) => {
    const rows = await db.$queryRaw<{ id: string }[]>`
      INSERT INTO items (name, normalized_name, category, created_by)
      VALUES (${name}, normalize_item_name(${name}), ${category}, ${createdBy}::uuid)
      ON CONFLICT (normalized_name) DO NOTHING
      RETURNING id`;
    if (rows.length > 0) return { item: await db.item.findUniqueOrThrow({ where: { id: rows[0].id } }), created: true };
    const [existing] = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM items WHERE normalized_name = normalize_item_name(${name})`;
    return { item: await db.item.findUniqueOrThrow({ where: { id: existing.id } }), created: false };
  },

  /** Stores an item's description and embedding (vector literal from toVectorLiteral). */
  setDescriptionAndEmbedding: (db: Db, itemId: string, description: string | null, vector: string, model: string) =>
    db.$executeRaw`
      UPDATE items SET description = COALESCE(${description}, description),
        embedding = ${vector}::vector, embedding_model = ${model}, embedded_at = now()
      WHERE id = ${itemId}::uuid`,

  /** Items with no embedding for `model` yet (new items, or the model changed). */
  missingEmbeddings: (db: Db, model: string, limit: number) =>
    db.$queryRaw<{ id: string; name: string; category: string | null; description: string | null }[]>`
      SELECT id, name, category, description FROM items
      WHERE embedding IS NULL OR embedding_model IS DISTINCT FROM ${model}
      ORDER BY created_at, id LIMIT ${limit}::int`,

  /**
   * Nearest items by cosine distance to a query embedding. Only rows from the same model and dimension are
   * compared; exact scan (fine for a few thousand items).
   */
  related: (db: Db, vector: string, dims: number, model: string, excludeIds: string[], maxDistance: number, limit: number) =>
    db.$queryRaw<(Omit<SearchRow, "match" | "similarity"> & { distance: number })[]>`
      SELECT id AS item_id, name, normalized_name, category, default_allergens::text[] AS default_allergens,
             shelf_life_days, (embedding <=> ${vector}::vector) AS distance
      FROM items
      WHERE embedding_model = ${model} AND vector_dims(embedding) = ${dims}::int
        AND NOT (id = ANY(${excludeIds}::uuid[]))
        AND (embedding <=> ${vector}::vector) <= ${maxDistance}::float8
      ORDER BY embedding <=> ${vector}::vector
      LIMIT ${limit}::int`,

  /** Nearest items to another item's stored embedding (cosine), e.g. Oreos → Chips Ahoy, Cookies. */
  relatedToItem: (db: Db, itemId: string, excludeIds: string[], maxDistance: number, limit: number) =>
    db.$queryRaw<(Omit<SearchRow, "match" | "similarity"> & { distance: number })[]>`
      SELECT b.id AS item_id, b.name, b.normalized_name, b.category, b.default_allergens::text[] AS default_allergens,
             b.shelf_life_days, (b.embedding <=> a.embedding) AS distance
      FROM items a JOIN items b
        ON b.embedding_model = a.embedding_model AND vector_dims(b.embedding) = vector_dims(a.embedding)
      WHERE a.id = ${itemId}::uuid AND a.embedding IS NOT NULL AND b.id <> a.id
        AND NOT (b.id = ANY(${excludeIds}::uuid[]))
        AND (b.embedding <=> a.embedding) <= ${maxDistance}::float8
      ORDER BY b.embedding <=> a.embedding
      LIMIT ${limit}::int`,

  /** Adds alias → itemId. Returns the item id the alias points at (an existing alias wins). */
  addAlias: async (db: Db, aliasText: string, itemId: string) => {
    await db.$executeRaw`
      INSERT INTO item_aliases (item_id, alias_normalized)
      VALUES (${itemId}::uuid, normalize_item_name(${aliasText}))
      ON CONFLICT (alias_normalized) DO NOTHING`;
    const [row] = await db.$queryRaw<{ item_id: string }[]>`
      SELECT item_id FROM item_aliases WHERE alias_normalized = normalize_item_name(${aliasText})`;
    return row?.item_id ?? null;
  },
};
