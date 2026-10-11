import { prisma } from "../../db.js";

export const aiRepo = {
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
