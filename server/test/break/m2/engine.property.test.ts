import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, cleanup, join, makeUser, mkGroup, mkItem, prisma, type U } from "./helpers.js";

// Attack #4: the shopping list engine end to end (real DB, real routes), with random groups, preferences,
// cabinets, manual rows and checked rows.

const ALLERGENS = ["milk", "eggs", "peanuts", "wheat", "soy"] as const;
type Row = { itemId: string; reason: string; checked: boolean; wantedBy: { userId: string }[]; allergenFlags: { userId: string; allergen: string }[] };

let users: U[] = [];
let items: { id: string; defaultAllergens: string[] }[] = [];

beforeAll(async () => {
  users = await Promise.all(Array.from({ length: 4 }, () => makeUser()));
  items = [];
  for (let i = 0; i < 6; i++) {
    const allergens = ALLERGENS.filter((_, j) => (i + j) % 3 === 0);
    items.push(await mkItem(`PItem${String.fromCharCode(97 + i)}`, "pantry", allergens));
  }
});
afterAll(cleanup);

// One random scenario: who is in the group, their allergens, prefs, cabinet, and pre-existing list rows.
const scenario = fc.record({
  memberCount: fc.integer({ min: 1, max: 4 }),
  allergens: fc.array(fc.subarray([...ALLERGENS]), { minLength: 4, maxLength: 4 }),
  prefs: fc.array(fc.record({ u: fc.nat(3), i: fc.nat(5), oneTime: fc.boolean() }), { maxLength: 12 }),
  cabinet: fc.array(fc.record({ i: fc.nat(5), low: fc.boolean() }), { maxLength: 6 }),
  rows: fc.array(fc.record({ i: fc.nat(5), manual: fc.boolean(), checked: fc.boolean() }), { maxLength: 6 }),
});

async function build(s: fc.RecordValue<typeof scenario> extends never ? never : any) {
  const owner = users[0];
  const g = await mkGroup(owner, "Prop");
  const members = users.slice(0, s.memberCount);
  if (members.length > 1) {
    await prisma.groupMember.createMany({ data: members.slice(1).map((u) => ({ groupId: g.id, userId: u.id, role: "member" as const })) });
  }
  for (const [k, u] of users.entries()) {
    await prisma.userAllergen.deleteMany({ where: { userId: u.id } });
    await prisma.userAllergen.createMany({ data: s.allergens[k].map((a: string) => ({ userId: u.id, allergen: a as never })) });
  }
  const prefs = new Map<string, { userId: string; itemId: string; oneTime: boolean }>();
  for (const p of s.prefs) {
    const u = members[p.u % members.length];
    prefs.set(`${u.id}:${items[p.i].id}`, { userId: u.id, itemId: items[p.i].id, oneTime: p.oneTime });
  }
  await prisma.preference.createMany({
    data: [...prefs.values()].map((p) => ({ groupId: g.id, userId: p.userId, itemId: p.itemId, recurrence: p.oneTime ? "one_time" as const : "staple" as const })),
  });
  const cab = new Map<string, boolean>();
  for (const c of s.cabinet) cab.set(items[c.i].id, c.low);
  await prisma.cabinetItem.createMany({
    data: [...cab].map(([itemId, low]) => ({ groupId: g.id, itemId, status: low ? "running_low" as const : "in_stock" as const })),
  });
  const rows = new Map<string, { manual: boolean; checked: boolean }>();
  for (const r of s.rows) rows.set(items[r.i].id, { manual: r.manual, checked: r.checked });
  await prisma.shoppingListItem.createMany({
    data: [...rows].map(([itemId, r]) => ({
      groupId: g.id, itemId, reason: r.manual ? "manual" as const : "preference" as const,
      checked: r.checked, checkedBy: r.checked ? owner.id : null, checkedAt: r.checked ? new Date() : null,
    })),
  });
  return { g, members, prefs, cab, rows, owner };
}

function expected(st: Awaited<ReturnType<typeof build>>, s: { allergens: string[][] }) {
  const inStock = new Set([...st.cab].filter(([, low]) => !low).map(([i]) => i));
  const desired = new Set([...st.prefs.values()].map((p) => p.itemId));
  const want = new Set([...desired].filter((i) => !inStock.has(i)));
  for (const [i, r] of st.rows) if (r.manual || r.checked) want.add(i);
  const flagsFor = (itemId: string) => {
    const has = items.find((x) => x.id === itemId)!.defaultAllergens;
    return st.members.flatMap((m) => {
      const k = users.indexOf(m);
      return s.allergens[k].filter((a) => has.includes(a)).map((a) => `${m.id}:${a}`);
    }).sort();
  };
  const wantedBy = (itemId: string) => [...st.prefs.values()].filter((p) => p.itemId === itemId).map((p) => p.userId).sort();
  return { want, flagsFor, wantedBy };
}

const loadList = async (gid: string, u: U) => (await api().get(`/api/groups/${gid}/shopping-list`).set(u.auth).expect(200)).body as Row[];

describe("generate: list == union(preferences) − in_stock ∪ manual ∪ checked", () => {
  it("holds for random groups; flags every member's allergens; wantedBy is exact; manual/checked rows keep their state", async () => {
    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        const st = await build(s);
        try {
          const list = (await api().post(`/api/groups/${st.g.id}/shopping-list/generate`).set(st.owner.auth).expect(200)).body as Row[];
          const { want, flagsFor, wantedBy } = expected(st, s);
          expect(new Set(list.map((r) => r.itemId ?? (r as any).item.id))).toEqual(want);
          for (const r of list) {
            const id = (r as any).item.id as string;
            expect(r.allergenFlags.map((f) => `${f.userId}:${f.allergen}`).sort()).toEqual(flagsFor(id));
            expect(r.wantedBy.map((w) => w.userId).sort()).toEqual(wantedBy(id));
            const pre = st.rows.get(id);
            if (pre) {
              expect(r.checked).toBe(pre.checked);
              expect(r.reason).toBe(pre.manual ? "manual" : "preference");
            } else {
              expect([r.reason, r.checked]).toEqual(["preference", false]);
            }
          }
          // Idempotent: a second run changes nothing.
          const again = (await api().post(`/api/groups/${st.g.id}/shopping-list/generate`).set(st.owner.auth).expect(200)).body as Row[];
          expect(again.map((r: any) => [r.id, r.updatedAt])).toEqual(list.map((r: any) => [r.id, r.updatedAt]));
        } finally {
          await prisma.group.delete({ where: { id: st.g.id } });
        }
      }),
      { numRuns: 30 },
    );
  }, 120_000);

  it("finish trip moves exactly the checked rows, drops only one_time prefs for them, and the rest regenerates", async () => {
    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        const st = await build(s);
        try {
          await api().post(`/api/groups/${st.g.id}/shopping-list/generate`).set(st.owner.auth).expect(200);
          const before = await loadList(st.g.id, st.owner);
          const checked = new Set(before.filter((r) => r.checked).map((r: any) => r.item.id as string));
          const unchecked = before.filter((r) => !r.checked);
          const res = await api().post(`/api/groups/${st.g.id}/shopping-list/complete`).set(st.owner.auth).expect(200);
          expect(res.body).toEqual({ movedToCabinet: checked.size });

          const cab = await prisma.cabinetItem.findMany({ where: { groupId: st.g.id }, select: { itemId: true, status: true } });
          for (const i of checked) expect(cab.find((c) => c.itemId === i)?.status).toBe("in_stock");
          // Cabinet rows of items that weren't bought are untouched.
          for (const [i, low] of st.cab) if (!checked.has(i)) expect(cab.find((c) => c.itemId === i)?.status).toBe(low ? "running_low" : "in_stock");

          const prefs = await prisma.preference.findMany({ where: { groupId: st.g.id }, select: { userId: true, itemId: true, recurrence: true } });
          for (const p of st.prefs.values()) {
            const still = prefs.some((x) => x.userId === p.userId && x.itemId === p.itemId);
            expect(still).toBe(!(p.oneTime && checked.has(p.itemId)));
          }
          const after = await loadList(st.g.id, st.owner);
          expect(after.some((r) => r.checked)).toBe(false);
          // Unchecked rows that were there survive unless their item is now in stock and they were preference rows.
          for (const r of unchecked) {
            const id = (r as any).item.id;
            if (r.reason === "manual") expect(after.some((x: any) => x.item.id === id)).toBe(true);
          }
          for (const r of after) expect(checked.has((r as any).item.id) && r.reason === "preference").toBe(false);
        } finally {
          await prisma.group.delete({ where: { id: st.g.id } });
        }
      }),
      { numRuns: 20 },
    );
  }, 120_000);
});

describe("engine examples", () => {
  let owner: U, m: U, g: { id: string };
  beforeAll(async () => {
    [owner, m] = [await makeUser(), await makeUser()];
    g = await mkGroup(owner, "Examples");
    await join(owner, g.id, m);
  });
  const L = () => loadList(g.id, owner);
  const has = async (itemId: string) => (await L()).find((r: any) => r.item.id === itemId) as any;

  it("ran out with a preference requeues; without one it doesn't (and the row leaves the cabinet either way)", async () => {
    const [a, b] = [await mkItem("RanA"), await mkItem("RanB")];
    await api().post(`/api/groups/${g.id}/preferences`).set(m.auth).send({ itemId: a.id }).expect(200);
    const ca = (await api().post(`/api/groups/${g.id}/cabinet`).set(owner.auth).send({ itemId: a.id }).expect(200)).body;
    const cb = (await api().post(`/api/groups/${g.id}/cabinet`).set(owner.auth).send({ itemId: b.id }).expect(200)).body;
    expect(await has(a.id)).toBeUndefined();
    expect((await api().post(`/api/groups/${g.id}/cabinet/${ca.id}/ran-out`).set(owner.auth).expect(200)).body).toEqual({ requeued: true });
    expect((await has(a.id)).reason).toBe("preference");
    expect((await api().post(`/api/groups/${g.id}/cabinet/${cb.id}/ran-out`).set(owner.auth).expect(200)).body).toEqual({ requeued: false });
    expect(await has(b.id)).toBeUndefined();
    expect(await prisma.cabinetItem.count({ where: { id: { in: [ca.id, cb.id] } } })).toBe(0);
    await api().post(`/api/groups/${g.id}/cabinet/${ca.id}/ran-out`).set(owner.auth).expect(404);
  });

  it("running low -> on the list and still in the cabinet; back in stock -> off the list (unless checked)", async () => {
    const [x, y] = [await mkItem("LowX"), await mkItem("LowY")];
    for (const it of [x, y]) await api().post(`/api/groups/${g.id}/preferences`).set(owner.auth).send({ itemId: it.id }).expect(200);
    const cx = (await api().post(`/api/groups/${g.id}/cabinet`).set(owner.auth).send({ itemId: x.id }).expect(200)).body;
    const cy = (await api().post(`/api/groups/${g.id}/cabinet`).set(owner.auth).send({ itemId: y.id }).expect(200)).body;
    await api().patch(`/api/groups/${g.id}/cabinet/${cx.id}`).set(owner.auth).send({ status: "running_low" }).expect(200);
    await api().patch(`/api/groups/${g.id}/cabinet/${cy.id}`).set(owner.auth).send({ status: "running_low" }).expect(200);
    expect(await has(x.id)).toBeDefined();
    expect(await prisma.cabinetItem.count({ where: { id: cx.id } })).toBe(1);
    const ry = await has(y.id);
    await api().patch(`/api/groups/${g.id}/shopping-list/${ry.id}`).set(m.auth).send({ checked: true }).expect(200);
    await api().patch(`/api/groups/${g.id}/cabinet/${cx.id}`).set(owner.auth).send({ status: "in_stock" }).expect(200);
    await api().patch(`/api/groups/${g.id}/cabinet/${cy.id}`).set(owner.auth).send({ status: "in_stock" }).expect(200);
    expect(await has(x.id)).toBeUndefined();
    expect((await has(y.id)).checked).toBe(true);
  });

  it("one_time is gone after finish trip, staple stays and comes back when it runs out", async () => {
    const [once, staple] = [await mkItem("Once"), await mkItem("Staple")];
    await api().post(`/api/groups/${g.id}/preferences`).set(m.auth).send({ itemId: once.id, recurrence: "one_time" }).expect(200);
    await api().post(`/api/groups/${g.id}/preferences`).set(m.auth).send({ itemId: staple.id, recurrence: "staple" }).expect(200);
    for (const it of [once, staple]) {
      const r = await has(it.id);
      await api().patch(`/api/groups/${g.id}/shopping-list/${r.id}`).set(owner.auth).send({ checked: true }).expect(200);
    }
    await api().post(`/api/groups/${g.id}/shopping-list/complete`).set(owner.auth).expect(200);
    expect(await prisma.preference.count({ where: { groupId: g.id, itemId: once.id } })).toBe(0);
    expect(await prisma.preference.count({ where: { groupId: g.id, itemId: staple.id } })).toBe(1);
    const cOnce = await prisma.cabinetItem.findFirstOrThrow({ where: { groupId: g.id, itemId: once.id } });
    const cStaple = await prisma.cabinetItem.findFirstOrThrow({ where: { groupId: g.id, itemId: staple.id } });
    expect((await api().post(`/api/groups/${g.id}/cabinet/${cOnce.id}/ran-out`).set(owner.auth)).body).toEqual({ requeued: false });
    expect((await api().post(`/api/groups/${g.id}/cabinet/${cStaple.id}/ran-out`).set(owner.auth)).body).toEqual({ requeued: true });
    expect(await has(once.id)).toBeUndefined();
    expect(await has(staple.id)).toBeDefined();
  });

  it("allergen flags follow membership and dietary changes for every member, not just the wanter", async () => {
    const pb = await mkItem("PBFlag", "pantry", ["peanuts"]);
    await api().post(`/api/groups/${g.id}/preferences`).set(owner.auth).send({ itemId: pb.id }).expect(200);
    await api().put("/api/me/dietary").set(m.auth).send({ diets: [], allergens: ["peanuts"] }).expect(200);
    expect((await has(pb.id)).allergenFlags.map((f: any) => f.userId)).toEqual([m.id]);
    const newbie = await makeUser();
    await prisma.userAllergen.create({ data: { userId: newbie.id, allergen: "peanuts" } });
    await join(owner, g.id, newbie);
    expect((await has(pb.id)).allergenFlags.map((f: any) => f.userId).sort()).toEqual([m.id, newbie.id].sort());
    await api().post(`/api/groups/${g.id}/leave`).set(newbie.auth).expect(204);
    expect((await has(pb.id)).allergenFlags.map((f: any) => f.userId)).toEqual([m.id]);
    await api().put("/api/me/dietary").set(m.auth).send({ diets: [], allergens: [] }).expect(200);
  });

  it("[DEFECT M2-03] allergen flag displayName goes stale after PATCH /me (list shows the old name until something else regenerates)", async () => {
    const pb = await mkItem("PBName", "pantry", ["peanuts"]);
    await api().put("/api/me/dietary").set(m.auth).send({ diets: [], allergens: ["peanuts"] }).expect(200);
    await api().post(`/api/groups/${g.id}/preferences`).set(owner.auth).send({ itemId: pb.id }).expect(200);
    await api().patch("/api/me").set(m.auth).send({ displayName: "Renamed Person" }).expect(200);
    const row = await has(pb.id);
    // wantedBy / checkedBy are resolved live; allergenFlags carry a snapshot of displayName.
    expect(row.allergenFlags[0].displayName).toBe("Renamed Person");
  });
});
