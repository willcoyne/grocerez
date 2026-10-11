import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db.js";
import { config } from "../src/config.js";
import { conflicts } from "../src/lib/diets.js";
import { agent } from "../src/modules/products/lookup.js";
import { startPriceWarming, warmTimers } from "../src/modules/ai/warm.js";
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
      // Items are numbered in the prompt (`1. "Milk"`); the answer is compact rows [n, blsId, low, high, typical, unit].
      const n = Object.fromEntries([...user.matchAll(/^(\d+)\. "([^"]+)"/gm)].map((m) => [m[2], Number(m[1])]));
      const rows = [
        n.Milk && [n.Milk, "B1", 299, 459, 349, "1 gal"], // cited BLS candidate
        n.Bread && [n.Bread, "B9", 250, 199, null, "loaf"], // low > high → dropped
        [99, null, 1, 2], // not asked
        n.Pasta && [n.Pasta, null, 100, 250, 150, "1 lb box"], // AI estimate
      ].filter(Boolean);
      return { choices: [{ message: { content: JSON.stringify({ p: rows }) } }] };
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
      expect(prompts[1]).not.toContain("Milk");
      expect(prompts[1]).toContain('"Bread"');
      expect(prompts[0]).not.toContain(milk); // numbered items, no UUIDs for the model to copy
      expect(chat).toHaveBeenCalledTimes(2);

      // A neighbour in the same census region (64111, also Midwest) reuses those prices without asking the model.
      const neighbour = await api().post(`/api/groups/${g.id}/shopping-list/prices`).set(u.auth).send({ zipCode: "64111" });
      const reused = neighbour.body.items.map((i: { itemId: string }) => i.itemId).sort();
      expect(reused).toEqual([milk, pasta].sort());
      expect(chat).toHaveBeenCalledTimes(3); // only Bread (never priced) is asked again
    } finally {
      chat.mockRestore();
      config.AKAMAI_API_KEY = saved.key;
      config.AKAMAI_BASE_URL = saved.url;
    }
  });

  it("prices a list in the background after it changes, so the Prices screen is served from the cache", async () => {
    const u = await makeUser();
    const g = await makeGroup(u);
    await api().patch("/api/me").set(u.auth).send({ zipCode: "64105" }).expect(200);
    const olive = await itemId("Olive Oil");
    await prisma.priceEstimate.deleteMany({ where: { itemId: olive } });
    const saved = { key: config.AKAMAI_API_KEY, url: config.AKAMAI_BASE_URL, delay: warmTimers.delayMs };
    config.AKAMAI_API_KEY = "test-akamai-key";
    config.AKAMAI_BASE_URL = "https://akamai.test/v1";
    warmTimers.delayMs = 20;
    const chat = vi.spyOn(agent, "chat").mockImplementation(async (body) => {
      const user = (body.messages as { content: string }[])[1].content;
      const rows = [...user.matchAll(/^(\d+)\. "/gm)].map((m) => [Number(m[1]), null, 700, 1100, 899, "16.9 oz"]);
      return { choices: [{ message: { content: JSON.stringify({ p: rows }) } }] } as never;
    });
    const stop = startPriceWarming();
    try {
      await api().post(`/api/groups/${g.id}/shopping-list`).set(u.auth).send({ itemId: olive }).expect(201);
      await vi.waitFor(async () => expect(await prisma.priceEstimate.count({ where: { itemId: olive, zipCode: "64105" } })).toBe(1), {
        timeout: 3000,
      });
      const calls = chat.mock.calls.length;
      const res = await api().post(`/api/groups/${g.id}/shopping-list/prices`).set(u.auth).send({});
      expect(res.body.items.find((i: { itemId: string }) => i.itemId === olive)).toMatchObject({ cached: true, typicalCents: 899 });
      expect(chat.mock.calls.length).toBe(calls);
    } finally {
      stop();
      chat.mockRestore();
      Object.assign(config, { AKAMAI_API_KEY: saved.key, AKAMAI_BASE_URL: saved.url });
      warmTimers.delayMs = saved.delay;
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
