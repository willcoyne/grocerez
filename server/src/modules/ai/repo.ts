import type { Allergen, PricedItem } from "../../contracts/ai.js";
import { prisma } from "../../db.js";

const CACHE_MS = 24 * 60 * 60 * 1000;

// Every group-owned read is scoped by groupId. price_estimates is a global cache keyed by (item, zip).
export const aiRepo = {
  /** Everything in the cabinet (in_stock and running_low) with its expiration date and known allergens. */
  cabinet: async (groupId: string) =>
    (
      await prisma.cabinetItem.findMany({
        where: { groupId },
        select: {
          expiresAt: true,
          item: { select: { name: true, defaultAllergens: true } },
          product: { select: { allergens: true, mayContain: true } },
        },
      })
    ).map((c) => ({
      name: c.item.name,
      expiresAt: c.expiresAt,
      // Catalog ∪ scanned product (contains + may contain): structured data the keyword check can't see (M3-16).
      allergens: [...new Set([...c.item.defaultAllergens, ...(c.product?.allergens ?? []), ...(c.product?.mayContain ?? [])])] as Allergen[],
    })),

  members: async (groupId: string) =>
    (
      await prisma.groupMember.findMany({
        where: { groupId },
        select: { user: { select: { diets: { select: { diet: true } }, allergens: { select: { allergen: true } } } } },
      })
    ).map(({ user }) => ({ diets: user.diets.map((d) => d.diet), allergens: user.allergens.map((a) => a.allergen as Allergen) })),

  listItems: async (groupId: string) =>
    (
      await prisma.shoppingListItem.findMany({
        where: { groupId },
        orderBy: { createdAt: "asc" },
        select: { itemId: true, item: { select: { name: true, userCreated: true } } },
      })
    ).map((r) => ({ itemId: r.itemId, name: r.item.name, userCreated: r.item.userCreated })),

  userZip: async (userId: string) =>
    (await prisma.user.findUnique({ where: { id: userId }, select: { zipCode: true } }))?.zipCode ?? null,

  /** Rows fetched within the last 24 h. Older rows are stale and get refreshed. */
  freshPrices: (itemIds: string[], zipCode: string, now = new Date()) =>
    prisma.priceEstimate.findMany({
      where: { itemId: { in: itemIds }, zipCode, fetchedAt: { gte: new Date(now.getTime() - CACHE_MS) } },
    }),

  upsertPrices: (zipCode: string, model: string, prices: PricedItem[]) =>
    prisma.$transaction(
      prices.map((p) => {
        const data = {
          lowCents: p.lowCents,
          typicalCents: p.typicalCents,
          highCents: p.highCents,
          unit: p.unit,
          sources: p.sourceUrls,
          model,
          fetchedAt: new Date(),
        };
        return prisma.priceEstimate.upsert({
          where: { itemId_zipCode: { itemId: p.itemId, zipCode } },
          create: { itemId: p.itemId, zipCode, ...data },
          update: data,
        });
      }),
    ),
};
