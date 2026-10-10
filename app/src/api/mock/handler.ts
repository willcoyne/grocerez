import { AllergenSchema, DietSchema } from '@contracts/dietary';
import { CategorySchema, RecurrenceSchema, StockStatusSchema } from '@contracts/models';
import type {
  CabinetItem,
  Group,
  GroupDetail,
  Invite,
  Item,
  MyInvite,
  Preference,
  ShoppingListItem,
  User,
} from '@contracts/models';
import { isEmail } from '@/lib/format';
import { realtimeBus, type RealtimeEvent } from '@/realtime/bus';

import { ApiError } from '../errors';
import { getMockDb, nextId, now, SEED, type DbInvite, type MockDb } from './db';
import { completeTrip, generate, ranOut, sortByAisle } from './engine';
import { matchItem, normalizeItemName } from './fuzzy';

// Mock server implementing plan/backend/README.md for the MVP endpoints (DESIGN.md §6.2).
// Errors use the same envelope codes the backend will send.

const MOCK_TOKEN_PREFIX = 'mock-token:';
export const mockTokenFor = (userId: string) => `${MOCK_TOKEN_PREFIX}${userId}`;

type Req = { method: string; path: string; query: URLSearchParams; body: any; userId: string | null; db: MockDb };
type Route = { method: string; pattern: RegExp; auth: boolean; run: (req: Req, params: string[]) => unknown };

const notFound = (msg = 'Not found') => new ApiError(404, 'NOT_FOUND', msg);
const invalid = (msg: string) => new ApiError(400, 'VALIDATION_ERROR', msg);
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

const emit = (event: RealtimeEvent, groupId?: string, by?: string | null) =>
  realtimeBus.emit(event, { groupId, by: by ?? undefined });

// ---------- view builders ----------

function userView(db: MockDb, id: string): User {
  const u = db.users.find((x) => x.id === id);
  if (!u) throw notFound();
  return { id: u.id, email: u.email, displayName: u.displayName, avatarUrl: null, zipCode: null, createdAt: u.createdAt };
}

function itemView(db: MockDb, id: string): Item {
  const i = db.items.find((x) => x.id === id);
  if (!i) throw notFound('Item not found');
  return { id: i.id, name: i.name, category: i.category, allergens: i.allergens };
}

function groupView(db: MockDb, groupId: string, userId: string): Group {
  const g = db.groups.find((x) => x.id === groupId);
  const me = db.members.find((m) => m.groupId === groupId && m.userId === userId);
  if (!g || !me) throw notFound();
  const memberCount = db.members.filter((m) => m.groupId === groupId).length;
  return { id: g.id, name: g.name, role: me.role, memberCount, createdAt: g.createdAt };
}

function groupDetail(db: MockDb, groupId: string, userId: string): GroupDetail {
  const members = db.members
    .filter((m) => m.groupId === groupId)
    .map((m) => {
      const u = db.users.find((x) => x.id === m.userId)!;
      return { id: u.id, displayName: u.displayName, email: u.email, avatarUrl: null, role: m.role, allergens: u.allergens };
    });
  return { ...groupView(db, groupId, userId), members };
}

function inviteView(db: MockDb, inv: DbInvite): Invite {
  const by = inv.invitedBy ? db.users.find((u) => u.id === inv.invitedBy) : undefined;
  return {
    id: inv.id,
    groupId: inv.groupId,
    email: inv.email,
    status: inv.status,
    invitedBy: by ? { id: by.id, displayName: by.displayName } : null,
    createdAt: inv.createdAt,
  };
}

const prefView = (db: MockDb, p: MockDb['preferences'][number]): Preference => ({ ...p, item: itemView(db, p.itemId) });
const cabinetView = (db: MockDb, c: MockDb['cabinet'][number]): CabinetItem => ({ ...c, item: itemView(db, c.itemId) });
const listView = (db: MockDb, r: MockDb['list'][number]): ShoppingListItem => ({ ...r, item: itemView(db, r.itemId) });

// ---------- guards ----------

function requireMember(db: MockDb, groupId: string, userId: string) {
  const m = db.members.find((x) => x.groupId === groupId && x.userId === userId);
  if (!m) throw notFound(); // don't reveal that the group exists
  return m;
}

function requireItem(db: MockDb, itemId: unknown): string {
  if (typeof itemId !== 'string' || !db.items.some((i) => i.id === itemId)) throw invalid('Unknown itemId');
  return itemId;
}

function myInvite(db: MockDb, inviteId: string, userId: string): DbInvite {
  const email = db.users.find((u) => u.id === userId)?.email;
  const inv = db.invites.find((i) => i.id === inviteId);
  if (!inv || inv.status !== 'pending' || inv.email !== email) throw new ApiError(404, 'INVITE_NOT_FOUND', 'Invite not found');
  return inv;
}

/** Regenerate every group the user belongs to (dietary or membership changes affect allergen flags). */
function regenerateFor(db: MockDb, userId: string) {
  for (const m of db.members.filter((x) => x.userId === userId)) {
    generate(db, m.groupId);
    emit('shopping-list:changed', m.groupId, userId);
  }
}

// ---------- routes ----------

const G = '/groups/([^/]+)';

const routes: Route[] = [
  { method: 'GET', pattern: /^\/health$/, auth: false, run: () => ({ ok: true }) },

  // auth
  {
    method: 'POST',
    pattern: /^\/auth\/google$/,
    auth: false,
    run: ({ db, body }) => {
      if (typeof body?.idToken !== 'string' || !body.idToken) throw new ApiError(401, 'UNAUTHENTICATED', 'Invalid Google token');
      // Every mock Google sign-in is the seeded current user.
      return { token: mockTokenFor(SEED.users.ian), user: userView(db, SEED.users.ian) };
    },
  },
  {
    method: 'POST',
    pattern: /^\/dev\/login-as\/([^/]+)$/,
    auth: false,
    run: ({ db }, [id]) => ({ token: mockTokenFor(id), user: userView(db, id) }),
  },

  // me
  { method: 'GET', pattern: /^\/me$/, auth: true, run: ({ db, userId }) => userView(db, userId!) },
  {
    method: 'PATCH',
    pattern: /^\/me$/,
    auth: true,
    run: ({ db, userId, body }) => {
      const u = db.users.find((x) => x.id === userId)!;
      if (typeof body?.displayName === 'string' && body.displayName.trim()) u.displayName = body.displayName.trim();
      return userView(db, u.id);
    },
  },
  {
    method: 'GET',
    pattern: /^\/me\/dietary$/,
    auth: true,
    run: ({ db, userId }) => {
      const u = db.users.find((x) => x.id === userId)!;
      return { diets: u.diets, allergens: u.allergens };
    },
  },
  {
    method: 'PUT',
    pattern: /^\/me\/dietary$/,
    auth: true,
    run: ({ db, userId, body }) => {
      const diets = DietSchema.array().safeParse(body?.diets);
      const allergens = AllergenSchema.array().safeParse(body?.allergens);
      if (!diets.success || !allergens.success) throw invalid('Unknown diet or allergen');
      const u = db.users.find((x) => x.id === userId)!;
      u.diets = [...new Set(diets.data)];
      u.allergens = [...new Set(allergens.data)];
      regenerateFor(db, u.id);
      return { diets: u.diets, allergens: u.allergens };
    },
  },
  {
    method: 'GET',
    pattern: /^\/me\/invites$/,
    auth: true,
    run: ({ db, userId }): MyInvite[] => {
      const email = db.users.find((u) => u.id === userId)?.email;
      return db.invites
        .filter((i) => i.email === email && i.status === 'pending')
        .map((i) => {
          const g = db.groups.find((x) => x.id === i.groupId)!;
          const memberCount = db.members.filter((m) => m.groupId === g.id).length;
          return { ...inviteView(db, i), group: { id: g.id, name: g.name, memberCount } };
        });
    },
  },

  // invites (invitee side)
  {
    method: 'POST',
    pattern: /^\/invites\/([^/]+)\/accept$/,
    auth: true,
    run: ({ db, userId }, [id]) => {
      const inv = myInvite(db, id, userId!);
      if (!db.members.some((m) => m.groupId === inv.groupId && m.userId === userId)) {
        db.members.push({ groupId: inv.groupId, userId: userId!, role: 'member', joinedAt: now(db) });
      }
      inv.status = 'accepted';
      inv.respondedAt = now(db);
      generate(db, inv.groupId);
      emit('group:changed', inv.groupId, userId);
      emit('invites:changed', inv.groupId, userId);
      emit('shopping-list:changed', inv.groupId, userId);
      return groupView(db, inv.groupId, userId!);
    },
  },
  {
    method: 'POST',
    pattern: /^\/invites\/([^/]+)\/decline$/,
    auth: true,
    run: ({ db, userId }, [id]) => {
      const inv = myInvite(db, id, userId!);
      inv.status = 'declined';
      inv.respondedAt = now(db);
      emit('invites:changed', inv.groupId, userId);
      return undefined;
    },
  },

  // groups
  {
    method: 'GET',
    pattern: /^\/groups$/,
    auth: true,
    run: ({ db, userId }) =>
      db.members.filter((m) => m.userId === userId).map((m) => groupView(db, m.groupId, userId!)),
  },
  {
    method: 'POST',
    pattern: /^\/groups$/,
    auth: true,
    run: ({ db, userId, body }) => {
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      if (!name) throw invalid('Name is required');
      const id = nextId(db, 'g');
      db.groups.push({ id, name, createdBy: userId!, createdAt: now(db) });
      db.members.push({ groupId: id, userId: userId!, role: 'owner', joinedAt: now(db) });
      return groupView(db, id, userId!);
    },
  },
  {
    method: 'GET',
    pattern: new RegExp(`^${G}$`),
    auth: true,
    run: ({ db, userId }, [gid]) => {
      requireMember(db, gid, userId!);
      return groupDetail(db, gid, userId!);
    },
  },

  // group invites (inviter side)
  {
    method: 'GET',
    pattern: new RegExp(`^${G}/invites$`),
    auth: true,
    run: ({ db, userId }, [gid]) => {
      requireMember(db, gid, userId!);
      return db.invites.filter((i) => i.groupId === gid && i.status === 'pending').map((i) => inviteView(db, i));
    },
  },
  {
    method: 'POST',
    pattern: new RegExp(`^${G}/invites$`),
    auth: true,
    run: ({ db, userId, body }, [gid]) => {
      requireMember(db, gid, userId!);
      const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!isEmail(email)) throw invalid('Enter a valid email');
      const memberEmails = db.members
        .filter((m) => m.groupId === gid)
        .map((m) => db.users.find((u) => u.id === m.userId)?.email);
      if (memberEmails.includes(email)) throw new ApiError(409, 'ALREADY_MEMBER', "They're already in this household.");
      let inv = db.invites.find((i) => i.groupId === gid && i.email === email);
      if (inv) {
        Object.assign(inv, { status: 'pending', invitedBy: userId, createdAt: now(db), respondedAt: null });
      } else {
        inv = { id: nextId(db, 'inv'), groupId: gid, email, status: 'pending', invitedBy: userId, createdAt: now(db), respondedAt: null };
        db.invites.push(inv);
      }
      emit('invites:changed', gid, userId);
      return inviteView(db, inv);
    },
  },
  {
    method: 'DELETE',
    pattern: new RegExp(`^${G}/invites/([^/]+)$`),
    auth: true,
    run: ({ db, userId }, [gid, inviteId]) => {
      const me = requireMember(db, gid, userId!);
      const inv = db.invites.find((i) => i.groupId === gid && i.id === inviteId && i.status === 'pending');
      if (!inv) throw notFound('Invite not found');
      if (me.role !== 'owner' && inv.invitedBy !== userId) {
        throw new ApiError(403, 'FORBIDDEN', 'Only the owner or the person who sent it can revoke an invite');
      }
      inv.status = 'revoked';
      inv.respondedAt = now(db);
      emit('invites:changed', gid, userId);
      return undefined;
    },
  },

  // items
  {
    method: 'GET',
    pattern: /^\/items\/search$/,
    auth: true,
    run: ({ db, query }) => {
      const q = query.get('q') ?? '';
      if (!normalizeItemName(q)) throw invalid('q is required');
      const keys = [
        ...db.items.map((i) => ({ itemId: i.id, key: i.normalized })),
        ...db.aliases.map((a) => ({ itemId: a.itemId, key: a.aliasNormalized })),
      ];
      const { match, itemIds } = matchItem(q, keys);
      return { match, results: itemIds.map((id) => itemView(db, id)) };
    },
  },
  {
    method: 'POST',
    pattern: /^\/items$/,
    auth: true,
    run: ({ db, body }) => {
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      const normalized = normalizeItemName(name);
      if (!normalized) throw invalid('Name is required');
      if (body?.aliasOf) {
        const target = itemView(db, body.aliasOf);
        if (!db.aliases.some((a) => a.aliasNormalized === normalized) && !db.items.some((i) => i.normalized === normalized)) {
          db.aliases.push({ itemId: target.id, aliasNormalized: normalized });
        }
        return target;
      }
      const existing = db.items.find((i) => i.normalized === normalized);
      if (existing) return itemView(db, existing.id);
      const category = CategorySchema.safeParse(body?.category).success ? body.category : 'other';
      const id = nextId(db, 'i');
      db.items.push({ id, name, category, allergens: [], normalized });
      return itemView(db, id);
    },
  },

  // preferences
  {
    method: 'GET',
    pattern: new RegExp(`^${G}/preferences$`),
    auth: true,
    run: ({ db, userId, query }, [gid]) => {
      requireMember(db, gid, userId!);
      const all = query.get('userId') === 'all';
      return db.preferences
        .filter((p) => p.groupId === gid && (all || p.userId === userId))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((p) => prefView(db, p));
    },
  },
  {
    method: 'POST',
    pattern: new RegExp(`^${G}/preferences$`),
    auth: true,
    run: ({ db, userId, body }, [gid]) => {
      requireMember(db, gid, userId!);
      const itemId = requireItem(db, body?.itemId);
      const recurrence = RecurrenceSchema.safeParse(body?.recurrence).success ? body.recurrence : 'staple';
      let p = db.preferences.find((x) => x.groupId === gid && x.userId === userId && x.itemId === itemId);
      if (p) {
        p.recurrence = recurrence;
      } else {
        p = {
          id: nextId(db, 'p'),
          groupId: gid,
          userId: userId!,
          itemId,
          quantityText: body?.quantityText ?? null,
          recurrence,
          note: body?.note ?? null,
          createdAt: now(db),
        };
        db.preferences.push(p);
      }
      generate(db, gid);
      emit('preferences:changed', gid, userId);
      emit('shopping-list:changed', gid, userId);
      return prefView(db, p);
    },
  },
  {
    method: 'PATCH',
    pattern: new RegExp(`^${G}/preferences/([^/]+)$`),
    auth: true,
    run: ({ db, userId, body }, [gid, id]) => {
      requireMember(db, gid, userId!);
      const p = db.preferences.find((x) => x.groupId === gid && x.id === id);
      if (!p) throw notFound();
      if (p.userId !== userId) throw new ApiError(403, 'FORBIDDEN', 'You can only edit your own preferences');
      if (body?.recurrence !== undefined) {
        if (!RecurrenceSchema.safeParse(body.recurrence).success) throw invalid('Unknown recurrence');
        p.recurrence = body.recurrence;
      }
      if (body?.quantityText !== undefined) p.quantityText = body.quantityText;
      if (body?.note !== undefined) p.note = body.note;
      generate(db, gid);
      emit('preferences:changed', gid, userId);
      return prefView(db, p);
    },
  },
  {
    method: 'DELETE',
    pattern: new RegExp(`^${G}/preferences/([^/]+)$`),
    auth: true,
    run: ({ db, userId }, [gid, id]) => {
      requireMember(db, gid, userId!);
      const p = db.preferences.find((x) => x.groupId === gid && x.id === id);
      if (!p) throw notFound();
      if (p.userId !== userId) throw new ApiError(403, 'FORBIDDEN', 'You can only remove your own preferences');
      db.preferences = db.preferences.filter((x) => x !== p);
      generate(db, gid);
      emit('preferences:changed', gid, userId);
      emit('shopping-list:changed', gid, userId);
      return undefined;
    },
  },

  // cabinet
  {
    method: 'GET',
    pattern: new RegExp(`^${G}/cabinet$`),
    auth: true,
    run: ({ db, userId }, [gid]) => {
      requireMember(db, gid, userId!);
      return sortByAisle(db.cabinet.filter((c) => c.groupId === gid).map((c) => cabinetView(db, c)));
    },
  },
  {
    method: 'POST',
    pattern: new RegExp(`^${G}/cabinet$`),
    auth: true,
    run: ({ db, userId, body }, [gid]) => {
      requireMember(db, gid, userId!);
      const itemId = requireItem(db, body?.itemId);
      let c = db.cabinet.find((x) => x.groupId === gid && x.itemId === itemId);
      if (c) {
        c.status = 'in_stock';
      } else {
        c = {
          id: nextId(db, 'c'),
          groupId: gid,
          itemId,
          status: 'in_stock',
          quantityText: body?.quantityText ?? null,
          location: body?.location ?? null,
          purchasedAt: now(db),
          expiresAt: body?.expiresAt ?? null,
          expirationSource: body?.expiresAt ? 'manual' : null,
          addedBy: userId,
        };
        db.cabinet.push(c);
      }
      generate(db, gid);
      emit('cabinet:changed', gid, userId);
      emit('shopping-list:changed', gid, userId);
      return cabinetView(db, c);
    },
  },
  {
    method: 'PATCH',
    pattern: new RegExp(`^${G}/cabinet/([^/]+)$`),
    auth: true,
    run: ({ db, userId, body }, [gid, id]) => {
      requireMember(db, gid, userId!);
      const c = db.cabinet.find((x) => x.groupId === gid && x.id === id);
      if (!c) throw notFound();
      if (body?.status !== undefined) {
        if (!StockStatusSchema.safeParse(body.status).success) throw invalid('Unknown status');
        c.status = body.status;
      }
      if (body?.quantityText !== undefined) c.quantityText = body.quantityText;
      if (body?.location !== undefined) c.location = body.location;
      if (body?.expiresAt !== undefined) {
        c.expiresAt = body.expiresAt;
        c.expirationSource = 'manual';
      }
      generate(db, gid);
      emit('cabinet:changed', gid, userId);
      emit('shopping-list:changed', gid, userId);
      return cabinetView(db, c);
    },
  },
  {
    method: 'DELETE',
    pattern: new RegExp(`^${G}/cabinet/([^/]+)$`),
    auth: true,
    run: ({ db, userId }, [gid, id]) => {
      requireMember(db, gid, userId!);
      if (!db.cabinet.some((x) => x.groupId === gid && x.id === id)) throw notFound();
      db.cabinet = db.cabinet.filter((x) => !(x.groupId === gid && x.id === id));
      emit('cabinet:changed', gid, userId); // removing is not running out: no list change (backend/05 step 5)
      return undefined;
    },
  },
  {
    method: 'POST',
    pattern: new RegExp(`^${G}/cabinet/([^/]+)/ran-out$`),
    auth: true,
    run: ({ db, userId }, [gid, id]) => {
      requireMember(db, gid, userId!);
      const result = ranOut(db, gid, id);
      if (!result) throw notFound();
      emit('cabinet:changed', gid, userId);
      emit('shopping-list:changed', gid, userId);
      return result;
    },
  },

  // shopping list
  {
    method: 'GET',
    pattern: new RegExp(`^${G}/shopping-list$`),
    auth: true,
    run: ({ db, userId }, [gid]) => {
      requireMember(db, gid, userId!);
      return sortByAisle(db.list.filter((r) => r.groupId === gid).map((r) => listView(db, r)));
    },
  },
  {
    method: 'POST',
    pattern: new RegExp(`^${G}/shopping-list/generate$`),
    auth: true,
    run: ({ db, userId }, [gid]) => {
      requireMember(db, gid, userId!);
      generate(db, gid);
      emit('shopping-list:changed', gid, userId);
      return sortByAisle(db.list.filter((r) => r.groupId === gid).map((r) => listView(db, r)));
    },
  },
  {
    method: 'POST',
    pattern: new RegExp(`^${G}/shopping-list/complete$`),
    auth: true,
    run: ({ db, userId }, [gid]) => {
      requireMember(db, gid, userId!);
      const movedToCabinet = completeTrip(db, gid, userId!);
      emit('cabinet:changed', gid, userId);
      emit('preferences:changed', gid, userId);
      emit('shopping-list:changed', gid, userId);
      return { movedToCabinet };
    },
  },
  {
    method: 'POST',
    pattern: new RegExp(`^${G}/shopping-list$`),
    auth: true,
    run: ({ db, userId, body }, [gid]) => {
      requireMember(db, gid, userId!);
      const itemId = requireItem(db, body?.itemId);
      let row = db.list.find((r) => r.groupId === gid && r.itemId === itemId);
      if (!row) {
        row = {
          id: nextId(db, 'l'),
          groupId: gid,
          itemId,
          reason: 'manual',
          wantedBy: [],
          quantityText: body?.quantityText ?? null,
          allergenFlags: [],
          checked: false,
          checkedBy: null,
          checkedAt: null,
          addedBy: userId,
        };
        db.list.push(row);
      }
      generate(db, gid);
      emit('shopping-list:changed', gid, userId);
      return listView(db, row);
    },
  },
  {
    method: 'PATCH',
    pattern: new RegExp(`^${G}/shopping-list/([^/]+)$`),
    auth: true,
    run: ({ db, userId, body }, [gid, id]) => {
      requireMember(db, gid, userId!);
      const row = db.list.find((r) => r.groupId === gid && r.id === id);
      if (!row) throw notFound();
      if (typeof body?.checked !== 'boolean') throw invalid('checked must be a boolean');
      row.checked = body.checked;
      row.checkedBy = body.checked ? userId : null;
      row.checkedAt = body.checked ? now(db) : null;
      emit('shopping-list:changed', gid, userId);
      return listView(db, row);
    },
  },
  {
    method: 'DELETE',
    pattern: new RegExp(`^${G}/shopping-list/([^/]+)$`),
    auth: true,
    run: ({ db, userId }, [gid, id]) => {
      requireMember(db, gid, userId!);
      const row = db.list.find((r) => r.groupId === gid && r.id === id);
      if (!row) throw notFound();
      if (row.reason === 'preference') {
        throw new ApiError(409, 'PREFERENCE_ROW', 'Remove the preference instead');
      }
      db.list = db.list.filter((r) => r !== row);
      emit('shopping-list:changed', gid, userId);
      return undefined;
    },
  },
];

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Simulated network latency; 0 under Jest. */
export const mockLatency = { ms: process.env.JEST_WORKER_ID ? 0 : 150 };

export async function mockRequest(method: string, rawPath: string, body: unknown, token: string | null): Promise<unknown> {
  if (mockLatency.ms) await delay(mockLatency.ms);
  const db = getMockDb();
  const [path, qs = ''] = rawPath.split('?');
  const userId = token?.startsWith(MOCK_TOKEN_PREFIX) ? token.slice(MOCK_TOKEN_PREFIX.length) : null;
  const knownUser = userId && db.users.some((u) => u.id === userId) ? userId : null;

  for (const route of routes) {
    if (route.method !== method) continue;
    const m = route.pattern.exec(path);
    if (!m) continue;
    if (route.auth && !knownUser) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in again');
    const result = route.run({ method, path, query: new URLSearchParams(qs), body, userId: knownUser, db }, m.slice(1));
    return clone(result);
  }
  throw notFound(`No mock route for ${method} ${path}`);
}
