import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { findAllergens, findDietConflicts } from "../src/lib/allergens.js";
import type { AiClient } from "../src/modules/ai/client.js";
import { buildRecipeContext, estimatePrices, suggestRecipes, type RecipeInput } from "../src/modules/ai/service.js";

// Stubbed Claude: each call returns (or throws) the next queued response. No network.
function stub(...responses: unknown[]) {
  const create = vi.fn(async () => {
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return r;
  });
  return { client: { beta: { messages: { create } } } as AiClient, create };
}
const msg = (body: unknown, stop_reason = "end_turn", before: unknown[] = []) => ({
  stop_reason,
  content: [...before, { type: "text", text: typeof body === "string" ? body : JSON.stringify(body) }],
});

const recipe = (over: Record<string, unknown> = {}) => ({
  title: "Spinach omelette",
  summary: "Quick and dairy-free.",
  minutes: 15,
  servings: 2,
  usesCabinetItems: ["Spinach", "Eggs"],
  missingItems: [],
  steps: ["Whisk eggs.", "Cook with spinach."],
  allergenWarnings: [],
  ...over,
});

const now = new Date("2026-10-10T12:00:00Z");
const base: RecipeInput = {
  cabinetItems: [
    { name: "Spinach", expiresAt: new Date("2026-10-11T00:00:00Z") },
    { name: "Eggs", expiresAt: new Date("2026-11-01T00:00:00Z") },
    { name: "Rice" },
  ],
  members: [{ diets: [], allergens: ["milk"] }],
  maxRecipes: 3,
  mustUseExpiring: true,
  now,
};

describe("buildRecipeContext", () => {
  it("splits expiring (within 3 days) items and unions members' diets, allergens, and diet exclusions", () => {
    const ctx = buildRecipeContext({
      ...base,
      members: [
        { diets: ["vegan"], allergens: ["peanuts"] },
        { diets: ["gluten_free"], allergens: ["peanuts", "sesame"] },
      ],
    });
    expect(ctx.expiring).toEqual(["Spinach"]);
    expect(ctx.other).toEqual(["Eggs", "Rice"]);
    expect(ctx.diets).toEqual(["gluten_free", "vegan"]);
    expect(ctx.allergens).toEqual(["eggs", "fish", "gluten", "milk", "peanuts", "sesame", "shellfish", "wheat"]);
  });
});

describe("findAllergens", () => {
  it("matches plurals, ignores X-free phrases, and only reports forbidden allergens", () => {
    expect(findAllergens(["2 Eggs", "peanut butter"], ["eggs", "peanuts", "milk"])).toEqual(["eggs", "peanuts"]);
    expect(findAllergens(["dairy-free and nut free"], ["milk", "tree_nuts"])).toEqual([]);
    expect(findAllergens(["butternut squash", "coconut milk"], ["milk"])).toEqual([]);
    expect(findAllergens(["almond milk"], ["milk", "tree_nuts"])).toEqual(["tree_nuts"]);
    expect(findAllergens(["Eggplant parmigiana", "crabapple"], ["eggs", "shellfish"])).toEqual([]);
    expect(findAllergens(["Béchamel", "nut butter"], ["milk", "tree_nuts"])).toEqual(["milk", "tree_nuts"]);
  });
  it("checks meat/pork/honey keywords for the diets that forbid them", () => {
    expect(findDietConflicts(["Pork buns", "honey"], ["halal", "keto", "vegan", "vegetarian"])).toEqual(["halal", "vegan", "vegetarian"]);
    expect(findDietConflicts(["Mushroom risotto", "meatless", "hamachi-free"], ["vegan", "vegetarian"])).toEqual([]);
  });
});

describe("suggestRecipes", () => {
  it("sends one structured-output request with the plan's settings and returns validated recipes", async () => {
    const { client, create } = stub(msg({ recipes: [recipe()] }));
    const out = await suggestRecipes(base, client);
    expect(out).toEqual([recipe()]);

    const [params, opts] = create.mock.calls[0] as unknown as [Record<string, any>, Record<string, any>];
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect(params.output_config.effort).toBe("low");
    expect(params.output_config.format.type).toBe("json_schema");
    expect(params.output_config.format.schema.additionalProperties).toBe(false);
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(params.fallbacks).toBe("default");
    expect(opts.timeout).toBe(60_000);
    expect(params.messages[0].content).toContain('"allergens":["milk"]');
  });

  it("drops recipes that contain a member allergen, including diet-implied ones", async () => {
    const { client } = stub(
      msg({
        recipes: [
          recipe({ title: "Cheesy rice", usesCabinetItems: ["Rice", "Spinach"], missingItems: ["cheddar"] }),
          recipe({ title: "Spinach rice", usesCabinetItems: ["Rice", "Spinach"], steps: ["Top with butter."] }),
          recipe({ title: "Safe rice", usesCabinetItems: ["Rice", "Spinach"], allergenWarnings: [] }),
        ],
      }),
    );
    const out = await suggestRecipes(base, client);
    expect(out.map((r) => r.title)).toEqual(["Safe rice"]);

    const vegan = stub(msg({ recipes: [recipe()] })); // omelette has eggs
    expect(await suggestRecipes({ ...base, members: [{ diets: ["vegan"], allergens: [] }] }, vegan.client)).toEqual([]);
  });

  it("moves invented cabinet items to missingItems and enforces mustUseExpiring", async () => {
    const { client } = stub(
      msg({
        recipes: [
          recipe({ title: "A", usesCabinetItems: ["spinach", "Tomatoes"] }),
          recipe({ title: "B", usesCabinetItems: ["Rice"] }), // uses no expiring item
        ],
      }),
    );
    const out = await suggestRecipes(base, client);
    expect(out).toHaveLength(1);
    expect(out[0].usesCabinetItems).toEqual(["Spinach"]);
    expect(out[0].missingItems).toEqual(["Tomatoes"]);
  });

  it("returns [] without calling Claude when the cabinet is empty", async () => {
    const { client, create } = stub();
    expect(await suggestRecipes({ ...base, cabinetItems: [] }, client)).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  const unavailable = { status: 503, code: "AI_UNAVAILABLE" };
  it.each([
    ["extra fields on a recipe", msg({ recipes: [{ ...recipe(), calories: 400 }] })],
    ["extra top-level field", msg({ recipes: [], note: "hi" })],
    ["wrong types", msg({ recipes: [recipe({ minutes: "15" })] })],
    ["invalid JSON", msg("Sure! Here are some recipes")],
    ["refusal (content never read)", msg("not json", "refusal")],
    ["max_tokens truncation", msg('{"recipes":[', "max_tokens")],
    ["timeout", new Anthropic.APIConnectionTimeoutError()],
    ["connection error", new Anthropic.APIConnectionError({ message: "down" })],
    ["unexpected error", new Error("boom")],
  ])("maps %s to 503 AI_UNAVAILABLE", async (_name, response) => {
    const { client } = stub(response);
    await expect(suggestRecipes(base, client)).rejects.toMatchObject(unavailable);
  });
});

describe("estimatePrices", () => {
  const items = [
    { itemId: "i-milk", name: "Milk" },
    { itemId: "i-eggs", name: "Eggs" },
    { itemId: "i-rice", name: "Rice" },
    { itemId: "i-bread", name: "Bread" },
  ];
  const price = (itemId: string, low: number, typical: number, high: number, over = {}) => ({
    itemId, itemName: itemId, lowCents: low, typicalCents: typical, highCents: high, unit: "1 ct", sourceUrls: [], ...over,
  });
  const searchOk = { type: "web_search_tool_result", tool_use_id: "t1", content: [{ type: "web_search_result" }] };
  const searchErr = { type: "web_search_tool_result", tool_use_id: "t1", content: { type: "web_search_tool_result_error", error_code: "unavailable" } };

  it("keeps valid prices, rejects negative / misordered / unknown / duplicate rows, and labels them unpriced", async () => {
    const { client, create } = stub(
      msg(
        {
          prices: [
            price("i-milk", 299, 349, 449, { itemName: "ignore me", sourceUrls: ["https://kroger.com/milk", "javascript:alert(1)"] }),
            price("i-eggs", -50, 300, 400),
            price("i-rice", 500, 300, 400),
            price("i-unknown", 100, 200, 300),
            price("i-milk", 1, 2, 3),
          ],
        },
        "end_turn",
        [{ type: "server_tool_use", id: "t1", name: "web_search", input: {} }, searchOk],
      ),
    );
    const out = await estimatePrices({ items, zipCode: "63130" }, client);
    expect(out.prices).toEqual([
      { ...price("i-milk", 299, 349, 449), itemName: "Milk", sourceUrls: ["https://kroger.com/milk"], estimate: true },
    ]);
    expect(out.unpricedItemIds).toEqual(["i-eggs", "i-rice", "i-bread"]);

    const [params] = create.mock.calls[0] as unknown as [Record<string, any>];
    expect(params.output_config.effort).toBe("medium");
    expect(params.tools[0]).toMatchObject({ type: "web_search_20260209", max_uses: 5 });
    expect(params.messages[0].content).toContain("63130");
  });

  it("continues a pause_turn and then parses the final answer", async () => {
    const { client, create } = stub(
      { stop_reason: "pause_turn", content: [{ type: "server_tool_use", id: "t1", name: "web_search", input: {} }] },
      msg({ prices: [price("i-rice", 100, 150, 200)] }, "end_turn", [searchOk]),
    );
    const out = await estimatePrices({ items, zipCode: "63130" }, client);
    expect(out.prices.map((p) => p.itemId)).toEqual(["i-rice"]);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("returns 503 when every web search failed, or on extra fields", async () => {
    const failed = stub(msg({ prices: [price("i-rice", 100, 150, 200)] }, "end_turn", [searchErr]));
    await expect(estimatePrices({ items, zipCode: "63130" }, failed.client)).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });

    const extra = stub(msg({ prices: [{ ...price("i-rice", 1, 2, 3), store: "Kroger" }] }));
    await expect(estimatePrices({ items, zipCode: "63130" }, extra.client)).rejects.toMatchObject({ status: 503 });
  });
});
