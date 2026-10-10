import type { CabinetItem, Member, Preference } from '@contracts/models';

import { namesFor } from '@/lib/format';

export type WantRow = {
  itemId: string;
  name: string;
  /** "Carson, Maya" / "you, Will" */
  wantedBy: string;
  inCabinet: boolean;
};

/**
 * Groups every member's preferences by item (first-appearance order) and joins them with the
 * cabinet: an item counts as "In cabinet" only when it's there with status in_stock.
 */
export function buildWants(
  prefs: Preference[],
  cabinet: CabinetItem[],
  members: Pick<Member, 'id' | 'displayName'>[],
  meId: string | undefined,
): WantRow[] {
  const inStock = new Set(cabinet.filter((c) => c.status === 'in_stock').map((c) => c.itemId));
  const byItem = new Map<string, { name: string; userIds: string[] }>();
  for (const p of prefs) {
    const entry = byItem.get(p.itemId) ?? { name: p.item.name, userIds: [] };
    if (!entry.userIds.includes(p.userId)) entry.userIds.push(p.userId);
    byItem.set(p.itemId, entry);
  }
  return [...byItem].map(([itemId, { name, userIds }]) => ({
    itemId,
    name,
    wantedBy: namesFor(userIds, meId, members),
    inCabinet: inStock.has(itemId),
  }));
}
