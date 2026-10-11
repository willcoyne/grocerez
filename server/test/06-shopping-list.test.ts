import { describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { regenerate } from "../src/modules/shopping-list/engine.js";
import { api, DEMO_GROUP_ID, itemId, makeGroup, makeUser, SEED_USERS, tokenFor, type TestUser } from "./helpers.js";

type ListRow = {
  id: string; itemId: string; item: { name: string; category: string }; reason: string; checked: boolean;
  checkedBy: string | null; checkedAt: string | null; wantedBy: { userId: string; displayName: string }[];
  allergenFlags: { userId: string; displayName: string; allergen: string }[]; quantityText: string | null; updatedAt: string;
};

async function getList(u: { auth: Record<string, string> } | Record<string, string>, groupId: string): Promise<ListRow[]> {
  const headers = "auth" in u ? (u.auth as Record<string, string>) : u;
  const res = await api().get(`/api/groups/${groupId}/shopping-list`).set(headers);
  expect(res.status).toBe(200);
  return res.body;
}

async function pref(u: TestUser, groupId: string, name: string, extra: Record<string, unknown> = {}) {
  const res = await api().post(`/api/groups/${groupId}/preferences`).set(u.auth).send({ itemId: await itemId(name), ...extra });
  expect(res.status).toBe(201);
  return res.body as { id: string };
}

describe("06 generate() on the seeded 4-user demo", () => {
  it("produces (∪ preferences) − in-stock cabinet with the board items Tostitos, Lay's, Oreos, and allergen badges", async () => {
    const auth = tokenFor(SEED_USERS[0]);
    const res = await api().post(`/api/groups/${DEMO_GROUP_ID}/shopping-list/generate`).set(auth);
    expect(res.status).toBe(200);
    const names = (res.body as ListRow[]).map((r) => r.item.name).sort();
    // Board example: everyone's wants minus Cheerios (in stock); Oreos are running low so they're needed too.
    expect(names).toEqual(["Bread", "Lay's", "Milk", "Oreos", "Peanut Butter", "Tostitos"]);
    const board = (res.body as ListRow[]).filter((r) => ["Tostitos", "Lay's", "Oreos"].includes(r.item.name));
    expect(board).toHaveLength(3);
    expect(names).not.toContain("Cheerios");

    // Independent set-math check against the database.
    const prefs = await prisma.preference.findMany({ where: { groupId: DEMO_GROUP_ID } });
    const have = new Set((await prisma.cabinetItem.findMany({ where: { groupId: DEMO_GROUP_ID, status: "in_stock" } })).map((c) => c.itemId));
    const needed = [...new Set(prefs.map((p) => p.itemId))].filter((i) => !have.has(i)).sort();
    expect((res.body as ListRow[]).map((r) => r.itemId).sort()).toEqual(needed);

    const byName = new Map((res.body as ListRow[]).map((r) => [r.item.name, r]));
    expect(byName.get("Milk")!.allergenFlags).toEqual([{ userId: SEED_USERS[2], displayName: "User 3", allergen: "milk" }]);
    expect(byName.get("Peanut Butter")!.allergenFlags).toEqual([{ userId: SEED_USERS[3], displayName: "User 4", allergen: "peanuts" }]);
    expect(byName.get("Oreos")!.wantedBy.map((w) => w.displayName).sort()).toEqual(["User 3", "User 4"]);
    expect(byName.get("Bread")!.quantityText).toBe("1 loaf");

    // Aisle order: categories in store order, then name.
    const order = ["produce", "bakery", "meat", "seafood", "dairy", "frozen", "pantry", "snacks", "beverages", "household", "other"];
    const cats = (res.body as ListRow[]).map((r) => order.indexOf(r.item.category));
    expect([...cats].sort((a, b) => a - b)).toEqual(cats);

    // Running generation again changes nothing.
    expect(await prisma.$transaction((tx) => regenerate(tx, DEMO_GROUP_ID))).toBe(0);
    const again = await api().post(`/api/groups/${DEMO_GROUP_ID}/shopping-list/generate`).set(auth);
    expect(again.body).toEqual(res.body);
  });
});

describe("06 list engine rules", () => {
  it("a checked row survives regeneration even when no longer needed; a removed preference drops its unchecked row", async () => {
    const a = await makeUser();
    const g = await makeGroup(a);
    const pMilk = await pref(a, g.id, "Milk");
    const pEggs = await pref(a, g.id, "Eggs");
    let list = await getList(a, g.id);
    const milkRow = list.find((r) => r.item.name === "Milk")!;
    await api().patch(`/api/groups/${g.id}/shopping-list/${milkRow.id}`).set(a.auth).send({ checked: true }).expect(200);

    await api().delete(`/api/groups/${g.id}/preferences/${pMilk.id}`).set(a.auth).expect(204);
    await api().delete(`/api/groups/${g.id}/preferences/${pEggs.id}`).set(a.auth).expect(204);
    list = await getList(a, g.id);
    expect(list.map((r) => r.item.name)).toEqual(["Milk"]);
    expect(list[0]).toMatchObject({ checked: true, checkedBy: a.id, wantedBy: [] });
  });

  it("check-off stamps checkedBy/checkedAt; unchecking clears them", async () => {
    const a = await makeUser();
    const g = await makeGroup(a);
    await pref(a, g.id, "Bread");
    const [row] = await getList(a, g.id);
    const on = await api().patch(`/api/groups/${g.id}/shopping-list/${row.id}`).set(a.auth).send({ checked: true });
    expect(on.body).toMatchObject({ checked: true, checkedBy: a.id });
    expect(on.body.checkedAt).toEqual(expect.any(String));
    const off = await api().patch(`/api/groups/${g.id}/shopping-list/${row.id}`).set(a.auth).send({ checked: false });
    expect(off.body).toMatchObject({ checked: false, checkedBy: null, checkedAt: null });
    expect((await api().patch(`/api/groups/${g.id}/shopping-list/${row.id}`).set(a.auth).send({})).status).toBe(400);
  });

  it("manual add upserts with reason 'manual' and survives regeneration; only manual rows can be deleted", async () => {
    const a = await makeUser();
    const g = await makeGroup(a);
    const salt = await itemId("Salt");
    const add = await api().post(`/api/groups/${g.id}/shopping-list`).set(a.auth).send({ itemId: salt, quantityText: "1 box" });
    expect(add.status).toBe(201);
    expect(add.body).toMatchObject({ reason: "manual", quantityText: "1 box", addedBy: a.id });
    await api().post(`/api/groups/${g.id}/shopping-list/generate`).set(a.auth).expect(200);
    expect((await getList(a, g.id)).map((r) => r.itemId)).toEqual([salt]);

    await pref(a, g.id, "Bread");
    const breadRow = (await getList(a, g.id)).find((r) => r.item.name === "Bread")!;
    const del = await api().delete(`/api/groups/${g.id}/shopping-list/${breadRow.id}`).set(a.auth);
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe("PREFERENCE_ROW");
    await api().delete(`/api/groups/${g.id}/shopping-list/${add.body.id}`).set(a.auth).expect(204);
    expect((await getList(a, g.id)).map((r) => r.item.name)).toEqual(["Bread"]);
  });

  it("finish trip moves exactly the checked items to the cabinet, deletes one_time prefs, keeps staples, in one go", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const g = await makeGroup(a, [b]);
    await pref(a, g.id, "Milk"); // staple
    await pref(b, g.id, "Bananas", { recurrence: "one_time" });
    await pref(b, g.id, "Bread");
    const list = await getList(a, g.id);
    const milk = list.find((r) => r.item.name === "Milk")!;
    const bananas = list.find((r) => r.item.name === "Bananas")!;
    await api().patch(`/api/groups/${g.id}/shopping-list/${milk.id}`).set(a.auth).send({ checked: true }).expect(200);
    await api().patch(`/api/groups/${g.id}/shopping-list/${bananas.id}`).set(b.auth).send({ checked: true }).expect(200);

    const done = await api().post(`/api/groups/${g.id}/shopping-list/complete`).set(a.auth);
    expect(done.status).toBe(200);
    expect(done.body).toEqual({ movedToCabinet: 2 });

    const cabinet = await api().get(`/api/groups/${g.id}/cabinet`).set(a.auth);
    expect(cabinet.body.map((c: { item: { name: string } }) => c.item.name).sort()).toEqual(["Bananas", "Milk"]);
    for (const c of cabinet.body) {
      expect(c).toMatchObject({ status: "in_stock", expirationSource: "estimated" });
      expect(c.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.purchasedAt).toEqual(expect.any(String));
    }
    expect((await getList(a, g.id)).map((r) => r.item.name)).toEqual(["Bread"]);
    const prefs = await prisma.preference.findMany({ where: { groupId: g.id }, include: { item: true } });
    expect(prefs.map((p) => p.item.name).sort()).toEqual(["Bread", "Milk"]);

    // Nothing checked → nothing moves.
    expect((await api().post(`/api/groups/${g.id}/shopping-list/complete`).set(a.auth)).body).toEqual({ movedToCabinet: 0 });
  });

  it("the board's loop: ran out → back on the list → bought → back in the cabinet", async () => {
    const a = await makeUser();
    const g = await makeGroup(a);
    const oreos = await itemId("Oreos");
    await pref(a, g.id, "Oreos");
    const c = await api().post(`/api/groups/${g.id}/cabinet`).set(a.auth).send({ itemId: oreos });
    expect(await getList(a, g.id)).toEqual([]);

    expect((await api().post(`/api/groups/${g.id}/cabinet/${c.body.id}/ran-out`).set(a.auth)).body).toEqual({ requeued: true });
    const [row] = await getList(a, g.id);
    expect(row.itemId).toBe(oreos);
    await api().patch(`/api/groups/${g.id}/shopping-list/${row.id}`).set(a.auth).send({ checked: true }).expect(200);
    await api().post(`/api/groups/${g.id}/shopping-list/complete`).set(a.auth).expect(200);
    const cab = await api().get(`/api/groups/${g.id}/cabinet`).set(a.auth);
    expect(cab.body.map((x: { itemId: string }) => x.itemId)).toEqual([oreos]);
    expect(await getList(a, g.id)).toEqual([]);
  });

  it("two phones checking items at the same time end up with the same state", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const g = await makeGroup(a, [b]);
    for (const n of ["Milk", "Eggs", "Bread", "Apples", "Bananas", "Oreos"]) await pref(a, g.id, n);
    const list = await getList(a, g.id);
    await Promise.all(
      list.map((r, i) =>
        api().patch(`/api/groups/${g.id}/shopping-list/${r.id}`).set((i % 2 ? b : a).auth).send({ checked: true }).expect(200),
      ),
    );
    const viewA = await getList(a, g.id);
    const viewB = await getList(b, g.id);
    expect(viewA).toEqual(viewB);
    expect(viewA.every((r) => r.checked)).toBe(true);
    const expectedChecker = new Map(list.map((r, i) => [r.id, i % 2 ? b.id : a.id]));
    for (const r of viewA) expect(r.checkedBy).toBe(expectedChecker.get(r.id));
    // Concurrent finish-trip calls: items move exactly once.
    const [r1, r2] = await Promise.all([
      api().post(`/api/groups/${g.id}/shopping-list/complete`).set(a.auth),
      api().post(`/api/groups/${g.id}/shopping-list/complete`).set(b.auth),
    ]);
    expect(r1.body.movedToCabinet + r2.body.movedToCabinet).toBe(list.length);
    expect(await prisma.cabinetItem.count({ where: { groupId: g.id } })).toBe(list.length);
  });

  it("a scanned product with allergens flags the item for an allergic member", async () => {
    const a = await makeUser();
    const b = await makeUser({ allergens: ["soy"] });
    const g = await makeGroup(a, [b]);
    await pref(a, g.id, "Tostitos");
    const [row] = await getList(a, g.id);
    expect(row.allergenFlags).toEqual([]);
    const product = await prisma.product.create({
      data: { itemId: row.itemId, gtin: "00028400090896", name: "Tostitos Scoops", source: "manual", allergens: [], mayContain: ["soy"], fetchedAt: new Date() },
    });
    const res = await api().patch(`/api/groups/${g.id}/shopping-list/${row.id}`).set(a.auth).send({ checked: true, scannedProductId: product.id });
    expect(res.body.allergenFlags).toEqual([{ userId: b.id, displayName: b.displayName, allergen: "soy" }]);
    expect(res.body.scannedProductId).toBe(product.id);
    await api().post(`/api/groups/${g.id}/shopping-list/complete`).set(a.auth).expect(200);
    const cab = await prisma.cabinetItem.findFirstOrThrow({ where: { groupId: g.id } });
    expect(cab.productId).toBe(product.id);
  });
});
