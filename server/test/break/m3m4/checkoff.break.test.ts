// Break tests (M3/M4): shopping-list check-off with scannedProductId (plan backend/06 steps 1.3, 4, 6 + backend/08).
// Tests named "[DEFECT M3-xx]" are expected to FAIL.
import { randomInt, randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../../src/app.js";
import { Group } from "../../../src/contracts/groups.js";
import { prisma } from "../../../src/db.js";
import { cleanupUsers, makeUser } from "../../helpers.js";

type U = Awaited<ReturnType<typeof makeUser>>;
const api = () => request(app);
const tag = randomUUID().replace(/[^a-f]/g, "").slice(0, 6) + "zk";
let a: U, a2: U, b: U, g: Group, gB: Group;
let snack: { id: string }, milkItem: { id: string };
const productIds: string[] = [];

const mkProduct = async (over: { allergens?: string[]; mayContain?: string[]; itemId?: string | null } = {}) => {
  const p = await prisma.product.create({
    data: {
      source: "openfoodfacts", fetchedAt: new Date(), gtin: `9${String(randomInt(1e11)).padStart(12, "0")}`, name: `Prod ${tag}`,
      allergens: (over.allergens ?? []) as never, mayContain: (over.mayContain ?? []) as never, ...(over.itemId && { itemId: over.itemId }),
    },
  });
  productIds.push(p.id);
  return p;
};
const listRow = async (itemId: string, gid = g.id, u = a) =>
  (await api().post(`/api/groups/${gid}/shopping-list`).set(u.auth).send({ itemId }).expect(200)).body as { id: string; allergenFlags: { userId: string; allergen: string }[] };
const check = (id: string, body: object, gid = g.id, u = a) => api().patch(`/api/groups/${gid}/shopping-list/${id}`).set(u.auth).send(body);
const flagsOf = (body: { allergenFlags: { userId: string; allergen: string }[] }) =>
  body.allergenFlags.map((f) => `${f.userId === a.id ? "a" : "a2"}:${f.allergen}`).sort();

beforeAll(async () => {
  [a, a2, b] = await Promise.all([makeUser(), makeUser(), makeUser()]);
  snack = await prisma.item.create({ data: { name: `Snackfoo ${tag}`, normalizedName: `snackfoo ${tag}`, category: "snacks", defaultAllergens: ["peanuts"] } });
  milkItem = await prisma.item.create({ data: { name: `Moomilk ${tag}`, normalizedName: `moomilk ${tag}`, category: "dairy", defaultAllergens: ["milk"] } });
  g = Group.parse((await api().post("/api/groups").set(a.auth).send({ name: "Check house" }).expect(201)).body);
  gB = Group.parse((await api().post("/api/groups").set(b.auth).send({ name: "Other house" }).expect(201)).body);
  await prisma.groupMember.create({ data: { groupId: g.id, userId: a2.id, role: "member" } });
  await prisma.userAllergen.createMany({ data: [{ userId: a.id, allergen: "peanuts" }, { userId: a2.id, allergen: "milk" }] });
});
beforeEach(async () => {
  await prisma.shoppingListItem.deleteMany({ where: { groupId: { in: [g.id, gB.id] } } });
  await prisma.cabinetItem.deleteMany({ where: { groupId: { in: [g.id, gB.id] } } });
});
afterAll(async () => {
  await cleanupUsers();
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.item.deleteMany({ where: { name: { endsWith: ` ${tag}` } } });
});

describe("scannedProductId validation", () => {
  it("nonexistent product -> 404 PRODUCT_NOT_FOUND; malformed -> 400; the row is unchanged", async () => {
    const row = await listRow(snack.id);
    const r1 = await check(row.id, { checked: true, scannedProductId: randomUUID() });
    expect(r1.status).toBe(404);
    expect(r1.body).toEqual({ error: { code: "PRODUCT_NOT_FOUND", message: expect.any(String) } });
    for (const bad of ["x", 5, "' OR 1=1 --", {}, ["a"]]) {
      const r = await check(row.id, { checked: true, scannedProductId: bad });
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe("VALIDATION_ERROR");
    }
    const db = await prisma.shoppingListItem.findUniqueOrThrow({ where: { id: row.id } });
    expect(db).toMatchObject({ checked: false, scannedProductId: null });
  });

  it("another group's list row can't be checked with a product (404, row untouched)", async () => {
    const rowB = await listRow(snack.id, gB.id, b);
    const p = await mkProduct({ allergens: ["peanuts"] });
    expect((await check(rowB.id, { checked: true, scannedProductId: p.id })).status).toBe(404); // A's group path
    expect((await check(rowB.id, { checked: true, scannedProductId: p.id }, gB.id)).status).toBe(404); // B's path, A's token
    expect(await prisma.shoppingListItem.findUniqueOrThrow({ where: { id: rowB.id } })).toMatchObject({ checked: false, scannedProductId: null });
  });
});

describe("allergen flags from the scanned product (backend/06 1.3)", () => {
  it("flags = product allergens ∪ may_contain, for every member", async () => {
    const row = await listRow(snack.id);
    expect(flagsOf(row)).toEqual(["a:peanuts"]);
    const p = await mkProduct({ allergens: ["milk"], mayContain: ["peanuts"] });
    const res = await check(row.id, { checked: true, scannedProductId: p.id });
    expect(res.status).toBe(200);
    expect(flagsOf(res.body)).toEqual(["a2:milk", "a:peanuts"]);
    // un-check clears the product, flags fall back to the catalog
    const un = await check(row.id, { checked: false });
    expect(un.body.scannedProductId).toBeNull();
    expect(flagsOf(un.body)).toEqual(["a:peanuts"]);
  });

  it("[DEFECT M3-10] a scanned product with no allergen data silently clears the catalog's peanut flag", async () => {
    // Open Food Facts has no allergens_tags for many products; mapOffProduct turns that into allergens: [].
    const row = await listRow(snack.id);
    const p = await mkProduct({ allergens: [], mayContain: [] });
    const res = await check(row.id, { checked: true, scannedProductId: p.id });
    expect(flagsOf(res.body)).toContain("a:peanuts");
  });

  it("[DEFECT M3-11] a product linked to a different catalog item is accepted and lands in the cabinet under the list item", async () => {
    const row = await listRow(milkItem.id);
    const peanutProduct = await mkProduct({ allergens: ["peanuts"], itemId: snack.id });
    const res = await check(row.id, { checked: true, scannedProductId: peanutProduct.id });
    expect(res.status).toBe(400); // or 409: the scanned product is not this list item
    await api().post(`/api/groups/${g.id}/shopping-list/complete`).set(a.auth).expect(200);
    const cab = await prisma.cabinetItem.findFirst({ where: { groupId: g.id, itemId: milkItem.id } });
    expect(cab?.productId ?? null).not.toBe(peanutProduct.id);
  });

  it("finish trip carries the scanned product into the cabinet row", async () => {
    const row = await listRow(snack.id);
    const p = await mkProduct({ allergens: ["peanuts"], itemId: snack.id });
    await check(row.id, { checked: true, scannedProductId: p.id }).expect(200);
    await api().post(`/api/groups/${g.id}/shopping-list/complete`).set(a.auth).expect(200);
    const cab = await prisma.cabinetItem.findFirstOrThrow({ where: { groupId: g.id, itemId: snack.id } });
    expect(cab.productId).toBe(p.id);
  });
});
