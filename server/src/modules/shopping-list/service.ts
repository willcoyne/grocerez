import type { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import type { AddListItemBody, AllergenFlag, CheckListItemBody, ShoppingListItem } from "../../contracts/shoppingList.js";
import { AppError } from "../../lib/errors.js";
import { estimateExpiration } from "../../lib/expiration.js";
import { emitGroup } from "../../lib/realtime.js";
import { cabinetRepo } from "../cabinet/repo.js";
import { groupsRepo } from "../groups/repo.js";
import { itemsRepo } from "../items/repo.js";
import { recallsRepo } from "../recalls/repo.js";
import { listRepo } from "./repo.js";

type Tx = Prisma.TransactionClient;
const notFound = () => new AppError(404, "LIST_ITEM_NOT_FOUND", "Shopping list item not found");

/**
 * Every write that can change the list runs here: one transaction holding the group row lock (the same lock
 * groups/03 uses for membership), taken FIRST so list, cabinet, preference and membership writers serialize per
 * group in one lock order (no deadlocks, no double moves).
 */
export const inListTx = <T>(groupId: string, fn: (tx: Tx) => Promise<T>) =>
  prisma.$transaction(
    async (tx) => {
      await groupsRepo.lock(tx, groupId);
      return fn(tx);
    },
    { timeout: 15_000 },
  );

/** Pure set math (property-tested): needed = desired − have; drop unchecked preference rows no longer needed. */
export function setMath(
  desired: Iterable<string>,
  have: Iterable<string>,
  rows: { id: string; itemId: string; reason: "preference" | "manual"; checked: boolean }[],
) {
  const haveSet = new Set(have);
  const needed = new Set([...desired].filter((i) => !haveSet.has(i)));
  const remove = rows.filter((r) => r.reason === "preference" && !r.checked && !needed.has(r.itemId));
  const existing = new Set(rows.map((r) => r.itemId));
  const create = [...needed].filter((i) => !existing.has(i));
  return { needed, remove, create };
}

/**
 * THE list generator (backend/06 step 1), used by every caller: list = needed ∪ manual rows ∪ checked rows.
 * Runs inside the caller's transaction; callers emit shopping-list:changed after commit.
 * Idempotent: a second run writes nothing.
 */
export async function generate(groupId: string, tx: Tx): Promise<void> {
  await groupsRepo.lock(tx, groupId); // no-op when the caller already holds it (inListTx)
  const prefs = await listRepo.preferences(tx, groupId);
  const have = await cabinetRepo.haveItemIds(groupId, tx);
  const members = await listRepo.members(tx, groupId);
  const rows = await listRepo.rows(tx, groupId);

  const desired = new Map<string, { wantedBy: string[]; quantities: string[] }>();
  for (const p of prefs) {
    const d = desired.get(p.itemId) ?? { wantedBy: [], quantities: [] };
    d.wantedBy.push(p.userId);
    if (p.quantityText && !d.quantities.includes(p.quantityText)) d.quantities.push(p.quantityText);
    desired.set(p.itemId, d);
  }
  const { remove, create } = setMath(desired.keys(), have, rows);
  const removed = new Set(remove.map((r) => r.id));
  const kept = rows.filter((r) => !removed.has(r.id));

  const allergens = await listRepo.itemAllergens(tx, [...create, ...kept.map((r) => r.itemId)]);
  // A scanned row is flagged by the catalog item's allergens ∪ the product's allergens ∪ may_contain. Deviates from
  // backend/06 step 1.3 (product only): OFF often has no allergen data, and "no data" must not clear a flag (M3-10).
  const scanned = new Map(kept.flatMap((r) => (r.scannedProduct ? [[r.itemId, [...r.scannedProduct.allergens, ...r.scannedProduct.mayContain] as string[]]] : [])));
  const flags = (itemId: string): AllergenFlag[] => {
    const has = [...(allergens.get(itemId) ?? []), ...(scanned.get(itemId) ?? [])];
    return members.flatMap((m) =>
      m.allergens.filter((a) => has.includes(a)).map((allergen) => ({ userId: m.id, displayName: m.displayName, allergen })),
    );
  };
  const target = (itemId: string) => ({
    wantedBy: desired.get(itemId)?.wantedBy ?? [],
    quantityText: desired.get(itemId)?.quantities.join(", ") || null,
    allergenFlags: flags(itemId),
  });

  // `checked: false` is re-evaluated by Postgres at delete time (READ COMMITTED), so a lock-free check-off that commits
  // after our read above is never deleted.
  if (remove.length) await tx.shoppingListItem.deleteMany({ where: { groupId, id: { in: [...removed] }, checked: false } });
  if (create.length) {
    await tx.shoppingListItem.createMany({
      data: create.map((itemId) => ({ groupId, itemId, reason: "preference" as const, ...target(itemId) })),
    });
  }
  // Existing rows keep reason / checked state; manual rows keep their own quantity.
  for (const r of kept) {
    const t = target(r.itemId);
    const next = { wantedBy: t.wantedBy, allergenFlags: t.allergenFlags, quantityText: r.reason === "preference" ? t.quantityText : r.quantityText };
    const cur = {
      wantedBy: r.wantedBy,
      allergenFlags: (r.allergenFlags as AllergenFlag[]).map(({ userId, displayName, allergen }) => ({ userId, displayName, allergen })),
      quantityText: r.quantityText,
    };
    if (JSON.stringify(next) !== JSON.stringify(cur)) await listRepo.update(groupId, r.id, next, tx);
  }
}

const changed = (groupId: string, by: string) => emitGroup(groupId, "shopping-list:changed", by);

export const list = (groupId: string) => listRepo.load(prisma, groupId);

export async function regenerateNow(groupId: string, userId: string): Promise<ShoppingListItem[]> {
  const rows = await inListTx(groupId, async (tx) => {
    await generate(groupId, tx);
    return listRepo.load(tx, groupId);
  });
  changed(groupId, userId);
  return rows;
}

// "We're out of X": a manual row survives regeneration. Re-adding an item already listed makes it manual.
export async function addManual(groupId: string, userId: string, { itemId, quantityText }: AddListItemBody): Promise<ShoppingListItem> {
  if (!(await itemsRepo.find(itemId))) throw new AppError(404, "ITEM_NOT_FOUND", "Item not found");
  const row = await inListTx(groupId, async (tx) => {
    const { id } = await listRepo.upsertManual(tx, groupId, itemId, userId, quantityText);
    await generate(groupId, tx); // allergen flags + wantedBy
    return (await listRepo.load(tx, groupId, id))[0];
  });
  changed(groupId, userId);
  return row;
}

// Saved immediately; last write wins per row. Un-checking clears who/when and the scanned product.
export async function check(groupId: string, id: string, userId: string, body: CheckListItemBody): Promise<ShoppingListItem> {
  if (body.scannedProductId) {
    const product = await prisma.product.findUnique({ where: { id: body.scannedProductId }, select: { itemId: true } });
    if (!product) throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found");
    // A product linked to another catalog item is a different thing (M3-11). Unlinked products are accepted.
    if (product.itemId) {
      const row = await prisma.shoppingListItem.findFirst({ where: { id, groupId }, select: { itemId: true } });
      if (!row) throw notFound();
      if (row.itemId !== product.itemId) throw new AppError(400, "PRODUCT_ITEM_MISMATCH", "This product is not the list item");
    }
  }
  const data = body.checked
    ? { checked: true, checkedBy: userId, checkedAt: new Date(), ...(body.scannedProductId !== undefined && { scannedProductId: body.scannedProductId }) }
    : { checked: false, checkedBy: null, checkedAt: null, scannedProductId: body.scannedProductId ?? null };
  // The scanned product changes the row's allergen flags, so that case regenerates under the group lock.
  // A plain check-off stays a lock-free single-row update.
  const productChanged = body.scannedProductId !== undefined || !body.checked;
  const ok = productChanged
    ? await inListTx(groupId, async (tx) => {
        const row = await listRepo.update(groupId, id, data, tx);
        if (row) await generate(groupId, tx);
        return row;
      })
    : await listRepo.update(groupId, id, data);
  if (!ok) throw notFound();
  changed(groupId, userId);
  const [row] = await listRepo.load(prisma, groupId, id);
  if (!row) throw notFound(); // finished/deleted in between
  return row;
}

// Manual rows (and orphaned preference rows nobody wants anymore) can be deleted; a wanted preference row is 409.
export async function remove(groupId: string, id: string, userId: string) {
  await inListTx(groupId, async (tx) => {
    const row = await listRepo.find(tx, groupId, id);
    if (!row) throw notFound();
    if (row.reason === "preference" && (await cabinetRepo.isWanted(groupId, row.itemId, tx))) {
      throw new AppError(409, "LIST_ITEM_IS_PREFERENCE", "This item is on the list because someone wants it; remove the preference instead");
    }
    await tx.shoppingListItem.delete({ where: { id } });
    await generate(groupId, tx); // a manual row for an item someone wants comes back as a preference row
  });
  changed(groupId, userId);
}

/** Finish trip (step 6): one transaction under the group lock, so two concurrent completes can't move an item twice. */
export async function complete(groupId: string, userId: string): Promise<{ movedToCabinet: number }> {
  const moved = await inListTx(groupId, async (tx) => {
    const checked = await listRepo.lockChecked(tx, groupId);
    if (!checked.length) return 0;
    const now = new Date();
    const cabinetIds: string[] = [];
    for (const r of checked) {
      const expiresAt = estimateExpiration(r.item, now);
      const write = {
        status: "in_stock" as const,
        purchasedAt: now,
        expiresAt,
        expirationSource: expiresAt ? ("estimated" as const) : null,
        ...(r.scannedProductId && { productId: r.scannedProductId }), // an unscanned re-buy keeps the known product
      };
      cabinetIds.push((await cabinetRepo.upsert(groupId, r.itemId, userId, write, write, tx)).id);
    }
    await recallsRepo.match({ cabinetItemIds: cabinetIds }, tx); // backend/09: bought items are cabinet adds too
    const itemIds = checked.map((r) => r.itemId);
    await tx.preference.deleteMany({ where: { groupId, itemId: { in: itemIds }, recurrence: "one_time" } });
    await tx.shoppingListItem.deleteMany({ where: { groupId, id: { in: checked.map((r) => r.id) } } });
    await generate(groupId, tx);
    return checked.length;
  });
  if (moved) {
    emitGroup(groupId, "cabinet:changed", userId);
    emitGroup(groupId, "preferences:changed", userId); // one_time preferences may be gone
    changed(groupId, userId);
  }
  return { movedToCabinet: moved };
}
