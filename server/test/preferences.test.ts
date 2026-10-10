import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { app } from "../src/app.js";
import { Group, Invite } from "../src/contracts/groups.js";
import { Item, ItemSearchResponse } from "../src/contracts/items.js";
import { Preference } from "../src/contracts/preferences.js";
import { prisma } from "../src/db.js";
import * as realtime from "../src/lib/realtime.js";
import { cleanupUsers, makeUser } from "./helpers.js";

type U = Awaited<ReturnType<typeof makeUser>>;
const api = () => request(app);
const emit = vi.spyOn(realtime, "emitGroup");
const NO_ID = "00000000-0000-4000-8000-000000000000";

let cheerios: Item;
let milk: Item;

beforeAll(async () => {
  const u = await makeUser();
  // The catalog is global and persists across runs: reset the alias this suite creates.
  await prisma.itemAlias.deleteMany({ where: { aliasNormalized: "cherio" } });
  cheerios = Item.parse((await api().post("/api/items").set(u.auth).send({ name: "Cheerios", category: "pantry" }).expect(200)).body);
  milk = Item.parse((await api().post("/api/items").set(u.auth).send({ name: "Milk", category: "dairy" }).expect(200)).body);
});

afterAll(async () => {
  await cleanupUsers();
  await prisma.$disconnect();
});

async function groupWith(owner: U, ...members: U[]) {
  const g = Group.parse((await api().post("/api/groups").set(owner.auth).send({ name: "House" }).expect(201)).body);
  for (const m of members) {
    const inv = Invite.parse((await api().post(`/api/groups/${g.id}/invites`).set(owner.auth).send({ email: m.email }).expect(201)).body);
    await api().post(`/api/invites/${inv.id}/accept`).set(m.auth).expect(200);
  }
  return g;
}

const search = async (u: U, q: string) =>
  ItemSearchResponse.parse((await api().get("/api/items/search").query({ q }).set(u.auth).expect(200)).body);
const prefs = (body: unknown[]) => body.map((p) => Preference.parse(p));

describe("items", () => {
  it("cherios -> did you mean Cheerios?; confirming stores an alias and the next search is exact", async () => {
    const u = await makeUser();
    expect(await search(u, "Cheerios!")).toEqual({ match: "exact", results: [cheerios] });

    const typo = await search(u, "cherios");
    expect(typo.match).toBe("suggested");
    expect(typo.results[0]).toEqual(cheerios);

    const confirmed = Item.parse((await api().post("/api/items").set(u.auth).send({ name: "cherios", aliasOf: cheerios.id }).expect(200)).body);
    expect(confirmed).toEqual(cheerios);
    expect(await prisma.itemAlias.count({ where: { aliasNormalized: "cherio", itemId: cheerios.id } })).toBe(1);
    expect(await search(u, "Cherios")).toEqual({ match: "exact", results: [cheerios] });
  });

  it("unrelated text gives match none; empty or missing q is 400", async () => {
    const u = await makeUser();
    expect((await search(u, "zqxv plorbnik")).match).toBe("none");
    expect((await api().get("/api/items/search").query({ q: "!!!" }).set(u.auth)).status).toBe(400);
    expect((await api().get("/api/items/search").set(u.auth)).status).toBe(400);
  });

  it("creating an existing name returns the existing item; bad aliasOf / category rejected", async () => {
    const u = await makeUser();
    const again = Item.parse((await api().post("/api/items").set(u.auth).send({ name: "  CHEERIOS " }).expect(200)).body);
    expect(again.id).toBe(cheerios.id);
    const r = await api().post("/api/items").set(u.auth).send({ name: "x", aliasOf: NO_ID });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe("ITEM_NOT_FOUND");
    expect((await api().post("/api/items").set(u.auth).send({ name: "x", category: "toys" })).status).toBe(400);
  });
});

describe("preferences", () => {
  it("create/update on (group, user, item), list me/all with wantedBy, and emit preferences:changed", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const g = await groupWith(a, b);
    const url = `/api/groups/${g.id}/preferences`;

    emit.mockClear();
    const p1 = Preference.parse((await api().post(url).set(a.auth).send({ itemId: cheerios.id, quantityText: "2 boxes" }).expect(200)).body);
    expect(p1).toMatchObject({ userId: a.id, groupId: g.id, recurrence: "staple", quantityText: "2 boxes", item: cheerios });
    expect(emit).toHaveBeenCalledWith(g.id, "preferences:changed", a.id);

    const p1b = Preference.parse((await api().post(url).set(a.auth).send({ itemId: cheerios.id, recurrence: "one_time" }).expect(200)).body);
    expect(p1b).toMatchObject({ id: p1.id, recurrence: "one_time", quantityText: "2 boxes" });

    await api().post(url).set(b.auth).send({ itemId: cheerios.id }).expect(200);
    await api().post(url).set(b.auth).send({ itemId: milk.id }).expect(200);

    const mine = prefs((await api().get(url).set(a.auth).expect(200)).body);
    expect(mine.map((p) => p.id)).toEqual([p1.id]);
    expect(mine[0].wantedBy).toBeUndefined();

    const all = prefs((await api().get(url).query({ userId: "all" }).set(a.auth).expect(200)).body);
    expect(all).toHaveLength(3);
    const names = (await prisma.user.findMany({ where: { id: { in: [a.id, b.id] } } })).map((u) => u.displayName).sort();
    expect(all.filter((p) => p.item.id === cheerios.id).map((p) => [...p.wantedBy!].sort())).toEqual([names, names]);
    expect(all.find((p) => p.item.id === milk.id)!.wantedBy).toHaveLength(1);

    expect((await api().post(url).set(a.auth).send({ itemId: NO_ID })).status).toBe(404);
  });

  it("a user can't edit or delete someone else's preference; can edit and delete their own", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const g = await groupWith(a, b);
    const url = `/api/groups/${g.id}/preferences`;
    const p = Preference.parse((await api().post(url).set(a.auth).send({ itemId: milk.id }).expect(200)).body);

    const patch = await api().patch(`${url}/${p.id}`).set(b.auth).send({ note: "mine now" });
    expect(patch.status).toBe(403);
    expect(patch.body.error.code).toBe("FORBIDDEN");
    expect((await api().delete(`${url}/${p.id}`).set(b.auth)).status).toBe(403);

    // A row id from another group is 404, even for its owner.
    const other = await groupWith(a);
    expect((await api().patch(`/api/groups/${other.id}/preferences/${p.id}`).set(a.auth).send({ note: "x" })).status).toBe(404);

    const edited = Preference.parse((await api().patch(`${url}/${p.id}`).set(a.auth).send({ note: "skim", quantityText: null }).expect(200)).body);
    expect(edited).toMatchObject({ note: "skim", quantityText: null });

    emit.mockClear();
    await api().delete(`${url}/${p.id}`).set(a.auth).expect(204);
    expect(emit).toHaveBeenCalledWith(g.id, "preferences:changed", a.id);
    expect(await prisma.preference.count({ where: { id: p.id } })).toBe(0);
  });

  it("non-members get 404; leaving or being removed deletes that member's preferences", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const c = await makeUser();
    const outsider = await makeUser();
    const g = await groupWith(a, b, c);
    const url = `/api/groups/${g.id}/preferences`;
    expect((await api().get(url).set(outsider.auth)).status).toBe(404);
    expect((await api().post(url).set(outsider.auth).send({ itemId: milk.id })).status).toBe(404);

    for (const u of [a, b, c]) await api().post(url).set(u.auth).send({ itemId: milk.id }).expect(200);
    await api().post(`/api/groups/${g.id}/leave`).set(b.auth).expect(204);
    await api().delete(`/api/groups/${g.id}/members/${c.id}`).set(a.auth).expect(204);
    expect((await prisma.preference.findMany({ where: { groupId: g.id } })).map((p) => p.userId)).toEqual([a.id]);
  });

  it("the duplicate (group, user, item) row is rejected by the database", async () => {
    const a = await makeUser();
    const g = await groupWith(a);
    const data = { groupId: g.id, userId: a.id, itemId: milk.id };
    await prisma.preference.create({ data });
    await expect(prisma.preference.create({ data })).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("dietary", () => {
  it("GET/PUT /me/dietary replaces both sets", async () => {
    const u = await makeUser();
    expect((await api().get("/api/me/dietary").set(u.auth).expect(200)).body).toEqual({ diets: [], allergens: [] });

    const put = await api().put("/api/me/dietary").set(u.auth).send({ diets: ["vegan", "vegan"], allergens: ["peanuts", "milk"] }).expect(200);
    expect(put.body).toEqual({ diets: ["vegan"], allergens: ["milk", "peanuts"] });

    await api().put("/api/me/dietary").set(u.auth).send({ diets: [], allergens: ["sesame"] }).expect(200);
    expect((await api().get("/api/me/dietary").set(u.auth).expect(200)).body).toEqual({ diets: [], allergens: ["sesame"] });

    expect((await api().put("/api/me/dietary").set(u.auth).send({ diets: ["paleo"], allergens: [] })).status).toBe(400);
    expect((await api().put("/api/me/dietary").set(u.auth).send({ diets: [] })).status).toBe(400);
  });
});
