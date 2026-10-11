/**
 * Attack 3: email invites (backend/03). Who can accept, state transitions, enumeration (body, status, timing),
 * re-invites after removal, who can revoke, and flooding.
 */
import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/db.js";
import { api, expectErrorShape, guardNetwork, makeGroup, makeUser, tag } from "./helpers.js";

let net: ReturnType<typeof guardNetwork>;
beforeEach(() => {
  net = guardNetwork();
});
afterEach(() => vi.restoreAllMocks());

const invite = (groupId: string, auth: { Authorization: string }, email: string) =>
  api().post(`/api/groups/${groupId}/invites`).set(auth).send({ email });

describe("attack 3: who can accept", () => {
  it("someone else's invite → 404 INVITE_NOT_FOUND; the invited account can accept", async () => {
    const owner = await makeUser();
    const will = await makeUser();
    const mallory = await makeUser();
    const g = await makeGroup(owner);
    const inv = await invite(g.id, owner.auth, will.email).expect(201);
    expectErrorShape(await api().post(`/api/invites/${inv.body.id}/accept`).set(mallory.auth), 404, "INVITE_NOT_FOUND");
    expect(await prisma.groupMember.count({ where: { groupId: g.id, userId: mallory.id } })).toBe(0);
    await api().post(`/api/invites/${inv.body.id}/accept`).set(will.auth).expect(200);
  });

  it("an invite typed with different casing/whitespace matches the (lower-cased) Google email", async () => {
    const owner = await makeUser();
    const will = await makeUser({ email: `will-${tag()}@example.com` });
    const g = await makeGroup(owner);
    const inv = await invite(g.id, owner.auth, `  ${will.email.toUpperCase()}  `).expect(201);
    expect(inv.body.email).toBe(will.email);
    const mine = await api().get("/api/me/invites").set(will.auth).expect(200);
    expect(mine.body.map((i: { id: string }) => i.id)).toContain(inv.body.id);
    await api().post(`/api/invites/${inv.body.id}/accept`).set(will.auth).expect(200);
  });

  it("a look-alike email (unicode homoglyph / trailing dot / plus tag) does not match", async () => {
    const owner = await makeUser();
    const will = await makeUser({ email: `will-${tag()}@example.com` });
    const g = await makeGroup(owner);
    const [local, domain] = will.email.split("@");
    for (const e of [`${local}+x@${domain}`, `${local}@${domain}.`, `${local.replace("i", "і")}@${domain}`]) {
      const res = await invite(g.id, owner.auth, e);
      if (res.status !== 201) continue; // rejected as invalid is fine
      expectErrorShape(await api().post(`/api/invites/${res.body.id}/accept`).set(will.auth), 404, "INVITE_NOT_FOUND");
    }
  });

  it("revoked, declined and already-accepted invites can't be accepted (404); accept twice → 404", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const c = await makeUser();
    const g = await makeGroup(owner);
    const ia = await invite(g.id, owner.auth, a.email).expect(201);
    const ib = await invite(g.id, owner.auth, b.email).expect(201);
    const ic = await invite(g.id, owner.auth, c.email).expect(201);
    await api().delete(`/api/groups/${g.id}/invites/${ia.body.id}`).set(owner.auth).expect(204);
    expectErrorShape(await api().post(`/api/invites/${ia.body.id}/accept`).set(a.auth), 404, "INVITE_NOT_FOUND");
    await api().post(`/api/invites/${ib.body.id}/decline`).set(b.auth).expect(204);
    expectErrorShape(await api().post(`/api/invites/${ib.body.id}/accept`).set(b.auth), 404, "INVITE_NOT_FOUND");
    await api().post(`/api/invites/${ic.body.id}/accept`).set(c.auth).expect(200);
    expectErrorShape(await api().post(`/api/invites/${ic.body.id}/accept`).set(c.auth), 404, "INVITE_NOT_FOUND");
    expectErrorShape(await api().post(`/api/invites/${ic.body.id}/decline`).set(c.auth), 404, "INVITE_NOT_FOUND");
    expect(await prisma.groupMember.count({ where: { groupId: g.id } })).toBe(2);
    // revoking something that isn't pending
    expectErrorShape(await api().delete(`/api/groups/${g.id}/invites/${ic.body.id}`).set(owner.auth), 409, "INVITE_NOT_PENDING");
  });

  it("inviting an existing member (or yourself) → 409 ALREADY_MEMBER", async () => {
    const owner = await makeUser();
    const m = await makeUser();
    const g = await makeGroup(owner, [m]);
    expectErrorShape(await invite(g.id, owner.auth, m.email.toUpperCase()), 409, "ALREADY_MEMBER");
    expectErrorShape(await invite(g.id, m.auth, owner.email), 409, "ALREADY_MEMBER");
  });
});

describe("attack 3: enumeration", () => {
  const strip = (b: Record<string, unknown>) => {
    const { id, email, createdAt, ...rest } = b;
    return { ...rest, idType: typeof id, emailType: typeof email, createdAtType: typeof createdAt };
  };

  it("known and unknown emails get the same status, body shape and values", async () => {
    const owner = await makeUser();
    const known = await makeUser();
    const g = await makeGroup(owner);
    const a = await invite(g.id, owner.auth, known.email);
    const b = await invite(g.id, owner.auth, `nobody-${tag()}@example.com`);
    expect(a.status).toBe(201);
    expect(b.status).toBe(a.status);
    expect(Object.keys(b.body).sort()).toEqual(Object.keys(a.body).sort());
    expect(strip(b.body)).toEqual(strip(a.body));
    expect(Object.keys(b.headers).sort()).toEqual(Object.keys(a.headers).sort());
    // the email is sent for both (or for neither)
    expect(net.mail.mock.calls.length % 2).toBe(0);
  });

  it("known and unknown emails take the same time (median of 15 each, within 15 ms)", async () => {
    const owner = await makeUser();
    const g = await makeGroup(owner);
    const knowns = await Promise.all(Array.from({ length: 15 }, () => makeUser()));
    // Invites count against a 20/hour limit per user: use several inviters (members) so the limit isn't hit.
    const inviters = await Promise.all(Array.from({ length: 2 }, () => makeUser()));
    for (const i of inviters) await prisma.groupMember.create({ data: { groupId: g.id, userId: i.id, role: "member" } });
    const time = async (auth: { Authorization: string }, email: string) => {
      const t = performance.now();
      const res = await invite(g.id, auth, email);
      expect(res.status).toBe(201);
      return performance.now() - t;
    };
    const tk: number[] = [];
    const tu: number[] = [];
    for (let i = 0; i < 15; i++) {
      tk.push(await time(inviters[0].auth, knowns[i].email));
      tu.push(await time(inviters[1].auth, `ghost-${tag()}@example.com`));
    }
    const med = (xs: number[]) => xs.sort((x, y) => x - y)[Math.floor(xs.length / 2)];
    expect(Math.abs(med(tk) - med(tu))).toBeLessThan(15);
  });
});

describe("attack 3: removal, re-invite and revoke rights", () => {
  it("after removal the old invite is dead; a deliberate re-invite works", async () => {
    const owner = await makeUser();
    const will = await makeUser();
    const g = await makeGroup(owner);
    const inv = await invite(g.id, owner.auth, will.email).expect(201);
    await api().post(`/api/invites/${inv.body.id}/accept`).set(will.auth).expect(200);
    await api().delete(`/api/groups/${g.id}/members/${will.id}`).set(owner.auth).expect(204);
    expectErrorShape(await api().post(`/api/invites/${inv.body.id}/accept`).set(will.auth), 404, "INVITE_NOT_FOUND");
    expectErrorShape(await api().get(`/api/groups/${g.id}`).set(will.auth), 404, "NOT_FOUND");
    const again = await invite(g.id, owner.auth, will.email).expect(201);
    await api().post(`/api/invites/${again.body.id}/accept`).set(will.auth).expect(200);
    expect(await prisma.groupMember.count({ where: { groupId: g.id, userId: will.id } })).toBe(1);
  });

  it("revoke: a member who is neither owner nor inviter → 403; the inviter (non-owner) → 204", async () => {
    const owner = await makeUser();
    const m1 = await makeUser();
    const m2 = await makeUser();
    const g = await makeGroup(owner, [m1, m2]);
    const inv = await invite(g.id, m1.auth, `x-${tag()}@example.com`).expect(201);
    expectErrorShape(await api().delete(`/api/groups/${g.id}/invites/${inv.body.id}`).set(m2.auth), 403, "FORBIDDEN");
    await api().delete(`/api/groups/${g.id}/invites/${inv.body.id}`).set(m1.auth).expect(204);
  });

  it("[API-INV-1] invites sent by a member stop working when the owner removes that member", async () => {
    const owner = await makeUser();
    const mallory = await makeUser();
    const accomplice = await makeUser();
    const g = await makeGroup(owner, [mallory]);
    const inv = await invite(g.id, mallory.auth, accomplice.email).expect(201);
    await api().delete(`/api/groups/${g.id}/members/${mallory.id}`).set(owner.auth).expect(204);
    // The removed member's pending invite still lets their accomplice into the household.
    const res = await api().post(`/api/invites/${inv.body.id}/accept`).set(accomplice.auth);
    expect(res.status, "a removed member's pending invite can still be accepted").toBe(404);
  });

  it("invite flooding: the 21st invite in an hour from one user → 429 RATE_LIMITED, across groups too", async () => {
    const owner = await makeUser();
    const g1 = await makeGroup(owner);
    const g2 = await makeGroup(owner);
    for (let i = 0; i < 20; i++) await invite(i % 2 ? g1.id : g2.id, owner.auth, `flood-${i}-${tag()}@example.com`).expect(201);
    expectErrorShape(await invite(g1.id, owner.auth, `flood-x-${tag()}@example.com`), 429, "RATE_LIMITED");
    expectErrorShape(await invite(g2.id, owner.auth, `flood-y-${tag()}@example.com`), 429, "RATE_LIMITED");
    expect(await prisma.groupInvite.count({ where: { groupId: { in: [g1.id, g2.id] } } })).toBe(20);
  });
});
