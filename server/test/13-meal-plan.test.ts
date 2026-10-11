import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import type { AgentPlan, AgentRunRequest, PlanMeal } from "../src/contracts/agent.js";
import { prisma } from "../src/db.js";
import { fromCalendarDate } from "../src/lib/expiration.js";
import { agentClient } from "../src/lib/agentClient.js";
import { setIo } from "../src/lib/realtime.js";
import { addDays, mealPlanService } from "../src/modules/meal-plan/service.js";
import { api, itemId, makeGroup, makeUser, type TestUser } from "./helpers.js";

// Week calendar (plan/challenges/01-pantry-agent §13): /meal-plan endpoints and the agent run integration.

const fixture = JSON.parse(readFileSync(new URL("./fixtures/agent/demo-run.json", import.meta.url), "utf8"));
const SECRET = "m".repeat(48);
const saved = { url: config.AGENT_URL, secret: config.AGENT_SHARED_SECRET };
const meta = { provider: "akamai", model: "test", toolCalls: 3, tokensIn: 1, tokensOut: 1, ms: 10 };

type Emit = { room: string; event: string; payload: Record<string, unknown> };
let emitted: Emit[] = [];
setIo({ to: (room: string) => ({ emit: (event: string, payload: Record<string, unknown>) => emitted.push({ room, event, payload }) }) } as never);
const emitsOf = (event: string, groupId: string) => emitted.filter((e) => e.event === event && e.room === `group:${groupId}`);

let startRun: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  config.AGENT_URL = "http://agent.test:8000";
  config.AGENT_SHARED_SECRET = SECRET;
  emitted = [];
  startRun = vi.spyOn(agentClient, "startRun").mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  config.AGENT_URL = saved.url;
  config.AGENT_SHARED_SECRET = saved.secret;
});
afterAll(() => setIo(null));

/** A simple, safe dinner (catalog ingredients only). */
const dinner = (title: string, over: Partial<PlanMeal> = {}): PlanMeal => ({
  title, day: null, date: null, minutes: 30, servings: 2, ingredients: ["Spinach", "Rice", "Garlic"], uses: ["Spinach"],
  missing: ["Garlic"], steps: ["Cook it."], source: null, ingredientLines: [], ...over,
});

async function home(opts: { allergens?: string[] } = {}) {
  const owner = await makeUser({ displayName: "Owner", allergens: opts.allergens });
  const g = await makeGroup(owner);
  const today = (await api().get(`/api/groups/${g.id}/meal-plan`).set(owner.auth)).body.today as string;
  return { owner, g, today };
}

const plan = (owner: TestUser, groupId: string, date: string, meal: PlanMeal = dinner(`Dinner ${date}`)) =>
  api().post(`/api/groups/${groupId}/meal-plan`).set(owner.auth).send({ date, meal });

function event(runId: string, seq: number, type: string, payload: unknown) {
  return api().post("/api/internal/agent-events").set("X-Agent-Secret", SECRET).send({ runId, seq, type, payload });
}

async function startRun_(u: TestUser, groupId: string, body: Record<string, unknown> = {}) {
  const res = await api().post(`/api/groups/${groupId}/agent/runs`).set(u.auth).send({ prompt: "Plan", ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  return { runId: res.body.runId as string, request: startRun.mock.calls.at(-1)![0] as AgentRunRequest };
}

/** The fixture plan with its meals on the given dates (one meal per date). */
function datedPlan(dates: (string | null)[]): AgentPlan {
  const p: AgentPlan = structuredClone(fixture.plan);
  p.meals = p.meals.slice(0, dates.length).map((m, i) => ({ ...m, date: dates[i] }));
  const titles = new Set(p.meals.map((m) => m.title));
  p.missingItems = p.missingItems.filter((mi) => mi.forMeals.some((t) => titles.has(t)));
  p.safety.perMeal = p.meals.map((m) => ({ title: m.title, passes: true, unknown: [] }));
  return p;
}

async function proposed(u: TestUser, groupId: string, p: AgentPlan, body: Record<string, unknown> = {}) {
  const { runId } = await startRun_(u, groupId, body);
  expect((await event(runId, 0, "proposed", { plan: p, meta })).status).toBe(204);
  return runId;
}

describe("13 meal plan: GET", () => {
  it("defaults to household today → today+6 and returns today; validates the range; non-members get 404", async () => {
    const { owner, g, today } = await home();
    const tz = (await prisma.group.findUniqueOrThrow({ where: { id: g.id } })).timeZone;
    expect(today).toBe(new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date()));
    await plan(owner, g.id, addDays(today, 2)).expect(201);
    await plan(owner, g.id, addDays(today, 9)).expect(201);

    const res = await api().get(`/api/groups/${g.id}/meal-plan`).set(owner.auth);
    expect(res.body).toMatchObject({ from: today, to: addDays(today, 6), today });
    expect(res.body.meals.map((m: { date: string }) => m.date)).toEqual([addDays(today, 2)]);

    const wide = await api().get(`/api/groups/${g.id}/meal-plan?from=${today}&to=${addDays(today, 30)}`).set(owner.auth);
    expect(wide.body.meals).toHaveLength(2);
    const url = `/api/groups/${g.id}/meal-plan`;
    expect((await api().get(`${url}?from=${today}&to=${addDays(today, 31)}`).set(owner.auth)).status).toBe(400); // 32 days
    expect((await api().get(`${url}?from=${addDays(today, 1)}&to=${today}`).set(owner.auth)).status).toBe(400);
    expect((await api().get(`${url}?from=tomorrow`).set(owner.auth)).status).toBe(400);
    const outsider = await makeUser();
    expect((await api().get(url).set(outsider.auth)).status).toBe(404);
    expect((await api().get(url)).status).toBe(401);
  });
});

describe("13 meal plan: add, move, remove", () => {
  it("POST adds (date set in the meal), 409 DATE_TAKEN, 422 PLAN_UNSAFE, 400 bad meal; one meal-plan:changed per write", async () => {
    const { owner, g, today } = await home({ allergens: ["peanuts"] });
    const d = addDays(today, 1);
    const res = await plan(owner, g.id, d);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ groupId: g.id, date: d, slot: "dinner", agentRunId: null, createdBy: owner.id });
    expect(res.body.meal).toMatchObject({ title: `Dinner ${d}`, date: d });
    expect(emitsOf("meal-plan:changed", g.id)).toHaveLength(1);

    const taken = await plan(owner, g.id, d);
    expect([taken.status, taken.body.error.code]).toEqual([409, "DATE_TAKEN"]);
    const unsafe = await plan(owner, g.id, addDays(today, 2), dinner("PB noodles", { ingredients: ["Peanut Butter", "Pasta"] }));
    expect([unsafe.status, unsafe.body.error.code]).toEqual([422, "PLAN_UNSAFE"]);
    expect((await plan(owner, g.id, addDays(today, 3), { title: "" } as never)).status).toBe(400);
    expect(emitsOf("meal-plan:changed", g.id)).toHaveLength(1);
  });

  it("PATCH moves to a free day, or swaps the two meals when the day is planned (one transaction)", async () => {
    const { owner, g, today } = await home();
    const [d1, d2, d3] = [1, 2, 3].map((n) => addDays(today, n));
    const a = (await plan(owner, g.id, d1, dinner("Alpha"))).body;
    const b = (await plan(owner, g.id, d2, dinner("Bravo"))).body;
    emitted = [];

    const moved = await api().patch(`/api/groups/${g.id}/meal-plan/${a.id}`).set(owner.auth).send({ date: d3 });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ id: a.id, date: d3, meal: { title: "Alpha", date: d3 } });
    expect(emitsOf("meal-plan:changed", g.id)).toHaveLength(1);

    const swapped = await api().patch(`/api/groups/${g.id}/meal-plan/${a.id}`).set(owner.auth).send({ date: d2 });
    expect(swapped.body).toMatchObject({ id: a.id, date: d2 });
    const list = (await api().get(`/api/groups/${g.id}/meal-plan`).set(owner.auth)).body.meals as { id: string; date: string; meal: PlanMeal }[];
    expect(list.map((m) => [m.meal.title, m.date, m.meal.date])).toEqual([["Alpha", d2, d2], ["Bravo", d3, d3]]);
    expect(list.find((m) => m.id === b.id)!.date).toBe(d3);
    expect(emitsOf("meal-plan:changed", g.id)).toHaveLength(2);

    // Same day: nothing written, nothing emitted.
    await api().patch(`/api/groups/${g.id}/meal-plan/${a.id}`).set(owner.auth).send({ date: d2 }).expect(200);
    expect(emitsOf("meal-plan:changed", g.id)).toHaveLength(2);

    const og = await makeGroup(owner, [], "Other");
    expect((await api().patch(`/api/groups/${og.id}/meal-plan/${a.id}`).set(owner.auth).send({ date: d1 })).status).toBe(404);
    expect((await api().patch(`/api/groups/${g.id}/meal-plan/nope`).set(owner.auth).send({ date: d1 })).status).toBe(404);
    expect((await api().patch(`/api/groups/${g.id}/meal-plan/${a.id}`).set(owner.auth).send({ date: "x" })).status).toBe(400);
  });

  it("DELETE → 204, then 404; another group's meal is 404; emits once", async () => {
    const { owner, g, today } = await home();
    const a = (await plan(owner, g.id, addDays(today, 1))).body;
    emitted = [];
    const outsider = await makeUser();
    const og = await makeGroup(outsider);
    expect((await api().delete(`/api/groups/${og.id}/meal-plan/${a.id}`).set(outsider.auth)).status).toBe(404);
    expect((await api().delete(`/api/groups/${g.id}/meal-plan/${a.id}`).set(owner.auth)).status).toBe(204);
    expect((await api().delete(`/api/groups/${g.id}/meal-plan/${a.id}`).set(owner.auth)).status).toBe(404);
    expect(emitsOf("meal-plan:changed", g.id)).toHaveLength(1);
  });
});

describe("13 meal plan: add missing to the list", () => {
  it("same path as apply: notes, cabinet/list skips, one shopping-list:changed and no meal-plan:changed", async () => {
    const { owner, g, today } = await home();
    await api().post(`/api/groups/${g.id}/cabinet`).set(owner.auth).send({ itemId: await itemId("Lemons") }).expect(201);
    await api().post(`/api/groups/${g.id}/shopping-list`).set(owner.auth).send({ itemId: await itemId("Salsa") }).expect(201);
    const meal = dinner("Taco night", { missing: ["Lemons", "Salsa", "Avocados", "Cilantro"] });
    const p = (await plan(owner, g.id, addDays(today, 1), meal)).body;
    emitted = [];

    const res = await api().post(`/api/groups/${g.id}/meal-plan/${p.id}/add-missing`).set(owner.auth).send({});
    expect(res.status).toBe(200);
    expect(res.body.added).toBe(2);
    expect(res.body.skipped).toEqual(expect.arrayContaining([
      { name: "Lemons", reason: "in_cabinet" }, { name: "Salsa", reason: "on_list" },
    ]));
    const rows = await prisma.shoppingListItem.findMany({ where: { groupId: g.id, note: { not: null } }, include: { item: true } });
    expect(rows.map((r) => [r.item.name, r.note]).sort()).toEqual([["Avocados", "✨ for Taco night"], ["Cilantro", "✨ for Taco night"]]);
    expect(emitsOf("shopping-list:changed", g.id)).toHaveLength(1);
    expect(emitsOf("meal-plan:changed", g.id)).toHaveLength(0);

    expect((await api().post(`/api/groups/${g.id}/meal-plan/${crypto.randomUUID()}/add-missing`).set(owner.auth)).status).toBe(404);
  });
});

describe("13 agent runs on dates", () => {
  it("dates default to the next 3 days; explicit dates are validated; alreadyPlanned lists meals within ±7 days", async () => {
    const { owner, g, today } = await home();
    await plan(owner, g.id, addDays(today, 1), dinner("Near")).expect(201);
    await plan(owner, g.id, addDays(today, 20), dinner("Far")).expect(201);

    const { request } = await startRun_(owner, g.id);
    expect(request.dates).toEqual([today, addDays(today, 1), addDays(today, 2)]);
    expect(request.alreadyPlanned).toEqual([{ date: addDays(today, 1), title: "Near" }]);

    const later = await startRun_(owner, g.id, { dates: [addDays(today, 25), addDays(today, 24)] });
    expect(later.request.dates).toEqual([addDays(today, 24), addDays(today, 25)]);
    expect(later.request.alreadyPlanned).toEqual([{ date: addDays(today, 20), title: "Far" }]);

    const url = `/api/groups/${g.id}/agent/runs`;
    const bad = async (dates: string[]) => (await api().post(url).set(owner.auth).send({ prompt: "x", dates })).status;
    expect(await bad([addDays(today, -1)])).toBe(400);
    expect(await bad([addDays(today, 31)])).toBe(400);
    expect(await bad([today, today])).toBe(400);
    expect(await bad(Array.from({ length: 8 }, (_, i) => addDays(today, i)))).toBe(400);
    expect((await api().post(url).set(owner.auth).send({ prompt: "x", replacePlannedMealId: crypto.randomUUID() })).status).toBe(404);
  });

  it("apply writes the dated meals AND the list items in one transaction, emits meal-plan:changed once, returns planned", async () => {
    const { owner, g, today } = await home();
    const dates = [addDays(today, 1), addDays(today, 2)];
    const runId = await proposed(owner, g.id, datedPlan(dates));
    emitted = [];
    const res = await api().post(`/api/groups/${g.id}/agent/runs/${runId}/apply`).set(owner.auth).send({});
    expect(res.status).toBe(200);
    expect(res.body.planned).toBe(2);
    expect(res.body.added).toBeGreaterThan(0);
    const week = (await api().get(`/api/groups/${g.id}/meal-plan`).set(owner.auth)).body.meals as { date: string; agentRunId: string }[];
    expect(week.map((m) => [m.date, m.agentRunId])).toEqual(dates.map((d) => [d, runId]));
    expect(emitsOf("meal-plan:changed", g.id)).toHaveLength(1);
    expect(emitsOf("shopping-list:changed", g.id)).toHaveLength(1);
  });

  it("a failure while writing the plan rolls back the list items and the claim too", async () => {
    const { owner, g, today } = await home();
    const runId = await proposed(owner, g.id, datedPlan([addDays(today, 1)]));
    vi.spyOn(mealPlanService, "writeForRun").mockRejectedValue(new Error("boom"));
    emitted = [];
    const res = await api().post(`/api/groups/${g.id}/agent/runs/${runId}/apply`).set(owner.auth).send({});
    expect(res.status).toBe(500);
    expect(await prisma.shoppingListItem.count({ where: { groupId: g.id } })).toBe(0);
    expect(await prisma.plannedMeal.count({ where: { groupId: g.id } })).toBe(0);
    expect((await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } })).status).toBe("proposed");
    expect(emitted).toHaveLength(0);
  });

  it("a date already planned is replaced by apply; a swap run replaces only its row's date", async () => {
    const { owner, g, today } = await home();
    const [d1, d2, d3] = [1, 2, 3].map((n) => addDays(today, n));
    const old1 = (await plan(owner, g.id, d1, dinner("Old one"))).body;
    await plan(owner, g.id, d2, dinner("Old two")).expect(201);

    // Normal run on d1 + d3: d1 is replaced, d3 created, d2 untouched.
    const run1 = await proposed(owner, g.id, datedPlan([d1, d3]), { dates: [d1, d3] });
    await api().post(`/api/groups/${g.id}/agent/runs/${run1}/apply`).set(owner.auth).send({}).expect(200);
    let week = (await api().get(`/api/groups/${g.id}/meal-plan`).set(owner.auth)).body.meals as { id: string; date: string; meal: PlanMeal }[];
    expect(week.map((m) => m.date)).toEqual([d1, d2, d3]);
    expect(week[0].id).toBe(old1.id); // same row, new meal
    expect(week[0].meal.title).toBe(fixture.plan.meals[0].title);
    expect(week[1].meal.title).toBe("Old two");

    // Swap the d2 meal: the run plans only d2; even if the plan carries other dates, only that row changes.
    const { runId: swap, request } = await startRun_(owner, g.id, { replacePlannedMealId: week[1].id, dates: [d3] });
    expect(request.dates).toEqual([d2]);
    expect(request.alreadyPlanned.map((p) => p.date)).toEqual([d1, d3]); // not the meal being replaced
    expect((await prisma.agentRun.findUniqueOrThrow({ where: { id: swap } })).replacePlannedMealId).toBe(week[1].id);
    const swapPlan = datedPlan([d2, d3]);
    swapPlan.meals[1].title = "Should not land";
    expect((await event(swap, 0, "proposed", { plan: swapPlan, meta })).status).toBe(204);
    const res = await api().post(`/api/groups/${g.id}/agent/runs/${swap}/apply`).set(owner.auth).send({});
    expect(res.body.planned).toBe(1);
    week = (await api().get(`/api/groups/${g.id}/meal-plan`).set(owner.auth)).body.meals;
    expect(week.map((m) => m.meal.title)).toEqual([fixture.plan.meals[0].title, fixture.plan.meals[0].title, fixture.plan.meals[1].title]);
    expect(week.map((m) => m.meal.title)).not.toContain("Should not land");
  });

  it("step previews round-trip and survive a later event for the same step", async () => {
    const { owner, g, today } = await home();
    const { runId } = await startRun_(owner, g.id);
    const preview = { date: addDays(today, 1), title: "Lemon chicken", site: null };
    expect((await event(runId, 0, "step", { id: "find_recipe:1", label: "Finding a recipe…", status: "running", preview })).status).toBe(204);
    expect((await event(runId, 1, "step", { id: "find_recipe:1", label: "Found: Lemon chicken", status: "done" })).status).toBe(204);
    const run = (await api().get(`/api/groups/${g.id}/agent/runs/${runId}`).set(owner.auth)).body;
    expect(run.steps).toEqual([
      { seq: 0, id: "find_recipe:1", label: "Found: Lemon chicken", status: "done", preview, at: expect.any(String) },
    ]);
  });
});

describe("13 expiration-aware plan (spec §14)", () => {
  const stock = async (groupId: string, name: string, expires: string | null, status: "in_stock" | "running_low" = "in_stock") =>
    prisma.cabinetItem.create({
      data: { groupId, itemId: await itemId(name), status, ...(expires ? { expiresAt: fromCalendarDate(expires), expirationSource: "manual" as const } : {}) },
    });
  const week = async (u: TestUser, groupId: string) => (await api().get(`/api/groups/${groupId}/meal-plan`).set(u.auth)).body;
  const spinachPlan = (dates: string[]) => {
    const p = datedPlan(dates);
    p.meals = p.meals.map((m) => ({ ...m, uses: ["Spinach"] }));
    return p;
  };

  it("GET computes warnings for used items that expire before the meal's date (whole-word, both directions)", async () => {
    const { owner, g, today } = await home();
    await stock(g.id, "Spinach", addDays(today, 2));
    const d1 = addDays(today, 2), d2 = addDays(today, 3), d3 = addDays(today, 4);
    await plan(owner, g.id, d1, dinner("On deadline"));
    await plan(owner, g.id, d2, dinner("Late", { uses: ["Baby Spinach"] }));
    await plan(owner, g.id, d3, dinner("Unrelated", { uses: ["Rice"] }));
    const meals = (await week(owner, g.id)).meals as { meal: PlanMeal; warnings: unknown[] }[];
    expect(meals.map((m) => [m.meal.title, m.warnings])).toEqual([
      ["On deadline", []],
      ["Late", [{ kind: "expires_before", item: "Spinach", expiresAt: addDays(today, 2) }]],
      ["Unrelated", []],
    ]);
  });

  it("expiring covers planned and unplanned items, soonest first; expired items have daysLeft < 0 and no meal", async () => {
    const { owner, g, today } = await home();
    await stock(g.id, "Spinach", addDays(today, 3));
    await stock(g.id, "Garlic", addDays(today, 5));
    await stock(g.id, "Rice", addDays(today, -2));
    await stock(g.id, "Milk", addDays(today, 8)); // beyond the 7-day window
    await stock(g.id, "Eggs", null); // no date
    const m = (await plan(owner, g.id, addDays(today, 2), dinner("Spinach night", { uses: ["Spinach", "Rice"] }))).body;
    const body = await week(owner, g.id);
    expect(body.expiring).toEqual([
      { cabinetItemId: expect.any(String), name: "Rice", expiresAt: addDays(today, -2), daysLeft: -2, plannedOn: null, plannedMealId: null },
      { cabinetItemId: expect.any(String), name: "Spinach", expiresAt: addDays(today, 3), daysLeft: 3, plannedOn: addDays(today, 2), plannedMealId: m.id },
      { cabinetItemId: expect.any(String), name: "Garlic", expiresAt: addDays(today, 5), daysLeft: 5, plannedOn: null, plannedMealId: null },
    ]);
    // The meal also uses expired Rice → warned.
    expect(body.meals[0].warnings).toEqual([{ kind: "expires_before", item: "Rice", expiresAt: addDays(today, -2) }]);
  });

  it("a move past the deadline is allowed but returns warnings; POST warns too", async () => {
    const { owner, g, today } = await home();
    await stock(g.id, "Spinach", addDays(today, 1));
    const a = (await plan(owner, g.id, addDays(today, 1))).body;
    expect(a.warnings).toEqual([]);
    const moved = await api().patch(`/api/groups/${g.id}/meal-plan/${a.id}`).set(owner.auth).send({ date: addDays(today, 4) });
    expect(moved.status).toBe(200);
    expect(moved.body.warnings).toEqual([{ kind: "expires_before", item: "Spinach", expiresAt: addDays(today, 1) }]);
    const added = await plan(owner, g.id, addDays(today, 5));
    expect(added.body.warnings).toHaveLength(1);
  });

  it("apply moves a late meal to the latest free date <= the deadline", async () => {
    const { owner, g, today } = await home();
    await stock(g.id, "Spinach", addDays(today, 2));
    await plan(owner, g.id, addDays(today, 2), dinner("Already there")); // blocks the deadline day itself
    const runId = await proposed(owner, g.id, spinachPlan([addDays(today, 5)]));
    const res = await api().post(`/api/groups/${g.id}/agent/runs/${runId}/apply`).set(owner.auth).send({});
    expect(res.status).toBe(200);
    const meals = (await week(owner, g.id)).meals as { date: string; agentRunId: string | null; warnings: unknown[]; meal: PlanMeal }[];
    expect(meals.map((m) => [m.date, m.agentRunId === runId, m.meal.date, m.warnings.length])).toEqual([
      [addDays(today, 1), true, addDays(today, 1), 0],
      [addDays(today, 2), false, addDays(today, 2), 0],
    ]);
  });

  it("apply keeps the date when no free slot exists before the deadline, and GET warns", async () => {
    const { owner, g, today } = await home();
    await stock(g.id, "Spinach", today);
    await plan(owner, g.id, today, dinner("Tonight")); // the only date <= deadline is taken
    const late = addDays(today, 3);
    const runId = await proposed(owner, g.id, spinachPlan([late]));
    await api().post(`/api/groups/${g.id}/agent/runs/${runId}/apply`).set(owner.auth).send({}).expect(200);
    const meals = (await week(owner, g.id)).meals as { date: string; agentRunId: string | null; warnings: unknown[] }[];
    const kept = meals.find((m) => m.agentRunId === runId)!;
    expect(kept.date).toBe(late);
    expect(kept.warnings).toEqual([{ kind: "expires_before", item: "Spinach", expiresAt: today }]);
  });
});
