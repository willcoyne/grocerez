import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { signAppToken } from "../src/lib/jwt.js";

export const app = createApp();
export const api = () => request(app);

export const DEMO_GROUP_ID = "00000000-0000-4000-8000-000000000001";
export const SEED_USERS = [1, 2, 3, 4].map((n) => `00000000-0000-4000-8000-00000000010${n}`);

export type TestUser = { id: string; email: string; displayName: string; token: string; auth: { Authorization: string } };

/** Creates a user row directly (as if they signed in with Google) and returns a valid app JWT for them. */
export async function makeUser(opts: { email?: string; displayName?: string; allergens?: string[] } = {}): Promise<TestUser> {
  const tag = randomUUID().slice(0, 8);
  const email = (opts.email ?? `test-${tag}@example.com`).toLowerCase();
  const user = await prisma.user.create({
    data: {
      googleSub: `test-${tag}`,
      email,
      displayName: opts.displayName ?? `Tester ${tag}`,
      allergens: opts.allergens?.length
        ? { create: opts.allergens.map((a) => ({ allergen: a as never })) }
        : undefined,
    },
  });
  const token = signAppToken(user.id);
  return { id: user.id, email, displayName: user.displayName, token, auth: { Authorization: `Bearer ${token}` } };
}

export function tokenFor(userId: string) {
  return { Authorization: `Bearer ${signAppToken(userId)}` };
}

/** Creates a group through the API with `owner` as owner, then adds `members` directly. */
export async function makeGroup(owner: TestUser, members: TestUser[] = [], name = "Test House") {
  const res = await api().post("/api/groups").set(owner.auth).send({ name });
  if (res.status !== 201) throw new Error(`makeGroup failed: ${res.status} ${JSON.stringify(res.body)}`);
  for (const m of members) {
    await prisma.groupMember.create({ data: { groupId: res.body.id, userId: m.id, role: "member" } });
  }
  return res.body as { id: string; name: string };
}

/** Creates a group directly in the database (no API), `owner` as owner. */
export async function makeGroupDirect(owner: TestUser, members: TestUser[] = [], name = "Direct House") {
  return prisma.group.create({
    data: {
      name,
      createdBy: owner.id,
      members: { create: [{ userId: owner.id, role: "owner" }, ...members.map((m) => ({ userId: m.id, role: "member" as const }))] },
    },
  });
}

/** Looks up a seeded catalog item id by display name. */
export async function itemId(name: string): Promise<string> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM items WHERE normalized_name = normalize_item_name(${name})`;
  if (!rows[0]) throw new Error(`no catalog item ${name}`);
  return rows[0].id;
}
