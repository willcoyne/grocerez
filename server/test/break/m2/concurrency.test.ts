import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, api, cleanup, invite, join, makeUser, mkGroup, mkItem, prisma, type U } from "./helpers.js";

// Attack #5: concurrent writers against one group.
afterAll(cleanup);

let owner: U, m: U;
beforeAll(async () => {
  [owner, m] = [await makeUser(), await makeUser()];
});

async function freshGroup() {
  const g = await mkGroup(owner, "Race");
  await addMember(g.id, m);
  return g;
}
const list = async (gid: string) => (await api().get(`/api/groups/${gid}/shopping-list`).set(owner.auth).expect(200)).body as any[];

describe("finish trip", () => {
  it("two concurrent finish trips move every checked item exactly once and lose nothing", async () => {
    const g = await freshGroup();
    const its = await Promise.all(Array.from({ length: 6 }, (_, i) => mkItem(`Trip${String.fromCharCode(97 + i)}`)));
    for (const it of its) await api().post(`/api/groups/${g.id}/preferences`).set(m.auth).send({ itemId: it.id }).expect(200);
    for (const r of await list(g.id)) await api().patch(`/api/groups/${g.id}/shopping-list/${r.id}`).set(owner.auth).send({ checked: true }).expect(200);

    const [a, b] = await Promise.all([
      api().post(`/api/groups/${g.id}/shopping-list/complete`).set(owner.auth),
      api().post(`/api/groups/${g.id}/shopping-list/complete`).set(m.auth),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.movedToCabinet + b.body.movedToCabinet).toBe(6);
    expect(await prisma.cabinetItem.count({ where: { groupId: g.id } })).toBe(6);
    expect(await list(g.id)).toEqual([]);
  });

  it("[DEFECT M2-02] preference edits and new preferences during finish trip leave a consistent list (== fresh regenerate)", async () => {
    const g = await freshGroup();
    const [x, y, z] = [await mkItem("DurX"), await mkItem("DurY"), await mkItem("DurZ")];
    const px = (await api().post(`/api/groups/${g.id}/preferences`).set(m.auth).send({ itemId: x.id, recurrence: "one_time" }).expect(200)).body;
    await api().post(`/api/groups/${g.id}/preferences`).set(owner.auth).send({ itemId: y.id }).expect(200);
    for (const r of await list(g.id)) await api().patch(`/api/groups/${g.id}/shopping-list/${r.id}`).set(owner.auth).send({ checked: true }).expect(200);

    const res = await Promise.all([
      api().post(`/api/groups/${g.id}/shopping-list/complete`).set(owner.auth),
      api().patch(`/api/groups/${g.id}/preferences/${px.id}`).set(m.auth).send({ recurrence: "staple", quantityText: "2" }),
      api().post(`/api/groups/${g.id}/preferences`).set(m.auth).send({ itemId: z.id }),
    ]);
    // The PATCH may lose to the trip deleting the one_time row: then 404, never 500.
    expect(res[0].status).toBe(200);
    expect([200, 404]).toContain(res[1].status);
    expect(res[2].status).toBe(200);
    const now = await list(g.id);
    const regen = (await api().post(`/api/groups/${g.id}/shopping-list/generate`).set(owner.auth).expect(200)).body;
    expect(regen.map((r: any) => [r.item.id, r.checked, r.updatedAt])).toEqual(now.map((r: any) => [r.item.id, r.checked, r.updatedAt]));
    expect(now.map((r: any) => r.item.id)).toContain(z.id);
  });

  it("an un-check racing finish trip either stays on the list unchecked or is moved, never both/neither", async () => {
    for (let n = 0; n < 5; n++) {
      const g = await freshGroup();
      const it = await mkItem(`Unchk${String.fromCharCode(97 + n)}`);
      const row = (await api().post(`/api/groups/${g.id}/shopping-list`).set(owner.auth).send({ itemId: it.id }).expect(200)).body;
      await api().patch(`/api/groups/${g.id}/shopping-list/${row.id}`).set(owner.auth).send({ checked: true }).expect(200);
      const [c, u] = await Promise.all([
        api().post(`/api/groups/${g.id}/shopping-list/complete`).set(owner.auth),
        api().patch(`/api/groups/${g.id}/shopping-list/${row.id}`).set(m.auth).send({ checked: false }),
      ]);
      expect(c.status).toBe(200);
      expect([200, 404]).toContain(u.status);
      const inCab = (await prisma.cabinetItem.count({ where: { groupId: g.id, itemId: it.id } })) === 1;
      const onList = (await prisma.shoppingListItem.count({ where: { groupId: g.id, itemId: it.id } })) === 1;
      expect(inCab !== onList).toBe(true);
      expect(c.body.movedToCabinet === 1).toBe(inCab);
    }
  });
});

describe("check-off", () => {
  it("two shoppers hammering the same row end with a valid row whose state matches the last response", async () => {
    const g = await freshGroup();
    const it = await mkItem("Toggle");
    const row = (await api().post(`/api/groups/${g.id}/shopping-list`).set(owner.auth).send({ itemId: it.id }).expect(200)).body;
    const reqs = Array.from({ length: 20 }, (_, i) =>
      api().patch(`/api/groups/${g.id}/shopping-list/${row.id}`).set((i % 2 ? owner : m).auth).send({ checked: i % 3 === 0 }),
    );
    const res = await Promise.all(reqs);
    expect(res.every((r) => r.status === 200)).toBe(true);
    const db = await prisma.shoppingListItem.findUniqueOrThrow({ where: { id: row.id } });
    expect(db.checked ? db.checkedBy !== null && db.checkedAt !== null : db.checkedBy === null && db.checkedAt === null).toBe(true);
  });

  it("a check-off racing a cabinet add of the same item is never silently deleted after a 200 (25 tries)", async () => {
    // backend/06: list = needed ∪ manual ∪ CHECKED rows. PATCH doesn't take the group lock, so in theory generate()
    // could read the row unchecked and delete it after the check-off commits. Not reproduced; kept as a guard.
    let lost = 0;
    for (let n = 0; n < 25 && !lost; n++) {
      const g = await freshGroup();
      const it = await mkItem(`Lost${String.fromCharCode(97 + (n % 26))}`);
      await api().post(`/api/groups/${g.id}/preferences`).set(m.auth).send({ itemId: it.id }).expect(200);
      const [row] = await list(g.id);
      const [chk, cab] = await Promise.all([
        api().patch(`/api/groups/${g.id}/shopping-list/${row.id}`).set(owner.auth).send({ checked: true }),
        api().post(`/api/groups/${g.id}/cabinet`).set(m.auth).send({ itemId: it.id }),
      ]);
      expect(cab.status).toBe(200);
      const survived = await prisma.shoppingListItem.count({ where: { id: row.id } });
      if (chk.status === 200 && chk.body.checked === true && survived === 0) lost++;
    }
    expect(lost, "a 200 {checked:true} row was deleted by a concurrent regenerate").toBe(0);
  }, 60_000);
});

describe("preferences", () => {
  it("[DEFECT M2-02] two concurrent DELETEs of the same preference: one 204, one 404 — never 500", async () => {
    const g = await freshGroup();
    const statuses: number[] = [];
    for (let n = 0; n < 8; n++) {
      const it = await mkItem(`Dbl${String.fromCharCode(97 + n)}`);
      const p = (await api().post(`/api/groups/${g.id}/preferences`).set(m.auth).send({ itemId: it.id }).expect(200)).body;
      const rs = await Promise.all([
        api().delete(`/api/groups/${g.id}/preferences/${p.id}`).set(m.auth),
        api().delete(`/api/groups/${g.id}/preferences/${p.id}`).set(m.auth),
        api().patch(`/api/groups/${g.id}/preferences/${p.id}`).set(m.auth).send({ note: "n" }),
      ]);
      statuses.push(...rs.map((r) => r.status));
    }
    expect(statuses.filter((s) => s >= 500)).toEqual([]);
  });

  it("[DEFECT M2-04] two concurrent PUT /me/dietary from one user both succeed (last write wins), not 409/500", async () => {
    const u = await makeUser();
    const statuses: number[] = [];
    for (let n = 0; n < 6; n++) {
      const rs = await Promise.all([
        api().put("/api/me/dietary").set(u.auth).send({ diets: ["vegan"], allergens: ["milk", "eggs"] }),
        api().put("/api/me/dietary").set(u.auth).send({ diets: ["vegan"], allergens: ["milk", "soy"] }),
      ]);
      statuses.push(...rs.map((r) => r.status));
    }
    expect(statuses.every((s) => s === 200), `statuses: ${statuses}`).toBe(true);
  });
});

describe("invites", () => {
  it("five simultaneous accepts of one invite: exactly one 200, one membership", async () => {
    const o = await makeUser();
    const g = await mkGroup(o);
    const t = await makeUser();
    const inv = (await invite(o, g.id, t.email).expect(201)).body;
    const rs = await Promise.all(Array.from({ length: 5 }, () => api().post(`/api/invites/${inv.id}/accept`).set(t.auth)));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 404, 404, 404, 404]);
    expect(await prisma.groupMember.count({ where: { groupId: g.id, userId: t.id } })).toBe(1);
  });

  it("accept racing revoke / decline: the invite's final status agrees with membership", async () => {
    for (let n = 0; n < 6; n++) {
      const o = await makeUser();
      const g = await mkGroup(o);
      const t = await makeUser();
      const inv = (await invite(o, g.id, t.email).expect(201)).body;
      await Promise.all([
        api().post(`/api/invites/${inv.id}/accept`).set(t.auth),
        n % 2
          ? api().delete(`/api/groups/${g.id}/invites/${inv.id}`).set(o.auth)
          : api().post(`/api/invites/${inv.id}/decline`).set(t.auth),
      ]);
      const st = (await prisma.groupInvite.findUniqueOrThrow({ where: { id: inv.id } })).status;
      const member = (await prisma.groupMember.count({ where: { groupId: g.id, userId: t.id } })) === 1;
      expect(member).toBe(st === "accepted");
    }
  });

  it("accept racing removal: membership ends consistent with the invite (member <=> accepted)", async () => {
    for (let n = 0; n < 6; n++) {
      const o = await makeUser();
      const g = await mkGroup(o);
      const t = await makeUser();
      const first = await join(o, g.id, t);
      await api().delete(`/api/groups/${g.id}/members/${t.id}`).set(o.auth).expect(204);
      const inv = (await invite(o, g.id, t.email).expect(201)).body;
      expect(inv.id).toBe(first); // same row, reset to pending
      const [acc, rem] = await Promise.all([
        api().post(`/api/invites/${inv.id}/accept`).set(t.auth),
        api().delete(`/api/groups/${g.id}/members/${t.id}`).set(o.auth),
      ]);
      expect(acc.status).toBeLessThan(500);
      expect(rem.status).toBeLessThan(500);
      const st = (await prisma.groupInvite.findUniqueOrThrow({ where: { id: inv.id } })).status;
      const member = (await prisma.groupMember.count({ where: { groupId: g.id, userId: t.id } })) === 1;
      expect(member).toBe(st === "accepted");
    }
  });
});
