import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { prisma } from "../src/db.js";
import { http } from "../src/lib/http.js";
import { agent } from "../src/modules/products/lookup.js";
import { api, itemId, makeGroupDirect, makeUser } from "./helpers.js";

const FK = "https://www.foodsafety.gov/keep-food-safe/foodkeeper-app";
const OFF = "https://world.openfoodfacts.org/product/0051500241776";

/** Fake Open Food Facts search: one Jif jar with peanut + soy, may contain tree nuts. */
const fakeOff = async () =>
  new Response(JSON.stringify({
    hits: [{ code: "0051500241776", product_name: "JIF Creamy Peanut Butter", brands: ["Jif"],
      allergens_tags: ["en:peanuts", "en:soybeans"], traces_tags: ["en:nuts"] }],
  }), { status: 200 });

/**
 * Fake hackathon-chat: round 1 calls the three tools; the final answer cites the real FoodKeeper/OFF entries
 * returned by those tools plus one made-up URL (which must be dropped, taking the price section with it).
 */
function fakeChat(body: Record<string, unknown>) {
  const messages = body.messages as { role: string; content: string }[];
  if (!body.response_format) {
    const tool = (name: string, query: string, i: number) => ({ id: `c${i}`, type: "function", function: { name, arguments: JSON.stringify({ query }) } });
    return { choices: [{ message: { content: null, tool_calls: [
      tool("shelf_life_search", "peanut butter", 1), tool("average_price_search", "peanut butter", 2), tool("product_search", "Jif creamy peanut butter", 3),
    ] } }] };
  }
  const shelf = JSON.parse(messages.find((m) => m.role === "tool")!.content) as { source: { url: string } }[];
  const fkUrl = shelf.find((r) => r.source.url.startsWith(FK))!.source.url;
  const answer = {
    product: { name: "Jif Creamy Peanut Butter", brand: "Jif", genericName: "Peanut Butter", category: "pantry" },
    shelfLife: {
      maxDays: 999, usualStorage: "pantry", notes: null,
      entries: [
        { storage: "pantry", opened: false, minDays: 180, maxDays: 270 },
        { storage: "fridge", opened: true, minDays: 90, maxDays: 120 },
        { storage: "freezer", opened: false, minDays: null, maxDays: 99999 },
      ],
      sources: [{ url: fkUrl, title: "whatever the model says", quote: "pantry 6-9 months" }],
    },
    price: { typicalCents: 399, unit: "16 oz", area: "Midwest", asOf: "2026-08", local: true,
      sources: [{ url: "https://made-up-grocer.example/jif", title: "Made up", quote: "$3.99" }] },
    allergens: { contains: ["peanuts", "soy"], mayContain: ["tree_nuts"], basis: "Open Food Facts",
      sources: [{ url: OFF, title: "x", quote: "contains peanuts, soy" }] },
  };
  return { choices: [{ message: { content: JSON.stringify(answer) } }] };
}

const original = { key: config.AKAMAI_API_KEY, url: config.AKAMAI_BASE_URL };

beforeAll(() => {
  config.AKAMAI_API_KEY = "test-akamai-key";
  config.AKAMAI_BASE_URL = "https://akamai.test/v1";
  vi.spyOn(http, "fetch").mockImplementation(fakeOff);
  vi.spyOn(agent, "chat").mockImplementation(async (b) => fakeChat(b) as never);
});

afterAll(async () => {
  vi.restoreAllMocks();
  config.AKAMAI_API_KEY = original.key;
  config.AKAMAI_BASE_URL = original.url;
  await prisma.productLookup.deleteMany();
});

describe("AI product lookup (backend/13)", () => {
  it("returns cited shelf life + allergens, drops the uncited price, and caches the result", async () => {
    const u = await makeUser();
    const res = await api().post("/api/products/lookup").set(u.auth).send({ name: "Jif creamy peanut butter", zipCode: "64111" });
    expect(res.status).toBe(200);
    const r = res.body.result;
    expect(res.body).toMatchObject({ estimate: true, cached: false, zipCode: "64111", item: { name: "Peanut Butter" } });
    // Headline max = the pantry unopened entry (not the model's 999); the 99999-day entry is dropped.
    expect(r.shelfLife.maxDays).toBe(270);
    expect(r.shelfLife.entries.map((e: { storage: string }) => e.storage)).toEqual(["pantry", "fridge"]);
    // Citation title comes from the tool, not the model.
    expect(r.shelfLife.sources[0].url).toMatch(/^https:\/\/www\.foodsafety\.gov\/.*#product-\d+$/);
    expect(r.shelfLife.sources[0].title).toMatch(/^USDA FoodKeeper: /);
    expect(r.price).toBeNull();
    expect(r.allergens).toMatchObject({ contains: ["peanuts", "soy"], mayContain: ["tree_nuts"] });
    expect(r.allergens.sources).toEqual([{ url: OFF, title: "Open Food Facts: Jif JIF Creamy Peanut Butter", quote: "contains peanuts, soy" }]);

    const calls = vi.mocked(agent.chat).mock.calls.length;
    const again = await api().post("/api/products/lookup").set(u.auth).send({ name: "jif  Creamy peanut butter!", zipCode: "64112" });
    expect(again.body.cached).toBe(true);
    expect(vi.mocked(agent.chat).mock.calls.length).toBe(calls);
  });

  it("gives a cabinet row an estimated expiration, but never overwrites a manual date", async () => {
    const u = await makeUser();
    const g = await makeGroupDirect(u);
    const pb = await itemId("Peanut Butter");
    const add = await api().post(`/api/groups/${g.id}/cabinet`).set(u.auth).send({ itemId: pb, location: "pantry" });
    const res = await api().post("/api/products/lookup").set(u.auth)
      .send({ name: "Jif creamy peanut butter", zipCode: "64111", groupId: g.id, cabinetItemId: add.body.id });
    expect(res.status).toBe(200);
    const row = await prisma.cabinetItem.findUniqueOrThrow({ where: { id: add.body.id } });
    expect(row.expirationSource).toBe("estimated");
    const days = Math.round((row.expiresAt!.getTime() - Date.now()) / 86_400_000);
    expect(days).toBeGreaterThanOrEqual(268);
    expect(days).toBeLessThanOrEqual(271);

    await prisma.cabinetItem.update({ where: { id: row.id }, data: { expiresAt: new Date("2030-01-02"), expirationSource: "manual" } });
    const again = await api().post("/api/products/lookup").set(u.auth)
      .send({ name: "Jif creamy peanut butter", zipCode: "64111", groupId: g.id, cabinetItemId: row.id });
    expect(again.body.cabinetExpiresAt).toBe("2030-01-02");

    const stranger = await makeUser();
    const denied = await api().post("/api/products/lookup").set(stranger.auth)
      .send({ name: "Jif creamy peanut butter", groupId: g.id, cabinetItemId: row.id });
    expect(denied.status).toBe(403);
  });

  it("validates the body and answers 503 without an Akamai key", async () => {
    const u = await makeUser();
    expect((await api().post("/api/products/lookup").set(u.auth).send({ name: "milk", gtin: "012345678905" })).status).toBe(400);
    config.AKAMAI_API_KEY = undefined;
    const res = await api().post("/api/products/lookup").set(u.auth).send({ name: "milk" });
    config.AKAMAI_API_KEY = "test-akamai-key";
    expect(res.status).toBe(503);
  });
});
