import type { Db, Tx } from "../../db.js";

export const listInclude = { item: { select: { id: true, name: true, category: true } } } as const;

/** Every function takes groupId and filters by it. */
export const shoppingListRepo = {
  list: (db: Db, groupId: string) => db.shoppingListItem.findMany({ where: { groupId }, include: listInclude }),

  find: (db: Db, groupId: string, id: string) =>
    db.shoppingListItem.findFirst({ where: { id, groupId }, include: listInclude }),

  findByItem: (db: Db, groupId: string, itemId: string) =>
    db.shoppingListItem.findUnique({ where: { groupId_itemId: { groupId, itemId } } }),

  memberNames: async (db: Db, groupId: string) => {
    const rows = await db.groupMember.findMany({
      where: { groupId },
      select: { user: { select: { id: true, displayName: true } } },
    });
    return new Map(rows.map((r) => [r.user.id, r.user.displayName]));
  },

  /** Manual add ("we're out of X"): upsert with reason 'manual'. */
  upsertManual: (db: Db, groupId: string, itemId: string, userId: string, quantityText: string | null | undefined) =>
    db.shoppingListItem.upsert({
      where: { groupId_itemId: { groupId, itemId } },
      create: { groupId, itemId, reason: "manual", quantityText: quantityText ?? null, addedBy: userId },
      update: { reason: "manual", ...(quantityText !== undefined ? { quantityText } : {}) },
      include: listInclude,
    }),

  /**
   * Pantry Agent apply (challenge 01): add rows as 'manual' with the agent's note and run id, in the caller's transaction.
   * An existing row (the caller already skipped unchecked ones) keeps its reason/checked state and only gets the note.
   * Regeneration never touches note / agent_run_id, and manual rows survive it.
   */
  upsertFromAgent: async (db: Db, groupId: string, userId: string, agentRunId: string, rows: { itemId: string; note: string }[]) => {
    const out: string[] = [];
    for (const { itemId, note } of rows) {
      const r = await db.shoppingListItem.upsert({
        where: { groupId_itemId: { groupId, itemId } },
        create: { groupId, itemId, reason: "manual", addedBy: userId, note, agentRunId },
        update: { note, agentRunId },
        select: { id: true },
      });
      out.push(r.id);
    }
    return out;
  },

  setChecked: (db: Db, groupId: string, id: string, data: { checked: boolean; checkedBy: string | null; scannedProductId?: string | null }) =>
    db.shoppingListItem.update({ where: { id, groupId }, data, include: listInclude }),

  delete: (db: Db, groupId: string, id: string) => db.shoppingListItem.delete({ where: { id, groupId } }),

  checkedRows: (tx: Tx, groupId: string) =>
    tx.shoppingListItem.findMany({
      where: { groupId, checked: true },
      include: { item: { select: { id: true, name: true, category: true, shelfLifeDays: true } } },
    }),
};
