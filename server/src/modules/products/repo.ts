import type { Prisma, Product as ProductRow } from "@prisma/client";
import { prisma } from "../../db.js";
import type { ProductData } from "./common.js";

export type { ProductRow };

// products is global (no groupId): a product scanned once is cached for every group (GAPS #10).
export const productsRepo = {
  byGtin: (gtin: string) => prisma.product.findUnique({ where: { gtin } }),
  byUrl: (smartlabelUrl: string) => prisma.product.findUnique({ where: { smartlabelUrl } }),

  /**
   * Insert or refresh the row for this product, keyed by gtin when known, otherwise by smartlabel_url.
   * A gtin-less row for the same QR URL (from an earlier scan that found no GTIN) is replaced, so the URL stays unique.
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
      if (data.gtin && smartlabelUrl) {
        await tx.product.deleteMany({ where: { smartlabelUrl, OR: [{ gtin: null }, { gtin: { not: data.gtin } }] } });
      }
      return tx.product.upsert({
        where: data.gtin ? { gtin: data.gtin } : { smartlabelUrl: smartlabelUrl! },
        create: { ...fields, gtin: data.gtin, smartlabelUrl, itemId },
        // Keep an existing smartlabel_url / item link when this scan didn't provide one.
        update: { ...fields, ...(smartlabelUrl && { smartlabelUrl }), ...(itemId && { itemId }) },
      });
    });
  },

  setImageKey: (id: string, imageS3Key: string) => prisma.product.update({ where: { id }, data: { imageS3Key } }),
};
