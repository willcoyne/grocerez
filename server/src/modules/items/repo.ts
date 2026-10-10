import type { Allergen } from "@prisma/client";
import { prisma } from "../../db.js";
import type { Item } from "../../contracts/items.js";

const select = { id: true, name: true, category: true, defaultAllergens: true, shelfLifeDays: true } as const;
const toItem = (i: { id: string; name: string; category: string | null; defaultAllergens: Allergen[]; shelfLifeDays: number | null }) =>
  i as Item; // category is CHECK-constrained to the contract's list

export const itemsRepo = {
  find: async (id: string): Promise<Item | null> => {
    const i = await prisma.item.findUnique({ where: { id }, select });
    return i && toItem(i);
  },

  // Exact hit on the item's own normalized name first, then on an alias.
  findExact: async (q: string): Promise<Item | null> => {
    const i =
      (await prisma.item.findUnique({ where: { normalizedName: q }, select })) ??
      (await prisma.itemAlias.findUnique({ where: { aliasNormalized: q }, select: { item: { select } } }))?.item;
    return i ? toItem(i) : null;
  },

  // database/04 step 5: `%` is similarity > pg_trgm.similarity_threshold (0.3) and uses the GIN index.
  fuzzy: async (q: string): Promise<(Item & { distance: number })[]> => {
    const rows = await prisma.$queryRaw<
      { id: string; name: string; category: string | null; default_allergens: Allergen[]; shelf_life_days: number | null; distance: number }[]
    >`
      SELECT id, name, category, default_allergens::text[] AS default_allergens, shelf_life_days,
             levenshtein(normalized_name, ${q}) AS distance
      FROM items
      WHERE normalized_name % ${q}
      ORDER BY distance, similarity(normalized_name, ${q}) DESC
      LIMIT 5`;
    return rows.map((r) => ({
      ...toItem({ id: r.id, name: r.name, category: r.category, defaultAllergens: r.default_allergens, shelfLifeDays: r.shelf_life_days }),
      distance: r.distance,
    }));
  },

  // INSERT ... ON CONFLICT (normalized_name) DO NOTHING, then read: a concurrent create of the same name returns the same
  // row. (prisma.item.upsert with `update: {}` is not a native upsert and raced to P2002 -> 409, M3-05.)
  create: async (name: string, normalizedName: string, category: string | undefined, createdBy: string): Promise<Item> => {
    await prisma.item.createMany({ data: [{ name, normalizedName, category, createdBy }], skipDuplicates: true });
    return toItem(await prisma.item.findUniqueOrThrow({ where: { normalizedName }, select }));
  },

  addAlias: (itemId: string, aliasNormalized: string) =>
    prisma.itemAlias.createMany({ data: [{ itemId, aliasNormalized }], skipDuplicates: true }),
};
