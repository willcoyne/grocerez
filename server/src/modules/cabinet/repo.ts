import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import type { Item } from "../../contracts/items.js";
import type { CabinetQuery } from "../../contracts/cabinet.js";

type Db = Prisma.TransactionClient | typeof prisma;

const select = {
  id: true,
  groupId: true,
  productId: true,
  status: true,
  quantityText: true,
  location: true,
  purchasedAt: true,
  expiresAt: true,
  expirationSource: true,
  photoKey: true,
  addedBy: true,
  createdAt: true,
  updatedAt: true,
  item: { select: { id: true, name: true, category: true, defaultAllergens: true, shelfLifeDays: true } },
  product: { select: { brand: true, imageS3Key: true } },
} as const;
export type CabinetRow = Omit<Prisma.CabinetItemGetPayload<{ select: typeof select }>, "item"> & { item: Item };

export type CabinetWrite = {
  status?: "in_stock" | "running_low";
  quantityText?: string | null;
  location?: string | null;
  expiresAt?: Date | null;
  expirationSource?: "manual" | "estimated" | null;
  photoKey?: string | null;
  purchasedAt?: Date | null; // finish trip (backend/06)
  productId?: string | null;
};

// A row deleted/moved between our read and write (P2025) is reported as "not found".
const orNull = <T>(p: Promise<T>) =>
  p.catch((e) => {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") return null;
    throw e;
  });

// Every function is scoped by groupId.
export const cabinetRepo = {
  list: (groupId: string, { location, status }: CabinetQuery) =>
    prisma.cabinetItem.findMany({
      where: { groupId, location, status },
      orderBy: [{ expiresAt: { sort: "asc", nulls: "last" } }, { item: { name: "asc" } }],
      select,
    }) as Promise<CabinetRow[]>,

  find: (groupId: string, id: string, db: Db = prisma) =>
    db.cabinetItem.findFirst({ where: { id, groupId }, select }) as Promise<CabinetRow | null>,

  // One row per (group, item). Re-adding updates the row; expiry fields are only overwritten when given (create sets them).
  upsert: (groupId: string, itemId: string, addedBy: string, create: CabinetWrite, update: CabinetWrite, db: Db = prisma) =>
    db.cabinetItem.upsert({
      where: { groupId_itemId: { groupId, itemId } },
      create: { groupId, itemId, addedBy, ...create },
      update,
      select,
    }) as Promise<CabinetRow>,

  update: (groupId: string, id: string, data: CabinetWrite, db: Db = prisma) =>
    orNull(db.cabinetItem.update({ where: { id, groupId }, data, select })) as Promise<CabinetRow | null>,

  delete: (groupId: string, id: string, db: Db = prisma) =>
    orNull(db.cabinetItem.delete({ where: { id, groupId }, select: { itemId: true } })),

  // database/06 step 4: the "have" set list generation subtracts from preferences. running_low is not "have".
  haveItemIds: async (groupId: string, db: Db = prisma) =>
    (await db.cabinetItem.findMany({ where: { groupId, status: "in_stock" }, select: { itemId: true } })).map((r) => r.itemId),

  isWanted: async (groupId: string, itemId: string, db: Db = prisma) =>
    (await db.preference.count({ where: { groupId, itemId } })) > 0,
};
