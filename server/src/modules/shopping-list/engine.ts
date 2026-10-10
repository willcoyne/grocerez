import type { Tx } from "../../db.js";

/**
 * THE list generation step (backend/06 step 1.1–1.5), run inside the caller's transaction:
 * needed = (∪ member preferences) − (cabinet rows with status 'in_stock'); upserts needed rows (reason 'preference',
 * wanted_by, combined quantity_text, allergen_flags) without touching `checked`; deletes unchecked 'preference'
 * rows that are no longer needed; keeps manual and checked rows (refreshing their wanted_by / flags).
 *
 * Implemented by the SQL function generate_shopping_list() (database/07), which takes a per-group advisory
 * lock and only writes rows whose values changed. Returns the number of rows changed (0 = already up to date).
 * Callers emit `shopping-list:changed` after commit (see service.generate()).
 */
export async function regenerate(tx: Tx, groupId: string): Promise<number> {
  const [row] = await tx.$queryRaw<{ n: number }[]>`SELECT generate_shopping_list(${groupId}::uuid) AS n`;
  return Number(row?.n ?? 0);
}
