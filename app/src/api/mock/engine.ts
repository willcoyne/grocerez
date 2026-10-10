import { categoryValues, type AllergenFlag, type Item } from '@contracts/models';

import { now, nextId, type MockDb } from './db';

// Shopping-list set math, a mirror of plan/backend/06-shopping-list-engine:
//   desired = ∪ members' preferences;  have = cabinet where status = in_stock
//   list    = (desired − have) ∪ manual rows ∪ checked rows

const aisleRank = new Map(categoryValues.map((c, i) => [c, i]));

/** Aisle order: category (store order), then name. */
export function sortByAisle<T extends { item: Item }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      (aisleRank.get(a.item.category) ?? 99) - (aisleRank.get(b.item.category) ?? 99) ||
      a.item.name.localeCompare(b.item.name),
  );
}

export function memberIds(db: MockDb, groupId: string): string[] {
  return db.members.filter((m) => m.groupId === groupId).map((m) => m.userId);
}

/** item_id → user IDs who want it, in preference creation order. */
export function desired(db: MockDb, groupId: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const prefs = db.preferences
    .filter((p) => p.groupId === groupId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const p of prefs) out.set(p.itemId, [...(out.get(p.itemId) ?? []), p.userId]);
  return out;
}

export function have(db: MockDb, groupId: string): Set<string> {
  return new Set(db.cabinet.filter((c) => c.groupId === groupId && c.status === 'in_stock').map((c) => c.itemId));
}

export function wantsItem(db: MockDb, groupId: string, itemId: string): boolean {
  return db.preferences.some((p) => p.groupId === groupId && p.itemId === itemId);
}

/** Item allergens ∩ each member's allergens, across all members (not only those who want it). */
export function allergenFlags(db: MockDb, groupId: string, itemId: string): AllergenFlag[] {
  const item = db.items.find((i) => i.id === itemId);
  if (!item) return [];
  const flags: AllergenFlag[] = [];
  for (const userId of memberIds(db, groupId)) {
    const user = db.users.find((u) => u.id === userId);
    if (!user) continue;
    for (const allergen of item.allergens) {
      if (user.allergens.includes(allergen)) flags.push({ userId, displayName: user.displayName, allergen });
    }
  }
  return flags;
}

/** Regenerates a group's list in place. Idempotent. */
export function generate(db: MockDb, groupId: string): void {
  const want = desired(db, groupId);
  const owned = have(db, groupId);
  const needed = new Map([...want].filter(([itemId]) => !owned.has(itemId)));

  // Drop preference rows that are no longer needed, unless someone already checked them.
  db.list = db.list.filter(
    (r) => r.groupId !== groupId || r.reason !== 'preference' || r.checked || needed.has(r.itemId),
  );

  for (const [itemId, wantedBy] of needed) {
    const row = db.list.find((r) => r.groupId === groupId && r.itemId === itemId);
    if (row) {
      row.reason = 'preference';
      row.wantedBy = wantedBy;
    } else {
      db.list.push({
        id: nextId(db, 'l'),
        groupId,
        itemId,
        reason: 'preference',
        wantedBy,
        quantityText: null,
        allergenFlags: [],
        checked: false,
        checkedBy: null,
        checkedAt: null,
        addedBy: null,
      });
    }
  }

  // Flags can change on any write (dietary, membership), so refresh them on every row.
  for (const row of db.list) {
    if (row.groupId === groupId) row.allergenFlags = allergenFlags(db, groupId, row.itemId);
  }
}

/** Finish trip: checked rows → cabinet in_stock, drop matching one_time prefs, delete checked rows. */
export function completeTrip(db: MockDb, groupId: string, userId: string): number {
  const checked = db.list.filter((r) => r.groupId === groupId && r.checked);
  const bought = new Set(checked.map((r) => r.itemId));
  const at = now(db);

  for (const itemId of bought) {
    const existing = db.cabinet.find((c) => c.groupId === groupId && c.itemId === itemId);
    if (existing) {
      existing.status = 'in_stock';
      existing.purchasedAt = at;
    } else {
      db.cabinet.push({
        id: nextId(db, 'c'),
        groupId,
        itemId,
        status: 'in_stock',
        quantityText: null,
        location: null,
        purchasedAt: at,
        expiresAt: null,
        expirationSource: null,
        addedBy: userId,
      });
    }
  }

  db.preferences = db.preferences.filter(
    (p) => !(p.groupId === groupId && p.recurrence === 'one_time' && bought.has(p.itemId)),
  );
  db.list = db.list.filter((r) => !(r.groupId === groupId && r.checked));
  generate(db, groupId);
  return checked.length;
}

/** Ran out: delete the cabinet row; requeued = anyone in the group wants the item. */
export function ranOut(db: MockDb, groupId: string, cabinetId: string): { requeued: boolean } | null {
  const row = db.cabinet.find((c) => c.groupId === groupId && c.id === cabinetId);
  if (!row) return null;
  db.cabinet = db.cabinet.filter((c) => c !== row);
  generate(db, groupId);
  return { requeued: wantsItem(db, groupId, row.itemId) };
}
