import type { Prisma, Product as ProductRow } from "@prisma/client";
import { prisma } from "../../db.js";
import { CACHE_MS, type Allergen, type ProductData } from "./common.js";

export type { ProductRow };

// products is global (no groupId): a product scanned once is cached for every group (GAPS #10).
export const productsRepo = {
  byGtin: (gtin: string) => prisma.product.findUnique({ where: { gtin } }),
  byUrl: (smartlabelUrl: string) => prisma.product.findUnique({ where: { smartlabelUrl } }),

  /**
   * Insert or refresh the row for this product. The row is found by gtin first, then by smartlabel_url.
   * - A row still fresh (another scan within 30 days) is only enriched: empty fields filled, allergens/may_contain unioned.
   *   A heuristic label parse must not erase what a barcode scan cached for every household (M3-01).
   * - When the URL row and the GTIN row are different rows, the URL row is folded into the GTIN row: cabinet and list
   *   references are re-pointed first, so no household loses its product link (M3-02). Rows are never deleted otherwise.
   */
  save: (data: ProductData, smartlabelUrl: string | null, itemId: string | null, raw: unknown) => {
    const fields = {
      source: data.source,
      name: data.name,
      brand: data.brand,
      servingSize: data.servingSize,
      caloriesPerServing: data.caloriesPerServing,
      nutrition: data.nutrition,
      ingredients: data.ingredients,
      allergens: data.allergens,
      mayContain: data.mayContain,
      healthScore: data.healthScore,
      raw: raw as Prisma.InputJsonValue,
      fetchedAt: new Date(),
    };
    return prisma.$transaction(async (tx) => {
      const byGtin = data.gtin ? await tx.product.findUnique({ where: { gtin: data.gtin } }) : null;
      const byUrl = smartlabelUrl ? await tx.product.findUnique({ where: { smartlabelUrl } }) : null;
      const keep = byGtin ?? byUrl;
      if (!keep) {
        // Native INSERT ... ON CONFLICT: a concurrent first scan of the same code refreshes the winner's row.
        return tx.product.upsert({
          where: data.gtin ? { gtin: data.gtin } : { smartlabelUrl: smartlabelUrl! },
          create: { ...fields, gtin: data.gtin, smartlabelUrl, itemId },
          update: { ...fields, ...(smartlabelUrl && { smartlabelUrl }), ...(itemId && { itemId }) },
        });
      }
      if (byUrl && byUrl.id !== keep.id) {
        await tx.cabinetItem.updateMany({ where: { productId: byUrl.id }, data: { productId: keep.id } });
        await tx.shoppingListItem.updateMany({ where: { scannedProductId: byUrl.id }, data: { scannedProductId: keep.id } });
        await tx.product.delete({ where: { id: byUrl.id } });
      }
      const fresh = Date.now() - keep.fetchedAt.getTime() < CACHE_MS;
      const union = (a: Allergen[], b: Allergen[]) => [...new Set([...a, ...b])];
      const update = fresh
        ? {
            ...Object.fromEntries(Object.entries(fields).filter(([k]) => keep[k as keyof typeof keep] == null)),
            allergens: union(keep.allergens, data.allergens),
            mayContain: union(keep.mayContain, data.mayContain),
          }
        : fields;
      return tx.product.update({
        where: { id: keep.id },
        data: {
          ...update,
          gtin: data.gtin ?? keep.gtin,
          ...(smartlabelUrl && { smartlabelUrl }),
          itemId: keep.itemId ?? byUrl?.itemId ?? itemId,
        },
      });
    });
  },

  setImageKey: (id: string, imageS3Key: string) => prisma.product.update({ where: { id }, data: { imageS3Key } }),
};
