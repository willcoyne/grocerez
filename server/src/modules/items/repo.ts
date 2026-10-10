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

export const searchRowToItem = (r: SearchRow): Item => ({
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
