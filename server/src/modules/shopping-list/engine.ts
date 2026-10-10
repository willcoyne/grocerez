import { prisma, type Tx } from "../../db.js";
import { emitGroup, type GroupEvent } from "../../lib/realtime.js";

/**
 * THE list generation step (backend/06 step 1.1–1.5), run inside the caller's transaction:
 * needed = (∪ member preferences) − (cabinet rows with status 'in_stock'); upserts needed rows (reason 'preference',
 * wanted_by, combined quantity_text, allergen_flags) without touching `checked`; deletes unchecked 'preference'
 * rows that are no longer needed; keeps manual and checked rows (refreshing their wanted_by / flags).
 *
 * Implemented by the SQL function generate_shopping_list() (database/07), which takes a per-group advisory
 * lock and only writes rows whose values changed. Returns the number of rows changed (0 = already up to date).
 * Callers emit `shopping-list:changed` after commit (see withRegeneration / shoppingListService.generate).
 */
/**
 * Takes the same per-group transaction advisory lock generate_shopping_list() takes (re-entrant within a transaction).
 * Every transaction that writes list-related rows AND regenerates must call this FIRST: otherwise two concurrent
 * transactions can each hold a row lock the other's generation needs (its INSERT … ON CONFLICT locks every
 * conflicting row) while waiting for the advisory lock → deadlock.
 * Lock several groups in sorted order (lockGroups) to avoid lock-order deadlocks.
 */
export async function lockGroup(tx: Tx, groupId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('generate_shopping_list:' || ${groupId}::text, 0))`;
}

export async function lockGroups(tx: Tx, groupIds: string[]): Promise<void> {
  for (const id of [...new Set(groupIds)].sort()) await lockGroup(tx, id);
}

export async function regenerate(tx: Tx, groupId: string): Promise<number> {
  const [row] = await tx.$queryRaw<{ n: number }[]>`SELECT generate_shopping_list(${groupId}::uuid) AS n`;
  return Number(row?.n ?? 0);
}

/**
 * Runs `fn` and then regenerate(groupId) in ONE transaction. After commit, emits `events` and, if the list
 * changed, `shopping-list:changed`. Every write that can change the list goes through here.
 */
export async function withRegeneration<T>(
  groupId: string,
  by: string,
  events: GroupEvent[],
  fn: (tx: Tx) => Promise<T>,
): Promise<{ result: T; listChanged: number }> {
  const out = await prisma.$transaction(async (tx) => {
    await lockGroup(tx, groupId);
    const result = await fn(tx);
    const listChanged = await regenerate(tx, groupId);
    return { result, listChanged };
  });
  for (const e of events) emitGroup(groupId, e, by);
  if (out.listChanged > 0 && !events.includes("shopping-list:changed")) emitGroup(groupId, "shopping-list:changed", by);
  return out;
}
