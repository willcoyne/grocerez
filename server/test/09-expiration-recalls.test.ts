import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db.js";
import { estimateExpiration } from "../src/lib/expiration.js";
import { http } from "../src/lib/http.js";
import { recallsService } from "../src/modules/recalls/service.js";
import { api, DEMO_GROUP_ID, itemId, makeGroup, makeUser, SEED_USERS, tokenFor } from "./helpers.js";

const FDA_PAGE = readFileSync(new URL("./fixtures/openfda/enforcement-page.json", import.meta.url), "utf8");

afterEach(() => vi.restoreAllMocks());

function stubFda(body = FDA_PAGE, status = 200) {
  return vi.spyOn(http, "fetch").mockImplementation(async (url: string) => {
    if (!url.startsWith("https://api.fda.gov/food/enforcement.json?")) throw new Error(`unexpected fetch ${url}`);
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  });
}

describe("09 expiration estimates", () => {
  it("purchasedAt + shelf_life_days, else the category default, household → none", () => {
    const d = new Date("2026-10-10T15:00:00Z");
    expect(estimateExpiration({ shelfLifeDays: 7, category: "dairy" }, d)?.toISOString().slice(0, 10)).toBe("2026-10-17");
    expect(estimateExpiration({ shelfLifeDays: null, category: "meat" }, d)?.toISOString().slice(0, 10)).toBe("2026-10-13");
    expect(estimateExpiration({ shelfLifeDays: null, category: "pantry" }, d)?.toISOString().slice(0, 10)).toBe("2027-10-10");
    expect(estimateExpiration({ shelfLifeDays: null, category: "household" }, d)).toBeNull();
    expect(estimateExpiration({ shelfLifeDays: null, category: null }, d)).toBeNull();
  });

  it("every bought item has an expiration date (estimated) after finish trip", async () => {
    const a = await makeUser();
    const g = await makeGroup(a);
    for (const n of ["Milk", "Chicken Breast", "Bread"]) {
      await api().post(`/api/groups/${g.id}/shopping-list`).set(a.auth).send({ itemId: await itemId(n) }).expect(201);
    }
    const list = await api().get(`/api/groups/${g.id}/shopping-list`).set(a.auth);
    for (const r of list.body) await api().patch(`/api/groups/${g.id}/shopping-list/${r.id}`).set(a.auth).send({ checked: true }).expect(200);
    await api().post(`/api/groups/${g.id}/shopping-list/complete`).set(a.auth).expect(200);
    const cab = await api().get(`/api/groups/${g.id}/cabinet`).set(a.auth);
    expect(cab.body).toHaveLength(3);
    for (const c of cab.body) expect(c).toMatchObject({ expiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), expirationSource: "estimated" });
  });
});

describe("09 alerts", () => {
  it("the seeded fake recall and the expiring Oreos show up as alerts; the recall can be dismissed", async () => {
    const auth = tokenFor(SEED_USERS[0]);
    const res = await api().get(`/api/groups/${DEMO_GROUP_ID}/alerts`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.expiring.map((c: { item: { name: string } }) => c.item.name)).toContain("Oreos");
    const demo = res.body.recalls.find((r: { recall: { externalId: string } }) => r.recall.externalId === "DEMO-0001");
    expect(demo).toMatchObject({
      label: "possible match, check your package",
      cabinetItem: { name: "Cheerios" },
      recall: { source: "demo", classification: "Class II", url: null },
    });

    const outsider = await makeUser();
    const og = await makeGroup(outsider);
    expect((await api().post(`/api/groups/${og.id}/alerts/recalls/${demo.id}/dismiss`).set(outsider.auth)).status).toBe(404);

    await api().post(`/api/groups/${DEMO_GROUP_ID}/alerts/recalls/${demo.id}/dismiss`).set(auth).expect(204);
    await api().post(`/api/groups/${DEMO_GROUP_ID}/alerts/recalls/${demo.id}/dismiss`).set(auth).expect(204);
    const after = await api().get(`/api/groups/${DEMO_GROUP_ID}/alerts`).set(auth);
    expect(after.body.recalls.find((r: { id: string }) => r.id === demo.id)).toBeUndefined();
  });

  it("expiring = within 3 days including already expired, soonest first", async () => {
    const a = await makeUser();
    const g = await makeGroup(a);
    const day = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
    const add = async (name: string, expiresAt: string) =>
      api().post(`/api/groups/${g.id}/cabinet`).set(a.auth).send({ itemId: await itemId(name), expiresAt }).expect(201);
    await add("Milk", day(2));
    await add("Eggs", day(-1));
    await add("Bread", day(10));
    const res = await api().get(`/api/groups/${g.id}/alerts`).set(a.auth);
    expect(res.body.expiring.map((c: { item: { name: string } }) => c.item.name)).toEqual(["Eggs", "Milk"]);
    expect(res.body.recalls).toEqual([]);
  });
});

describe("09 recall import job", () => {
  it("imports openFDA recalls, matches a branded cabinet product, and running twice creates no duplicates", async () => {
    const a = await makeUser();
    const g = await makeGroup(a);
    const other = await makeGroup(a);
    const tostitos = await itemId("Tostitos");
    const fritoLay = await prisma.product.create({
      data: { itemId: tostitos, gtin: "00028400090902", brand: "Frito-Lay", name: "Tostitos Scoops", source: "manual", fetchedAt: new Date() },
    });
    const wrongBrand = await prisma.product.create({
      data: { itemId: tostitos, gtin: "00099999999990", brand: "Kirkland", name: "Tortilla Chips", source: "manual", fetchedAt: new Date() },
    });
    await prisma.cabinetItem.create({ data: { groupId: g.id, itemId: tostitos, productId: fritoLay.id } });
    await prisma.cabinetItem.create({ data: { groupId: other.id, itemId: tostitos, productId: wrongBrand.id } });

    const net = stubFda();
    const first = await recallsService.importAndMatch(new Date("2026-10-10T06:00:00Z"));
    expect(first.imported).toBe(3);
    expect(String(net.mock.calls[0][0])).toContain("search=report_date:[20260910+TO+20261010]");
    const second = await recallsService.importAndMatch(new Date("2026-10-10T06:00:00Z"));
    expect(second.imported).toBe(3);
    expect(second.matched).toBe(0);
    expect(String(net.mock.calls[1][0])).toContain("report_date:[20260930+TO+20261010]");

    expect(await prisma.recall.count({ where: { externalId: { in: ["H-1395-2026", "H-1396-2026", "SYNTH-0001"] } } })).toBe(3);
    const alerts = await api().get(`/api/groups/${g.id}/alerts`).set(a.auth);
    expect(alerts.body.recalls).toHaveLength(1);
    expect(alerts.body.recalls[0]).toMatchObject({
      cabinetItem: { name: "Tostitos", brand: "Frito-Lay" },
      recall: { externalId: "SYNTH-0001", firm: "Frito-Lay, Inc.", reportDate: "2026-09-30", url: expect.stringContaining("SYNTH-0001") },
    });
    expect(alerts.body.recalls[0].score).toBeGreaterThanOrEqual(0.35);
    // Brand known but not in the description → no match.
    expect((await api().get(`/api/groups/${other.id}/alerts`).set(a.auth)).body.recalls).toEqual([]);
  });

  it("adding an item to the cabinet re-runs matching against already-imported recalls", async () => {
    const a = await makeUser();
    const g = await makeGroup(a);
    await prisma.recall.upsert({
      where: { externalId: "SYNTH-0002" },
      update: {},
      create: { source: "openfda", externalId: "SYNTH-0002", productDescription: "SYNTHETIC: Fresh Spinach, 10 oz clamshell, all lots" },
    });
    await api().post(`/api/groups/${g.id}/cabinet`).set(a.auth).send({ itemId: await itemId("Spinach") }).expect(201);
    const alerts = await api().get(`/api/groups/${g.id}/alerts`).set(a.auth);
    expect(alerts.body.recalls.map((r: { recall: { externalId: string } }) => r.recall.externalId)).toEqual(["SYNTH-0002"]);
  });

  it("openFDA 404 (no matches) imports nothing", async () => {
    stubFda(JSON.stringify({ error: { code: "NOT_FOUND", message: "No matches found!" } }), 404);
    const res = await recallsService.importAndMatch(new Date("2030-01-01T06:00:00Z"));
    expect(res.imported).toBe(0);
  });
});
