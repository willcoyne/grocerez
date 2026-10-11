import { prisma } from "../../db.js";
import type { PricesResponse } from "../../contracts/ai.js";
import { embeddingsConfigured } from "../../lib/embeddings.js";
import { badRequest, notConfigured } from "../../lib/errors.js";
import { zipRegion } from "../../lib/productData.js";
import { estimatePrices, PRICE_MODEL_LABEL } from "./prices.js";
import { aiRepo } from "./repo.js";

const PRICE_TTL_MS = 24 * 3600 * 1000;

export const aiService = {
  /**
   * POST /shopping-list/prices. ZIP = body, else the user's profile, else 400. Cached rows (< 24 h, including prices
   * the product lookup found) are reused; the rest are priced by Akamai hackathon-chat against BLS regional averages
   * for the ZIP's census region (modules/ai/prices.ts), validated, and upserted into price_estimates.
   */
  async prices(groupId: string, userId: string, zipBody?: string): Promise<PricesResponse> {
    const zipCode = zipBody ?? (await prisma.user.findUnique({ where: { id: userId }, select: { zipCode: true } }))?.zipCode;
    if (!zipCode) throw badRequest("Set a ZIP code in your profile (or send zipCode) to estimate prices", "ZIP_REQUIRED");

    const listItems = await aiRepo.listItems(groupId);
    if (listItems.length === 0) return { zipCode, items: [], missingItemIds: [], totalLowCents: 0, totalHighCents: 0 };
    const ids = listItems.map((i) => i.id);
    const cached = await aiRepo.cachedPrices(ids, zipCode, new Date(Date.now() - PRICE_TTL_MS));
    const cachedIds = new Set(cached.map((c) => c.itemId));
    const todo = listItems.filter((i) => !cachedIds.has(i.id));

    const fresh: typeof cached = [];
    if (todo.length) {
      if (!embeddingsConfigured()) throw notConfigured("Price estimates (AKAMAI_API_KEY)");
      for (const p of await estimatePrices(todo, zipRegion(zipCode))) {
        fresh.push(await aiRepo.upsertPrice(p.itemId, zipCode, {
          lowCents: p.lowCents, highCents: p.highCents, typicalCents: p.typicalCents, unit: p.unit, sources: p.sources,
          model: PRICE_MODEL_LABEL(),
        }));
      }
    }

    const names = new Map(listItems.map((i) => [i.id, i.name]));
    const rows = [...cached.map((c) => ({ c, cached: true })), ...fresh.map((c) => ({ c, cached: false }))];
    const items = rows.map(({ c, cached }) => ({
      itemId: c.itemId,
      name: names.get(c.itemId) ?? "",
      lowCents: c.lowCents,
      highCents: c.highCents,
      typicalCents: c.typicalCents,
      unit: c.unit,
      sources: Array.isArray(c.sources) ? (c.sources as string[]) : [],
      basis: (Array.isArray(c.sources) && c.sources.length ? "regional_average" : "ai_estimate") as "regional_average" | "ai_estimate",
      estimate: true as const,
      cached,
      fetchedAt: c.fetchedAt.toISOString(),
    }));
    const priced = new Set(items.map((i) => i.itemId));
    return {
      zipCode,
      items,
      missingItemIds: ids.filter((id) => !priced.has(id)),
      totalLowCents: items.reduce((s, i) => s + i.lowCents, 0),
      totalHighCents: items.reduce((s, i) => s + i.highCents, 0),
    };
  },
};
