import { prisma } from "../../db.js";
import type { CreatePreferenceBody, Preference, UpdatePreferenceBody } from "../../contracts/preferences.js";
import { forbidden, notFound } from "../../lib/errors.js";
import { toItem } from "../items/repo.js";
import { withRegeneration } from "../shopping-list/engine.js";
import { preferencesRepo } from "./repo.js";

type Row = NonNullable<Awaited<ReturnType<typeof preferencesRepo.find>>>;

export const toPreference = (p: Row): Preference => ({
  id: p.id,
  groupId: p.groupId,
  userId: p.userId,
  itemId: p.itemId,
  item: toItem(p.item),
  user: { id: p.user.id, displayName: p.user.displayName },
  quantityText: p.quantityText,
  recurrence: p.recurrence,
  note: p.note,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

/** Loads a preference in this group and checks it's the caller's own row (404 if not in the group, 403 if someone else's). */
async function ownRow(groupId: string, userId: string, id: string) {
  const row = await preferencesRepo.find(prisma, groupId, id);
  if (!row) throw notFound("Preference");
  if (row.userId !== userId) throw forbidden("You can only change your own preferences");
  return row;
}

export const preferencesService = {
  async list(groupId: string, userId: string, scope: "me" | "all"): Promise<Preference[]> {
    const rows = await preferencesRepo.list(prisma, groupId, scope === "me" ? userId : undefined);
    return rows.map(toPreference);
  },

  /** Create or update on (group, user, item), then regenerate the list (same transaction). */
  async upsert(groupId: string, userId: string, body: CreatePreferenceBody): Promise<{ pref: Preference; created: boolean }> {
    const item = await prisma.item.findUnique({ where: { id: body.itemId }, select: { id: true } });
    if (!item) throw notFound("Item");
    const { result } = await withRegeneration(groupId, userId, ["preferences:changed"], async (tx) => {
      const before = await tx.preference.findUnique({
        where: { groupId_userId_itemId: { groupId, userId, itemId: body.itemId } },
        select: { id: true },
      });
      const row = await preferencesRepo.upsert(tx, groupId, userId, body.itemId, {
        quantityText: body.quantityText,
        recurrence: body.recurrence,
        note: body.note,
      });
      return { pref: toPreference(row), created: !before };
    });
    return result;
  },

  async update(groupId: string, userId: string, id: string, body: UpdatePreferenceBody): Promise<Preference> {
    await ownRow(groupId, userId, id);
    const { result } = await withRegeneration(groupId, userId, ["preferences:changed"], async (tx) =>
      toPreference(await preferencesRepo.update(tx, groupId, id, body)),
    );
    return result;
  },

  async remove(groupId: string, userId: string, id: string): Promise<void> {
    await ownRow(groupId, userId, id);
    await withRegeneration(groupId, userId, ["preferences:changed"], (tx) => preferencesRepo.delete(tx, groupId, id));
  },
};
