import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/config.js";
import type { AgentPlan, AgentRunRequest } from "../../src/contracts/agent.js";
import { prisma } from "../../src/db.js";
import { agentClient } from "../../src/lib/agentClient.js";
import { setIo } from "../../src/lib/realtime.js";
import { agentTimers, sweepStaleRuns } from "../../src/modules/agent/service.js";
import { api, expectErrorShape, guardNetwork, itemId, makeGroup, makeUser, tag, type TestUser } from "./helpers.js";

/**
 * Pantry Agent break tests (plan/challenges/01-pantry-agent §4.3, §5, §9; agent/API.md).
 * Every test here FAILS on purpose: each one proves a defect. The agent service is stubbed (agentClient.startRun),
 * Claude/HTTP are blocked by guardNetwork(), and the agent's progress events are forged with the shared secret.
 */

const SECRET = "s".repeat(48);
const saved = {
  url: config.AGENT_URL, secret: config.AGENT_SHARED_SECRET,
  timeout: agentTimers.runTimeoutMs, stale: agentTimers.staleAfterMs,
};

type Emit = { room: string; event: string; payload: Record<string, unknown> };
let emitted: Emit[] = [];
setIo({ to: (room: string) => ({ emit: (event: string, payload: Record<string, unknown>) => emitted.push({ room, event, payload }) }) } as never);
afterAll(() => setIo(null));

let startRun: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  guardNetwork();
  config.AGENT_URL = "http://agent.test:8000";
  config.AGENT_SHARED_SECRET = SECRET;
  emitted = [];
  startRun = vi.spyOn(agentClient, "startRun").mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  config.AGENT_URL = saved.url;
  config.AGENT_SHARED_SECRET = saved.secret;
  agentTimers.runTimeoutMs = saved.timeout;
  agentTimers.staleAfterMs = saved.stale;
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const meta = { provider: "akamai", model: "break-model", toolCalls: 3, tokensIn: 10, tokensOut: 10, ms: 100 };

function event(runId: string, seq: number, type: string, payload: unknown) {
  return api().post("/api/internal/agent-events").set("X-Agent-Secret", SECRET).send({ runId, seq, type, payload });
}

type MealIn = { title: string; ingredients: string[]; missing?: string[]; steps?: string[] };
function planOf(meals: MealIn[], missingItems: { name: string; forMeals: string[] }[] = []): AgentPlan {
  return {
    meals: meals.map((m) => ({
      title: m.title, day: null, minutes: 20, servings: 2, ingredients: m.ingredients, uses: [],
      missing: m.missing ?? [], steps: m.steps ?? ["Cook it."], source: null, ingredientLines: [], date: null,
    })),
    missingItems,
    estimate: null,
    safety: { checked: true, perMeal: meals.map((m) => ({ title: m.title, passes: true, unknown: [] })) },
    summary: "break test plan",
  };
}

/** Owner + Carson (peanuts) + Maya (milk, eggs) + Veg (vegetarian). */
async function household() {
  const owner = await makeUser({ displayName: "Owner" });
  const carson = await makeUser({ displayName: "Carson", allergens: ["peanuts"] });
  const maya = await makeUser({ displayName: "Maya", allergens: ["milk", "eggs"] });
  const veg = await makeUser({ displayName: "Veg" });
  await prisma.userDiet.create({ data: { userId: veg.id, diet: "vegetarian" } });
  const g = await makeGroup(owner, [carson, maya, veg], `Agent break ${tag()}`);
  return { owner, carson, maya, veg, g };
}

async function startRunFor(u: TestUser, groupPathId: string) {
  const res = await api().post(`/api/groups/${groupPathId}/agent/runs`).set(u.auth).send({ prompt: "Plan our week" });
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  return res.body.runId as string;
}

/** A run the (forged) agent has proposed with `plan`. */
async function proposed(u: TestUser, groupId: string, plan: AgentPlan) {
  const runId = await startRunFor(u, groupId);
  const res = await event(runId, 0, "proposed", { plan, meta });
  expect(res.status, JSON.stringify(res.body)).toBe(204);
  return runId;
}

async function listNames(groupId: string) {
  const rows = await prisma.shoppingListItem.findMany({ where: { groupId }, include: { item: { select: { name: true } } } });
  return rows.map((r) => r.item.name);
}

// ─────────────────────────────────────────────────────────────────────────────
// HIGH: safety re-check on apply can be evaded
// ─────────────────────────────────────────────────────────────────────────────

describe("HIGH agent safety: what apply writes is not what it checks", () => {
  it("AG-1 apply adds Peanut Butter for a peanut-allergic member when it is only in missingItems (meals look clean)", async () => {
    const { owner, g } = await household();
    // Meals pass every check; the item that actually lands on the list is never checked.
    const plan = planOf(
      [{ title: "Toast night", ingredients: ["Bread", "Bananas"], missing: ["Peanut Butter"] }],
      [{ name: "Peanut Butter", forMeals: ["Toast night"] }],
    );
    const runId = await proposed(owner, g.id, plan);

    const res = await api().post(`/api/groups/${g.id}/agent/runs/${runId}/apply`).set(owner.auth).send({});
    // §4.3: "A model that skips the check cannot ship an unsafe plan." Expected 422 PLAN_UNSAFE, nothing written.
    expect(await listNames(g.id)).not.toContain("Peanut Butter");
    expectErrorShape(res, 422, "PLAN_UNSAFE");
  });

  it("AG-2 an allergen in the meal title or steps (not in ingredients[]) is ignored by the check and by apply", async () => {
    const { owner, g } = await household();
    const plan = planOf([{
      title: "Peanut butter noodle bowl with shrimp",
      ingredients: ["Rice", "Carrots"],
      steps: ["Whisk 1/2 cup peanut butter with water.", "Toss with the rice and carrots."],
    }]);
    const check = await api().post(`/api/groups/${g.id}/agent/safety-check`).set(owner.auth)
      .send({ meals: [{ title: plan.meals[0].title, ingredients: plan.meals[0].ingredients }] });
    expect(check.status).toBe(200);
    const runId = await proposed(owner, g.id, plan);
    const res = await api().post(`/api/groups/${g.id}/agent/runs/${runId}/apply`).set(owner.auth).send({});

    // The user reads and cooks the title + steps; Carson is allergic to peanuts.
    expect(check.body.meals[0].passes).toBe(false);
    expectErrorShape(res, 422, "PLAN_UNSAFE");
  });
});

describe("HIGH agent safety: diet and allergen evasion", () => {
  it("AG-3 seeded meat items pass for a vegetarian and are marked verified (Hot Dogs, Steaks); meat plurals pass as unknown", async () => {
    const { owner, g } = await household();
    const names = ["Hot Dogs", "Steaks", "Meatballs", "Chickens"];
    const res = await api().post(`/api/groups/${g.id}/agent/safety-check`).set(owner.auth)
      .send({ meals: names.map((n) => ({ title: n, ingredients: [n] })) });
    expect(res.status).toBe(200);
    const passing = (res.body.meals as { title: string; passes: boolean; unknown: string[] }[])
      .filter((m) => m.passes)
      .map((m) => `${m.title}${m.unknown.length ? " (unknown)" : " (VERIFIED safe)"}`);
    // "Hot Dogs" and "Steak" are category=meat catalog items; the diet check only regex-matches the raw text.
    expect(passing, "meat that passes the vegetarian check").toEqual([]);
  });

  it("AG-4 a fuzzy 'suggested' catalog hit borrows the wrong item's allergens: Custard → Mustard is VERIFIED safe for milk+eggs", async () => {
    const { owner, g } = await household();
    const res = await api().post(`/api/groups/${g.id}/agent/safety-check`).set(owner.auth)
      .send({ meals: [{ title: "Dessert", ingredients: ["Custard"] }] });
    expect(res.status).toBe(200);
    const m = res.body.meals[0] as { passes: boolean; unknown: string[] };
    // Custard is milk + eggs (Maya). At minimum it must not be reported as verified-safe.
    expect(m.passes === false || m.unknown.includes("Custard"), JSON.stringify(m)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MEDIUM
// ─────────────────────────────────────────────────────────────────────────────

describe("MEDIUM agent: rate limit, run token, timeouts, realtime", () => {
  it("AG-5 the perGroup(10/h) start limit is bypassed by re-casing the group id in the path", async () => {
    const { owner, g } = await household();
    for (let i = 0; i < 10; i++) await startRunFor(owner, g.id);
    expect((await api().post(`/api/groups/${g.id}/agent/runs`).set(owner.auth).send({ prompt: "x" })).status).toBe(429);

    const upper = g.id.toUpperCase();
    const mixed = g.id.replace(/[a-f]/, (c) => c.toUpperCase());
    const bypass = await Promise.all([upper, mixed].map((p) => api().post(`/api/groups/${p}/agent/runs`).set(owner.auth).send({ prompt: "x" })));
    expect(bypass.map((r) => r.status)).toEqual([429, 429]);
    expect(await prisma.agentRun.count({ where: { groupId: g.id } })).toBe(10);
  });

  it("AG-6 the run token is a full session token: it can write group data and still works after the run has ended", async () => {
    const { owner, g } = await household();
    const runId = await startRunFor(owner, g.id);
    const runToken = (startRun.mock.calls[0][0] as AgentRunRequest).runToken;
    expect((await event(runId, 0, "failed", { message: "done" })).status).toBe(204);

    // §9: "the agent can't write anything except through propose_plan". The run is over, yet its token:
    const auth = { Authorization: `Bearer ${runToken}` };
    const write = await api().post(`/api/groups/${g.id}/cabinet`).set(auth).send({ itemId: await itemId("Spinach") });
    const other = await makeGroup(owner, [], `Other ${tag()}`);
    const otherGroup = await api().get(`/api/groups/${other.id}/cabinet`).set(auth);
    const rename = await api().patch("/api/me").set(auth).send({ displayName: "pwned by agent" });
    expect({ write: write.status, otherGroup: otherGroup.status, rename: rename.status }).toEqual({ write: 401, otherGroup: 401, rename: 401 });
  });

  it("AG-7 a run that was `running` when the server restarted and is < 2 min old is never failed (no timer re-armed by the boot sweep)", async () => {
    const { owner, g } = await household();
    agentTimers.runTimeoutMs = 150;
    agentTimers.staleAfterMs = 150;
    // A run started by the previous process 30 ms before it died; the agent died with it.
    const orphan = await prisma.agentRun.create({ data: { groupId: g.id, userId: owner.id, prompt: "orphan" } });
    await sleep(30);
    await sweepStaleRuns(); // boot
    await sleep(600); // well past the run timeout
    // §5.2: "Don't rely on the agent to report its own death." Expected failed "Took too long"; it stays running forever.
    expect((await prisma.agentRun.findUniqueOrThrow({ where: { id: orphan.id } })).status).toBe("failed");
  });

  it("AG-8 apply through an upper-case group id emits shopping-list:changed / agent:changed to a room nobody is in", async () => {
    const { owner, g } = await household();
    const runId = await proposed(owner, g.id, planOf([{ title: "Salad", ingredients: ["Spinach"] }], [{ name: "Cucumbers", forMeals: ["Salad"] }]));
    emitted = [];
    const res = await api().post(`/api/groups/${g.id.toUpperCase()}/agent/runs/${runId}/apply`).set(owner.auth).send({});
    expect(res.status).toBe(200);
    expect(res.body.added).toBe(1);
    const rooms = [...new Set(emitted.filter((e) => e.event === "shopping-list:changed" || e.event === "agent:changed").map((e) => e.room))];
    // Sockets join `group:<lower-case uuid>`; other members never see the new rows.
    expect(rooms).toEqual([`group:${g.id}`]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LOW: unhandled database errors → 500 INTERNAL instead of 400
// ─────────────────────────────────────────────────────────────────────────────

describe("LOW agent: input that crashes the database layer", () => {
  it("AG-9 POST /agent/runs with a NUL byte in the prompt → 500 INTERNAL instead of 400", async () => {
    const { owner, g } = await household();
    const res = await api().post(`/api/groups/${g.id}/agent/runs`).set(owner.auth).send({ prompt: "Plan\u0000 our week" });
    expectErrorShape(res, 400, "VALIDATION_ERROR");
  });

  it("AG-10 internal events: seq > 2^31-1 or a NUL byte in a step/failed/plan string → 500 instead of 400", async () => {
    const { owner, g } = await household();
    const runId = await startRunFor(owner, g.id);
    const results = {
      hugeSeq: (await event(runId, 2 ** 31, "step", { id: "s", label: "ok", status: "running" })).status,
      nulLabel: (await event(runId, 1, "step", { id: "n", label: "bad\u0000label", status: "running" })).status,
      nulPlan: (await event(runId, 2, "proposed", { plan: planOf([{ title: "Soup\u0000", ingredients: ["Carrots"] }]), meta })).status,
    };
    expect(results).toEqual({ hugeSeq: 400, nulLabel: 400, nulPlan: 422 });
    expect((await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } })).status).not.toBe("running");
  });
});
