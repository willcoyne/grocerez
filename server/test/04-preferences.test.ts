import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { normalize } from "../src/lib/normalize.js";
import { api, itemId, makeGroup, makeUser } from "./helpers.js";

const fixture = JSON.parse(readFileSync(new URL("../prisma/fixtures/normalize-cases.json", import.meta.url), "utf8")) as {
  cases: { input: string; expected: string }[];
};

describe("04 normalize()", () => {
  it.each(fixture.cases.map((c) => [c.input, c.expected]))("normalize(%j) = %j", (input, expected) => {
    expect(normalize(input)).toBe(expected);
    expect(normalize(normalize(input))).toBe(expected);
  });

  it("agrees with SQL normalize_item_name() on every fixture case and extra tricky inputs", async () => {
    const extra = ["ÀÉÎÕÜ Ñoño's", "  tabs\tand\nnewlines  ", "Boxes of Matches", "s s", "Glass", "Sushi", "café-au-lait", "Ça va", "x", "ess", "classes"];
    const inputs = [...fixture.cases.map((c) => c.input), ...extra];
    const rows = await prisma.$queryRaw<{ i: string; n: string }[]>`
      SELECT i, normalize_item_name(i) AS n FROM unnest(${inputs}::text[]) AS i`;
    for (const r of rows) expect(normalize(r.i), JSON.stringify(r.i)).toBe(r.n);
  });
});

describe("04 item search and create", () => {
  it("exact name and alias matches", async () => {
    const u = await makeUser();
    const res = await api().get("/api/items/search").query({ q: "  CHEERIOS " }).set(u.auth);
    expect(res.status).toBe(200);
    expect(res.body.match).toBe("exact");
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({ name: "Cheerios", normalizedName: "cheerio", category: expect.any(String) });
  });

  it('a typo gives "Did you mean Cheerios?", and confirming it stores an alias', async () => {
    const u = await makeUser();
    const s = await api().get("/api/items/search").query({ q: "cherios" }).set(u.auth);
    expect(s.body.match).toBe("suggested");
    expect(s.body.results[0].name).toBe("Cheerios");

    const confirm = await api().post("/api/items").set(u.auth).send({ name: "cherios", aliasOf: s.body.results[0].id });
    expect(confirm.status).toBe(201);
    expect(confirm.body.id).toBe(s.body.results[0].id);
    expect(await prisma.itemAlias.count({ where: { aliasNormalized: "cherio" } })).toBe(1);

    const again = await api().get("/api/items/search").query({ q: "Cherios" }).set(u.auth);
    expect(again.body).toMatchObject({ match: "exact", results: [{ id: s.body.results[0].id }] });
    // Confirming the same alias twice is harmless.
    expect((await api().post("/api/items").set(u.auth).send({ name: "Cherios", aliasOf: s.body.results[0].id })).status).toBe(200);
  });

  it("nothing similar → none with no results; empty query → 400", async () => {
    const u = await makeUser();
    const res = await api().get("/api/items/search").query({ q: "zzqxw" }).set(u.auth);
    expect(res.body).toEqual({ match: "none", results: [], related: [] });
    expect((await api().get("/api/items/search").query({ q: "!!!" }).set(u.auth)).status).toBe(400);
    expect((await api().get("/api/items/search").set(u.auth)).status).toBe(400);
  });

  it("POST /items creates a new item, and returns the existing one for a duplicate name", async () => {
    const u = await makeUser();
    const name = `Dragonfruit Chips ${Date.now()}`;
    const a = await api().post("/api/items").set(u.auth).send({ name, category: "snacks" });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ name, category: "snacks", normalizedName: normalize(name) });
    const b = await api().post("/api/items").set(u.auth).send({ name: name.toUpperCase() + "!" });
    expect(b.status).toBe(200);
    expect(b.body.id).toBe(a.body.id);
    expect((await api().post("/api/items").set(u.auth).send({ name: "x", category: "toys" })).status).toBe(400);
  });

  it("an alias that already means another item is 409 NAME_TAKEN", async () => {
    const u = await makeUser();
    const res = await api().post("/api/items").set(u.auth).send({ name: "Milk", aliasOf: await itemId("Oreos") });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NAME_TAKEN");
  });
});

describe("04 preferences", () => {
  it("adding or removing a preference updates the group's shopping list right away", async () => {
    const owner = await makeUser();
    const g = await makeGroup(owner);
    const milk = await itemId("Milk");
    const add = await api().post(`/api/groups/${g.id}/preferences`).set(owner.auth).send({ itemId: milk, quantityText: "1 gal" });
    expect(add.status).toBe(201);
    expect(add.body).toMatchObject({ itemId: milk, quantityText: "1 gal", recurrence: "staple", user: { id: owner.id } });
    let list = await prisma.shoppingListItem.findMany({ where: { groupId: g.id } });
    expect(list.map((r) => r.itemId)).toEqual([milk]);
    expect(list[0].wantedBy).toEqual([owner.id]);

    // Upsert on (group, user, item): same row, updated.
    const again = await api().post(`/api/groups/${g.id}/preferences`).set(owner.auth).send({ itemId: milk, quantityText: "2 gal" });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(add.body.id);
    list = await prisma.shoppingListItem.findMany({ where: { groupId: g.id } });
    expect(list[0].quantityText).toBe("2 gal");

    await api().delete(`/api/groups/${g.id}/preferences/${add.body.id}`).set(owner.auth).expect(204);
    expect(await prisma.shoppingListItem.count({ where: { groupId: g.id } })).toBe(0);
  });

  it("a user can't edit or delete someone else's preference (403); ?userId=all shows everyone's", async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const g = await makeGroup(owner, [member]);
    const p = await api().post(`/api/groups/${g.id}/preferences`).set(owner.auth).send({ itemId: await itemId("Bread") });
    await api().post(`/api/groups/${g.id}/preferences`).set(member.auth).send({ itemId: await itemId("Eggs"), recurrence: "one_time" });

    const patch = await api().patch(`/api/groups/${g.id}/preferences/${p.body.id}`).set(member.auth).send({ note: "x" });
    expect(patch.status).toBe(403);
    expect((await api().delete(`/api/groups/${g.id}/preferences/${p.body.id}`).set(member.auth)).status).toBe(403);

    const mine = await api().get(`/api/groups/${g.id}/preferences`).set(member.auth);
    expect(mine.body).toHaveLength(1);
    const all = await api().get(`/api/groups/${g.id}/preferences?userId=all`).set(member.auth);
    expect(all.body).toHaveLength(2);
    expect(all.body.map((x: { user: { displayName: string } }) => x.user.displayName).sort()).toEqual(
      [owner.displayName, member.displayName].sort(),
    );

    const ok = await api().patch(`/api/groups/${g.id}/preferences/${p.body.id}`).set(owner.auth).send({ note: "whole wheat" });
    expect(ok.status).toBe(200);
    expect(ok.body.note).toBe("whole wheat");
  });

  it("a preference id from another group is 404; an unknown item is 404", async () => {
    const a = await makeUser();
    const g1 = await makeGroup(a);
    const g2 = await makeGroup(a);
    const p = await api().post(`/api/groups/${g1.id}/preferences`).set(a.auth).send({ itemId: await itemId("Bread") });
    expect((await api().patch(`/api/groups/${g2.id}/preferences/${p.body.id}`).set(a.auth).send({ note: "x" })).status).toBe(404);
    expect((await api().delete(`/api/groups/${g2.id}/preferences/${p.body.id}`).set(a.auth)).status).toBe(404);
    const bad = await api().post(`/api/groups/${g1.id}/preferences`).set(a.auth).send({ itemId: "00000000-0000-4000-8000-00000000ffff" });
    expect(bad.status).toBe(404);
  });
});

describe("04 dietary profile", () => {
  it("PUT replaces both sets and regenerates allergen flags in every group", async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const g = await makeGroup(owner, [member]);
    await api().post(`/api/groups/${g.id}/preferences`).set(owner.auth).send({ itemId: await itemId("Peanut Butter") });

    expect((await api().get("/api/me/dietary").set(member.auth)).body).toEqual({ diets: [], allergens: [] });
    const put = await api().put("/api/me/dietary").set(member.auth).send({ diets: ["vegetarian"], allergens: ["peanuts", "milk"] });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ diets: ["vegetarian"], allergens: ["milk", "peanuts"] });

    const [row] = await prisma.shoppingListItem.findMany({ where: { groupId: g.id } });
    expect(row.allergenFlags).toEqual([{ userId: member.id, displayName: member.displayName, allergen: "peanuts" }]);

    await api().put("/api/me/dietary").set(member.auth).send({ diets: [], allergens: [] }).expect(200);
    const [after] = await prisma.shoppingListItem.findMany({ where: { groupId: g.id } });
    expect(after.allergenFlags).toEqual([]);

    expect((await api().put("/api/me/dietary").set(member.auth).send({ diets: ["paleo"], allergens: [] })).status).toBe(400);
  });
});
