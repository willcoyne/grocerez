import type { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import type { CabinetItem, CabinetQuery, CreateCabinetBody, UpdateCabinetBody } from "../../contracts/cabinet.js";
import { AppError } from "../../lib/errors.js";
import { estimateExpiration } from "../../lib/expiration.js";
import { emitGroup } from "../../lib/realtime.js";
import { presignGet } from "../../lib/s3.js";
import { itemsRepo } from "../items/repo.js";
import { cabinetRepo, type CabinetRow, type CabinetWrite } from "./repo.js";

// ponytail: THE hook for backend/06. Replace the body with `await generate(groupId, tx)` (same transaction).
// Until 06 the list doesn't exist, so this is a no-op; callers already run it inside their transaction and emit
// shopping-list:changed after commit.
async function regenerate(_groupId: string, _tx: Prisma.TransactionClient): Promise<void> {}

const notFound = () => new AppError(404, "CABINET_ITEM_NOT_FOUND", "Cabinet item not found");
// A date set by hand (null clears it, and its source).
const manualExpiry = (d: string | null): CabinetWrite =>
  d ? { expiresAt: new Date(`${d}T00:00:00Z`), expirationSource: "manual" } : { expiresAt: null, expirationSource: null };

async function toCabinetItem({ photoKey, expiresAt, purchasedAt, createdAt, updatedAt, ...row }: CabinetRow): Promise<CabinetItem> {
  return {
    ...row,
    location: row.location as CabinetItem["location"], // CHECK-constrained
    expiresAt: expiresAt ? expiresAt.toISOString().slice(0, 10) : null,
    purchasedAt: purchasedAt?.toISOString() ?? null,
    photoUrl: photoKey ? await presignGet(photoKey) : null,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}

function emit(groupId: string, userId: string, regenerated: boolean) {
  emitGroup(groupId, "cabinet:changed", userId);
  if (regenerated) emitGroup(groupId, "shopping-list:changed", userId);
}

export const list = async (groupId: string, query: CabinetQuery) =>
  Promise.all((await cabinetRepo.list(groupId, query)).map(toCabinetItem));

// Manual "map out cabinet". Adding means we have it: status goes (back) to in_stock, so the list regenerates.
export async function add(groupId: string, userId: string, { itemId, expiresAt, ...body }: CreateCabinetBody): Promise<CabinetItem> {
  const item = await itemsRepo.find(itemId);
  if (!item) throw new AppError(404, "ITEM_NOT_FOUND", "Item not found");
  const est = estimateExpiration(item, new Date());
  const expiry: CabinetWrite =
    expiresAt === undefined ? { expiresAt: est, expirationSource: est ? "estimated" : null } : manualExpiry(expiresAt);
  const update: CabinetWrite = { ...body, status: "in_stock", ...(expiresAt !== undefined && expiry) };
  const row = await prisma.$transaction(async (tx) => {
    const row = await cabinetRepo.upsert(groupId, itemId, userId, { ...body, ...expiry }, update, tx);
    await regenerate(groupId, tx);
    return row;
  });
  emit(groupId, userId, true);
  return toCabinetItem(row);
}

export async function update(groupId: string, id: string, userId: string, body: UpdateCabinetBody): Promise<CabinetItem> {
  const { expiresAt, photoKey, ...rest } = body;
  // Exactly the shape /uploads/presign issues to this caller, so nobody can attach another user's object.
  const ownKey = new RegExp(`^item-photo/${userId}/[0-9a-f-]{36}\.(jpg|png|webp)$`);
  if (photoKey != null && !ownKey.test(photoKey)) {
    throw new AppError(400, "VALIDATION_ERROR", "photoKey must be an item-photo key issued to you by /uploads/presign");
  }
  const data: CabinetWrite = { ...rest, photoKey, ...(expiresAt !== undefined && manualExpiry(expiresAt)) };

  const regenerated = body.status !== undefined; // in_stock <-> running_low changes the "have" set
  const row = await prisma.$transaction(async (tx) => {
    const row = await cabinetRepo.update(groupId, id, data, tx);
    if (row && regenerated) await regenerate(groupId, tx);
    return row;
  });
  if (!row) throw notFound();
  emit(groupId, userId, regenerated);
  return toCabinetItem(row);
}

// Ran out: the row goes away. If anyone in the group still wants the item, regenerating puts it back on the list.
export async function ranOut(groupId: string, id: string, userId: string): Promise<{ requeued: boolean }> {
  const requeued = await prisma.$transaction(async (tx) => {
    const gone = await cabinetRepo.delete(groupId, id, tx);
    if (!gone) throw notFound();
    const wanted = await cabinetRepo.isWanted(groupId, gone.itemId, tx);
    if (wanted) await regenerate(groupId, tx);
    return wanted;
  });
  emit(groupId, userId, requeued);
  return { requeued };
}

// Thrown away etc.: removed without requeueing.
export async function remove(groupId: string, id: string, userId: string) {
  if (!(await cabinetRepo.delete(groupId, id))) throw notFound();
  emit(groupId, userId, false);
}
