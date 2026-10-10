import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db.js";
import { ai } from "../src/lib/anthropic.js";
import { conflicts } from "../src/lib/diets.js";
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

  it("prices uncached items in one web-search call, validates them, caches them, and the second call is served from the cache", async () => {
    const u = await makeUser();
    const g = await makeGroup(u);
    await api().patch("/api/me").set(u.auth).send({ zipCode: "64105" }).expect(200);
    const milk = await itemId("Milk");
    const bread = await itemId("Bread");
    const pasta = await itemId("Pasta");
    for (const id of [milk, bread, pasta]) await api().post(`/api/groups/${g.id}/shopping-list`).set(u.auth).send({ itemId: id }).expect(201);
    await prisma.priceEstimate.deleteMany({ where: { zipCode: "64105", itemId: { in: [milk, bread, pasta] } } });

    const call = stubClaude({
      stop_reason: "end_turn",
      content: [{ type: "web_search_tool_result", tool_use_id: "x", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } }],
      parsed_output: {
        prices: [
          { itemId: milk, itemName: "Milk", lowCents: 299, highCents: 459, typicalCents: 349, unit: "1 gal", sourceUrls: ["https://example.com/milk", "javascript:x"] },
          { itemId: bread, itemName: "Bread", lowCents: 250, highCents: 199, typicalCents: null, unit: "loaf", sourceUrls: [] }, // low > high → dropped
          { itemId: "00000000-0000-4000-8000-00000000beef", itemName: "Steak", lowCents: 1, highCents: 2, typicalCents: null, unit: null, sourceUrls: [] }, // not asked
          { itemId: pasta, itemName: "Pasta", lowCents: 100, highCents: 250, typicalCents: 300, unit: "1 lb", sourceUrls: [] }, // typical > high → dropped
        ],
      },
    });
    const res = await api().post(`/api/groups/${g.id}/shopping-list/prices`).set(u.auth).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ zipCode: "64105", totalLowCents: 299, totalHighCents: 459 });
    expect(res.body.items).toEqual([
      expect.objectContaining({ itemId: milk, name: "Milk", lowCents: 299, highCents: 459, typicalCents: 349, unit: "1 gal",
        sources: ["https://example.com/milk"], estimate: true, cached: false }),
    ]);
    expect(res.body.missingItemIds.sort()).toEqual([bread, pasta].sort());

    const params = call.mock.calls[0][0] as unknown as { tools: unknown[]; output_config: { effort: string }; messages: { content: string }[] };
    expect(params.tools).toEqual([
      { type: "web_search_20260209", name: "web_search", max_uses: 5, user_location: { type: "approximate", country: "US" } },
    ]);
    expect(params.output_config.effort).toBe("medium");
    expect(params.messages[0].content).toContain("64105");

    // Second call: Milk comes from the cache; only Bread and Pasta are asked again.
    const call2 = stubClaude({ stop_reason: "end_turn", parsed_output: { prices: [] } });
    const again = await api().post(`/api/groups/${g.id}/shopping-list/prices`).set(u.auth).send({ zipCode: "64105" });
    expect(again.body.items).toEqual([expect.objectContaining({ itemId: milk, cached: true })]);
    const prompt2 = (call2.mock.calls.at(-1)![0] as unknown as { messages: { content: string }[] }).messages[0].content;
    expect(prompt2).not.toContain(milk);
    expect(prompt2).toContain(bread);
  });

  it("an empty list costs nothing", async () => {
    const u = await makeUser();
    const g = await makeGroup(u);
    const call = stubClaude();
    const res = await api().post(`/api/groups/${g.id}/shopping-list/prices`).set(u.auth).send({ zipCode: "64105" });
    expect(res.body).toEqual({ zipCode: "64105", items: [], missingItemIds: [], totalLowCents: 0, totalHighCents: 0 });
    expect(call).not.toHaveBeenCalled();
  });
});
