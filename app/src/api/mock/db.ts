import type { Allergen, Diet } from '@contracts/dietary';
import type { CabinetItem, Category, Invite, Item, Preference, Role, ShoppingListItem } from '@contracts/models';

import { generate } from './engine';
import { normalizeItemName } from './fuzzy';

// In-memory store + seed for mock mode (DESIGN.md §6.3). Rows mirror the DB tables in plan/database.

export type DbUser = {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  diets: Diet[];
  allergens: Allergen[];
};
export type DbGroup = { id: string; name: string; createdBy: string; createdAt: string };
export type DbMember = { groupId: string; userId: string; role: Role; joinedAt: string };
export type DbInvite = Omit<Invite, 'invitedBy'> & { invitedBy: string | null; respondedAt: string | null };
export type DbItem = Item & { normalized: string };
export type DbAlias = { itemId: string; aliasNormalized: string };
export type DbPreference = Omit<Preference, 'item'>;
export type DbCabinetItem = Omit<CabinetItem, 'item'>;
export type DbListRow = Omit<ShoppingListItem, 'item'>;

export type MockDb = {
  users: DbUser[];
  groups: DbGroup[];
  members: DbMember[];
  invites: DbInvite[];
  items: DbItem[];
  aliases: DbAlias[];
  preferences: DbPreference[];
  cabinet: DbCabinetItem[];
  list: DbListRow[];
  seq: number;
  clock: number; // ms; advances on every write so createdAt ordering is stable
};

const SEED_TIME = Date.parse('2026-10-10T12:00:00.000Z');

export function nextId(db: MockDb, prefix: string): string {
  db.seq += 1;
  return `${prefix}-${db.seq}`;
}

export function now(db: MockDb): string {
  db.clock += 1000;
  return new Date(db.clock).toISOString();
}

const catalog: [id: string, name: string, category: Category, allergens: Allergen[]][] = [
  ['i-cheerios', 'Cheerios', 'pantry', []],
  ['i-tostitos', 'Tostitos', 'snacks', []],
  ['i-lays', "Lay's", 'snacks', []],
  ['i-oreos', 'Oreos', 'snacks', ['wheat', 'soy']],
  ['i-milk', 'Milk', 'dairy', ['milk']],
  ['i-eggs', 'Eggs', 'dairy', ['eggs']],
  ['i-yogurt', 'Yogurt', 'dairy', ['milk']],
  ['i-bread', 'Bread', 'bakery', ['wheat']],
  ['i-peanut-butter', 'Peanut butter', 'pantry', ['peanuts']],
  ['i-pasta', 'Pasta', 'pantry', ['wheat']],
  ['i-rice', 'Rice', 'pantry', []],
  ['i-bananas', 'Bananas', 'produce', []],
  ['i-apples', 'Apples', 'produce', []],
  ['i-spinach', 'Spinach', 'produce', []],
  ['i-chicken', 'Chicken breast', 'meat', []],
  ['i-salmon', 'Salmon', 'meat', ['fish']],
  ['i-coffee', 'Coffee', 'beverages', []],
  ['i-paper-towels', 'Paper towels', 'household', []],
];

export const SEED = {
  groupId: 'g-hack',
  inviteId: 'inv-ian',
  users: { carson: 'u-carson', will: 'u-will', maya: 'u-maya', ian: 'u-ian' },
} as const;

export function createSeedDb(): MockDb {
  const db: MockDb = {
    users: [],
    groups: [],
    members: [],
    invites: [],
    items: [],
    aliases: [],
    preferences: [],
    cabinet: [],
    list: [],
    seq: 0,
    clock: SEED_TIME,
  };
  const { carson, will, maya, ian } = SEED.users;
  const gid = SEED.groupId;

  const user = (id: string, displayName: string, email: string, allergens: Allergen[] = []) =>
    db.users.push({ id, displayName, email, allergens, diets: [], createdAt: now(db) });
  user(carson, 'Carson', 'carson@example.com', ['peanuts']);
  user(will, 'Will', 'will@example.com');
  user(maya, 'Maya', 'maya@example.com', ['milk']);
  user(ian, 'Ian', 'you@example.com');

  for (const [id, name, category, allergens] of catalog) {
    db.items.push({ id, name, category, allergens, normalized: normalizeItemName(name) });
  }

  db.groups.push({ id: gid, name: 'Hack Midwest House', createdBy: carson, createdAt: now(db) });
  db.members.push(
    { groupId: gid, userId: carson, role: 'owner', joinedAt: now(db) },
    { groupId: gid, userId: will, role: 'member', joinedAt: now(db) },
    { groupId: gid, userId: maya, role: 'member', joinedAt: now(db) },
  );

  const pref = (userId: string, itemId: string) =>
    db.preferences.push({
      id: nextId(db, 'p'),
      groupId: gid,
      userId,
      itemId,
      quantityText: null,
      recurrence: 'staple',
      note: null,
      createdAt: now(db),
    });
  pref(carson, 'i-oreos');
  pref(carson, 'i-lays');
  pref(will, 'i-tostitos');
  pref(will, 'i-cheerios');
  pref(maya, 'i-lays');
  pref(maya, 'i-oreos');

  const shelf = (itemId: string, status: 'in_stock' | 'running_low') =>
    db.cabinet.push({
      id: nextId(db, 'c'),
      groupId: gid,
      itemId,
      status,
      quantityText: null,
      location: null,
      purchasedAt: now(db),
      expiresAt: null,
      expirationSource: null,
      addedBy: carson,
    });
  shelf('i-cheerios', 'in_stock');
  shelf('i-oreos', 'running_low');

  db.invites.push({
    id: SEED.inviteId,
    groupId: gid,
    email: 'you@example.com',
    status: 'pending',
    invitedBy: carson,
    createdAt: now(db),
    respondedAt: null,
  });

  generate(db, gid);
  return db;
}

// Seeded lazily: db.ts and engine.ts import each other, so nothing may run at module load.
let current: MockDb | null = null;

export function getMockDb(): MockDb {
  current ??= createSeedDb();
  return current;
}

/** Restores the seed. Tests call this in beforeEach. */
export function resetMockDb(): MockDb {
  current = createSeedDb();
  return current;
}
