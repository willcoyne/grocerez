import type { Db } from "../../db.js";
import type { Prisma } from "../../../generated/prisma/client.js";

export const cabinetInclude = {
  item: { select: { id: true, name: true, category: true, shelfLifeDays: true } },
  product: { select: { id: true, brand: true, name: true, imageS3Key: true } },
} as const;

/** Every function takes groupId and filters by it. */
export const cabinetRepo = {
  list: (db: Db, groupId: string, filter: { location?: string; status?: "in_stock" | "running_low" }) =>
    db.cabinetItem.findMany({
      where: { groupId, ...filter },
      include: cabinetInclude,
      orderBy: [{ expiresAt: { sort: "asc", nulls: "last" } }, { item: { name: "asc" } }],
    }),

  find: (db: Db, groupId: string, id: string) =>
    db.cabinetItem.findFirst({ where: { id, groupId }, include: cabinetInclude }),

  findByItem: (db: Db, groupId: string, itemId: string) =>
    db.cabinetItem.findUnique({ where: { groupId_itemId: { groupId, itemId } }, include: cabinetInclude }),

  create: (db: Db, data: Prisma.CabinetItemUncheckedCreateInput) =>
    db.cabinetItem.create({ data, include: cabinetInclude }),

  update: (db: Db, groupId: string, id: string, data: Prisma.CabinetItemUncheckedUpdateInput) =>
    db.cabinetItem.update({ where: { id, groupId }, data, include: cabinetInclude }),

  delete: (db: Db, groupId: string, id: string) => db.cabinetItem.delete({ where: { id, groupId } }),

  isPreferred: async (db: Db, groupId: string, itemId: string) =>
    (await db.preference.count({ where: { groupId, itemId } })) > 0,
};
