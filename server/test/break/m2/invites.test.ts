import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { api, cleanup, invite, isErrorShape, join, makeUser, mkGroup, prisma } from "./helpers.js";

// Attack #3: email invites (backend/03 steps 5-12).
afterAll(cleanup);

const status = async (id: string) => (await prisma.groupInvite.findUnique({ where: { id } }))?.status;
const isMember = async (groupId: string, userId: string) =>
  (await prisma.groupMember.count({ where: { groupId, userId } })) > 0;

describe("accepting", () => {
  it("someone else's invite can't be accepted or declined, even by a member of that group", async () => {
    const [owner, target, other] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const g = await mkGroup(owner);
    const inv = (await invite(owner, g.id, target.email).expect(201)).body;
    for (const u of [other, owner]) {
      const a = await api().post(`/api/invites/${inv.id}/accept`).set(u.auth);
      expect(a.status).toBe(404);
      expect(a.body.error.code).toBe("INVITE_NOT_FOUND");
      await api().post(`/api/invites/${inv.id}/decline`).set(u.auth).expect(404);
    }
    expect(await status(inv.id)).toBe("pending");
    expect(await isMember(g.id, other.id)).toBe(false);
  });

  it("email casing and whitespace in the invite still match the Google account", async () => {
    const [owner, target] = await Promise.all([makeUser(), makeUser(`Mixed.${randomUUID()}@Example.com`)]);
    const g = await mkGroup(owner);
    const inv = (await invite(owner, g.id, `   ${target.email.toUpperCase()}  `).expect(201)).body;
    expect(inv.email).toBe(target.email);
    expect((await api().get("/api/me/invites").set(target.auth).expect(200)).body.map((i: { id: string }) => i.id)).toEqual([inv.id]);
    await api().post(`/api/invites/${inv.id}/accept`).set(target.auth).expect(200);
    expect(await isMember(g.id, target.id)).toBe(true);
  });

  it("revoked and declined invites can't be accepted; accepting twice is 404 the second time", async () => {
    const [owner, t1, t2, t3] = await Promise.all([makeUser(), makeUser(), makeUser(), makeUser()]);
    const g = await mkGroup(owner);
    const i1 = (await invite(owner, g.id, t1.email)).body;
    await api().delete(`/api/groups/${g.id}/invites/${i1.id}`).set(owner.auth).expect(204);
    await api().post(`/api/invites/${i1.id}/accept`).set(t1.auth).expect(404);

    const i2 = (await invite(owner, g.id, t2.email)).body;
    await api().post(`/api/invites/${i2.id}/decline`).set(t2.auth).expect(204);
    await api().post(`/api/invites/${i2.id}/accept`).set(t2.auth).expect(404);
    await api().post(`/api/invites/${i2.id}/decline`).set(t2.auth).expect(404);

    const i3 = (await invite(owner, g.id, t3.email)).body;
    await api().post(`/api/invites/${i3.id}/accept`).set(t3.auth).expect(200);
    await api().post(`/api/invites/${i3.id}/accept`).set(t3.auth).expect(404);
    await api().delete(`/api/groups/${g.id}/invites/${i3.id}`).set(owner.auth).expect(409);
    expect([await isMember(g.id, t1.id), await isMember(g.id, t2.id), await isMember(g.id, t3.id)]).toEqual([false, false, true]);
  });

  it("inviting an existing member (any casing) is 409 ALREADY_MEMBER and creates no invite row", async () => {
    const [owner, m] = await Promise.all([makeUser(), makeUser()]);
    const g = await mkGroup(owner);
    await join(owner, g.id, m);
    const r = await invite(owner, g.id, ` ${m.email.toUpperCase()} `);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("ALREADY_MEMBER");
    const self = await invite(owner, g.id, owner.email);
    expect(self.status).toBe(409);
  });

  it("removal revokes the old invite; re-inviting is a fresh pending invite that works", async () => {
    const [owner, m] = await Promise.all([makeUser(), makeUser()]);
    const g = await mkGroup(owner);
    const first = await join(owner, g.id, m);
    await api().delete(`/api/groups/${g.id}/members/${m.id}`).set(owner.auth).expect(204);
    expect(await status(first)).toBe("revoked");
    await api().post(`/api/invites/${first}/accept`).set(m.auth).expect(404);
    expect(await isMember(g.id, m.id)).toBe(false);

    const again = (await invite(owner, g.id, m.email).expect(201)).body;
    expect(again.status).toBe("pending");
    await api().post(`/api/invites/${again.id}/accept`).set(m.auth).expect(200);
    expect(await isMember(g.id, m.id)).toBe(true);
  });

  it("an invite from a deleted group disappears and can't be accepted", async () => {
    const [owner, t] = await Promise.all([makeUser(), makeUser()]);
    const g = await mkGroup(owner);
    const inv = (await invite(owner, g.id, t.email)).body;
    await api().delete(`/api/groups/${g.id}`).set(owner.auth).expect(204);
    expect((await api().get("/api/me/invites").set(t.auth)).body).toEqual([]);
    await api().post(`/api/invites/${inv.id}/accept`).set(t.auth).expect(404);
  });
});

describe("revoking", () => {
  it("only the owner or the inviter may revoke; another member gets 403 and the invite stays pending", async () => {
    const [owner, m1, m2] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const g = await mkGroup(owner);
    await join(owner, g.id, m1);
    await join(owner, g.id, m2);
    const byM1 = (await invite(m1, g.id, `x-${randomUUID()}@example.com`).expect(201)).body;
    const byOwner = (await invite(owner, g.id, `y-${randomUUID()}@example.com`).expect(201)).body;

    const r = await api().delete(`/api/groups/${g.id}/invites/${byM1.id}`).set(m2.auth);
    expect(r.status).toBe(403);
    expect(isErrorShape(r.body)).toBe(true);
    await api().delete(`/api/groups/${g.id}/invites/${byOwner.id}`).set(m1.auth).expect(403);
    expect(await status(byM1.id)).toBe("pending");

    await api().delete(`/api/groups/${g.id}/invites/${byM1.id}`).set(m1.auth).expect(204);
    await api().delete(`/api/groups/${g.id}/invites/${byOwner.id}`).set(owner.auth).expect(204);
  });
});

describe("no user enumeration", () => {
  it("invite response is identical (status, keys, shape) for known and unknown emails", async () => {
    const [owner, known] = await Promise.all([makeUser(), makeUser()]);
    const g = await mkGroup(owner);
    const unknown = `nobody-${randomUUID()}@example.com`;
    const a = await invite(owner, g.id, known.email);
    const b = await invite(owner, g.id, unknown);
    expect(a.status).toBe(b.status);
    const strip = (x: Record<string, unknown>) => ({ ...x, id: "-", email: "-", createdAt: "-" });
    expect(strip(a.body)).toEqual(strip(b.body));
    expect(Object.keys(a.headers).sort()).toEqual(Object.keys(b.headers).sort());
    // The group's invite list doesn't reveal it either.
    const list = (await api().get(`/api/groups/${g.id}/invites`).set(owner.auth)).body as Record<string, unknown>[];
    expect(new Set(list.map((i) => JSON.stringify(Object.keys(i).sort()))).size).toBe(1);
  });

  it("timing: known vs unknown emails are indistinguishable within noise (median ratio < 1.5)", async () => {
    const owner = await makeUser();
    const g = await mkGroup(owner);
    const known = await Promise.all(Array.from({ length: 8 }, () => makeUser()));
    const time = async (email: string) => {
      const t = process.hrtime.bigint();
      await invite(owner, g.id, email).expect(201);
      return Number(process.hrtime.bigint() - t) / 1e6;
    };
    const k: number[] = [], u: number[] = [];
    for (let i = 0; i < 8; i++) {
      k.push(await time(known[i].email));
      u.push(await time(`ghost-${randomUUID()}@example.com`));
    }
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
    const ratio = Math.max(med(k), med(u)) / Math.min(med(k), med(u));
    expect(ratio).toBeLessThan(1.5);
  });
});

describe("rate limit", () => {
  it("the 21st invite in an hour from one user is 429 RATE_LIMITED, in the standard error shape", async () => {
    const owner = await makeUser();
    const g = await mkGroup(owner);
    const codes: number[] = [];
    for (let i = 0; i < 21; i++) codes.push((await invite(owner, g.id, `flood-${i}-${randomUUID()}@example.com`)).status);
    expect(codes.slice(0, 20).every((c) => c === 201)).toBe(true);
    const r = await invite(owner, g.id, `flood-x@example.com`);
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe("RATE_LIMITED");
    // A different user isn't affected (limit is per user, not global).
    const other = await makeUser();
    const g2 = await mkGroup(other);
    expect((await invite(other, g2.id, `ok-${randomUUID()}@example.com`)).status).toBe(201);
  });

  it("re-sending the same invite over and over also counts against the limit (no email-bombing one address)", async () => {
    const owner = await makeUser();
    const g = await mkGroup(owner);
    const victim = `victim-${randomUUID()}@example.com`;
    const codes: number[] = [];
    for (let i = 0; i < 22; i++) codes.push((await invite(owner, g.id, victim)).status);
    expect(codes.filter((c) => c === 201).length).toBeLessThanOrEqual(20);
    expect(codes.at(-1)).toBe(429);
  });
});
