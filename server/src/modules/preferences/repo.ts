import type { Db } from "../../db.js";
import type { Recurrence } from "../../../generated/prisma/client.js";

export const prefInclude = {
  item: true,
  user: { select: { id: true, displayName: true } },
} as const;

/** Every function takes groupId and filters by it. */
export const preferencesRepo = {
  list: (db: Db, groupId: string, userId?: string) =>
    db.preference.findMany({
      where: { groupId, ...(userId ? { userId } : {}) },
      include: prefInclude,
      orderBy: [{ item: { name: "asc" } }, { createdAt: "asc" }],
    }),

  find: (db: Db, groupId: string, id: string) =>
    db.preference.findFirst({ where: { id, groupId }, include: prefInclude }),

  upsert: (
    db: Db,
    groupId: string,
    userId: string,
    itemId: string,
    data: { quantityText?: string | null; recurrence?: Recurrence; note?: string | null },
  ) =>
    db.preference.upsert({
      where: { groupId_userId_itemId: { groupId, userId, itemId } },
      create: { groupId, userId, itemId, ...data },
      update: data,
      include: prefInclude,
    }),

  update: (
    db: Db,
    groupId: string,
    id: string,
    data: { quantityText?: string | null; recurrence?: Recurrence; note?: string | null },
  ) => db.preference.update({ where: { id, groupId }, data, include: prefInclude }),

  delete: (db: Db, groupId: string, id: string) => db.preference.delete({ where: { id, groupId } }),
};
