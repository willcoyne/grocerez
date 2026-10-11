import { prisma, type Db } from "../../db.js";
import { CATEGORIES } from "../../contracts/common.js";
import type { AddListItemBody, AllergenFlag, CheckListItemBody, ShoppingListItem } from "../../contracts/shoppingList.js";
import { conflict, notFound } from "../../lib/errors.js";
import { estimateExpiration, groupTimeZone } from "../../lib/expiration.js";
import { emitGroup } from "../../lib/realtime.js";
import { cabinetHooks } from "../cabinet/service.js";
import { lockGroup, regenerate, withRegeneration } from "./engine.js";
import { shoppingListRepo } from "./repo.js";

type Row = NonNullable<Awaited<ReturnType<typeof shoppingListRepo.find>>>;

const AISLE = new Map<string, number>(CATEGORIES.map((c, i) => [c, i]));
const aisle = (category: string | null) => AISLE.get(category ?? "other") ?? AISLE.get("other")!;

function toListItem(r: Row, names: Map<string, string>): ShoppingListItem {
  return {
    id: r.id,
    groupId: r.groupId,
    itemId: r.itemId,
    item: { id: r.item.id, name: r.item.name, category: r.item.category },
    reason: r.reason,
    wantedBy: r.wantedBy.map((userId) => ({ userId, displayName: names.get(userId) ?? "Former member" })),
    quantityText: r.quantityText,
    allergenFlags: (r.allergenFlags ?? []) as AllergenFlag[],
    checked: r.checked,
    checkedBy: r.checkedBy,
    checkedAt: r.checkedAt?.toISOString() ?? null,
    scannedProductId: r.scannedProductId,
    addedBy: r.addedBy,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** The list in store-aisle order (category), then name. */
async function readList(db: Db, groupId: string): Promise<ShoppingListItem[]> {
  const [rows, names] = await Promise.all([shoppingListRepo.list(db, groupId), shoppingListRepo.memberNames(db, groupId)]);
  rows.sort((a, b) => aisle(a.item.category) - aisle(b.item.category) || a.item.name.localeCompare(b.item.name));
  return rows.map((r) => toListItem(r, names));
}

async function readOne(db: Db, groupId: string, id: string) {
  const row = await shoppingListRepo.find(db, groupId, id);
  if (!row) throw notFound("List item");
  return toListItem(row, await shoppingListRepo.memberNames(db, groupId));
}

export const shoppingListService = {
  /**
   * generate(groupId): the one generation entry point (initial list / explicit regenerate). Runs the engine in a
   * transaction, emits shopping-list:changed if anything changed, and returns the list.
   * Other writes (preferences, cabinet, ran-out, finish trip) call the same engine inside their own transaction.
   */
  async generate(groupId: string, by: string | null): Promise<ShoppingListItem[]> {
    const changed = await prisma.$transaction((tx) => regenerate(tx, groupId));
    if (changed > 0) emitGroup(groupId, "shopping-list:changed", by);
    return readList(prisma, groupId);
  },

  list: (groupId: string) => readList(prisma, groupId),

  /** Manual add ("we're out of X"). Upsert with reason 'manual', then regenerate (fills wanted_by / allergen flags). */
  async addManual(groupId: string, userId: string, body: AddListItemBody): Promise<{ row: ShoppingListItem; created: boolean }> {
    if (!(await prisma.item.findUnique({ where: { id: body.itemId }, select: { id: true } }))) throw notFound("Item");
    const { result } = await withRegeneration(groupId, userId, ["shopping-list:changed"], async (tx) => {
      const before = await shoppingListRepo.findByItem(tx, groupId, body.itemId);
      const row = await shoppingListRepo.upsertManual(tx, groupId, body.itemId, userId, body.quantityText);
      return { id: row.id, created: !before };
    });
    return { row: await readOne(prisma, groupId, result.id), created: result.created };
  },

  /** Check / uncheck (the DB trigger stamps checked_at; unchecking clears checked_by/at) and link a scanned product. */
  async check(groupId: string, userId: string, id: string, body: CheckListItemBody): Promise<ShoppingListItem> {
    const row = await shoppingListRepo.find(prisma, groupId, id);
    if (!row) throw notFound("List item");
    if (body.scannedProductId) {
      const p = await prisma.product.findUnique({ where: { id: body.scannedProductId }, select: { id: true, itemId: true } });
      if (!p) throw notFound("Product");
      // DB-04: the database rejects a product of another catalog item (its allergens would replace this item's).
      if (p.itemId !== row.itemId) {
        throw conflict("The scanned product belongs to a different item than this list row", "PRODUCT_ITEM_MISMATCH");
      }
    }
    await withRegeneration(groupId, userId, ["shopping-list:changed"], (tx) =>
      shoppingListRepo.setChecked(tx, groupId, id, {
        checked: body.checked,
        checkedBy: body.checked ? userId : null,
        ...(body.scannedProductId !== undefined ? { scannedProductId: body.scannedProductId } : {}),
      }),
    );
    return readOne(prisma, groupId, id);
  },

  /** Only manual rows can be deleted; preference rows → 409 (remove the preference instead). */
  async remove(groupId: string, userId: string, id: string): Promise<void> {
    const row = await shoppingListRepo.find(prisma, groupId, id);
    if (!row) throw notFound("List item");
    if (row.reason !== "manual") {
      throw conflict("This item is on the list because of a preference; remove the preference instead", "PREFERENCE_ROW");
    }
    await withRegeneration(groupId, userId, ["shopping-list:changed"], (tx) => shoppingListRepo.delete(tx, groupId, id));
  },

  /**
   * Finish trip, ONE transaction: checked rows → cabinet (in_stock, purchased now, scanned product, estimated expiry);
   * delete one_time preferences for those items; delete the checked rows; regenerate.
   */
  async complete(groupId: string, userId: string): Promise<{ movedToCabinet: number }> {
    const now = new Date();
    const { moved, cabinetIds, prefsDeleted } = await prisma.$transaction(async (tx) => {
      await lockGroup(tx, groupId);
      const timeZone = await groupTimeZone(tx, groupId);
      const rows = await shoppingListRepo.checkedRows(tx, groupId);
      const cabinetIds: string[] = [];
      for (const r of rows) {
        const expiresAt = estimateExpiration(r.item, now, timeZone);
        const expiry = expiresAt
          ? { expiresAt, expirationSource: "estimated" as const }
          : { expiresAt: null, expirationSource: null };
        const c = await tx.cabinetItem.upsert({
          where: { groupId_itemId: { groupId, itemId: r.itemId } },
          create: {
            groupId, itemId: r.itemId, status: "in_stock", purchasedAt: now, productId: r.scannedProductId,
            quantityText: r.quantityText, addedBy: r.checkedBy ?? userId, ...expiry,
          },
          update: {
            status: "in_stock", purchasedAt: now, ...(r.scannedProductId ? { productId: r.scannedProductId } : {}),
            ...(r.quantityText ? { quantityText: r.quantityText } : {}), ...expiry,
          },
          select: { id: true },
        });
        cabinetIds.push(c.id);
      }
      const itemIds = rows.map((r) => r.itemId);
      const prefs = await tx.preference.deleteMany({ where: { groupId, itemId: { in: itemIds }, recurrence: "one_time" } });
      await tx.shoppingListItem.deleteMany({ where: { groupId, id: { in: rows.map((r) => r.id) } } });
      await regenerate(tx, groupId);
      return { moved: rows.length, cabinetIds, prefsDeleted: prefs.count };
    });
    if (moved > 0) {
      emitGroup(groupId, "cabinet:changed", userId);
      emitGroup(groupId, "shopping-list:changed", userId);
      if (prefsDeleted > 0) emitGroup(groupId, "preferences:changed", userId);
    }
    for (const id of cabinetIds) await cabinetHooks.afterAdd(groupId, id);
    return { movedToCabinet: moved };
  },
};
