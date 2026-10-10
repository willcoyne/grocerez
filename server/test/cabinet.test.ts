import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app.js";
import { CabinetItem } from "../src/contracts/cabinet.js";
import { Group, Invite } from "../src/contracts/groups.js";
import { Item } from "../src/contracts/items.js";
import { prisma } from "../src/db.js";
import * as realtime from "../src/lib/realtime.js";
import { cabinetRepo } from "../src/modules/cabinet/repo.js";
import { cleanupUsers, makeUser } from "./helpers.js";

// No AWS: presigned GET URLs are faked.
vi.mock("../src/lib/s3.js", async (orig) => ({
  ...(await orig<typeof import("../src/lib/s3.js")>()),
  presignGet: vi.fn(async (key: string) => `https://get.test/${key}`),
}));

type U = Awaited<ReturnType<typeof makeUser>>;
const api = () => request(app);
const emit = vi.spyOn(realtime, "emitGroup");
const NO_ID = "00000000-0000-4000-8000-000000000000";
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

let milk: Item, eggs: Item, soap: Item;
let owner: U, member: U, outsider: U, g: Group;

beforeAll(async () => {
  owner = await makeUser();
  member = await makeUser();
  outsider = await makeUser();
  const mk = async (name: string, category: string) =>
    Item.parse((await api().post("/api/items").set(owner.auth).send({ name, category }).expect(200)).body);
  milk = await mk("Milk", "dairy");
  eggs = await mk("Eggs", "dairy");
  soap = await mk("Dish Soap", "household");
  g = Group.parse((await api().post("/api/groups").set(owner.auth).send({ name: "House" }).expect(201)).body);
  const inv = Invite.parse(
    (await api().post(`/api/groups/${g.id}/invites`).set(owner.auth).send({ email: member.email }).expect(201)).body,
  );
  await api().post(`/api/invites/${inv.id}/accept`).set(member.auth).expect(200);
});

beforeEach(async () => {
  await prisma.cabinetItem.deleteMany({ where: { groupId: g.id } });
  await prisma.preference.deleteMany({ where: { groupId: g.id } });
  emit.mockClear();
});

afterAll(async () => {
  await cleanupUsers();
  await prisma.$disconnect();
});

const base = () => `/api/groups/${g.id}/cabinet`;
const add = async (u: U, body: object) => CabinetItem.parse((await api().post(base()).set(u.auth).send(body).expect(200)).body);
const names = (body: CabinetItem[]) => body.map((r) => r.item.name);
const events = () => emit.mock.calls.map((c) => c[1]);

describe("cabinet", () => {
  it("POST estimates expiry, upserts on (group, item); GET sorts by expiry then name, with filters", async () => {
    const m = await add(member, { itemId: milk.id, location: "fridge" });
    expect(m).toMatchObject({
      status: "in_stock",
      location: "fridge",
      expiresAt: plusDays(10),
      expirationSource: "estimated",
      addedBy: member.id,
      photoUrl: null,
    });
    expect(events()).toEqual(["cabinet:changed", "shopping-list:changed"]);

    const again = await add(owner, { itemId: milk.id, quantityText: "1 gal" });
    expect(again).toMatchObject({ id: m.id, quantityText: "1 gal", location: "fridge", expirationSource: "estimated" });

    const s = await add(owner, { itemId: soap.id, location: "other" }); // household: no estimate
    expect(s).toMatchObject({ expiresAt: null, expirationSource: null });
    const e = await add(owner, { itemId: eggs.id, location: "fridge", expiresAt: today() });
    expect(e).toMatchObject({ expiresAt: today(), expirationSource: "manual" });

    const all = (await api().get(base()).set(member.auth).expect(200)).body.map((r: unknown) => CabinetItem.parse(r));
    expect(names(all)).toEqual(["Eggs", "Milk", "Dish Soap"]);
    expect(names((await api().get(base()).query({ location: "fridge" }).set(member.auth).expect(200)).body)).toEqual(["Eggs", "Milk"]);
    expect((await api().get(base()).query({ status: "running_low" }).set(member.auth).expect(200)).body).toEqual([]);
    await api().get(base()).query({ location: "garage" }).set(member.auth).expect(400);
  });

  it("validation and authorization", async () => {
    await api().post(base()).set(owner.auth).send({ itemId: NO_ID }).expect(404);
    await api().post(base()).set(owner.auth).send({ itemId: milk.id, status: "running_low" }).expect(400);
    await api().get(base()).set(outsider.auth).expect(404);
    await api().post(base()).set(outsider.auth).send({ itemId: milk.id }).expect(404);

    const m = await add(owner, { itemId: milk.id });
    // A row from another group is not reachable through a group the caller does belong to.
    const other = Group.parse((await api().post("/api/groups").set(outsider.auth).send({ name: "Other" }).expect(201)).body);
    const o = `/api/groups/${other.id}/cabinet/${m.id}`;
    await api().patch(o).set(outsider.auth).send({ status: "running_low" }).expect(404);
    await api().post(`${o}/ran-out`).set(outsider.auth).expect(404);
    await api().delete(o).set(outsider.auth).expect(404);
    await api().patch(`${base()}/${m.id}`).set(outsider.auth).send({ status: "running_low" }).expect(404);
    await api().patch(`${base()}/${NO_ID}`).set(owner.auth).send({ status: "running_low" }).expect(404);
    expect(await prisma.cabinetItem.count({ where: { id: m.id, status: "in_stock" } })).toBe(1);
  });

  it("running low: still in the cabinet, out of 'have', list regenerates; back to in_stock returns it", async () => {
    const m = await add(owner, { itemId: milk.id });
    emit.mockClear();
    const low = CabinetItem.parse(
      (await api().patch(`${base()}/${m.id}`).set(member.auth).send({ status: "running_low" }).expect(200)).body,
    );
    expect(low).toMatchObject({ id: m.id, status: "running_low" });
    expect(events()).toEqual(["cabinet:changed", "shopping-list:changed"]);
    expect(await cabinetRepo.haveItemIds(g.id)).not.toContain(milk.id);
    expect((await api().get(base()).set(owner.auth).expect(200)).body).toHaveLength(1);

    await api().patch(`${base()}/${m.id}`).set(member.auth).send({ status: "in_stock" }).expect(200);
    expect(await cabinetRepo.haveItemIds(g.id)).toContain(milk.id);
  });

  it("PATCH expiresAt sets source manual (null clears); quantity/location changes don't regenerate", async () => {
    const m = await add(owner, { itemId: milk.id });
    emit.mockClear();
    const url = `${base()}/${m.id}`;
    const r = CabinetItem.parse((await api().patch(url).set(owner.auth).send({ expiresAt: "2030-01-02", location: "freezer" }).expect(200)).body);
    expect(r).toMatchObject({ expiresAt: "2030-01-02", expirationSource: "manual", location: "freezer" });
    expect(events()).toEqual(["cabinet:changed"]);
    const c = CabinetItem.parse((await api().patch(url).set(owner.auth).send({ expiresAt: null }).expect(200)).body);
    expect(c).toMatchObject({ expiresAt: null, expirationSource: null });
    await api().patch(url).set(owner.auth).send({ expiresAt: "02/01/2030" }).expect(400);
  });

  it("photoKey: only the caller's own item-photo key; responses carry a presigned URL, never the key", async () => {
    const m = await add(owner, { itemId: milk.id });
    const url = `${base()}/${m.id}`;
    const key = `item-photo/${member.id}/${randomUUID()}.jpg`;
    const r = CabinetItem.parse((await api().patch(url).set(member.auth).send({ photoKey: key }).expect(200)).body);
    expect(r.photoUrl).toBe(`https://get.test/${key}`);
    expect(JSON.stringify((await api().get(base()).set(owner.auth)).body)).not.toContain("photoKey");
    for (const bad of [
      `item-photo/${owner.id}/${randomUUID()}.jpg`,
      `avatar/${member.id}/${randomUUID()}.jpg`,
      `item-photo/${member.id}/../x.jpg`,
    ]) {
      await api().patch(url).set(member.auth).send({ photoKey: bad }).expect(400);
    }
    const cleared = CabinetItem.parse((await api().patch(url).set(member.auth).send({ photoKey: null }).expect(200)).body);
    expect(cleared.photoUrl).toBeNull();
  });

  it("ran out + in someone's preferences: row deleted, requeued, out of 'have'; bought again -> back in cabinet", async () => {
    await api().post(`/api/groups/${g.id}/preferences`).set(member.auth).send({ itemId: milk.id }).expect(200);
    const m = await add(owner, { itemId: milk.id });
    emit.mockClear();
    expect((await api().post(`${base()}/${m.id}/ran-out`).set(owner.auth).expect(200)).body).toEqual({ requeued: true });
    expect(events()).toEqual(["cabinet:changed", "shopping-list:changed"]);
    expect(await prisma.cabinetItem.count({ where: { id: m.id } })).toBe(0);
    expect(await cabinetRepo.haveItemIds(g.id)).not.toContain(milk.id);
    await api().post(`${base()}/${m.id}/ran-out`).set(owner.auth).expect(404);

    await add(owner, { itemId: milk.id }); // "bought" (06 finishTrip will do this)
    expect(await cabinetRepo.haveItemIds(g.id)).toContain(milk.id);
  });

  it("ran out, nobody wants it: requeued false; DELETE removes without requeueing", async () => {
    const e = await add(owner, { itemId: eggs.id });
    emit.mockClear();
    expect((await api().post(`${base()}/${e.id}/ran-out`).set(member.auth).expect(200)).body).toEqual({ requeued: false });
    expect(events()).toEqual(["cabinet:changed"]);

    await api().post(`/api/groups/${g.id}/preferences`).set(member.auth).send({ itemId: milk.id }).expect(200);
    const m = await add(owner, { itemId: milk.id });
    emit.mockClear();
    await api().delete(`${base()}/${m.id}`).set(member.auth).expect(204);
    expect(events()).toEqual(["cabinet:changed"]);
    expect(await prisma.cabinetItem.count({ where: { groupId: g.id } })).toBe(0);
    await api().delete(`${base()}/${m.id}`).set(member.auth).expect(404);
  });
});
