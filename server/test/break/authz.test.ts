/**
 * Attack 1: cross-household access. User B (household 2) aims every /groups/:groupId/* route and every :id route at
 * household 1, both under household 1's path and smuggled under household 2's own path. Any success is Critical.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/db.js";
import { api, expectErrorShape, guardNetwork, itemId, makeHousehold, snapshot, type Household } from "./helpers.js";

let h1: Household;
let h2: Household;

beforeAll(async () => {
  h1 = await makeHousehold("Victim");
  h2 = await makeHousehold("Attacker");
});
beforeEach(() => {
  guardNetwork();
});
afterEach(() => vi.restoreAllMocks());

type Req = { method: "get" | "post" | "patch" | "put" | "delete"; path: string; body?: object };

function send(r: Req, auth: { Authorization: string }) {
  const t = api()[r.method](r.path).set(auth);
  return r.body ? t.send(r.body) : t;
}

describe("attack 1: B's token against household 1's group path", () => {
  const routes = (): Req[] => {
    const g = `/api/groups/${h1.group.id}`;
    return [
      { method: "get", path: g },
      { method: "patch", path: g, body: { name: "pwned" } },
      { method: "delete", path: g },
      { method: "get", path: `${g}/invites?status=all` },
      { method: "post", path: `${g}/invites`, body: { email: h2.owner.email } },
      { method: "delete", path: `${g}/invites/${h1.inviteId}` },
      { method: "post", path: `${g}/leave` },
      { method: "delete", path: `${g}/members/${h1.member.id}` },
      { method: "get", path: `${g}/preferences?userId=all` },
      { method: "post", path: `${g}/preferences`, body: { itemId: h1.prefId } },
      { method: "patch", path: `${g}/preferences/${h1.prefId}`, body: { note: "pwned" } },
      { method: "delete", path: `${g}/preferences/${h1.prefId}` },
      { method: "get", path: `${g}/cabinet` },
      { method: "post", path: `${g}/cabinet`, body: { itemId: h1.prefId } },
      { method: "patch", path: `${g}/cabinet/${h1.cabinetId}`, body: { status: "running_low" } },
      { method: "post", path: `${g}/cabinet/${h1.cabinetId}/ran-out` },
      { method: "delete", path: `${g}/cabinet/${h1.cabinetId}` },
      { method: "get", path: `${g}/shopping-list` },
      { method: "post", path: `${g}/shopping-list/generate` },
      { method: "post", path: `${g}/shopping-list`, body: { itemId: h1.prefId } },
      { method: "patch", path: `${g}/shopping-list/${h1.listPrefRowId}`, body: { checked: true } },
      { method: "delete", path: `${g}/shopping-list/${h1.listManualRowId}` },
      { method: "post", path: `${g}/shopping-list/complete` },
      { method: "post", path: `${g}/shopping-list/prices`, body: { zipCode: "64105" } },
      { method: "get", path: `${g}/alerts` },
      { method: "post", path: `${g}/alerts/recalls/${h1.recallMatchId}/dismiss` },
      { method: "post", path: `${g}/recipes/suggest`, body: {} },
    ];
  };

  it("every route answers 404 NOT_FOUND (group hidden) and household 1 is unchanged", async () => {
    const before = await snapshot(h1.group.id);
    const failures: string[] = [];
    for (const r of routes()) {
      const res = await send(r, h2.owner.auth);
      if (res.status !== 404 || res.body?.error?.code !== "NOT_FOUND") failures.push(`${r.method.toUpperCase()} ${r.path} → ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
      else expectErrorShape(res, 404, "NOT_FOUND");
    }
    expect(failures).toEqual([]);
    expect(await snapshot(h1.group.id)).toEqual(before);
  });

  it("the response for a real-but-foreign group is identical to a random unknown group (no existence oracle)", async () => {
    const real = await api().get(`/api/groups/${h1.group.id}/cabinet`).set(h2.owner.auth);
    const fake = await api().get(`/api/groups/7a1d9a2e-1d7e-4c55-9c1e-3f1b2c3d4e5f/cabinet`).set(h2.owner.auth);
    expect(real.status).toBe(fake.status);
    expect(real.body).toEqual(fake.body);
  });
});

describe("attack 1: household 1's ids smuggled under B's own group path", () => {
  const routes = (): Req[] => {
    const g = `/api/groups/${h2.group.id}`;
    return [
      { method: "patch", path: `${g}/preferences/${h1.prefId}`, body: { note: "pwned" } },
      { method: "delete", path: `${g}/preferences/${h1.prefId}` },
      { method: "patch", path: `${g}/cabinet/${h1.cabinetId}`, body: { status: "running_low", quantityText: "pwned" } },
      { method: "post", path: `${g}/cabinet/${h1.cabinetId}/ran-out` },
      { method: "delete", path: `${g}/cabinet/${h1.cabinetId}` },
      { method: "patch", path: `${g}/shopping-list/${h1.listPrefRowId}`, body: { checked: true } },
      { method: "patch", path: `${g}/shopping-list/${h1.listManualRowId}`, body: { checked: true } },
      { method: "delete", path: `${g}/shopping-list/${h1.listManualRowId}` },
      { method: "delete", path: `${g}/invites/${h1.inviteId}` },
      { method: "post", path: `${g}/alerts/recalls/${h1.recallMatchId}/dismiss` },
      { method: "delete", path: `${g}/members/${h1.member.id}` },
    ];
  };

  it("every :id route answers 404 and household 1 is unchanged", async () => {
    const before = await snapshot(h1.group.id);
    const failures: string[] = [];
    for (const r of routes()) {
      const res = await send(r, h2.owner.auth);
      if (res.status !== 404) failures.push(`${r.method.toUpperCase()} ${r.path} → ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
      else expectErrorShape(res, 404);
    }
    expect(failures).toEqual([]);
    expect(await snapshot(h1.group.id)).toEqual(before);
  });

  it("B's list/cabinet/preference/alerts reads never contain household 1 rows", async () => {
    const g = `/api/groups/${h2.group.id}`;
    const h1Ids = new Set([h1.prefId, h1.memberPrefId, h1.cabinetId, h1.listPrefRowId, h1.listManualRowId, h1.inviteId, h1.recallMatchId]);
    for (const p of ["/preferences?userId=all", "/cabinet", "/shopping-list", "/invites?status=all"]) {
      const res = await api().get(`${g}${p}`).set(h2.owner.auth).expect(200);
      for (const row of res.body as { id: string; groupId: string }[]) {
        expect(h1Ids.has(row.id)).toBe(false);
        expect(row.groupId).toBe(h2.group.id);
      }
    }
    const alerts = await api().get(`${g}/alerts`).set(h2.owner.auth).expect(200);
    for (const r of alerts.body.recalls) expect(h1Ids.has(r.id)).toBe(false);
  });
});

describe("attack 1: invites and non-group routes", () => {
  it("B cannot accept or decline household 1's invite (404 INVITE_NOT_FOUND) and doesn't see it in /me/invites", async () => {
    const before = await snapshot(h1.group.id);
    const acc = await api().post(`/api/invites/${h1.inviteId}/accept`).set(h2.owner.auth);
    expectErrorShape(acc, 404, "INVITE_NOT_FOUND");
    const dec = await api().post(`/api/invites/${h1.inviteId}/decline`).set(h2.owner.auth);
    expectErrorShape(dec, 404, "INVITE_NOT_FOUND");
    const mine = await api().get("/api/me/invites").set(h2.owner.auth).expect(200);
    expect((mine.body as { id: string }[]).map((i) => i.id)).not.toContain(h1.inviteId);
    expect(await snapshot(h1.group.id)).toEqual(before);
  });

  it("GET /groups lists only B's own groups", async () => {
    const res = await api().get("/api/groups").set(h2.owner.auth).expect(200);
    expect((res.body as { id: string }[]).map((g) => g.id)).not.toContain(h1.group.id);
  });
});

describe("attack 1: inside one household (role and ownership checks)", () => {
  it("a member cannot rename/delete the group or remove the owner (403), nor edit/delete the owner's preference (403)", async () => {
    const g = `/api/groups/${h1.group.id}`;
    const before = await snapshot(h1.group.id);
    expectErrorShape(await api().patch(g).set(h1.member.auth).send({ name: "mine now" }), 403, "FORBIDDEN");
    expectErrorShape(await api().delete(g).set(h1.member.auth), 403, "FORBIDDEN");
    expectErrorShape(await api().delete(`${g}/members/${h1.owner.id}`).set(h1.member.auth), 403, "FORBIDDEN");
    expectErrorShape(await api().patch(`${g}/preferences/${h1.prefId}`).set(h1.member.auth).send({ note: "x" }), 403, "FORBIDDEN");
    expectErrorShape(await api().delete(`${g}/preferences/${h1.prefId}`).set(h1.member.auth), 403, "FORBIDDEN");
    expectErrorShape(await api().delete(`${g}/invites/${h1.inviteId}`).set(h1.member.auth), 403, "FORBIDDEN");
    expect(await snapshot(h1.group.id)).toEqual(before);
  });

  it("a removed member's token gets 404 on every group route afterwards", async () => {
    const h = await makeHousehold("Removal");
    const g = `/api/groups/${h.group.id}`;
    await api().delete(`${g}/members/${h.member.id}`).set(h.owner.auth).expect(204);
    for (const p of ["", "/cabinet", "/shopping-list", "/preferences?userId=all", "/invites", "/alerts"]) {
      expectErrorShape(await api().get(`${g}${p}`).set(h.member.auth), 404, "NOT_FOUND");
    }
    const milk = await itemId("Milk");
    expectErrorShape(await api().post(`${g}/preferences`).set(h.member.auth).send({ itemId: milk }), 404);
    expect(await prisma.preference.count({ where: { groupId: h.group.id, userId: h.member.id } })).toBe(0);
  });
});
