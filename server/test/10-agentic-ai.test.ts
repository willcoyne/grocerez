import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db.js";
import { config } from "../src/config.js";
import { conflicts } from "../src/lib/diets.js";
import { agent } from "../src/modules/products/lookup.js";
import { api, itemId, makeGroup, makeUser } from "./helpers.js";

afterEach(() => vi.restoreAllMocks());

describe("10 deterministic diet/allergen re-check", () => {
  it("flags allergens and diet conflicts by keyword", () => {
    expect(conflicts("Satay with peanut sauce", [], ["peanuts"])).toEqual(["contains peanuts"]);
    expect(conflicts("Chicken stir fry", ["vegetarian"], [])).toEqual(["not vegetarian"]);
    expect(conflicts("Cheese omelette", ["vegan"], [])).toEqual(["not vegan"]);
    expect(conflicts("Spinach frittata with eggs", ["vegetarian"], ["peanuts"])).toEqual([]);
    expect(conflicts("Bacon pasta", ["halal"], [])).toEqual(["not halal"]);
  });
});

describe("10 price estimates", () => {
  it("needs a ZIP code (body, then profile)", async () => {
    const u = await makeUser();
    const g = await makeGroup(u);
    const res = await api().post(`/api/groups/${g.id}/shopping-list/prices`).set(u.auth).send({});
    expect([res.status, res.body.error.code]).toEqual([400, "ZIP_REQUIRED"]);
    expect((await api().post(`/api/groups/${g.id}/shopping-list/prices`).set(u.auth).send({ zipCode: "abc" })).status).toBe(400);
  });

  it("prices items with Akamai against BLS regional averages, validates them, caches them, and reuses the cache", async () => {
    const u = await makeUser();
    const g = await makeGroup(u);
    await api().patch("/api/me").set(u.auth).send({ zipCode: "64105" }).expect(200); // Midwest
    const milk = await itemId("Milk");
    const bread = await itemId("Bread");
    const pasta = await itemId("Pasta");
    for (const id of [milk, bread, pasta]) await api().post(`/api/groups/${g.id}/shopping-list`).set(u.auth).send({ itemId: id }).expect(201);
    await prisma.priceEstimate.deleteMany({ where: { zipCode: "64105", itemId: { in: [milk, bread, pasta] } } });

    const saved = { key: config.AKAMAI_API_KEY, url: config.AKAMAI_BASE_URL };
    config.AKAMAI_API_KEY = "test-akamai-key";
    config.AKAMAI_BASE_URL = "https://akamai.test/v1";
    const prompts: string[] = [];
    const chat = vi.spyOn(agent, "chat").mockImplementation(async (body) => {
      const user = (body.messages as { role: string; content: string }[])[1].content;
      prompts.push(user);
      const prices = [
        { itemId: milk, blsId: "B1", lowCents: 299, highCents: 459, typicalCents: 349, unit: "1 gal" }, // cited BLS candidate
        { itemId: bread, blsId: "B9", lowCents: 250, highCents: 199, typicalCents: null, unit: "loaf" }, // low > high → dropped
        { itemId: "00000000-0000-4000-8000-00000000beef", blsId: null, lowCents: 1, highCents: 2, unit: null }, // not asked
        { itemId: pasta, blsId: null, lowCents: 100, highCents: 250, typicalCents: 150, unit: "1 lb box" }, // AI estimate
      ].filter((p) => user.includes(p.itemId));
      return { choices: [{ message: { content: JSON.stringify({ prices }) } }] };
    });
    try {
      const res = await api().post(`/api/groups/${g.id}/shopping-list/prices`).set(u.auth).send({});
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ zipCode: "64105", totalLowCents: 399, totalHighCents: 709 });
      const byId = Object.fromEntries(res.body.items.map((i: { itemId: string }) => [i.itemId, i]));
      expect(byId[milk]).toMatchObject({ name: "Milk", typicalCents: 349, unit: "1 gal", basis: "regional_average", estimate: true, cached: false });
      // Midwest series when BLS has a recent one, else the U.S. average (whole milk: U.S. only).
      expect(byId[milk].sources[0]).toMatch(/^https:\/\/data\.bls\.gov\/timeseries\/APU0[02]/);
      expect(byId[pasta]).toMatchObject({ basis: "ai_estimate", sources: [] });
      expect(res.body.missingItemIds).toEqual([bread]);
      expect(prompts[0]).toContain("Shopper's region: Midwest");
      expect(prompts[0]).toMatch(/B1: Milk, fresh/);

      // Second call: Milk and Pasta come from the cache; only Bread is asked again.
      const again = await api().post(`/api/groups/${g.id}/shopping-list/prices`).set(u.auth).send({ zipCode: "64105" });
      expect(again.body.items.every((i: { cached: boolean }) => i.cached)).toBe(true);
      expect(prompts[1]).not.toContain(milk);
      expect(prompts[1]).toContain(bread);
      expect(chat).toHaveBeenCalledTimes(2);
    } finally {
      chat.mockRestore();
      config.AKAMAI_API_KEY = saved.key;
      config.AKAMAI_BASE_URL = saved.url;
    }
  });

  it("answers 503 when Akamai isn't configured and something needs pricing", async () => {
    const u = await makeUser();
    const g = await makeGroup(u);
    const salt = await itemId("Salt");
    await api().post(`/api/groups/${g.id}/shopping-list`).set(u.auth).send({ itemId: salt }).expect(201);
    await prisma.priceEstimate.deleteMany({ where: { zipCode: "64105", itemId: salt } });
    const res = await api().post(`/api/groups/${g.id}/shopping-list/prices`).set(u.auth).send({ zipCode: "64105" });
    expect(res.status).toBe(503);
  });

  it("an empty list costs nothing", async () => {
    const u = await makeUser();
    const g = await makeGroup(u);
    const chat = vi.spyOn(agent, "chat");
    const res = await api().post(`/api/groups/${g.id}/shopping-list/prices`).set(u.auth).send({ zipCode: "64105" });
    expect(res.body).toEqual({ zipCode: "64105", items: [], missingItemIds: [], totalLowCents: 0, totalHighCents: 0 });
    expect(chat).not.toHaveBeenCalled();
    chat.mockRestore();
  });
});
