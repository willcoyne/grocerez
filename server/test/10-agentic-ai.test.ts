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


describe("10 deterministic diet/allergen re-check", () => {
  it("flags allergens and diet conflicts by keyword", () => {
    expect(conflicts("Satay with peanut sauce", [], ["peanuts"])).toEqual(["contains peanuts"]);
    expect(conflicts("Chicken stir fry", ["vegetarian"], [])).toEqual(["not vegetarian"]);
    expect(conflicts("Cheese omelette", ["vegan"], [])).toEqual(["not vegan"]);
    expect(conflicts("Spinach frittata with eggs", ["vegetarian"], ["peanuts"])).toEqual([]);
    expect(conflicts("Bacon pasta", ["halal"], [])).toEqual(["not halal"]);
  });
});

/** One item on the list and a ZIP, nothing cached, so POST /shopping-list/prices makes exactly one Claude call. */
async function priced() {
  const u = await makeUser();
  const g = await makeGroup(u);
  await api().patch("/api/me").set(u.auth).send({ zipCode: "64105" }).expect(200);
  const eggs = await itemId("Eggs");
  await api().post(`/api/groups/${g.id}/shopping-list`).set(u.auth).send({ itemId: eggs }).expect(201);
  await prisma.priceEstimate.deleteMany({ where: { zipCode: "64105", itemId: eggs } });
  return { u, url: `/api/groups/${g.id}/shopping-list/prices` };
}

describe("10 Claude call handling (through /shopping-list/prices)", () => {
  it("without ANTHROPIC_API_KEY → 503 NOT_CONFIGURED", async () => {
    const { u, url } = await priced();
    const res = await api().post(url).set(u.auth).send({});
    expect([res.status, res.body.error.code]).toEqual([503, "NOT_CONFIGURED"]);
  });

  it("checks stop_reason first: refusal → 422, max_tokens → 503; bad output → 502; SDK errors → 503; pause_turn is resumed", async () => {
    const { u, url } = await priced();
    stubClaude({ stop_reason: "refusal", parsed_output: { prices: [] } });
    let res = await api().post(url).set(u.auth).send({});
    expect([res.status, res.body.error.code]).toEqual([422, "AI_REFUSED"]);
    vi.restoreAllMocks();

    stubClaude({ stop_reason: "max_tokens" });
    res = await api().post(url).set(u.auth).send({});
    expect([res.status, res.body.error.code]).toEqual([503, "AI_UNAVAILABLE"]);
    vi.restoreAllMocks();

    stubClaude({ stop_reason: "end_turn", parsed_output: { prices: [{ itemId: "no other fields" }] } });
    res = await api().post(url).set(u.auth).send({});
    expect([res.status, res.body.error.code]).toEqual([502, "AI_BAD_OUTPUT"]);
    vi.restoreAllMocks();

    vi.spyOn(ai, "isConfigured").mockReturnValue(true);
    vi.spyOn(ai, "call").mockRejectedValue(new Anthropic.APIConnectionError({ message: "timeout" }));
    res = await api().post(url).set(u.auth).send({});
    expect([res.status, res.body.error.code]).toEqual([503, "AI_UNAVAILABLE"]);
    vi.restoreAllMocks();

    const call = stubClaude(
      { stop_reason: "pause_turn", content: [{ type: "text", text: "..." }] },
      { stop_reason: "end_turn", parsed_output: { prices: [] } },
    );
    res = await api().post(url).set(u.auth).send({});
    expect(res.status).toBe(200);
    expect(call).toHaveBeenCalledTimes(2);
    const second = call.mock.calls[1][0] as unknown as { messages: { role: string }[] };
    expect(second.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
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
