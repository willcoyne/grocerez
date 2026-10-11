import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db.js";
import { config } from "../src/config.js";
import { ai } from "../src/lib/anthropic.js";
import { conflicts } from "../src/lib/diets.js";
import { agent } from "../src/modules/products/lookup.js";
import { api, itemId, makeGroup, makeUser } from "./helpers.js";

afterEach(() => vi.restoreAllMocks());

type Fake = { stop_reason: string; parsed_output?: unknown; content?: unknown[] };
/** Stubs the single Claude call site; each call returns the next fake response. */
function stubClaude(...responses: Fake[]) {
  vi.spyOn(ai, "isConfigured").mockReturnValue(true);
  const queue = [...responses];
  return vi.spyOn(ai, "call").mockImplementation(async () => {
    const r = queue.shift();
    if (!r) throw new Error("unexpected extra Claude call");
    return { content: r.content ?? [], stop_reason: r.stop_reason, parsed_output: r.parsed_output ?? null } as never;
  });
}

const day = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
const recipe = (over: Record<string, unknown>) => ({
  title: "Spinach Frittata", summary: "Quick eggs and greens", minutes: 20, servings: 2,
  ingredients: ["4 eggs", "2 cups spinach", "1 clove garlic"], usesCabinetItems: ["Spinach", "Eggs"],
  missingItems: ["Garlic"], steps: ["Whisk", "Cook"], allergenWarnings: [], ...over,
});

async function kitchen() {
  const owner = await makeUser();
  const member = await makeUser({ allergens: ["peanuts"] });
  await prisma.userDiet.create({ data: { userId: member.id, diet: "vegetarian" } });
  const g = await makeGroup(owner, [member]);
  await api().post(`/api/groups/${g.id}/cabinet`).set(owner.auth).send({ itemId: await itemId("Spinach"), expiresAt: day(1) }).expect(201);
  await api().post(`/api/groups/${g.id}/cabinet`).set(owner.auth).send({ itemId: await itemId("Eggs"), expiresAt: day(20) }).expect(201);
  return { owner, member, g };
}

describe("10 deterministic diet/allergen re-check", () => {
  it("flags allergens and diet conflicts by keyword", () => {
    expect(conflicts("Satay with peanut sauce", [], ["peanuts"])).toEqual(["contains peanuts"]);
    expect(conflicts("Chicken stir fry", ["vegetarian"], [])).toEqual(["not vegetarian"]);
    expect(conflicts("Cheese omelette", ["vegan"], [])).toEqual(["not vegan"]);
    expect(conflicts("Spinach frittata with eggs", ["vegetarian"], ["peanuts"])).toEqual([]);
    expect(conflicts("Bacon pasta", ["halal"], [])).toEqual(["not halal"]);
  });
});

describe("10 recipes", () => {
  it("without ANTHROPIC_API_KEY → 503 NOT_CONFIGURED", async () => {
    const { owner, g } = await kitchen();
    const res = await api().post(`/api/groups/${g.id}/recipes/suggest`).set(owner.auth).send({});
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("NOT_CONFIGURED");
  });

  it("builds the context in code, calls Claude correctly, drops unsafe recipes and maps missing items to the catalog", async () => {
    const { owner, g } = await kitchen();
    const call = stubClaude({
      stop_reason: "end_turn",
      parsed_output: {
        recipes: [
          recipe({}),
          recipe({ title: "Spinach Satay", ingredients: ["spinach", "peanut sauce"], missingItems: [] }),
          recipe({ title: "Chicken Florentine", ingredients: ["chicken breast", "spinach"], missingItems: ["Zzqxv Spice"] }),
        ],
      },
    });
    const res = await api().post(`/api/groups/${g.id}/recipes/suggest`).set(owner.auth).send({ maxRecipes: 3 });
    expect(res.status).toBe(200);
    expect(res.body.map((r: { title: string }) => r.title)).toEqual(["Spinach Frittata"]);
    expect(res.body[0]).toMatchObject({
      usesExpiring: ["Spinach"],
      missingItems: [{ name: "Garlic", itemId: await itemId("Garlic"), itemName: "Garlic", match: "exact" }],
    });

    const params = call.mock.calls[0][0] as unknown as Record<string, unknown> & { messages: { content: string }[] };
    expect(params).toMatchObject({
      model: "claude-opus-5-5",
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    expect((params.output_config as { format: unknown }).format).toBeTruthy();
    const prompt = params.messages[0].content;
    expect(prompt).toContain("vegetarian");
    expect(prompt).toContain("peanuts");
    expect(prompt).toMatch(/EXPIRING SOON:\n- Spinach/);
    expect(prompt).toMatch(/ALSO IN THE KITCHEN:\n- Eggs/);

    // "Add missing to list" = manual list add with the mapped item id.
    await api().post(`/api/groups/${g.id}/shopping-list`).set(owner.auth).send({ itemId: res.body[0].missingItems[0].itemId }).expect(201);
  });

  it("checks stop_reason first: refusal → 422, max_tokens → 503; bad output → 502; SDK errors → 503; pause_turn is resumed", async () => {
    const { owner, g } = await kitchen();
    const url = `/api/groups/${g.id}/recipes/suggest`;
    stubClaude({ stop_reason: "refusal", parsed_output: { recipes: [recipe({})] } });
    let res = await api().post(url).set(owner.auth).send({});
    expect([res.status, res.body.error.code]).toEqual([422, "AI_REFUSED"]);
    vi.restoreAllMocks();

    stubClaude({ stop_reason: "max_tokens" });
    res = await api().post(url).set(owner.auth).send({});
    expect([res.status, res.body.error.code]).toEqual([503, "AI_UNAVAILABLE"]);
    vi.restoreAllMocks();

    stubClaude({ stop_reason: "end_turn", parsed_output: { recipes: [{ title: "no fields" }] } });
    res = await api().post(url).set(owner.auth).send({});
    expect([res.status, res.body.error.code]).toEqual([502, "AI_BAD_OUTPUT"]);
    vi.restoreAllMocks();

    vi.spyOn(ai, "isConfigured").mockReturnValue(true);
    vi.spyOn(ai, "call").mockRejectedValue(new Anthropic.APIConnectionError({ message: "timeout" }));
    res = await api().post(url).set(owner.auth).send({});
    expect([res.status, res.body.error.code]).toEqual([503, "AI_UNAVAILABLE"]);
    vi.restoreAllMocks();

    const call = stubClaude(
      { stop_reason: "pause_turn", content: [{ type: "text", text: "..." }] },
      { stop_reason: "end_turn", parsed_output: { recipes: [recipe({})] } },
    );
    res = await api().post(url).set(owner.auth).send({});
    expect(res.status).toBe(200);
    expect(call).toHaveBeenCalledTimes(2);
    const second = call.mock.calls[1][0] as unknown as { messages: { role: string }[] };
    expect(second.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("an empty cabinet is 400 CABINET_EMPTY", async () => {
    const u = await makeUser();
    const g = await makeGroup(u);
    stubClaude();
    const res = await api().post(`/api/groups/${g.id}/recipes/suggest`).set(u.auth).send({});
    expect([res.status, res.body.error.code]).toEqual([400, "CABINET_EMPTY"]);
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
