import { randomUUID } from "node:crypto";
import { prisma } from "../src/db.js";
import { signAppToken } from "../src/middleware/auth.js";

// Real users in the local Postgres, signed in with an app JWT. Call cleanupUsers() in afterAll.
const created: string[] = [];

export async function makeUser(email = `u-${randomUUID()}@example.com`) {
  const user = await prisma.user.create({
    data: { googleSub: `test-${randomUUID()}`, email: email.toLowerCase(), displayName: email.split("@")[0] },
  });
  created.push(user.id);
  return { id: user.id, email: user.email, token: signAppToken(user.id), auth: { Authorization: `Bearer ${signAppToken(user.id)}` } };
}

export async function cleanupUsers() {
  await prisma.group.deleteMany({ where: { createdBy: { in: created } } });
  await prisma.user.deleteMany({ where: { id: { in: created } } });
  await prisma.group.deleteMany({ where: { members: { none: {} } } }); // memberless leftovers (e.g. after DELETE /me tests)
}
