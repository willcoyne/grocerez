import { describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { estimateExpiration } from "../src/lib/expiration.js";
import { api, itemId, makeGroup, makeUser, type TestUser } from "./helpers.js";

async function setup() {
  const owner = await makeUser();
  const member = await makeUser();
  const g = await makeGroup(owner, [member]);
  return { owner, member, g };
}

const listItemIds = async (groupId: string) =>
  (await prisma.shoppingListItem.findMany({ where: { groupId } })).map((r) => r.itemId).sort();

async function addPref(u: TestUser, groupId: string, name: string) {
  return api().post(`/api/groups/${groupId}/preferences`).set(u.auth).send({ itemId: await itemId(name) }).expect(201);
}

describe("05 cabinet", () => {
  it("POST adds an item (estimated expiration), removes it from the list, and upserts on (group, item)", async () => {
    const { owner, member, g } = await setup();
    const milk = await itemId("Milk");
    await addPref(owner, g.id, "Milk");
    expect(await listItemIds(g.id)).toEqual([milk]);

    const res = await api().post(`/api/groups/${g.id}/cabinet`).set(member.auth).send({ itemId: milk, location: "fridge", quantityText: "1 gal" });
    expect(res.status).toBe(201);
    const item = await prisma.item.findUniqueOrThrow({ where: { id: milk } });
    expect(res.body).toMatchObject({
      itemId: milk, item: { name: "Milk" }, status: "in_stock", location: "fridge", quantityText: "1 gal",
      expiresAt: estimateExpiration(item)!.toISOString().slice(0, 10), expirationSource: "estimated", addedBy: member.id,
    });
    expect(await listItemIds(g.id)).toEqual([]);

    const again = await api().post(`/api/groups/${g.id}/cabinet`).set(member.auth).send({ itemId: milk, expiresAt: "2030-01-02" });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ id: res.body.id, expiresAt: "2030-01-02", expirationSource: "manual", location: "fridge" });
  });

  it("running low → on the list AND still in the cabinet; back to in_stock removes it", async () => {
    const { owner, g } = await setup();
    const bread = await itemId("Bread");
    await addPref(owner, g.id, "Bread");
    const c = await api().post(`/api/groups/${g.id}/cabinet`).set(owner.auth).send({ itemId: bread });
    expect(await listItemIds(g.id)).toEqual([]);

    const low = await api().patch(`/api/groups/${g.id}/cabinet/${c.body.id}`).set(owner.auth).send({ status: "running_low" });
    expect(low.status).toBe(200);
    expect(low.body.status).toBe("running_low");
    expect(await listItemIds(g.id)).toEqual([bread]);
    expect(await prisma.cabinetItem.count({ where: { id: c.body.id } })).toBe(1);

    await api().patch(`/api/groups/${g.id}/cabinet/${c.body.id}`).set(owner.auth).send({ status: "in_stock" }).expect(200);
    expect(await listItemIds(g.id)).toEqual([]);
  });

  it("ran out + in preferences → back on the list ({requeued:true}); not wanted → {requeued:false}", async () => {
    const { owner, member, g } = await setup();
    const oreos = await itemId("Oreos");
    const eggs = await itemId("Eggs");
    await addPref(member, g.id, "Oreos");
    const c1 = await api().post(`/api/groups/${g.id}/cabinet`).set(owner.auth).send({ itemId: oreos });
    const c2 = await api().post(`/api/groups/${g.id}/cabinet`).set(owner.auth).send({ itemId: eggs });

    const r1 = await api().post(`/api/groups/${g.id}/cabinet/${c1.body.id}/ran-out`).set(owner.auth);
    expect(r1.status).toBe(200);
    expect(r1.body).toEqual({ requeued: true });
    const row = await prisma.shoppingListItem.findFirstOrThrow({ where: { groupId: g.id, itemId: oreos } });
    expect(row.reason).toBe("preference");
    expect(row.wantedBy).toEqual([member.id]);
    expect(await prisma.cabinetItem.count({ where: { id: c1.body.id } })).toBe(0);

    const r2 = await api().post(`/api/groups/${g.id}/cabinet/${c2.body.id}/ran-out`).set(owner.auth);
    expect(r2.body).toEqual({ requeued: false });
    expect(await listItemIds(g.id)).toEqual([oreos]);
  });

  it("PATCH expiresAt sets a manual date; null clears it; DELETE removes without re-adding to the list", async () => {
    const { owner, g } = await setup();
    const chips = await itemId("Tostitos");
    await addPref(owner, g.id, "Tostitos");
    const c = await api().post(`/api/groups/${g.id}/cabinet`).set(owner.auth).send({ itemId: chips });
    const p = await api().patch(`/api/groups/${g.id}/cabinet/${c.body.id}`).set(owner.auth).send({ expiresAt: "2031-05-06" });
    expect(p.body).toMatchObject({ expiresAt: "2031-05-06", expirationSource: "manual" });
    const cleared = await api().patch(`/api/groups/${g.id}/cabinet/${c.body.id}`).set(owner.auth).send({ expiresAt: null });
    expect(cleared.body).toMatchObject({ expiresAt: null, expirationSource: null });
    expect((await api().patch(`/api/groups/${g.id}/cabinet/${c.body.id}`).set(owner.auth).send({ expiresAt: "May 6" })).status).toBe(400);

    await api().delete(`/api/groups/${g.id}/cabinet/${c.body.id}`).set(owner.auth).expect(204);
    expect(await listItemIds(g.id)).toEqual([]);
  });

  it("GET sorts by expiresAt (nulls last) then name, filters by location/status, and is group-scoped", async () => {
    const { owner, g } = await setup();
    const other = await setup();
    const add = (name: string, body: Record<string, unknown>) =>
      itemId(name).then((id) => api().post(`/api/groups/${g.id}/cabinet`).set(owner.auth).send({ itemId: id, ...body }));
    await add("Paper Towels", { location: "other" }); // household: no estimate
    await add("Apples", { expiresAt: "2030-01-01", location: "fridge" });
    await add("Bananas", { expiresAt: "2029-01-01", location: "pantry" });
    const res = await api().get(`/api/groups/${g.id}/cabinet`).set(owner.auth);
    expect(res.body.map((r: { item: { name: string } }) => r.item.name)).toEqual(["Bananas", "Apples", "Paper Towels"]);
    const fridge = await api().get(`/api/groups/${g.id}/cabinet?location=fridge`).set(owner.auth);
    expect(fridge.body.map((r: { item: { name: string } }) => r.item.name)).toEqual(["Apples"]);
    expect((await api().get(`/api/groups/${g.id}/cabinet?status=running_low`).set(owner.auth)).body).toEqual([]);

    // Someone else's cabinet row id can't be touched through my group.
    const foreign = await api().post(`/api/groups/${other.g.id}/cabinet`).set(other.owner.auth).send({ itemId: await itemId("Milk") });
    expect((await api().patch(`/api/groups/${g.id}/cabinet/${foreign.body.id}`).set(owner.auth).send({ status: "running_low" })).status).toBe(404);
    expect((await api().post(`/api/groups/${g.id}/cabinet/${foreign.body.id}/ran-out`).set(owner.auth)).status).toBe(404);
    expect((await api().delete(`/api/groups/${g.id}/cabinet/${foreign.body.id}`).set(owner.auth)).status).toBe(404);
  });
  it("GET returns allergens = item defaults ∪ product allergens ∪ may_contain, plus product calories, health score, ingredients and serving size", async () => {
    const { owner, g } = await setup();
    const milk = await itemId("Milk");
    const plain = await api().post(`/api/groups/${g.id}/cabinet`).set(owner.auth).send({ itemId: milk });
    const item = await prisma.item.findUniqueOrThrow({ where: { id: milk } });
    expect(plain.body.product).toBeNull();
    expect(plain.body.allergens).toEqual(item.defaultAllergens);

    const product = await prisma.product.create({
      data: {
        itemId: milk, gtin: "00070038000563", name: "Chocolate Milk", brand: "Moo", source: "manual",
        allergens: ["soy", "milk"], mayContain: ["peanuts"], caloriesPerServing: 190.5, healthScore: "C", fetchedAt: new Date(),
        ingredients: "Milk, sugar, cocoa, soy lecithin", servingSize: "1 cup (240 ml)",
      },
    });
    await prisma.cabinetItem.update({ where: { id: plain.body.id }, data: { productId: product.id } });
    const res = await api().get(`/api/groups/${g.id}/cabinet`).set(owner.auth);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].product).toMatchObject({
      id: product.id, brand: "Moo", caloriesPerServing: 190.5, healthScore: "C",
      ingredients: "Milk, sugar, cocoa, soy lecithin", servingSize: "1 cup (240 ml)",
    });
    // Deduped, in ALLERGENS order (milk, peanuts, soy), and the catalog default (milk) is kept.
    expect(res.body[0].allergens).toEqual(["milk", "peanuts", "soy"]);
  });
  it("GET returns ingredients and servingSize as null when the linked product has no label text", async () => {
    const { owner, g } = await setup();
    const milk = await itemId("Milk");
    const row = await api().post(`/api/groups/${g.id}/cabinet`).set(owner.auth).send({ itemId: milk });
    const product = await prisma.product.create({
      data: { itemId: milk, gtin: "00070038000570", name: "Plain Milk", source: "manual", fetchedAt: new Date() },
    });
    await prisma.cabinetItem.update({ where: { id: row.body.id }, data: { productId: product.id } });
    const res = await api().get(`/api/groups/${g.id}/cabinet`).set(owner.auth);
    expect(res.body[0].product).toMatchObject({ id: product.id, ingredients: null, servingSize: null });
  });
});
