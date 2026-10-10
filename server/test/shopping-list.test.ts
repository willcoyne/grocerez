import { randomUUID } from "node:crypto";
import fc from "fast-check";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app.js";
import { Group, Invite } from "../src/contracts/groups.js";
import { CabinetItem } from "../src/contracts/cabinet.js";
import { ShoppingListItem } from "../src/contracts/shoppingList.js";
import { prisma } from "../src/db.js";
import * as realtime from "../src/lib/realtime.js";
import { setMath } from "../src/modules/shopping-list/service.js";
import { cleanupUsers, makeUser } from "./helpers.js";

type U = Awaited<ReturnType<typeof makeUser>>;
type Allergen = "milk" | "peanuts" | "wheat" | "soy";
const api = () => request(app);
const emit = vi.spyOn(realtime, "emitGroup");
const tag = randomUUID().slice(0, 8).replace(/\d/g, "x"); // keeps these catalog items private to this run
const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

let u1: U, u2: U, u3: U, u4: U, outsider: U, g: Group, other: Group;
const it_ = {} as Record<"cheerios" | "tostitos" | "lays" | "oreos" | "pb" | "apples", { id: string; name: string }>;

type Prod = { id: string };
const mkProduct = (name: string, data: { allergens?: Allergen[]; mayContain?: Allergen[]; brand?: string } = {}): Promise<Prod> =>
  prisma.product.create({ data: { name: `${name} ${tag}`, source: "manual", fetchedAt: new Date(), ...data } });

const mkItem = (name: string, category: string, defaultAllergens: Allergen[] = []) =>
  prisma.item.create({ data: { name: `${name} ${tag}`, normalizedName: `${name.toLowerCase()} ${tag}`, category, defaultAllergens } });

beforeAll(async () => {
  [u1, u2, u3, u4, outsider] = await Promise.all([makeUser(), makeUser(), makeUser(), makeUser(), makeUser()]);
  it_.cheerios = await mkItem("Cheerios", "pantry");
  it_.tostitos = await mkItem("Tostitos", "snacks");
  it_.lays = await mkItem("Lays", "snacks");
  it_.oreos = await mkItem("Oreos", "snacks", ["wheat", "soy", "milk"]);
  it_.pb = await mkItem("Peanut Butter", "pantry", ["peanuts"]);
  it_.apples = await mkItem("Apples", "produce");
  g = Group.parse((await api().post("/api/groups").set(u1.auth).send({ name: "Hack Midwest House" }).expect(201)).body);
  other = Group.parse((await api().post("/api/groups").set(outsider.auth).send({ name: "Elsewhere" }).expect(201)).body);
  for (const u of [u2, u3, u4]) {
    const inv = Invite.parse((await api().post(`/api/groups/${g.id}/invites`).set(u1.auth).send({ email: u.email }).expect(201)).body);
    await api().post(`/api/invites/${inv.id}/accept`).set(u.auth).expect(200);
  }
  await prisma.userAllergen.createMany({ data: [{ userId: u3.id, allergen: "milk" }, { userId: u4.id, allergen: "peanuts" }] });
});

// The seeded 4-user demo (database/10): union {Cheerios, Tostitos, Lay's, Oreos}; Cheerios in stock, Oreos running low.
beforeEach(async () => {
  for (const gid of [g.id, other.id]) {
    await prisma.shoppingListItem.deleteMany({ where: { groupId: gid } });
    await prisma.cabinetItem.deleteMany({ where: { groupId: gid } });
    await prisma.preference.deleteMany({ where: { groupId: gid } });
  }
  const pref = (u: U, item: { id: string }, recurrence: "staple" | "one_time" = "staple", quantityText?: string) => ({
    groupId: g.id,
    userId: u.id,
    itemId: item.id,
    recurrence,
    quantityText,
  });
  await prisma.preference.createMany({
    data: [
      pref(u1, it_.cheerios),
      pref(u2, it_.tostitos, "one_time"),
      pref(u2, it_.cheerios),
      pref(u3, it_.lays, "staple", "2 bags"),
      pref(u3, it_.oreos),
      pref(u4, it_.oreos),
      pref(u4, it_.lays, "staple", "family size"),
    ],
  });
  await prisma.cabinetItem.createMany({
    data: [
      { groupId: g.id, itemId: it_.cheerios.id, status: "in_stock" },
      { groupId: g.id, itemId: it_.oreos.id, status: "running_low", expiresAt: new Date(`${plusDays(2)}T00:00:00Z`) },
    ],
  });
  emit.mockClear();
});

afterAll(async () => {
  await cleanupUsers();
  await prisma.product.deleteMany({ where: { name: { endsWith: ` ${tag}` } } });
  await prisma.item.deleteMany({ where: { name: { endsWith: ` ${tag}` } } });
  await prisma.$disconnect();
});

const base = () => `/api/groups/${g.id}/shopping-list`;
const parseList = (body: unknown) => ShoppingListItem.array().parse(body);
const generate = async (u = u1) => parseList((await api().post(`${base()}/generate`).set(u.auth).expect(200)).body);
const getList = async (u = u1) => parseList((await api().get(base()).set(u.auth).expect(200)).body);
const names = (rows: ShoppingListItem[]) => rows.map((r) => r.item.name.replace(` ${tag}`, ""));
const row = (rows: ShoppingListItem[], item: { id: string }) => rows.find((r) => r.item.id === item.id)!;
const check = async (u: U, id: string, body: object) =>
  ShoppingListItem.parse((await api().patch(`${base()}/${id}`).set(u.auth).send(body).expect(200)).body);
const complete = async (u = u1) => (await api().post(`${base()}/complete`).set(u.auth).expect(200)).body as { movedToCabinet: number };
const prefId = async (u: U, item: { id: string }) =>
  (await prisma.preference.findFirstOrThrow({ where: { groupId: g.id, userId: u.id, itemId: item.id } })).id;
const events = () => emit.mock.calls.map((c) => c[1]);

describe("generate (seeded demo)", () => {
  it("lists Tostitos, Lay's, Oreos with wantedBy, combined quantities and allergen flags for every member", async () => {
    const list = await generate();
    expect(names(list)).toEqual(["Lays", "Oreos", "Tostitos"]); // all snacks: sorted by name
    expect(events()).toEqual(["shopping-list:changed"]);

    const lays = row(list, it_.lays);
    expect(lays).toMatchObject({ reason: "preference", checked: false, allergenFlags: [] });
    expect(lays.quantityText!.split(", ").sort()).toEqual(["2 bags", "family size"]); // combined
    expect(lays.wantedBy.map((w) => w.userId).sort()).toEqual([u3.id, u4.id].sort());

    // Oreos contain milk: u3 is flagged. u4 (peanuts) isn't. Everyone is checked, not only those who want it.
    const oreos = row(list, it_.oreos);
    expect(oreos.allergenFlags).toEqual([{ userId: u3.id, displayName: expect.any(String), allergen: "milk" }]);
    expect(row(list, it_.tostitos).wantedBy.map((w) => w.userId)).toEqual([u2.id]);

    expect(await getList(u4)).toEqual(list);
  });

  it("is idempotent: a second run changes nothing and never duplicates", async () => {
    const first = await generate();
    const second = await generate();
    expect(second).toEqual(first); // updatedAt included
    expect(await prisma.shoppingListItem.count({ where: { groupId: g.id } })).toBe(3);
  });

  it("sorts by store aisle, then name; flags a manual row's allergens for a member who doesn't want it", async () => {
    await generate();
    const pb = ShoppingListItem.parse(
      (await api().post(base()).set(u2.auth).send({ itemId: it_.pb.id, quantityText: "1 jar" }).expect(200)).body,
    );
    expect(pb).toMatchObject({ reason: "manual", quantityText: "1 jar", wantedBy: [], addedBy: { userId: u2.id } });
    expect(pb.allergenFlags).toEqual([{ userId: u4.id, displayName: expect.any(String), allergen: "peanuts" }]);
    await api().post(base()).set(u1.auth).send({ itemId: it_.apples.id }).expect(200);
    expect(names(await getList())).toEqual(["Apples", "Peanut Butter", "Lays", "Oreos", "Tostitos"]); // produce, pantry, snacks
  });

  it("set math property: list = (desired − have) ∪ manual ∪ checked", () => {
    const ids = fc.constantFrom("a", "b", "c", "d", "e", "f");
    fc.assert(
      fc.property(
        fc.uniqueArray(ids),
        fc.uniqueArray(ids),
        fc.uniqueArray(fc.record({ itemId: ids, reason: fc.constantFrom("preference" as const, "manual" as const), checked: fc.boolean() }), {
          selector: (r) => r.itemId,
        }),
        (desired, have, raw) => {
          const rows = raw.map((r, i) => ({ ...r, id: String(i) }));
          const { needed, remove, create } = setMath(desired, have, rows);
          const removed = new Set(remove.map((r) => r.id));
          const result = new Set([...rows.filter((r) => !removed.has(r.id)).map((r) => r.itemId), ...create]);
          const expected = new Set([
            ...desired.filter((d) => !have.includes(d)),
            ...rows.filter((r) => r.reason === "manual" || r.checked).map((r) => r.itemId),
          ]);
          expect(result).toEqual(expected);
          expect([...needed].every((n) => !have.includes(n))).toBe(true);
          expect(create.every((c) => !rows.some((r) => r.itemId === c))).toBe(true); // never duplicates
        },
      ),
    );
  });
});

describe("survival rules", () => {
  it("a checked row survives removing its preference; an unchecked row drops; a manual row survives", async () => {
    let list = await generate();
    const t = await check(u1, row(list, it_.tostitos).id, { checked: true });
    expect(t).toMatchObject({ checked: true, checkedBy: { userId: u1.id } });
    expect(t.checkedAt).not.toBeNull();
    await api().post(base()).set(u1.auth).send({ itemId: it_.apples.id }).expect(200);

    await api().delete(`/api/groups/${g.id}/preferences/${await prefId(u2, it_.tostitos)}`).set(u2.auth).expect(204);
    await api().delete(`/api/groups/${g.id}/preferences/${await prefId(u3, it_.lays)}`).set(u3.auth).expect(204);
    list = await getList();
    expect(row(list, it_.lays).wantedBy.map((w) => w.userId)).toEqual([u4.id]); // still wanted by u4
    expect(row(list, it_.lays).quantityText).toBe("family size");
    await api().delete(`/api/groups/${g.id}/preferences/${await prefId(u4, it_.lays)}`).set(u4.auth).expect(204);

    list = await getList();
    expect(names(list)).toEqual(["Apples", "Oreos", "Tostitos"]); // Lay's gone, checked Tostitos + manual Apples kept
    expect(row(list, it_.tostitos)).toMatchObject({ checked: true, wantedBy: [] });
  });

  it("adding a preference through the API puts it on the list right away (no explicit generate)", async () => {
    emit.mockClear();
    await api().post(`/api/groups/${g.id}/preferences`).set(u1.auth).send({ itemId: it_.pb.id, quantityText: "crunchy" }).expect(200);
    expect(events()).toEqual(["preferences:changed", "shopping-list:changed"]);
    expect(names(await getList())).toEqual(["Peanut Butter", "Lays", "Oreos", "Tostitos"]);
    expect(row(await getList(), it_.pb)).toMatchObject({ reason: "preference", quantityText: "crunchy" });
  });

  it("an item back in stock leaves the list; running low (Oreos) stays on it", async () => {
    await generate();
    await api().post(`/api/groups/${g.id}/cabinet`).set(u1.auth).send({ itemId: it_.lays.id }).expect(200);
    expect(names(await getList())).toEqual(["Oreos", "Tostitos"]);
  });

  it("un-checking clears checkedBy/checkedAt/scannedProductId; DELETE: wanted preference row 409, manual 204", async () => {
    const list = await generate();
    const id = row(list, it_.oreos).id;
    const scanned = (await mkProduct("Oreo Double Stuf")).id;
    expect(await check(u2, id, { checked: true, scannedProductId: scanned })).toMatchObject({ scannedProductId: scanned });
    expect(await check(u3, id, { checked: false })).toMatchObject({ checked: false, checkedBy: null, checkedAt: null, scannedProductId: null });

    const del = await api().delete(`${base()}/${id}`).set(u1.auth).expect(409);
    expect(del.body.error.code).toBe("LIST_ITEM_IS_PREFERENCE");
    const pb = ShoppingListItem.parse((await api().post(base()).set(u1.auth).send({ itemId: it_.pb.id }).expect(200)).body);
    await api().delete(`${base()}/${pb.id}`).set(u1.auth).expect(204);
    await api().delete(`${base()}/${pb.id}`).set(u1.auth).expect(404);
    expect(names(await getList())).toEqual(["Lays", "Oreos", "Tostitos"]);
  });

  it("dietary changes and membership changes refresh allergen flags and wantedBy", async () => {
    await generate();
    await api().put("/api/me/dietary").set(u4.auth).send({ diets: [], allergens: ["peanuts", "milk"] }).expect(200);
    let oreos = row(await getList(), it_.oreos);
    expect(oreos.allergenFlags.map((f) => f.userId)).toEqual([u3.id, u4.id]);

    await api().delete(`/api/groups/${g.id}/members/${u3.id}`).set(u1.auth).expect(204);
    oreos = row(await getList(), it_.oreos);
    expect(oreos.allergenFlags.map((f) => f.userId)).toEqual([u4.id]);
    expect(oreos.wantedBy.map((w) => w.userId)).toEqual([u4.id]);

    // restore u3 and u4 for the other tests
    const inv = Invite.parse((await api().post(`/api/groups/${g.id}/invites`).set(u1.auth).send({ email: u3.email }).expect(201)).body);
    await api().post(`/api/invites/${inv.id}/accept`).set(u3.auth).expect(200);
    await api().put("/api/me/dietary").set(u4.auth).send({ diets: [], allergens: ["peanuts"] }).expect(200);
  });
});

describe("scanned products (06x08)", () => {
  it("PATCH with an unknown scannedProductId is 404 PRODUCT_NOT_FOUND and changes nothing", async () => {
    const id = row(await generate(), it_.oreos).id;
    const res = await api().patch(`${base()}/${id}`).set(u1.auth).send({ checked: true, scannedProductId: randomUUID() }).expect(404);
    expect(res.body.error.code).toBe("PRODUCT_NOT_FOUND");
    expect(row(await getList(), it_.oreos)).toMatchObject({ checked: false, scannedProductId: null });
  });

  it("a scanned row is flagged by the catalog allergens ∪ the product's allergens ∪ may_contain; un-checking goes back to the catalog item", async () => {
    const list = await generate();
    const tostitos = row(list, it_.tostitos);
    expect(tostitos.allergenFlags).toEqual([]);
    const withMilk = await mkProduct("Tostitos Queso", { allergens: ["milk"] });
    const flagged = await check(u2, tostitos.id, { checked: true, scannedProductId: withMilk.id });
    expect(flagged.allergenFlags.map((f) => [f.userId, f.allergen])).toEqual([[u3.id, "milk"]]);

    // Oreos (catalog: wheat, soy, milk) scanned as a product that declares only "may contain peanuts": the catalog's
    // milk flag stays (catalog ∪ product, DECISIONS "M3 scan and check-off", M3-10).
    const oreos = row(list, it_.oreos);
    const mayPeanuts = await mkProduct("Oreo Thins", { mayContain: ["peanuts"] });
    const o = await check(u1, oreos.id, { checked: true, scannedProductId: mayPeanuts.id });
    expect(o.allergenFlags.map((f) => [f.userId, f.allergen])).toEqual([[u4.id, "peanuts"], [u3.id, "milk"]]);

    const back = await check(u1, oreos.id, { checked: false });
    expect(back.allergenFlags.map((f) => [f.userId, f.allergen])).toEqual([[u3.id, "milk"]]);
  });

  it("deleting a product sets scanned_product_id and cabinet product_id to null (ON DELETE SET NULL)", async () => {
    const list = await generate();
    const p1 = await mkProduct("Tostitos Scoops");
    const p2 = await mkProduct("Lays Wavy");
    await check(u1, row(list, it_.tostitos).id, { checked: true, scannedProductId: p1.id });
    await check(u1, row(list, it_.lays).id, { checked: true, scannedProductId: p2.id });
    await complete();
    await check(u1, row(await generate(), it_.oreos).id, { checked: true, scannedProductId: p1.id });
    await prisma.product.deleteMany({ where: { id: { in: [p1.id, p2.id] } } });
    expect(row(await getList(), it_.oreos).scannedProductId).toBeNull();
    const cab = await prisma.cabinetItem.findMany({ where: { groupId: g.id, itemId: { in: [it_.tostitos.id, it_.lays.id] } } });
    expect(cab.map((c) => c.productId)).toEqual([null, null]);
  });
});

describe("finish trip", () => {
  it("moves exactly the checked items, estimates expiry, deletes one_time preferences, keeps staples", async () => {
    const list = await generate();
    const scanned = (await mkProduct("Lay's Classic", { brand: "Lay's" })).id;
    await check(u1, row(list, it_.tostitos).id, { checked: true });
    await check(u2, row(list, it_.lays).id, { checked: true, scannedProductId: scanned });
    emit.mockClear();

    expect(await complete(u3)).toEqual({ movedToCabinet: 2 });
    expect(events()).toEqual(["cabinet:changed", "preferences:changed", "shopping-list:changed"]);
    expect(names(await getList())).toEqual(["Oreos"]); // unchecked, untouched

    const cab = CabinetItem.array().parse((await api().get(`/api/groups/${g.id}/cabinet`).set(u1.auth).expect(200)).body);
    const lays = cab.find((c) => c.item.id === it_.lays.id)!;
    expect(lays).toMatchObject({ status: "in_stock", productId: scanned, product: { brand: "Lay's", imageUrl: null }, expiresAt: plusDays(90), expirationSource: "estimated" });
    expect(lays.purchasedAt).not.toBeNull();
    expect(cab.find((c) => c.item.id === it_.tostitos.id)).toMatchObject({ status: "in_stock", productId: null });
    expect(cab.find((c) => c.item.id === it_.oreos.id)).toMatchObject({ status: "running_low" }); // not bought

    const prefs = await prisma.preference.findMany({ where: { groupId: g.id, itemId: { in: [it_.tostitos.id, it_.lays.id] } } });
    expect(prefs.map((p) => p.itemId).sort()).toEqual([it_.lays.id, it_.lays.id].sort()); // one_time Tostitos gone
    expect(await complete()).toEqual({ movedToCabinet: 0 });
  });

  it("ran out → requeued → bought → cabinet (staple); a one_time item doesn't come back", async () => {
    let list = await generate();
    await check(u1, row(list, it_.lays).id, { checked: true });
    await check(u1, row(list, it_.tostitos).id, { checked: true });
    await complete();
    let cab = CabinetItem.array().parse((await api().get(`/api/groups/${g.id}/cabinet`).set(u1.auth).expect(200)).body);
    const laysCab = cab.find((c) => c.item.id === it_.lays.id)!;
    const tostCab = cab.find((c) => c.item.id === it_.tostitos.id)!;

    const ranOut = (id: string) => api().post(`/api/groups/${g.id}/cabinet/${id}/ran-out`).set(u2.auth).expect(200);
    expect((await ranOut(laysCab.id)).body).toEqual({ requeued: true });
    expect((await ranOut(tostCab.id)).body).toEqual({ requeued: false });
    list = await getList();
    expect(names(list)).toEqual(["Lays", "Oreos"]);

    await check(u4, row(list, it_.lays).id, { checked: true });
    expect(await complete(u4)).toEqual({ movedToCabinet: 1 });
    expect(names(await getList())).toEqual(["Oreos"]);
    cab = CabinetItem.array().parse((await api().get(`/api/groups/${g.id}/cabinet`).set(u1.auth).expect(200)).body);
    expect(cab.find((c) => c.item.id === it_.lays.id)).toMatchObject({ status: "in_stock" });
  });

  it("two concurrent completes move each checked item exactly once", async () => {
    const list = await generate();
    await Promise.all(list.map((r) => check(u1, r.id, { checked: true })));
    const results = await Promise.all([complete(u1), complete(u2), complete(u3)]);
    expect(results.map((r) => r.movedToCabinet).sort()).toEqual([0, 0, 3]);
    expect(await getList()).toEqual([]);
    const cab = await prisma.cabinetItem.findMany({ where: { groupId: g.id } });
    expect(cab.map((c) => c.itemId).sort()).toEqual([it_.cheerios.id, it_.lays.id, it_.oreos.id, it_.tostitos.id].sort());
    expect(cab.every((c) => c.status === "in_stock")).toBe(true);
  });

  it("concurrent check-offs from two phones and a racing complete end in one consistent state", async () => {
    const list = await generate();
    const [lays, oreos, tost] = [row(list, it_.lays), row(list, it_.oreos), row(list, it_.tostitos)];
    await Promise.all([
      check(u1, lays.id, { checked: true }),
      check(u2, oreos.id, { checked: true }),
      check(u2, tost.id, { checked: true }),
      api().post(`/api/groups/${g.id}/cabinet`).set(u3.auth).send({ itemId: it_.apples.id }), // unrelated writer
    ]);
    const [a, b] = await Promise.all([getList(u1), getList(u2)]);
    expect(a).toEqual(b);
    expect(a.every((r) => r.checked)).toBe(true);

    // un-check racing finish trip: either it was moved (PATCH 404) or it stays unchecked on the list. Never both, never lost.
    const [patch, done] = await Promise.all([
      api().patch(`${base()}/${tost.id}`).set(u2.auth).send({ checked: false }),
      complete(u1),
    ]);
    const onList = (await getList()).find((r) => r.id === tost.id);
    const inCab = await prisma.cabinetItem.count({ where: { groupId: g.id, itemId: it_.tostitos.id } });
    if (patch.status === 404) expect([done.movedToCabinet, onList, inCab]).toEqual([3, undefined, 1]);
    else expect([patch.status, done.movedToCabinet, onList?.checked, inCab]).toEqual([200, 2, false, 0]);
  });
});

describe("authorization", () => {
  it("non-members get 404 (requireGroupMember); another group's row id is 404; validation errors are 400", async () => {
    const list = await generate();
    await api().get(base()).set(outsider.auth).expect(404);
    await api().post(`${base()}/complete`).set(outsider.auth).expect(404);
    const otherBase = `/api/groups/${other.id}/shopping-list`;
    await api().patch(`${otherBase}/${list[0].id}`).set(outsider.auth).send({ checked: true }).expect(404);
    await api().delete(`${otherBase}/${list[0].id}`).set(outsider.auth).expect(404);
    await api().patch(`${base()}/${list[0].id}`).set(u1.auth).send({}).expect(400);
    await api().patch(`${base()}/${list[0].id}`).set(u1.auth).send({ checked: true, scannedProductId: "nope" }).expect(400);
    await api().post(base()).set(u1.auth).send({ itemId: randomUUID() }).expect(404);
    expect((await getList()).every((r) => !r.checked)).toBe(true);
  });
});
