import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/config.js";
import type { AgentPlan, PlanMeal } from "../../src/contracts/agent.js";
import { prisma } from "../../src/db.js";
import { agentClient } from "../../src/lib/agentClient.js";
import { fromCalendarDate } from "../../src/lib/expiration.js";
import { setIo } from "../../src/lib/realtime.js";
import { addDays } from "../../src/modules/meal-plan/service.js";
import { api, expectErrorShape, guardNetwork, itemId, makeGroup, makeUser, tag, type TestUser } from "./helpers.js";

/**
 * Week calendar + expiration break tests (plan/challenges/01-pantry-agent §13, §14).
 * Every test here FAILS on purpose: each one proves a defect.
 */

const SECRET = "p".repeat(48);
const saved = { url: config.AGENT_URL, secret: config.AGENT_SHARED_SECRET };
const meta = { provider: "akamai", model: "break", toolCalls: 1, tokensIn: 1, tokensOut: 1, ms: 1 };

type Emit = { room: string; event: string };
let emitted: Emit[] = [];
setIo({ to: (room: string) => ({ emit: (event: string) => emitted.push({ room, event }) }) } as never);
afterAll(() => setIo(null));

beforeEach(() => {
  guardNetwork();
  config.AGENT_URL = "http://agent.test:8000";
  config.AGENT_SHARED_SECRET = SECRET;
  emitted = [];
  vi.spyOn(agentClient, "startRun").mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  config.AGENT_URL = saved.url;
  config.AGENT_SHARED_SECRET = saved.secret;
});

const dinner = (title: string, over: Partial<PlanMeal> = {}): PlanMeal => ({
  title, day: null, date: null, minutes: 30, servings: 2, ingredients: ["Spinach", "Rice"], uses: [],
  missing: [], steps: ["Cook it."], source: null, ingredientLines: [], ...over,
});

async function home() {
  const owner = await makeUser({ displayName: "Owner" });
  const g = await makeGroup(owner, [], `Plan ${tag()}`);
  const today = (await api().get(`/api/groups/${g.id}/meal-plan`).set(owner.auth)).body.today as string;
  return { owner, g, today };
}
const url = (gid: string, rest = "") => `/api/groups/${gid}/meal-plan${rest}`;
const add = (u: TestUser, gid: string, date: string, meal = dinner(`Dinner ${date}`)) =>
  api().post(url(gid)).set(u.auth).send({ date, meal });
const stock = async (groupId: string, name: string, expires: string | null) =>
  prisma.cabinetItem.create({
    data: { groupId, itemId: await itemId(name), status: "in_stock", ...(expires ? { expiresAt: fromCalendarDate(expires), expirationSource: "manual" as const } : {}) },
  });
const emitsOf = (event: string, gid: string) => emitted.filter((e) => e.event === event && e.room === `group:${gid}`);

function event(runId: string, seq: number, type: string, payload: unknown) {
  return api().post("/api/internal/agent-events").set("X-Agent-Secret", SECRET).send({ runId, seq, type, payload });
}
function planOf(meals: PlanMeal[]): AgentPlan {
  return {
    meals, missingItems: [], estimate: null,
    safety: { checked: true, perMeal: meals.map((m) => ({ title: m.title, passes: true, unknown: [] })) },
    summary: "break",
  };
}
async function proposed(u: TestUser, gid: string, plan: AgentPlan, body: Record<string, unknown> = {}) {
  const res = await api().post(`/api/groups/${gid}/agent/runs`).set(u.auth).send({ prompt: "Plan", ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  expect((await event(res.body.runId, 0, "proposed", { plan, meta })).status).toBe(204);
  return res.body.runId as string;
}
const apply = (u: TestUser, gid: string, runId: string) => api().post(`/api/groups/${gid}/agent/runs/${runId}/apply`).set(u.auth).send({});

describe("MP-1 date validation: syntactically valid but impossible dates", () => {
  it("MP-1a POST with 2026-02-31 / 2026-13-45 is a 400, not a 500", async () => {
    const { owner, g } = await home();
    for (const date of ["2026-02-31", "2026-13-45", "2026-00-00"]) {
      expectErrorShape(await add(owner, g.id, date), 400);
    }
  });
  it("MP-1b GET ?from=2026-02-31 and PATCH to 2026-99-99 are 400, not 500", async () => {
    const { owner, g, today } = await home();
    expectErrorShape(await api().get(url(g.id)).query({ from: "2026-02-31" }).set(owner.auth), 400);
    const m = (await add(owner, g.id, addDays(today, 1))).body;
    expectErrorShape(await api().patch(url(g.id, `/${m.id}`)).set(owner.auth).send({ date: "2026-99-99" }), 400);
  });
  it("MP-1c year 0000 and 9999 do not 500 (Postgres date range / addDays overflow)", async () => {
    const { owner, g } = await home();
    const r0 = await add(owner, g.id, "0000-01-01");
    expect(r0.status, JSON.stringify(r0.body)).toBeLessThan(500);
    const r9 = await api().get(url(g.id)).query({ from: "9999-12-30" }).set(owner.auth);
    expect(r9.status, JSON.stringify(r9.body)).toBeLessThan(500);
  });
});

describe("MP-2 the 1900-01-01 swap parking date leaks", () => {
  it("MP-2 a meal moved to 1900-01-01 makes every later swap fail with a 5xx (unique index collision)", async () => {
    const { owner, g, today } = await home();
    const [a, b, c] = [1, 2, 3].map((n) => addDays(today, n));
    const mA = (await add(owner, g.id, a)).body;
    const mB = (await add(owner, g.id, b)).body;
    await add(owner, g.id, c);
    const park = await api().patch(url(g.id, `/${mA.id}`)).set(owner.auth).send({ date: "1900-01-01" });
    // Swap B with C: parks B at 1900-01-01, where A already sits.
    const res = await api().patch(url(g.id, `/${mB.id}`)).set(owner.auth).send({ date: c });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(500);
    expect(park.status, "the internal parking date must not be a user-reachable plan date").toBe(400);
  });
});

describe("MP-3 swap run whose target row was deleted", () => {
  it("MP-3 apply after the target is deleted must not overwrite other days of the plan", async () => {
    const { owner, g, today } = await home();
    const [d2, d3] = [2, 3].map((n) => addDays(today, n));
    const target = (await add(owner, g.id, d2, dinner("Target"))).body;
    await add(owner, g.id, d3, dinner("Old three")).expect(201);
    const run = await api().post(`/api/groups/${g.id}/agent/runs`).set(owner.auth).send({ prompt: "swap", replacePlannedMealId: target.id });
    expect(run.status).toBe(202);
    const p = planOf([dinner("New two", { date: d2 }), dinner("Should not land", { date: d3 })]);
    await event(run.body.runId, 0, "proposed", { plan: p, meta }).expect(204);
    await api().delete(url(g.id, `/${target.id}`)).set(owner.auth).expect(204);
    await apply(owner, g.id, run.body.runId);
    const row = await prisma.plannedMeal.findFirst({ where: { groupId: g.id, date: fromCalendarDate(d3) } });
    expect((row!.meal as { title: string }).title).toBe("Old three"); // a swap run only ever touches its own row
  });
});

describe("MP-4 meetDeadlines", () => {
  it("MP-4 an already-expired item used by a meal must not stop its other, still-fresh item from being honoured", async () => {
    const { owner, g, today } = await home();
    await stock(g.id, "Milk", addDays(today, -1));
    await stock(g.id, "Spinach", addDays(today, 2));
    const late = addDays(today, 5);
    const runId = await proposed(owner, g.id, planOf([dinner("Creamy spinach", { date: late, uses: ["Milk", "Spinach"] })]));
    await apply(owner, g.id, runId).expect(200);
    const row = await prisma.plannedMeal.findFirstOrThrow({ where: { groupId: g.id } });
    expect(row.date.toISOString().slice(0, 10) <= addDays(today, 2)).toBe(true);
  });
});

describe("MP-5 realtime on non-writes", () => {
  it("MP-5 add-missing that adds nothing (everything already on the list) emits no shopping-list:changed", async () => {
    const { owner, g, today } = await home();
    const m = (await add(owner, g.id, addDays(today, 1), dinner("Garlic rice", { missing: ["Garlic"] }))).body;
    await api().post(url(g.id, `/${m.id}/add-missing`)).set(owner.auth).expect(200);
    emitted = [];
    const res = await api().post(url(g.id, `/${m.id}/add-missing`)).set(owner.auth);
    expect(res.body.added).toBe(0);
    expect(emitsOf("shopping-list:changed", g.id)).toHaveLength(0);
  });
});

describe("MP-6 household time zone", () => {
  it("MP-6 today follows the group's zone at extreme offsets", async () => {
    for (const tz of ["Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
      const { owner, g } = await home();
      await prisma.group.update({ where: { id: g.id }, data: { timeZone: tz } });
      const want = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      expect((await api().get(url(g.id)).set(owner.auth)).body.today).toBe(want);
    }
  });
});

describe("MP-7 cross-group, races and forged fields", () => {
  it("MP-7a group 1's meal id is untouchable through group 2 (move/delete/add-missing) and via B's own group path", async () => {
    const a = await home();
    const bOwner = await makeUser();
    const gB = await makeGroup(bOwner, [], `B ${tag()}`);
    const m = (await add(a.owner, a.g.id, addDays(a.today, 1), dinner("Secret", { missing: ["Garlic"] }))).body;
    for (const gid of [gB.id, a.g.id]) {
      for (const r of [
        api().patch(url(gid, `/${m.id}`)).set(bOwner.auth).send({ date: addDays(a.today, 2) }),
        api().delete(url(gid, `/${m.id}`)).set(bOwner.auth),
        api().post(url(gid, `/${m.id}/add-missing`)).set(bOwner.auth),
      ]) expect([403, 404]).toContain((await r).status);
    }
    expect(await prisma.plannedMeal.count({ where: { id: m.id, groupId: a.g.id } })).toBe(1);
    expect(await prisma.shoppingListItem.count({ where: { groupId: a.g.id } })).toBe(0);
    expect((await api().get(url(gB.id)).set(bOwner.auth)).body.meals).toEqual([]);
  });
  it("MP-7b parallel PATCHes swapping the same two days keep both meals and unique dates", async () => {
    const { owner, g, today } = await home();
    const [d1, d2] = [1, 2].map((n) => addDays(today, n));
    const m1 = (await add(owner, g.id, d1)).body;
    const m2 = (await add(owner, g.id, d2)).body;
    const rs = await Promise.all([
      api().patch(url(g.id, `/${m1.id}`)).set(owner.auth).send({ date: d2 }),
      api().patch(url(g.id, `/${m2.id}`)).set(owner.auth).send({ date: d1 }),
      api().patch(url(g.id, `/${m1.id}`)).set(owner.auth).send({ date: d2 }),
    ]);
    for (const r of rs) expect(r.status, JSON.stringify(r.body)).toBe(200);
    const rows = await prisma.plannedMeal.findMany({ where: { groupId: g.id } });
    expect(rows.map((r) => r.date.toISOString().slice(0, 10)).sort()).toEqual([d1, d2]);
  });
  it("MP-7c forged warnings/date/agentRunId in the add body are ignored; unsafe meal is 422 and emits nothing", async () => {
    const owner = await makeUser({ allergens: ["peanuts"] });
    const g = await makeGroup(owner, [], `F ${tag()}`);
    const today = (await api().get(url(g.id)).set(owner.auth)).body.today as string;
    const d = addDays(today, 1);
    const forged = { ...dinner("Ok"), warnings: [{ kind: "x" }], agentRunId: crypto.randomUUID() };
    const ok = await api().post(url(g.id)).set(owner.auth).send({ date: d, meal: forged, agentRunId: crypto.randomUUID(), warnings: [] });
    expect(ok.status).toBe(201);
    expect(ok.body.agentRunId).toBeNull();
    emitted = [];
    expectErrorShape(await add(owner, g.id, addDays(today, 2), dinner("Satay", { missing: ["Peanut Butter"] })), 422, "PLAN_UNSAFE");
    expect(emitted).toHaveLength(0);
  });
});
