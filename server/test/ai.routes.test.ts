import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app.js";
import { Group } from "../src/contracts/groups.js";
import { PriceEstimateResponse, RecipeSuggestResponse } from "../src/contracts/ai.js";
import { prisma } from "../src/db.js";
import { normalizeItemName } from "../src/lib/normalize.js";
import { cleanupUsers, makeUser } from "./helpers.js";

// Stubbed Claude for every route call: each request takes the next queued response (or error). No network.
const ai = vi.hoisted(() => {
  const queue: unknown[] = [];
  const create = vi.fn(async (..._args: unknown[]) => {
    const r = queue.shift();
    if (r instanceof Error) throw r;
    if (r === undefined) throw new Error("unexpected Claude call");
    return r;
  });
  return { queue, create };
});
vi.mock("../src/modules/ai/client.js", async (orig) => ({
  ...(await orig<typeof import("../src/modules/ai/client.js")>()),
  getAiClient: () => ({ beta: { messages: { create: ai.create } } }),
}));

type U = Awaited<ReturnType<typeof makeUser>>;
const api = () => request(app);
const msg = (body: unknown, before: unknown[] = []) => ({
  stop_reason: "end_turn",
  content: [...before, { type: "text", text: JSON.stringify(body) }],
});
const userText = (call: number) => JSON.stringify((ai.create.mock.calls[call]![0] as { messages: unknown[] }).messages);
const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000);
const tag = randomUUID().slice(0, 8).replace(/\d/g, "x");

let u1: U, u2: U, outsider: U, g: Group, limited: Group;
const items = {} as Record<"spinach" | "rice" | "parmesan" | "basil" | "milk" | "bread", { id: string; name: string }>;
const mkItem = (name: string) => {
  const full = `${name} ${tag}`;
  return prisma.item.create({ data: { name: full, normalizedName: normalizeItemName(full) }, select: { id: true, name: true } });
};

beforeAll(async () => {
  [u1, u2, outsider] = await Promise.all([makeUser(), makeUser(), makeUser()]);
  for (const k of ["spinach", "rice", "parmesan", "basil", "milk", "bread"] as const) items[k] = await mkItem(k);
  g = Group.parse((await api().post("/api/groups").set(u1.auth).send({ name: "AI House" }).expect(201)).body);
  limited = Group.parse((await api().post("/api/groups").set(u1.auth).send({ name: "Rate Limited" }).expect(201)).body);
  await prisma.groupMember.create({ data: { groupId: g.id, userId: u2.id, role: "member" } });
  await prisma.userAllergen.create({ data: { userId: u2.id, allergen: "milk" } });
  await prisma.userDiet.create({ data: { userId: u1.id, diet: "vegetarian" } });
});

beforeEach(async () => {
  ai.queue.length = 0;
  ai.create.mockClear();
  await prisma.cabinetItem.deleteMany({ where: { groupId: g.id } });
  await prisma.shoppingListItem.deleteMany({ where: { groupId: g.id } });
  await prisma.priceEstimate.deleteMany({ where: { itemId: { in: Object.values(items).map((i) => i.id) } } });
  await prisma.user.update({ where: { id: u1.id }, data: { zipCode: null } });
});

afterAll(async () => {
  await cleanupUsers();
  await prisma.item.deleteMany({ where: { id: { in: Object.values(items).map((i) => i.id) } } });
});

const recipe = (over: Record<string, unknown> = {}) => ({
  title: "Spinach rice bowl",
  summary: "Quick and simple.",
  minutes: 20,
  servings: 2,
  usesCabinetItems: [items.spinach.name, items.rice.name],
  missingItems: [items.basil.name, "dragonfruit zzqx"],
  steps: ["Cook rice.", "Wilt spinach.", "Top with basil."],
  allergenWarnings: [],
  ...over,
});

describe("authorization", () => {
  it("non-members get 404 on both routes and Claude is never called", async () => {
    await api().post(`/api/groups/${g.id}/recipes/suggest`).set(outsider.auth).send({}).expect(404);
    await api().post(`/api/groups/${g.id}/shopping-list/prices`).set(outsider.auth).send({ zipCode: "64105" }).expect(404);
    await api().post(`/api/groups/${g.id}/shopping-list/prices`).send({ zipCode: "64105" }).expect(401);
    expect(ai.create).not.toHaveBeenCalled();
  });
});

describe("POST /groups/:groupId/recipes/suggest", () => {
  beforeEach(async () => {
    await prisma.cabinetItem.createMany({
      data: [
        { groupId: g.id, itemId: items.spinach.id, expiresAt: plusDays(1) },
        { groupId: g.id, itemId: items.rice.id, expiresAt: plusDays(200) },
      ],
    });
  });

  it("builds context from the cabinet and combined member diets/allergens, drops unsafe recipes, maps missing items", async () => {
    ai.queue.push(
      msg({
        recipes: [
          recipe(),
          recipe({ title: "Cheesy spinach risotto", missingItems: [items.parmesan.name, "cheese"] }), // milk: dropped
        ],
      }),
    );
    const res = await api().post(`/api/groups/${g.id}/recipes/suggest`).set(u1.auth).expect(200);
    const body = RecipeSuggestResponse.parse(res.body);

    const ctx = userText(0);
    expect(ctx).toContain(items.spinach.name); // expiring item
    expect(ctx).toContain("milk"); // u2's allergen
    expect(ctx).toContain("vegetarian"); // u1's diet
    expect(ctx).toMatch(/expiring/);
    const sent = JSON.parse(JSON.parse(ctx)[0].content.split("\n").slice(1).join("\n"));
    expect(sent.expiring).toEqual([items.spinach.name]);
    expect(sent.allergens).toEqual(expect.arrayContaining(["milk", "fish", "shellfish"]));

    expect(body.map((r) => r.title)).toEqual(["Spinach rice bowl"]);
    expect(body[0]!.missingItemMatches).toEqual([
      { name: items.basil.name, item: expect.objectContaining({ id: items.basil.id }) },
      { name: "dragonfruit zzqx", item: null },
    ]);

    // "Add missing to list": the matched catalog item goes onto the shopping list as a manual row.
    const add = await api()
      .post(`/api/groups/${g.id}/shopping-list`)
      .set(u1.auth)
      .send({ itemId: body[0]!.missingItemMatches[0]!.item!.id })
      .expect(200);
    expect(add.body).toMatchObject({ reason: "manual" });
  });

  it("uses the effort/model/structured output settings from the plan", async () => {
    ai.queue.push(msg({ recipes: [] }));
    await api().post(`/api/groups/${g.id}/recipes/suggest`).set(u1.auth).send({ maxRecipes: 2 }).expect(200);
    const params = ai.create.mock.calls[0]![0] as Record<string, any>;
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.output_config.effort).toBe("low");
    expect(params.output_config.format).toBeDefined();
    expect(userText(0)).toContain("up to 2 recipes");
  });

  it("returns [] without calling Claude when the cabinet is empty", async () => {
    await prisma.cabinetItem.deleteMany({ where: { groupId: g.id } });
    const res = await api().post(`/api/groups/${g.id}/recipes/suggest`).set(u1.auth).expect(200);
    expect(res.body).toEqual([]);
    expect(ai.create).not.toHaveBeenCalled();
  });

  it.each([
    ["rate limit", new Anthropic.RateLimitError(429, { type: "error" }, "rate limited", new Headers())],
    ["network", new Error("socket hang up")],
    ["refusal", { stop_reason: "refusal", content: [] }],
    ["max_tokens", { stop_reason: "max_tokens", content: [{ type: "text", text: '{"recipes":[' }] }],
    ["bad shape", msg({ recipes: [{ title: "x" }] })],
  ])("Claude failure (%s) is 503 AI_UNAVAILABLE, never 500", async (_n, r) => {
    ai.queue.push(r);
    const res = await api().post(`/api/groups/${g.id}/recipes/suggest`).set(u1.auth).send({}).expect(503);
    expect(res.body.error.code).toBe("AI_UNAVAILABLE");
  });

  it("validates the body", async () => {
    await api().post(`/api/groups/${g.id}/recipes/suggest`).set(u1.auth).send({ maxRecipes: 50 }).expect(400);
    await api().post(`/api/groups/${g.id}/recipes/suggest`).set(u1.auth).send({ mustUseExpiring: "yes" }).expect(400);
  });

  it("limits each group to 10 requests per hour", async () => {
    // Empty cabinet: no Claude call, but the request still counts.
    for (let i = 0; i < 10; i++) await api().post(`/api/groups/${limited.id}/recipes/suggest`).set(u1.auth).expect(200);
    const res = await api().post(`/api/groups/${limited.id}/recipes/suggest`).set(u1.auth).expect(429);
    expect(res.body.error.code).toBe("RATE_LIMITED");
    // Another group is unaffected (g has its own budget, already used by the tests above).
    const fresh = Group.parse((await api().post("/api/groups").set(u1.auth).send({ name: "Fresh" }).expect(201)).body);
    await api().post(`/api/groups/${fresh.id}/recipes/suggest`).set(u1.auth).expect(200);
  });
});

describe("POST /groups/:groupId/shopping-list/prices", () => {
  const price = (item: { id: string; name: string }, low: number, typical: number, high: number) => ({
    itemId: item.id,
    itemName: item.name,
    lowCents: low,
    typicalCents: typical,
    highCents: high,
    unit: "1 ct",
    sourceUrls: ["https://grocer.example/p", "javascript:alert(1)"],
  });
  const search = { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: "https://grocer.example/p" }] };

  beforeEach(async () => {
    await prisma.shoppingListItem.createMany({
      data: [items.milk, items.bread, items.basil].map((i) => ({ groupId: g.id, itemId: i.id, reason: "manual" as const })),
    });
  });

  it("400 ZIP_REQUIRED when neither the body nor the profile has a ZIP", async () => {
    const res = await api().post(`/api/groups/${g.id}/shopping-list/prices`).set(u1.auth).expect(400);
    expect(res.body.error.code).toBe("ZIP_REQUIRED");
    await api().post(`/api/groups/${g.id}/shopping-list/prices`).set(u1.auth).send({ zipCode: "641" }).expect(400);
    expect(ai.create).not.toHaveBeenCalled();
  });

  it("prices uncached items in one call, caches them with the model, and serves the second call from cache", async () => {
    await prisma.user.update({ where: { id: u1.id }, data: { zipCode: "64105" } }); // profile fallback
    ai.queue.push(
      msg({ prices: [price(items.milk, 300, 350, 420), price(items.bread, 250, 300, 400), price(items.basil, 500, 400, 300)] }, [search]),
    );
    const first = PriceEstimateResponse.parse(
      (await api().post(`/api/groups/${g.id}/shopping-list/prices`).set(u1.auth).expect(200)).body,
    );
    expect(ai.create).toHaveBeenCalledTimes(1);
    expect(userText(0)).toContain("64105");
    expect(first.items.map((p) => p.itemId)).toEqual([items.milk.id, items.bread.id]);
    expect(first.items[0]).toMatchObject({ estimate: true, sourceUrls: ["https://grocer.example/p"] });
    expect(first.unpricedItemIds).toEqual([items.basil.id]); // low > high: rejected
    expect(first).toMatchObject({ totalLowCents: 550, totalHighCents: 820 });

    const rows = await prisma.priceEstimate.findMany({ where: { zipCode: "64105", itemId: { in: [items.milk.id, items.bread.id, items.basil.id] } } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.model === "claude-opus-5-5")).toBe(true);

    // Second call: milk + bread from cache, only basil goes to Claude.
    ai.queue.push(msg({ prices: [price(items.basil, 200, 250, 300)] }, [search]));
    const second = PriceEstimateResponse.parse(
      (await api().post(`/api/groups/${g.id}/shopping-list/prices`).set(u1.auth).send({}).expect(200)).body,
    );
    expect(ai.create).toHaveBeenCalledTimes(2);
    expect(userText(1)).toContain(items.basil.id);
    expect(userText(1)).not.toContain(items.milk.id);
    expect(second).toMatchObject({ totalLowCents: 750, totalHighCents: 1120, unpricedItemIds: [] });

    // Third call: everything cached, no Claude call at all.
    await api().post(`/api/groups/${g.id}/shopping-list/prices`).set(u1.auth).expect(200);
    expect(ai.create).toHaveBeenCalledTimes(2);
  });

  it("body ZIP wins over the profile; rows older than 24 h are refreshed", async () => {
    await prisma.user.update({ where: { id: u1.id }, data: { zipCode: "64105" } });
    const old = new Date(Date.now() - 25 * 3_600_000);
    await prisma.priceEstimate.createMany({
      data: [items.milk, items.bread, items.basil].map((i) => ({
        itemId: i.id, zipCode: "10001", lowCents: 1, typicalCents: 1, highCents: 1, unit: "x", model: "old", fetchedAt: old,
      })),
    });
    ai.queue.push(msg({ prices: [price(items.milk, 400, 450, 500), price(items.bread, 300, 350, 400), price(items.basil, 100, 150, 200)] }, [search]));
    const res = PriceEstimateResponse.parse(
      (await api().post(`/api/groups/${g.id}/shopping-list/prices`).set(u1.auth).send({ zipCode: "10001" }).expect(200)).body,
    );
    expect(userText(0)).toContain("10001");
    expect(res).toMatchObject({ totalLowCents: 800, totalHighCents: 1100 });
    const milk = await prisma.priceEstimate.findUniqueOrThrow({ where: { itemId_zipCode: { itemId: items.milk.id, zipCode: "10001" } } });
    expect(milk).toMatchObject({ lowCents: 400, model: "claude-opus-5-5" });
    expect(milk.fetchedAt.getTime()).toBeGreaterThan(old.getTime());
  });

  it("empty list returns zero totals without calling Claude", async () => {
    await prisma.shoppingListItem.deleteMany({ where: { groupId: g.id } });
    const res = await api().post(`/api/groups/${g.id}/shopping-list/prices`).set(u1.auth).send({ zipCode: "64105" }).expect(200);
    expect(res.body).toEqual({ items: [], totalLowCents: 0, totalHighCents: 0, unpricedItemIds: [] });
    expect(ai.create).not.toHaveBeenCalled();
  });

  it.each([
    ["API error", new Anthropic.InternalServerError(500, { type: "error" }, "boom", new Headers())],
    ["every web search failed", msg({ prices: [] }, [{ type: "web_search_tool_result", tool_use_id: "s1", content: { type: "web_search_tool_result_error", error_code: "unavailable" } }])],
    ["malformed JSON", { stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] }],
  ])("Claude failure (%s) is 503 AI_UNAVAILABLE and nothing is cached", async (_n, r) => {
    ai.queue.push(r);
    const res = await api().post(`/api/groups/${g.id}/shopping-list/prices`).set(u1.auth).send({ zipCode: "64105" }).expect(503);
    expect(res.body.error.code).toBe("AI_UNAVAILABLE");
    expect(await prisma.priceEstimate.count({ where: { itemId: { in: [items.milk.id, items.bread.id, items.basil.id] } } })).toBe(0);
  });

  it("does not shadow the shopping-list /:id routes", async () => {
    await api().patch(`/api/groups/${g.id}/shopping-list/prices`).set(u1.auth).send({ checked: true }).expect(400);
    const list = await api().get(`/api/groups/${g.id}/shopping-list`).set(u1.auth).expect(200);
    expect(list.body.items ?? list.body).toBeDefined();
  });
});
