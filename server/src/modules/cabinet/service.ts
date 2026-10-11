import { prisma } from "../../db.js";
import type { AddCabinetBody, CabinetItem, UpdateCabinetBody } from "../../contracts/cabinet.js";
import { estimateExpiration, fromCalendarDate, groupTimeZone, toCalendarDate } from "../../lib/expiration.js";
import { uploadKeyPattern } from "../../contracts/uploads.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { images } from "../../lib/images.js";
import { emitGroup } from "../../lib/realtime.js";
import { withRegeneration } from "../shopping-list/engine.js";
import { cabinetRepo } from "./repo.js";

type Row = NonNullable<Awaited<ReturnType<typeof cabinetRepo.find>>>;

export async function toCabinetItem(c: Row): Promise<CabinetItem> {
  return {
    id: c.id,
    groupId: c.groupId,
    itemId: c.itemId,
    item: { id: c.item.id, name: c.item.name, category: c.item.category },
    product: c.product
      ? { id: c.product.id, brand: c.product.brand, name: c.product.name, imageUrl: await images.urlFor(c.product.imageS3Key) }
      : null,
    status: c.status,
    quantityText: c.quantityText,
    location: c.location as CabinetItem["location"],
    purchasedAt: c.purchasedAt?.toISOString() ?? null,
    expiresAt: toCalendarDate(c.expiresAt),
    expirationSource: c.expirationSource,
    photoUrl: await images.urlFor(c.photoS3Key),
    addedBy: c.addedBy,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/** Hook for recall matching (09): called after an item is added to a cabinet. Set by the recalls module. */
export const cabinetHooks = {
  afterAdd: async (_groupId: string, _cabinetItemId: string): Promise<void> => {},
};

export const cabinetService = {
  async list(groupId: string, filter: { location?: string; status?: "in_stock" | "running_low" }): Promise<CabinetItem[]> {
    return Promise.all((await cabinetRepo.list(prisma, groupId, filter)).map(toCabinetItem));
  },

  /**
   * Manual "map out the cabinet": upsert on (group, item), status in_stock. Missing expiresAt → estimate
   * (expiration_source 'estimated'), unless the existing row already has a date. Regenerates the list.
   */
  async add(groupId: string, userId: string, body: AddCabinetBody): Promise<{ row: CabinetItem; created: boolean }> {
    const item = await prisma.item.findUnique({ where: { id: body.itemId } });
    if (!item) throw notFound("Item");
    const timeZone = await groupTimeZone(prisma, groupId);
    const { result } = await withRegeneration(groupId, userId, ["cabinet:changed"], async (tx) => {
      const existing = await cabinetRepo.findByItem(tx, groupId, body.itemId);
      const expiry = body.expiresAt
        ? { expiresAt: fromCalendarDate(body.expiresAt), expirationSource: "manual" as const }
        : existing?.expiresAt
          ? {}
          : (() => {
              const d = estimateExpiration(item, new Date(), timeZone);
              return d ? { expiresAt: d, expirationSource: "estimated" as const } : {};
            })();
      const row = existing
        ? await cabinetRepo.update(tx, groupId, existing.id, {
            status: "in_stock",
            ...(body.location !== undefined ? { location: body.location } : {}),
            ...(body.quantityText !== undefined ? { quantityText: body.quantityText } : {}),
            ...expiry,
          })
        : await cabinetRepo.create(tx, {
            groupId,
            itemId: body.itemId,
            status: "in_stock",
            location: body.location ?? null,
            quantityText: body.quantityText ?? null,
            addedBy: userId,
            ...expiry,
          });
      return { row, created: !existing };
    });
    await cabinetHooks.afterAdd(groupId, result.row.id);
    return { row: await toCabinetItem(result.row), created: result.created };
  },

  /** running_low ↔ in_stock regenerates the list; a hand-set expiresAt becomes 'manual'; null clears it. */
  async update(groupId: string, userId: string, id: string, body: UpdateCabinetBody): Promise<CabinetItem> {
    if (!(await cabinetRepo.find(prisma, groupId, id))) throw notFound("Cabinet item");
    if (body.photoKey && !uploadKeyPattern("item-photo", userId).test(body.photoKey)) {
      throw badRequest("photoKey must be a key from POST /uploads/presign (purpose item-photo)", "INVALID_UPLOAD_KEY");
    }
    const { result } = await withRegeneration(groupId, userId, ["cabinet:changed"], (tx) =>
      cabinetRepo.update(tx, groupId, id, {
        ...(body.photoKey !== undefined ? { photoS3Key: body.photoKey } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.location !== undefined ? { location: body.location } : {}),
        ...(body.quantityText !== undefined ? { quantityText: body.quantityText } : {}),
        ...(body.expiresAt === null
          ? { expiresAt: null, expirationSource: null }
          : body.expiresAt !== undefined
            ? { expiresAt: fromCalendarDate(body.expiresAt), expirationSource: "manual" }
            : {}),
      }),
    );
    return toCabinetItem(result);
  },

  /** Ran out: delete the row; if anyone wants the item it comes back on the list (reason 'preference'). One transaction. */
  async ranOut(groupId: string, userId: string, id: string): Promise<{ requeued: boolean }> {
    const row = await cabinetRepo.find(prisma, groupId, id);
    if (!row) throw notFound("Cabinet item");
    const { result } = await withRegeneration(groupId, userId, ["cabinet:changed"], async (tx) => {
      await cabinetRepo.delete(tx, groupId, id);
      return cabinetRepo.isPreferred(tx, groupId, row.itemId);
    });
    return { requeued: result };
  },

  /** Removes the item without running it out (thrown away). Does not regenerate, so it isn't re-added right now. */
  async remove(groupId: string, userId: string, id: string): Promise<void> {
    if (!(await cabinetRepo.find(prisma, groupId, id))) throw notFound("Cabinet item");
    await cabinetRepo.delete(prisma, groupId, id);
    emitGroup(groupId, "cabinet:changed", userId);
  },
};
