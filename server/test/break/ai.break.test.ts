// Break tests (M1): Claude output handling in the standalone AI layer (plan backend/10). Claude is never called:
// either a stub client, or the real Anthropic SDK pointed at a local fake server. Tests named "[DEFECT B-xx]" FAIL.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AiClient } from "../../src/modules/ai/client.js";
import { estimatePrices, suggestRecipes, type RecipeInput } from "../../src/modules/ai/service.js";

const stub = (...responses: unknown[]) =>
  ({ beta: { messages: { create: vi.fn(async () => { const r = responses.shift(); if (r instanceof Error) throw r; return r; }) } } }) as AiClient;
const msg = (body: unknown, stop_reason = "end_turn") => ({
  stop_reason,
  content: [{ type: "text", text: typeof body === "string" ? body : JSON.stringify(body) }],
});
const recipe = (over: Record<string, unknown> = {}) => ({
  title: "Rice bowl", summary: "Simple.", minutes: 20, servings: 2, usesCabinetItems: ["Rice"], missingItems: [],
  steps: ["Cook rice."], allergenWarnings: [], ...over,
});
const input = (allergens: RecipeInput["members"][number]["allergens"], diets: string[] = []): RecipeInput => ({
  cabinetItems: [{ name: "Rice" }], members: [{ diets, allergens }], maxRecipes: 5, mustUseExpiring: false,
});
const items = [{ itemId: "i1", name: "Milk" }, { itemId: "i2", name: "Eggs" }];
const price = (over: Record<string, unknown> = {}) => ({
  itemId: "i1", itemName: "Milk", lowCents: 300, typicalCents: 400, highCents: 500, unit: "1 gal", sourceUrls: [], ...over,
});
const ai503 = { status: 503, code: "AI_UNAVAILABLE" };

describe("malformed / hostile model output -> 503 AI_UNAVAILABLE, never a raw error", () => {
  it.each([
    ["not JSON", msg("Sure! Here are some recipes: ...")],
    ["empty text", msg("")],
    ["JSON array instead of object", msg([recipe()])],
    ["recipes: null", msg({ recipes: null })],
    ["extra top-level field", msg({ recipes: [recipe()], note: "hi" })],
    ["extra recipe field", msg({ recipes: [recipe({ calories: 500 })] })],
    ["minutes as string", msg({ recipes: [recipe({ minutes: "20" })] })],
    ["minutes 1e400 (Infinity)", msg('{"recipes":[{"title":"x","summary":"","minutes":1e400,"servings":1,"usesCabinetItems":[],"missingItems":[],"steps":["a"],"allergenWarnings":[]}]}')],
    ["refusal", msg({ recipes: [recipe()] }, "refusal")],
    ["max_tokens", msg('{"recipes":[{"title":"Rice', "max_tokens")],
    ["stop_reason null", msg({ recipes: [] }, null as never)],
    ["no content array", { stop_reason: "end_turn" }],
    ["null message", null],
    ["timeout error", new Anthropic.APIConnectionTimeoutError()],
    ["rate limit error", new Error("429 rate_limit_error")],
  ])("%s", async (_n, response) => {
    await expect(suggestRecipes(input([]), stub(response))).rejects.toMatchObject(ai503);
  });

  it("prices: negative, low > high, typical outside range, over cap, unknown id are dropped and reported unpriced", async () => {
    const out = await estimatePrices(
      { items, zipCode: "63130" },
      stub(msg({ prices: [
        price({ lowCents: -1 }),
        price({ itemId: "i2", itemName: "Eggs", lowCents: 600, typicalCents: 500, highCents: 400 }),
        price({ itemId: "i2", itemName: "Eggs", typicalCents: 900 }),
        price({ itemId: "zzz" }),
        price({ highCents: 10_000_000 }),
      ] })),
    );
    expect(out.prices).toEqual([]);
    expect(out.unpricedItemIds.sort()).toEqual(["i1", "i2"]);
  });

  it("prices: model-supplied itemName and javascript: URLs never reach the client; every row is labeled estimate", async () => {
    const out = await estimatePrices(
      { items, zipCode: "63130" },
      stub(msg({ prices: [price({ itemName: "<script>alert(1)</script>", sourceUrls: ["javascript:alert(1)", "https://store.example/milk"] })] })),
    );
    expect(out.prices).toEqual([expect.objectContaining({ itemName: "Milk", sourceUrls: ["https://store.example/milk"], estimate: true })]);
  });
});

describe("real Anthropic SDK against a local fake API (no network)", () => {
  let server: Server;
  let mode = "500";
  let base = "";
  beforeAll(async () => {
    server = createServer((req, res) => {
      req.resume();
      if (mode === "reset") return req.socket.destroy();
      if (mode === "garbage") { res.writeHead(200, { "content-type": "application/json" }); return res.end("{not json"); }
      if (mode === "html") { res.writeHead(502, { "content-type": "text/html" }); return res.end("<html>Bad gateway</html>"); }
      const status = Number(mode);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: status === 429 ? "rate_limit_error" : "overloaded_error", message: "x" } }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it.each(["500", "529", "429", "401", "400", "garbage", "html", "reset"])("upstream %s -> 503", async (m) => {
    mode = m;
    const client = new Anthropic({ apiKey: "test", baseURL: base, maxRetries: 0 }) as unknown as AiClient;
    await expect(suggestRecipes(input([]), client)).rejects.toMatchObject(ai503);
    await expect(estimatePrices({ items, zipCode: "63130" }, client)).rejects.toMatchObject(ai503);
  });
});

describe("deterministic allergen re-check (plan 10: 'Re-check each recipe ... against member allergens')", () => {
  // Each recipe obviously contains the member's allergen, but no word in the keyword table matches.
  it.each([
    ["milk", recipe({ title: "Buttermilk pancakes", missingItems: ["buttermilk"] })],
    ["milk", recipe({ title: "Vanilla custard", missingItems: ["custard powder"] })],
    ["eggs", recipe({ title: "Garlic aioli dip", missingItems: ["aioli"] })],
    ["tree_nuts", recipe({ title: "Basil pesto rice", missingItems: ["pesto"] })],
    ["tree_nuts", recipe({ title: "Nutella toast", missingItems: ["Nutella"] })],
    ["tree_nuts", recipe({ title: "Rice with nut butter drizzle", missingItems: ["nut butter"] })],
    ["sesame", recipe({ title: "Hummus bowl", missingItems: ["hummus"] })],
    ["soy", recipe({ title: "Teriyaki rice", missingItems: ["teriyaki sauce"] })],
    ["gluten", recipe({ title: "Seitan stir fry", missingItems: ["seitan"] })],
    ["wheat", recipe({ title: "Panko-crusted rice cakes", missingItems: ["panko"] })],
    ["fish", recipe({ title: "Rice with Worcestershire glaze", missingItems: ["Worcestershire sauce"] })],
    ["shellfish", recipe({ title: "Crabmeat fried rice", missingItems: ["crabmeat"] })],
  ] as const)("[DEFECT B-01] a recipe containing %s is dropped: %#", async (allergen, r) => {
    const out = await suggestRecipes(input([allergen]), stub(msg({ recipes: [r] })));
    expect(out.map((x) => x.title)).toEqual([]);
  });

  it.each([
    ["vegetarian", "Beef tacos", "ground beef"],
    ["vegan", "Chicken fried rice", "chicken thighs"],
    ["vegetarian", "Bacon rice", "bacon"],
  ])("[DEFECT B-14] a %s household never gets '%s'", async (diet, title, meat) => {
    const out = await suggestRecipes(input([], [diet]), stub(msg({ recipes: [recipe({ title, missingItems: [meat] })] })));
    expect(out).toEqual([]);
  });

  it("control: the obvious cases are dropped", async () => {
    const out = await suggestRecipes(input(["peanuts"]), stub(msg({ recipes: [recipe({ title: "Peanut noodles" }), recipe()] })));
    expect(out.map((r) => r.title)).toEqual(["Rice bowl"]);
  });
});
