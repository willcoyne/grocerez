import { prisma } from "../../db.js";

export const aiRepo = {
  /** Cabinet names + expiry, and the combined diets/allergens of every member of the group. */
  recipeContext: async (groupId: string) => {
    const [cabinet, members] = await Promise.all([
      prisma.cabinetItem.findMany({
        where: { groupId },
        select: { expiresAt: true, status: true, item: { select: { name: true } } },
        orderBy: [{ expiresAt: { sort: "asc", nulls: "last" } }],
        take: 150,
      }),
      prisma.groupMember.findMany({
        where: { groupId },
        select: { user: { select: { diets: { select: { diet: true } }, allergens: { select: { allergen: true } } } } },
      }),
    ]);
    return {
      cabinet: cabinet.map((c) => ({ name: c.item.name, expiresAt: c.expiresAt, status: c.status })),
      diets: members.flatMap((m) => m.user.diets.map((d) => d.diet)),
      allergens: members.flatMap((m) => m.user.allergens.map((a) => a.allergen as string)),
    };
  },

  listItems: async (groupId: string) =>
    (
      await prisma.shoppingListItem.findMany({
        where: { groupId },
        select: { quantityText: true, item: { select: { id: true, name: true } } },
      })
    ).map((r) => ({ id: r.item.id, name: r.item.name, quantityText: r.quantityText })),

  cachedPrices: (itemIds: string[], zipCode: string, since: Date) =>
    prisma.priceEstimate.findMany({ where: { itemId: { in: itemIds }, zipCode, fetchedAt: { gte: since } } }),

  upsertPrice: (
    itemId: string,
    zipCode: string,
    d: { lowCents: number; highCents: number; typicalCents: number | null; unit: string | null; sources: string[]; model: string },
  ) => {
    const data = { ...d, fetchedAt: new Date() };
    return prisma.priceEstimate.upsert({
      where: { itemId_zipCode: { itemId, zipCode } },
      create: { itemId, zipCode, ...data },
      update: data,
    });
  },
};
