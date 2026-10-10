import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, cleanup, isErrorShape, join, makeUser, mkGroup, mkItem, prisma, type U } from "./helpers.js";

// Attack #1: user B (group 2) against every /groups/:groupId/* route and every :id route of group 1,
// both under group 1's path and with group-1 ids smuggled under group 2's path. Any 2xx is Critical.

let A: U, A2: U, B: U;
let g1: { id: string }, g2: { id: string };
const ids = {} as Record<"pref" | "pref2" | "cab" | "list" | "invite" | "item", string>;

async function snapshot() {
  const [group, members, prefs, cab, list, invites] = await Promise.all([
    prisma.group.findUnique({ where: { id: g1.id }, select: { name: true } }),
    prisma.groupMember.findMany({ where: { groupId: g1.id }, select: { userId: true, role: true }, orderBy: { userId: "asc" } }),
    prisma.preference.findMany({ where: { groupId: g1.id }, select: { id: true, quantityText: true, recurrence: true, note: true }, orderBy: { id: "asc" } }),
    prisma.cabinetItem.findMany({ where: { groupId: g1.id }, select: { id: true, status: true, location: true, quantityText: true, expiresAt: true }, orderBy: { id: "asc" } }),
    prisma.shoppingListItem.findMany({ where: { groupId: g1.id }, select: { id: true, checked: true, reason: true, quantityText: true }, orderBy: { id: "asc" } }),
    prisma.groupInvite.findMany({ where: { groupId: g1.id }, select: { id: true, status: true }, orderBy: { id: "asc" } }),
  ]);
  return { group, members, prefs, cab, list, invites };
}

beforeAll(async () => {
  [A, A2, B] = await Promise.all([makeUser(), makeUser(), makeUser()]);
  g1 = await mkGroup(A, "Group One");
  g2 = await mkGroup(B, "Group Two");
  await join(A, g1.id, A2);
  const milk = await mkItem("XMilk", "dairy", ["milk"]);
  const bread = await mkItem("XBread", "bakery", ["wheat"]);
  const eggs = await mkItem("XEggs", "dairy", ["eggs"]);
  ids.item = milk.id;
  ids.pref = (await api().post(`/api/groups/${g1.id}/preferences`).set(A.auth).send({ itemId: milk.id, note: "secret note" }).expect(200)).body.id;
  ids.pref2 = (await api().post(`/api/groups/${g1.id}/preferences`).set(A2.auth).send({ itemId: eggs.id }).expect(200)).body.id;
  ids.cab = (await api().post(`/api/groups/${g1.id}/cabinet`).set(A.auth).send({ itemId: bread.id, location: "pantry" }).expect(200)).body.id;
  ids.list = (await api().post(`/api/groups/${g1.id}/shopping-list`).set(A.auth).send({ itemId: eggs.id, quantityText: "12" }).expect(200)).body.id;
  ids.invite = (await api().post(`/api/groups/${g1.id}/invites`).set(A.auth).send({ email: "someone-else@example.com" }).expect(201)).body.id;
  // B has its own data in group 2 so the group-2 routes are "live".
  await api().post(`/api/groups/${g2.id}/preferences`).set(B.auth).send({ itemId: milk.id }).expect(200);
});
afterAll(cleanup);

type Req = [method: "get" | "post" | "patch" | "delete", path: string, body?: object];

const g1Routes = (): Req[] => {
  const G = `/api/groups/${g1.id}`;
  return [
    ["get", G],
    ["patch", G, { name: "pwned" }],
    ["delete", G],
    ["get", `${G}/invites`],
    ["get", `${G}/invites?status=all`],
    ["post", `${G}/invites`, { email: "attacker@example.com" }],
    ["delete", `${G}/invites/${ids.invite}`],
    ["post", `${G}/leave`],
    ["delete", `${G}/members/${A2.id}`],
    ["get", `${G}/preferences?userId=all`],
    ["get", `${G}/preferences`],
    ["post", `${G}/preferences`, { itemId: ids.item }],
    ["patch", `${G}/preferences/${ids.pref}`, { note: "pwned" }],
    ["delete", `${G}/preferences/${ids.pref}`],
    ["get", `${G}/cabinet`],
    ["post", `${G}/cabinet`, { itemId: ids.item }],
    ["patch", `${G}/cabinet/${ids.cab}`, { status: "running_low" }],
    ["delete", `${G}/cabinet/${ids.cab}`],
    ["post", `${G}/cabinet/${ids.cab}/ran-out`],
    ["get", `${G}/shopping-list`],
    ["post", `${G}/shopping-list`, { itemId: ids.item }],
    ["post", `${G}/shopping-list/generate`],
    ["patch", `${G}/shopping-list/${ids.list}`, { checked: true }],
    ["post", `${G}/shopping-list/complete`],
    ["delete", `${G}/shopping-list/${ids.list}`],
  ];
};

const smuggled = (): Req[] => {
  const G = `/api/groups/${g2.id}`;
  return [
    ["patch", `${G}/preferences/${ids.pref}`, { note: "pwned" }],
    ["delete", `${G}/preferences/${ids.pref}`],
    ["patch", `${G}/cabinet/${ids.cab}`, { status: "running_low", quantityText: "pwned" }],
    ["delete", `${G}/cabinet/${ids.cab}`],
    ["post", `${G}/cabinet/${ids.cab}/ran-out`],
    ["patch", `${G}/shopping-list/${ids.list}`, { checked: true }],
    ["delete", `${G}/shopping-list/${ids.list}`],
    ["delete", `${G}/invites/${ids.invite}`],
    ["delete", `${G}/members/${A.id}`],
    ["delete", `${G}/members/${A2.id}`],
  ];
};

const send = ([m, p, body]: Req, u: U) => {
  const r = api()[m](p).set(u.auth);
  return body ? r.send(body) : r;
};

describe("cross-household access (B -> group 1)", () => {
  it("every /groups/<g1>/* route is 404 for a non-member, standard error shape, nothing leaked or changed", async () => {
    const before = await snapshot();
    for (const req of g1Routes()) {
      const r = await send(req, B);
      expect.soft(r.status, `${req[0]} ${req[1]}`).toBe(404);
      expect.soft(isErrorShape(r.body), `${req[0]} ${req[1]} shape`).toBe(true);
      expect.soft(JSON.stringify(r.body)).not.toMatch(/Group One|secret note|someone-else/);
    }
    expect(await snapshot()).toEqual(before);
  });

  it("group-1 ids under group 2's path are 404 and change nothing", async () => {
    const before = await snapshot();
    for (const req of smuggled()) {
      const r = await send(req, B);
      expect.soft(r.status, `${req[0]} ${req[1]}`).toBe(404);
      expect.soft(isErrorShape(r.body)).toBe(true);
    }
    expect(await snapshot()).toEqual(before);
  });

  it("B can't accept or decline group 1's invite addressed to someone else", async () => {
    const before = await snapshot();
    await api().post(`/api/invites/${ids.invite}/accept`).set(B.auth).expect(404);
    await api().post(`/api/invites/${ids.invite}/decline`).set(B.auth).expect(404);
    expect((await api().get("/api/me/invites").set(B.auth).expect(200)).body).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it("path spelling variants don't bypass the membership check", async () => {
    const before = await snapshot();
    const up = g1.id.toUpperCase();
    const variants: Req[] = [
      ["get", `/api/groups/${up}/cabinet`],
      ["get", `/API/GROUPS/${g1.id}/CABINET`],
      ["get", `/api//groups/${g1.id}/cabinet`],
      ["get", `/api/groups//${g1.id}/cabinet`],
      ["get", `/api/groups/${g1.id}/cabinet/`],
      ["get", `/api/groups/${g1.id}%2Fcabinet`],
      ["get", `/api/groups/%7B${g1.id}%7D/cabinet`],
      ["get", `/api/groups/${g1.id.replace(/-/g, "")}/cabinet`],
      ["get", `/api/groups/${g1.id}/./cabinet`],
      ["get", `/api/groups/${g2.id}/../${g1.id}/cabinet`],
      ["patch", `/api/groups/${up}/preferences/${ids.pref.toUpperCase()}`, { note: "pwned" }],
      ["get", `/api/groups/${g1.id};/cabinet`],
    ];
    for (const req of variants) {
      const r = await send(req, B);
      expect.soft(r.status, `${req[0]} ${req[1]}`).toBeGreaterThanOrEqual(400);
      expect.soft(r.status, `${req[0]} ${req[1]} no 500`).toBeLessThan(500);
      expect.soft(JSON.stringify(r.body)).not.toMatch(/XBread|XMilk|secret note/);
    }
    expect(await snapshot()).toEqual(before);
  });

  it("a removed member loses access immediately", async () => {
    const ex = await makeUser();
    await join(A, g1.id, ex);
    await api().get(`/api/groups/${g1.id}/shopping-list`).set(ex.auth).expect(200);
    await api().delete(`/api/groups/${g1.id}/members/${ex.id}`).set(A.auth).expect(204);
    for (const req of g1Routes().filter(([m]) => m === "get")) {
      expect.soft((await send(req, ex)).status, req[1]).toBe(404);
    }
  });

  it("within a group, a member can't edit or delete another member's preference (403) and the row is unchanged", async () => {
    const r1 = await api().patch(`/api/groups/${g1.id}/preferences/${ids.pref}`).set(A2.auth).send({ note: "x" });
    const r2 = await api().delete(`/api/groups/${g1.id}/preferences/${ids.pref}`).set(A2.auth);
    expect([r1.status, r2.status]).toEqual([403, 403]);
    expect((await prisma.preference.findUnique({ where: { id: ids.pref } }))?.note).toBe("secret note");
  });

  it("a non-owner member can't rename/delete the group, remove members, or revoke the owner's invite", async () => {
    await api().patch(`/api/groups/${g1.id}`).set(A2.auth).send({ name: "x" }).expect(403);
    await api().delete(`/api/groups/${g1.id}`).set(A2.auth).expect(403);
    await api().delete(`/api/groups/${g1.id}/members/${A.id}`).set(A2.auth).expect(403);
    await api().delete(`/api/groups/${g1.id}/invites/${ids.invite}`).set(A2.auth).expect(403);
    expect((await prisma.groupInvite.findUnique({ where: { id: ids.invite } }))?.status).toBe("pending");
  });
});
