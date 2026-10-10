import type { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { orNull } from "../../lib/errors.js";
import type { Item } from "../../contracts/items.js";
import type { CreatePreferenceBody, Preference, UpdatePreferenceBody } from "../../contracts/preferences.js";

const select = {
  id: true,
  groupId: true,
  userId: true,
  quantityText: true,
  recurrence: true,
  note: true,
  createdAt: true,
  updatedAt: true,
  item: { select: { id: true, name: true, category: true, defaultAllergens: true, shelfLifeDays: true } },
  member: { select: { user: { select: { displayName: true } } } },
} as const;
type Db = Prisma.TransactionClient | typeof prisma;
type Row = Prisma.PreferenceGetPayload<{ select: typeof select }>;

const toPreference = ({ member: _, item, createdAt, updatedAt, ...p }: Row): Preference => ({
  ...p,
  item: item as Item,
  createdAt: createdAt.toISOString(),
  updatedAt: updatedAt.toISOString(),
});

// Every function is scoped by groupId.
export const preferencesRepo = {
  // userId null = every member's rows, each with wantedBy (all members wanting that item).
  list: async (groupId: string, userId: string | null): Promise<Preference[]> => {
    const rows = await prisma.preference.findMany({
      where: { groupId, ...(userId && { userId }) },
      orderBy: [{ item: { name: "asc" } }, { createdAt: "asc" }],
      select,
    });
    if (userId) return rows.map(toPreference);
    const names = new Map<string, string[]>();
    for (const r of rows) names.set(r.item.id, [...(names.get(r.item.id) ?? []), r.member.user.displayName]);
    return rows.map((r) => ({ ...toPreference(r), wantedBy: names.get(r.item.id) }));
  },

  owner: async (groupId: string, id: string): Promise<string | null> =>
    (await prisma.preference.findFirst({ where: { id, groupId }, select: { userId: true } }))?.userId ?? null,

  upsert: async (groupId: string, userId: string, { itemId, ...data }: CreatePreferenceBody, db: Db = prisma): Promise<Preference> =>
    toPreference(
      await db.preference.upsert({
        where: { groupId_userId_itemId: { groupId, userId, itemId } },
        create: { groupId, userId, itemId, ...data },
        update: data,
        select,
      }),
    ),

  // null = the row was deleted concurrently (another device, or finish trip removing a one_time row).
  update: async (groupId: string, id: string, data: UpdatePreferenceBody, db: Db = prisma): Promise<Preference | null> => {
    const row = await orNull(db.preference.update({ where: { id, groupId }, data, select }));
    return row && toPreference(row);
  },

  delete: (groupId: string, id: string, db: Db = prisma) => orNull(db.preference.delete({ where: { id, groupId } })),
};
