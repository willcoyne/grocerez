import { zipRegion } from "../../lib/productData.js";
import { prisma } from "../../db.js";

export const aiRepo = {
  listItems: async (groupId: string) =>
    (
      await prisma.shoppingListItem.findMany({
        where: { groupId },
        select: { quantityText: true, item: { select: { id: true, name: true } } },
      })
    ).map((r) => ({ id: r.item.id, name: r.item.name, quantityText: r.quantityText })),

  /**
   * Fresh prices for these items: the ZIP's own row, else one from any ZIP in the same census region (prices are
   * regional BLS averages / regional AI estimates, so a neighbour's estimate is just as good). One row per item.
   */
  cachedPrices: async (itemIds: string[], zipCode: string, since: Date) => {
    const rows = await prisma.priceEstimate.findMany({
      where: { itemId: { in: itemIds }, fetchedAt: { gte: since } },
      orderBy: { fetchedAt: "desc" },
    });
    const region = zipRegion(zipCode);
    const best = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const cur = best.get(r.itemId);
      if (r.zipCode === zipCode) {
        if (!cur || cur.zipCode !== zipCode) best.set(r.itemId, r);
      } else if (!cur && region && zipRegion(r.zipCode) === region) {
        best.set(r.itemId, r);
      }
    }
    return [...best.values()];
  },

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
