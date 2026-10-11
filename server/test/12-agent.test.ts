import { readFileSync } from "node:fs";
import jwt from "jsonwebtoken";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import type { AgentPlan } from "../src/contracts/agent.js";
import { prisma } from "../src/db.js";
import { agentClient } from "../src/lib/agentClient.js";
import { verifyAgentRunToken, verifyAppToken } from "../src/lib/jwt.js";
import { setIo } from "../src/lib/realtime.js";
import { agentTimers, sweepStaleRuns, waitForPlanEstimates } from "../src/modules/agent/service.js";
import { agent as akamai } from "../src/modules/products/lookup.js";
import { api, itemId, makeGroup, makeUser, type TestUser } from "./helpers.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/agent/demo-run.json", import.meta.url), "utf8"));
const SECRET = "x".repeat(48);
const saved = { url: config.AGENT_URL, secret: config.AGENT_SHARED_SECRET, timeout: agentTimers.runTimeoutMs };

// Fake Socket.IO server: records every emit so tests can count them.
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
  agentTimers.runTimeoutMs = saved.timeout;
});
afterAll(() => setIo(null));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const plan = (): AgentPlan => structuredClone(fixture.plan);
const meta = { provider: "akamai", model: "test-model", toolCalls: 8, tokensIn: 100, tokensOut: 50, ms: 1234 };

function event(runId: string, seq: number, type: string, payload: unknown, secret: string | null = SECRET) {
  const r = api().post("/api/internal/agent-events");
  if (secret !== null) r.set("X-Agent-Secret", secret);
  return r.send({ runId, seq, type, payload });
}

/** Owner + Carson (peanuts) + Maya (milk). */
async function household() {
  const owner = await makeUser({ displayName: "Owner" });
  const carson = await makeUser({ displayName: "Carson", allergens: ["peanuts"] });
  const maya = await makeUser({ displayName: "Maya", allergens: ["milk"] });
  const g = await makeGroup(owner, [carson, maya]);
  return { owner, carson, maya, g };
}

async function startRunFor(u: TestUser, groupId: string, body: Record<string, unknown> = { prompt: "Plan our week" }) {
  const res = await api().post(`/api/groups/${groupId}/agent/runs`).set(u.auth).send(body);
  expect(res.status).toBe(202);
  return res.body.runId as string;
}

async function proposedRun(u: TestUser, groupId: string, p: AgentPlan = plan()) {
  const runId = await startRunFor(u, groupId);
  const res = await event(runId, 0, "proposed", { plan: p, meta });
  expect(res.status).toBe(204);
  return runId;
}

const runRow = (id: string) => prisma.agentRun.findUniqueOrThrow({ where: { id } });

describe("12 agent: start a run", () => {
  it("202 + a running run row; the agent gets the wire request with a 15-minute token for the caller", async () => {
    const { owner, g } = await household();
    await prisma.user.update({ where: { id: owner.id }, data: { zipCode: "64105" } });
    const runId = await startRunFor(owner, g.id, { prompt: "  Plan our week, cheap  ", budgetCents: 6000 });

    expect(await runRow(runId)).toMatchObject({ groupId: g.id, userId: owner.id, prompt: "Plan our week, cheap", budgetCents: 6000, status: "running" });
    expect(startRun).toHaveBeenCalledTimes(1);
    const req = startRun.mock.calls[0][0] as Record<string, string>;
    expect(req).toMatchObject({
      runId, groupId: g.id, prompt: "Plan our week, cheap", budgetCents: 6000, zipCode: "64105", apiBaseUrl: config.AGENT_PUBLIC_API_URL,
    });
    expect(verifyAgentRunToken(req.runToken)).toEqual({ userId: owner.id, runId, groupId: g.id });
    expect(verifyAppToken(req.runToken)).toBeNull(); // not a session token
    const decoded = jwt.decode(req.runToken) as { iat: number; exp: number };
    expect(decoded.exp - decoded.iat).toBe(15 * 60);
  });

  it("the run token only reads its own group (+ safety-check) and only while the run is running", async () => {
    const { owner, g } = await household();
    const runId = await startRunFor(owner, g.id);
    const auth = { Authorization: `Bearer ${(startRun.mock.calls[0][0] as { runToken: string }).runToken}` };
    for (const p of ["agent/household", "cabinet", "shopping-list", "preferences?userId=all"]) {
      expect((await api().get(`/api/groups/${g.id}/${p}`).set(auth)).status, p).toBe(200);
    }
    const meals = { meals: [{ title: "Greens", ingredients: ["Spinach"] }] };
    expect((await api().post(`/api/groups/${g.id}/agent/safety-check`).set(auth).send(meals)).status).toBe(200);
    expect((await api().post(`/api/groups/${g.id}/shopping-list`).set(auth).send({ itemId: await itemId("Spinach") })).status).toBe(401);
    expect((await api().get("/api/me").set(auth)).status).toBe(401);
    const other = await makeGroup(owner);
    expect((await api().get(`/api/groups/${other.id}/cabinet`).set(auth)).status).toBe(401);

    await event(runId, 0, "failed", { message: "done" });
    expect((await api().get(`/api/groups/${g.id}/cabinet`).set(auth)).status).toBe(401);
    expect((await api().get(`/api/groups/${g.id}/cabinet`).set(owner.auth)).status).toBe(200); // normal tokens unaffected
  });

  it("503 NOT_CONFIGURED without AGENT_URL, and no run is created", async () => {
    const { owner, g } = await household();
    config.AGENT_URL = undefined;
    const res = await api().post(`/api/groups/${g.id}/agent/runs`).set(owner.auth).send({ prompt: "x" });
    expect([res.status, res.body.error.code]).toEqual([503, "NOT_CONFIGURED"]);
    expect(await prisma.agentRun.count({ where: { groupId: g.id } })).toBe(0);
    expect(startRun).not.toHaveBeenCalled();
  });

  it("agent unreachable → 503 AGENT_UNAVAILABLE and the run is failed", async () => {
    const { owner, g } = await household();
    startRun.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await api().post(`/api/groups/${g.id}/agent/runs`).set(owner.auth).send({ prompt: "x" });
    expect([res.status, res.body.error.code]).toEqual([503, "AGENT_UNAVAILABLE"]);
    const [run] = await prisma.agentRun.findMany({ where: { groupId: g.id } });
    expect(run).toMatchObject({ status: "failed" });
    expect(run.error).toBeTruthy();
  });

  it("validates the body: prompt ≤ 500, budget 0..100000", async () => {
    const { owner, g } = await household();
    const url = `/api/groups/${g.id}/agent/runs`;
    expect((await api().post(url).set(owner.auth).send({ prompt: "x".repeat(501) })).status).toBe(400);
    expect((await api().post(url).set(owner.auth).send({ prompt: "ok", budgetCents: 100_001 })).status).toBe(400);
    expect((await api().post(url).set(owner.auth).send({})).status).toBe(400);
  });

  it("non-members get 404 on every agent route, and a run can't be read through another group", async () => {
    const { owner, g } = await household();
    const runId = await startRunFor(owner, g.id);
    const outsider = await makeUser();
    const base = `/api/groups/${g.id}/agent`;
    expect((await api().post(`${base}/runs`).set(outsider.auth).send({ prompt: "x" })).status).toBe(404);
    expect((await api().get(`${base}/runs/${runId}`).set(outsider.auth)).status).toBe(404);
    expect((await api().get(`${base}/runs`).set(outsider.auth)).status).toBe(404);
    expect((await api().post(`${base}/runs/${runId}/apply`).set(outsider.auth).send({})).status).toBe(404);
    expect((await api().get(`${base}/household`).set(outsider.auth)).status).toBe(404);

    // Outsider's own group, owner's run id → 404 (not 403), so run ids don't leak across groups.
    const og = await makeGroup(outsider);
    expect((await api().get(`/api/groups/${og.id}/agent/runs/${runId}`).set(outsider.auth)).status).toBe(404);
    expect((await api().post(`/api/groups/${og.id}/agent/runs/${runId}/apply`).set(outsider.auth).send({})).status).toBe(404);
    expect((await api().get(`${base}/runs/not-a-uuid`).set(owner.auth)).status).toBe(404);
  });
});

describe("12 agent: internal events", () => {
  it("wrong or missing X-Agent-Secret → 401; unknown run → 404", async () => {
    const { owner, g } = await household();
    const runId = await startRunFor(owner, g.id);
    const step = { id: "get_cabinet", label: "Reading the cabinet…", status: "running" };
    expect((await event(runId, 0, "step", step, "y".repeat(48))).status).toBe(401);
    expect((await event(runId, 0, "step", step, "short")).status).toBe(401);
    expect((await event(runId, 0, "step", step, null)).status).toBe(401);
    expect((await runRow(runId)).steps).toEqual([]);

    config.AGENT_SHARED_SECRET = undefined;
    expect((await event(runId, 0, "step", step, SECRET)).status).toBe(401);
    config.AGENT_SHARED_SECRET = SECRET;

    expect((await event("00000000-0000-4000-8000-00000000dead", 0, "step", step)).status).toBe(404);
    expect((await event(runId, 0, "step", { id: "x" })).status).toBe(400);
  });

  it("steps upsert by id, keep their first position, ignore stale events, and the server stamps `at`", async () => {
    const { owner, g } = await household();
    const runId = await startRunFor(owner, g.id);
    expect((await event(runId, 0, "step", { id: "get_household", label: "Reading the household…", status: "running" })).status).toBe(204);
    expect((await event(runId, 1, "step", { id: "get_cabinet", label: "Reading the cabinet…", status: "running" })).status).toBe(204);
    expect((await event(runId, 2, "step", { id: "get_household", label: "Checking allergies: Carson (peanuts)", status: "done", detail: "3 people" })).status).toBe(204);
    // A late, out-of-order "running" for a step that's already done is ignored.
    expect((await event(runId, 0, "step", { id: "get_household", label: "Reading the household…", status: "running" })).status).toBe(204);

    const res = await api().get(`/api/groups/${g.id}/agent/runs/${runId}`).set(owner.auth);
    expect(res.status).toBe(200);
    expect(res.body.steps).toEqual([
      { seq: 0, id: "get_household", label: "Checking allergies: Carson (peanuts)", status: "done", detail: "3 people", at: expect.any(String) },
      { seq: 1, id: "get_cabinet", label: "Reading the cabinet…", status: "running", at: expect.any(String) },
    ]);
    expect(Number.isNaN(Date.parse(res.body.steps[0].at))).toBe(false);
  });

  it("concurrent step events are all kept (atomic jsonb append, no lost updates)", async () => {
    const { owner, g } = await household();
    const runId = await startRunFor(owner, g.id);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => event(runId, i, "step", { id: `s${i}`, label: `Step ${i}`, status: "done" })),
    );
    expect(results.every((r) => r.status === 204)).toBe(true);
    const steps = (await api().get(`/api/groups/${g.id}/agent/runs/${runId}`).set(owner.auth)).body.steps as { id: string; seq: number }[];
    expect(steps.map((s) => s.id)).toEqual(Array.from({ length: 20 }, (_, i) => `s${i}`));
  });

  it("proposed with an invalid plan → 422 and the run is failed; later events → 409", async () => {
    const { owner, g } = await household();
    const runId = await startRunFor(owner, g.id);
    const bad = { ...plan(), estimate: { lowCents: 1, highCents: 2, label: "price" } };
    const res = await event(runId, 5, "proposed", { plan: bad, meta });
    expect(res.status).toBe(422);
    expect(await runRow(runId)).toMatchObject({ status: "failed", error: "Plan didn't validate", plan: null });
    expect((await event(runId, 6, "step", { id: "x", label: "late", status: "done" })).status).toBe(409);
    expect((await event(runId, 6, "proposed", { plan: plan(), meta })).status).toBe(409);
  });

  it("a plan proposed without a price estimate gets one filled in afterwards (Akamai prices, every item priced)", async () => {
    const { owner, g } = await household();
    await prisma.user.update({ where: { id: owner.id }, data: { zipCode: "64105" } });
    const key = { key: config.AKAMAI_API_KEY, url: config.AKAMAI_BASE_URL };
    config.AKAMAI_API_KEY = "test-akamai-key";
    config.AKAMAI_BASE_URL = "https://akamai.test/v1";
    const chat = vi.spyOn(akamai, "chat").mockImplementation(async (b) => {
      const prompt = (b.messages as { content: string }[])[1].content;
      const rows = [...prompt.matchAll(/^(\d+)\. "/gm)].map((m) => [Number(m[1]), null, 100, 300, 200, "1"]);
      return { choices: [{ message: { content: JSON.stringify({ p: rows }) } }] } as never;
    });
    try {
      const p = { ...plan(), estimate: null };
      const runId = await proposedRun(owner, g.id, p);
      await waitForPlanEstimates();
      const n = p.missingItems.length;
      expect(n).toBeGreaterThan(0);
      expect((await runRow(runId)).plan).toMatchObject({ estimate: { lowCents: 100 * n, highCents: 300 * n, label: "AI estimate" } });
      expect(chat).toHaveBeenCalled();
    } finally {
      chat.mockRestore();
      config.AKAMAI_API_KEY = key.key;
      config.AKAMAI_BASE_URL = key.url;
    }
  });

  it("proposed stores plan + meta; failed stores the message; both are terminal; agent:changed is emitted with runId", async () => {
    const { owner, g } = await household();
    const runId = await startRunFor(owner, g.id);
    expect((await event(runId, 3, "proposed", { plan: plan(), meta })).status).toBe(204);
    const res = await api().get(`/api/groups/${g.id}/agent/runs/${runId}`).set(owner.auth);
    expect(res.body).toMatchObject({ id: runId, status: "proposed", meta, error: null, appliedAt: null });
    expect(res.body.plan.meals).toHaveLength(4);
    expect((await event(runId, 4, "failed", { message: "late" })).status).toBe(409);

    const run2 = await startRunFor(owner, g.id);
    expect((await event(run2, 1, "failed", { message: "Model unavailable" })).status).toBe(204);
    expect(await runRow(run2)).toMatchObject({ status: "failed", error: "Model unavailable" });

    await sleep(300); // trailing throttled emit
    const changed = emitsOf("agent:changed", g.id);
    expect(changed.some((e) => e.payload.runId === runId && e.payload.by === owner.id)).toBe(true);
    expect(changed.some((e) => e.payload.runId === run2)).toBe(true);
  });

  it("agent:changed is throttled to ≤ 1 per 250 ms per run, with a trailing emit", async () => {
    const { owner, g } = await household();
    const runId = await startRunFor(owner, g.id);
    emitted = [];
    const t0 = Date.now();
    for (let i = 0; i < 6; i++) await event(runId, i, "step", { id: `s${i}`, label: `Step ${i}`, status: "done" });
    const elapsed = Date.now() - t0;
    await sleep(300);
    const n = emitsOf("agent:changed", g.id).filter((e) => e.payload.runId === runId).length;
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(Math.ceil((elapsed + 300) / 250) + 1);
    expect(n).toBeLessThan(6);
  });
});

describe("12 agent: apply", () => {
  /** Lemons in stock (skip), Ginger running low (add), Salsa unchecked on the list (skip). */
  async function kitchen() {
    const h = await household();
    const { owner, g } = h;
    await api().post(`/api/groups/${g.id}/cabinet`).set(owner.auth).send({ itemId: await itemId("Lemons") }).expect(201);
    await prisma.cabinetItem.create({ data: { groupId: g.id, itemId: await itemId("Ginger"), status: "running_low", addedBy: owner.id } });
    await api().post(`/api/groups/${g.id}/shopping-list`).set(owner.auth).send({ itemId: await itemId("Salsa") }).expect(201);
    return h;
  }

  it("skips an item that is already checked off in the cart as on_list (not re-added or re-tagged)", async () => {
    const { owner, g } = await kitchen();
    const row = await api().post(`/api/groups/${g.id}/shopping-list`).set(owner.auth).send({ itemId: await itemId("Avocados") }).expect(201);
    await api().patch(`/api/groups/${g.id}/shopping-list/${row.body.id}`).set(owner.auth).send({ checked: true }).expect(200);
    const runId = await proposedRun(owner, g.id);

    const res = await api().post(`/api/groups/${g.id}/agent/runs/${runId}/apply`).set(owner.auth).send({});
    expect(res.status).toBe(200);
    expect(res.body.skipped).toEqual(expect.arrayContaining([{ name: "Avocados", reason: "on_list" }]));
    expect(res.body.added).toBe(3);
    const avocados = await prisma.shoppingListItem.findFirst({ where: { groupId: g.id, itemId: await itemId("Avocados") } });
    expect(avocados).toMatchObject({ checked: true, note: null, agentRunId: null });
  });

  it("adds exactly the missing items with ✨ notes, skips cabinet/list items, emits shopping-list:changed once", async () => {
    const { owner, g } = await kitchen();
    const runId = await proposedRun(owner, g.id);
    emitted = [];

    const res = await api().post(`/api/groups/${g.id}/agent/runs/${runId}/apply`).set(owner.auth).send({});
    expect(res.status).toBe(200);
    expect(res.body.added).toBe(4);
    expect(res.body.skipped).toEqual(
      expect.arrayContaining([{ name: "Lemons", reason: "in_cabinet" }, { name: "Salsa", reason: "on_list" }]),
    );
    expect(res.body.skipped).toHaveLength(2);
    const added = new Map((res.body.items as { item: { name: string }; note: string }[]).map((r) => [r.item.name, r]));
    expect([...added.keys()].sort()).toEqual(["Avocados", "Basil", "Ginger", "Zucchini"]);
    expect(added.get("Avocados")!.note).toBe("✨ for Spinach and black bean quesadillas");
    expect(added.get("Basil")!.note).toBe("✨ for Tomato pasta with spinach");


    const rows = await prisma.shoppingListItem.findMany({ where: { groupId: g.id }, include: { item: true } });
    expect(rows.map((r) => r.item.name).sort()).toEqual(["Avocados", "Basil", "Ginger", "Salsa", "Zucchini"]);
    for (const r of rows.filter((r) => r.item.name !== "Salsa")) expect(r).toMatchObject({ agentRunId: runId, reason: "manual", addedBy: owner.id });
    expect(rows.find((r) => r.item.name === "Salsa")).toMatchObject({ agentRunId: null, note: null });

    expect(emitsOf("shopping-list:changed", g.id)).toHaveLength(1);
    const agentChanged = emitsOf("agent:changed", g.id);
    expect(agentChanged).toHaveLength(1);
    expect(agentChanged[0].payload).toMatchObject({ runId, groupId: g.id, by: owner.id });
    expect(await runRow(runId)).toMatchObject({ status: "applied", appliedAt: expect.any(Date) });

    // The list endpoint exposes the note.
    const list = await api().get(`/api/groups/${g.id}/shopping-list`).set(owner.auth);
    expect(list.body.find((r: { item: { name: string } }) => r.item.name === "Zucchini").note).toBe("✨ for Tomato pasta with spinach");
  });

  it("second apply → 409 RUN_NOT_PROPOSED; parallel double-tap applies exactly once", async () => {
    const { owner, g } = await kitchen();
    const runId = await proposedRun(owner, g.id);
    const url = `/api/groups/${g.id}/agent/runs/${runId}/apply`;
    await api().post(url).set(owner.auth).send({}).expect(200);
    const again = await api().post(url).set(owner.auth).send({});
    expect([again.status, again.body.error.code]).toEqual([409, "RUN_NOT_PROPOSED"]);

    const { owner: o2, g: g2 } = await kitchen();
    const run2 = await proposedRun(o2, g2.id);
    emitted = [];
    const url2 = `/api/groups/${g2.id}/agent/runs/${run2}/apply`;
    const both = await Promise.all([api().post(url2).set(o2.auth).send({}), api().post(url2).set(o2.auth).send({})]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(emitsOf("shopping-list:changed", g2.id)).toHaveLength(1);
    expect(await prisma.shoppingListItem.count({ where: { groupId: g2.id, agentRunId: run2 } })).toBe(4);
  });

  it("an unverifiable item: 422 PLAN_UNSAFE in an allergy household; created via POST /items and added otherwise", async () => {
    const odd = `Zzqxv Spice ${Date.now()}`;
    const p = plan();
    p.missingItems.push({ name: odd, forMeals: [p.meals[0].title] });

    const { owner, g } = await household(); // Carson (peanuts), Maya (milk)
    const runId = await proposedRun(owner, g.id, p);
    const res = await api().post(`/api/groups/${g.id}/agent/runs/${runId}/apply`).set(owner.auth).send({});
    expect([res.status, res.body.error.code]).toEqual([422, "PLAN_UNSAFE"]);
    expect(JSON.stringify(res.body.error.details)).toContain("couldn't verify ingredients (allergy household)");

    const solo = await makeUser();
    const sg = await makeGroup(solo);
    const run2 = await proposedRun(solo, sg.id, p);
    const ok = await api().post(`/api/groups/${sg.id}/agent/runs/${run2}/apply`).set(solo.auth).send({});
    expect(ok.status).toBe(200);
    expect(ok.body.items.map((r: { item: { name: string } }) => r.item.name)).toContain(odd);
    expect(await prisma.item.findFirst({ where: { name: odd } })).toBeTruthy();
  });

  it("apply keyword-scans the cited recipe's ingredientLines: a peanut line → 422 PLAN_UNSAFE", async () => {
    const { owner, g } = await household();
    const p = plan();
    p.meals[0].ingredientLines = ["2 cups cooked rice", "2 tbsp peanut sauce"];
    const runId = await proposedRun(owner, g.id, p);
    const res = await api().post(`/api/groups/${g.id}/agent/runs/${runId}/apply`).set(owner.auth).send({});
    expect([res.status, res.body.error.code]).toEqual([422, "PLAN_UNSAFE"]);
    expect(JSON.stringify(res.body.error.details)).toContain("2 tbsp peanut sauce");
  });

  it("apply on a running run → 409", async () => {
    const { owner, g } = await household();
    const runId = await startRunFor(owner, g.id);
    const res = await api().post(`/api/groups/${g.id}/agent/runs/${runId}/apply`).set(owner.auth).send({});
    expect([res.status, res.body.error.code]).toEqual([409, "RUN_NOT_PROPOSED"]);
  });

  it("a plan with peanut butter for a peanut-allergic member → 422 PLAN_UNSAFE, nothing is added, run stays proposed", async () => {
    const { owner, g } = await household();
    const p = plan();
    p.meals[0].ingredients.push("Peanut Butter");
    p.meals[0].missing.push("Peanut Butter");
    p.missingItems.push({ name: "Peanut Butter", forMeals: [p.meals[0].title] });
    // A forged "proposed" event can carry a plan the agent never safety-checked.
    p.safety.perMeal = p.meals.map((m) => ({ title: m.title, passes: true, unknown: [] }));
    const runId = await proposedRun(owner, g.id, p);
    emitted = [];

    const res = await api().post(`/api/groups/${g.id}/agent/runs/${runId}/apply`).set(owner.auth).send({});
    expect([res.status, res.body.error.code]).toEqual([422, "PLAN_UNSAFE"]);
    expect(JSON.stringify(res.body.error.details)).toContain("Carson");
    expect(await prisma.shoppingListItem.count({ where: { groupId: g.id } })).toBe(0);
    expect((await runRow(runId)).status).toBe("proposed");
    expect(emitsOf("shopping-list:changed", g.id)).toHaveLength(0);
  });

  it("long meal lists truncate the note to 120 chars; agent notes survive POST /shopping-list/generate", async () => {
    const { owner, g } = await household();
    const p = plan();
    const titles = p.meals.map((m) => m.title);
    p.missingItems = [{ name: "Zucchini", forMeals: titles }];
    const runId = await proposedRun(owner, g.id, p);
    await api().post(`/api/groups/${g.id}/agent/runs/${runId}/apply`).set(owner.auth).send({}).expect(200);

    const row = await prisma.shoppingListItem.findFirstOrThrow({ where: { groupId: g.id, itemId: await itemId("Zucchini") } });
    expect(row.note!.length).toBeLessThanOrEqual(120);
    expect(row.note!.startsWith("✨ for Lemon garlic chicken")).toBe(true);

    // Add a preference so regeneration has work to do, then regenerate.
    await api().post(`/api/groups/${g.id}/preferences`).set(owner.auth).send({ itemId: await itemId("Milk") }).expect(201);
    const gen = await api().post(`/api/groups/${g.id}/shopping-list/generate`).set(owner.auth);
    expect(gen.status).toBe(200);
    const z = gen.body.find((r: { item: { name: string } }) => r.item.name === "Zucchini");
    expect(z).toMatchObject({ note: row.note, reason: "manual" });
    expect(await prisma.shoppingListItem.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ agentRunId: runId, note: row.note });
  });
});

describe("12 agent: reads, household, timeouts", () => {
  it("GET /agent/runs lists newest first without steps; limit is honoured", async () => {
    const { owner, g } = await household();
    const a = await startRunFor(owner, g.id);
    await event(a, 0, "step", { id: "x", label: "X", status: "done" });
    const b = await proposedRun(owner, g.id);
    const res = await api().get(`/api/groups/${g.id}/agent/runs?limit=1`).set(owner.auth);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: b, status: "proposed" });
    expect(res.body[0].steps).toBeUndefined();
    const all = await api().get(`/api/groups/${g.id}/agent/runs`).set(owner.auth);
    expect(all.body.map((r: { id: string }) => r.id)).toEqual([b, a]);
    expect((await api().get(`/api/groups/${g.id}/agent/runs?limit=99`).set(owner.auth)).status).toBe(400);
  });

  it("GET /agent/household: today in the group's zone, the caller's ZIP, every member's allergens and diets", async () => {
    const { owner, maya, g } = await household();
    await prisma.userDiet.create({ data: { userId: maya.id, diet: "vegetarian" } });
    await prisma.user.update({ where: { id: maya.id }, data: { zipCode: "64105" } });
    const res = await api().get(`/api/groups/${g.id}/agent/household`).set(maya.auth);
    expect(res.status).toBe(200);
    const tz = (await prisma.group.findUniqueOrThrow({ where: { id: g.id } })).timeZone;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    expect(res.body).toMatchObject({ today, timeZone: tz, zipCode: "64105" });
    const byName = new Map(res.body.members.map((m: { displayName: string }) => [m.displayName, m]));
    expect(byName.get("Carson")).toEqual({ displayName: "Carson", allergens: ["peanuts"], diets: [] });
    expect(byName.get("Maya")).toEqual({ displayName: "Maya", allergens: ["milk"], diets: ["vegetarian"] });
    expect(res.body.members).toHaveLength(3);
    expect((await api().get(`/api/groups/${g.id}/agent/household`).set(owner.auth)).body.zipCode).toBeNull();
  });

  it("a run still running after the timeout is failed ('Took too long') and agent:changed is emitted", async () => {
    agentTimers.runTimeoutMs = 80;
    const { owner, g } = await household();
    const runId = await startRunFor(owner, g.id);
    const done = await startRunFor(owner, g.id);
    await event(done, 0, "proposed", { plan: plan(), meta });
    emitted = [];
    await sleep(400);
    expect(await runRow(runId)).toMatchObject({ status: "failed", error: "Took too long" });
    expect((await runRow(done)).status).toBe("proposed");
    expect(emitsOf("agent:changed", g.id).some((e) => e.payload.runId === runId)).toBe(true);
  });

  it("boot sweep fails running runs older than 2 minutes and leaves recent ones alone", async () => {
    const { owner, g } = await household();
    const old = await prisma.agentRun.create({
      data: { groupId: g.id, userId: owner.id, prompt: "old", createdAt: new Date(Date.now() - 3 * 60_000) },
    });
    const fresh = await prisma.agentRun.create({ data: { groupId: g.id, userId: owner.id, prompt: "fresh" } });
    expect(await sweepStaleRuns()).toBeGreaterThanOrEqual(1);
    expect(await runRow(old.id)).toMatchObject({ status: "failed", error: "Took too long" });
    expect((await runRow(fresh.id)).status).toBe("running");
  });
});
