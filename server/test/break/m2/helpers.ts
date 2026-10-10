import { randomUUID } from "node:crypto";
import request from "supertest";
import { expect } from "vitest";
import { app } from "../../../src/app.js";
import { prisma } from "../../../src/db.js";
import { cleanupUsers, makeUser } from "../../helpers.js";

// M2 break-test helpers. All data is created per run and removed in cleanup(); the shared DB is never reset.
export type U = Awaited<ReturnType<typeof makeUser>>;
export const api = () => request(app);
export { app, makeUser, prisma };

const items: string[] = [];
const tag = () => randomUUID().replace(/[\d-]/g, "").slice(0, 10); // letters only, so normalization keeps it intact

export async function mkItem(name: string, category = "pantry", defaultAllergens: string[] = []) {
  const t = tag();
  const i = await prisma.item.create({
    data: { name: `${name} ${t}`, normalizedName: `${name.toLowerCase()} ${t}`, category, defaultAllergens: defaultAllergens as never },
  });
  items.push(i.id);
  return i;
}
export const trackItem = (id: string) => items.push(id);

export async function mkGroup(owner: U, name = "G") {
  const r = await api().post("/api/groups").set(owner.auth).send({ name }).expect(201);
  return r.body as { id: string; name: string };
}

export const invite = (by: U, groupId: string, email: string) =>
  api().post(`/api/groups/${groupId}/invites`).set(by.auth).send({ email });

export async function join(owner: U, groupId: string, u: U) {
  const r = await invite(owner, groupId, u.email);
  expect(r.status).toBe(201);
  await api().post(`/api/invites/${r.body.id}/accept`).set(u.auth).expect(200);
  return r.body.id as string;
}

// Direct membership insert, for tests that would otherwise trip the 20 invites/hour limit.
export const addMember = (groupId: string, u: U) => prisma.groupMember.create({ data: { groupId, userId: u.id, role: "member" } });

export async function cleanup() {
  await cleanupUsers();
  // Items are ON DELETE RESTRICT from preferences/cabinet/list; those rows went with their groups above.
  await prisma.itemAlias.deleteMany({ where: { itemId: { in: items } } });
  await prisma.item.deleteMany({ where: { id: { in: items } } }).catch(() => {});
  await prisma.$disconnect();
}

export const isErrorShape = (body: unknown) => {
  const b = body as { error?: { code?: unknown; message?: unknown } };
  return typeof b?.error?.code === "string" && typeof b.error.message === "string" && Object.keys(b).length === 1;
};
