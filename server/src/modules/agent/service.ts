import { config } from "../../config.js";
import {
  AgentEvent,
  AgentPlan,
  type AgentHousehold,
  type AgentRun,
  type AgentRunSummary,
  type AgentStep,
  type ApplyAgentRunResponse,
  type SafetyCheckBody,
  type SafetyCheckResponse,
  type StartAgentRunBody,
} from "../../contracts/agent.js";
import type { Item } from "../../contracts/items.js";
import { prisma } from "../../db.js";
import { agentClient } from "../../lib/agentClient.js";
import { AppError, conflict, notConfigured, notFound } from "../../lib/errors.js";
import { groupTimeZone, householdToday, toCalendarDate } from "../../lib/expiration.js";
import { signAgentRunToken } from "../../lib/jwt.js";
import { logger } from "../../lib/logger.js";
import { normalize } from "../../lib/normalize.js";
import { emitGroup } from "../../lib/realtime.js";
import { itemsService } from "../items/service.js";
import { withRegeneration } from "../shopping-list/engine.js";
import { shoppingListRepo } from "../shopping-list/repo.js";
import { shoppingListService } from "../shopping-list/service.js";
import { agentRepo } from "./repo.js";
import { safety, type SafetyMeal } from "./safety.js";

/** Mutable so tests can shorten them. */
export const agentTimers = { runTimeoutMs: 120_000, staleAfterMs: 120_000, emitThrottleMs: 250 };

const TOO_LONG = "Took too long";
const NOTE_MAX = 120;

type RunRow = NonNullable<Awaited<ReturnType<typeof agentRepo.find>>>;
type SummaryRow = Awaited<ReturnType<typeof agentRepo.list>>[number];
type Owner = { id: string; groupId: string; userId: string };

const notProposed = () => conflict("This plan can't be applied (it isn't waiting for approval)", "RUN_NOT_PROPOSED");
const notRunning = () => conflict("This run is no longer running", "RUN_NOT_RUNNING");

// ─── Serialization ───────────────────────────────────────────────────────────

function toSummary(r: SummaryRow): AgentRunSummary {
  return {
    id: r.id,
    groupId: r.groupId,
    userId: r.userId,
    prompt: r.prompt,
    budgetCents: r.budgetCents,
    status: r.status,
    plan: (r.plan ?? null) as AgentRunSummary["plan"],
    error: r.error,
    meta: (r.meta ?? null) as AgentRunSummary["meta"],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    appliedAt: r.appliedAt?.toISOString() ?? null,
  };
}

/** Steps without the internal `_ev` marker (see agentRepo.upsertStep). */
function toRun(r: RunRow): AgentRun {
  const steps = (Array.isArray(r.steps) ? r.steps : []) as (AgentStep & { _ev?: number })[];
  return { ...toSummary(r), steps: steps.map(({ _ev: _, ...s }) => s) };
}

// ─── agent:changed (throttled per run) and timeouts ──────────────────────────

const throttle = new Map<string, { last: number; timer: NodeJS.Timeout | null }>();

/** emitGroup(agent:changed) at most once per emitThrottleMs per run; a burst ends with one trailing emit. */
function notifyRun(run: Owner) {
  const ms = agentTimers.emitThrottleMs;
  const t = throttle.get(run.id) ?? { last: 0, timer: null };
  throttle.set(run.id, t);
  if (t.timer) return;
  const fire = () => {
    t.timer = null;
    t.last = Date.now();
    emitGroup(run.groupId, "agent:changed", run.userId, { runId: run.id });
    setTimeout(() => {
      if (!t.timer && Date.now() - t.last >= ms) throttle.delete(run.id);
    }, ms).unref();
  };
  const wait = t.last + ms - Date.now();
  if (wait <= 0) fire();
  else t.timer = setTimeout(fire, wait).unref();
}

async function expire(runId: string) {
  const owner = await agentRepo.findOwner(runId);
  if (owner && (await agentRepo.fail(runId, TOO_LONG))) {
    logger.warn({ runId }, "agent run timed out");
    emitGroup(owner.groupId, "agent:changed", owner.userId, { runId });
  }
}

function scheduleTimeout(runId: string, ms = agentTimers.runTimeoutMs) {
  setTimeout(() => {
    expire(runId).catch((err) => logger.error({ err, runId }, "agent run timeout failed"));
  }, Math.max(0, ms)).unref();
}

/**
 * Boot sweep: runs still `running` after staleAfterMs belong to a dead agent or a previous server process → failed.
 * Younger running runs lost their timer with that process, so the remaining part of their timeout is re-armed here.
 */
export async function sweepStaleRuns(olderThanMs = agentTimers.staleAfterMs): Promise<number> {
  const rows = await agentRepo.failStale(new Date(Date.now() - olderThanMs), TOO_LONG);
  for (const r of rows) emitGroup(r.groupId, "agent:changed", r.userId, { runId: r.id });
  for (const r of await agentRepo.running()) {
    scheduleTimeout(r.id, r.createdAt.getTime() + agentTimers.runTimeoutMs - Date.now());
  }
  return rows.length;
}

// ─── Apply helpers ───────────────────────────────────────────────────────────

/** missingItems[].name → catalog item: exact/suggested match, else created through the POST /items path. */
async function resolveItem(userId: string, name: string): Promise<Item | null> {
  if (!normalize(name)) return null;
  const res = await itemsService.search(name);
  if (res.match !== "none" && res.results[0]) return res.results[0];
  return (await itemsService.create(userId, { name: name.trim().slice(0, 200) })).item;
}

function unsafe(failing: { title: string; problems: SafetyCheckResponse["meals"][number]["problems"] }[]) {
  const first = failing[0].problems[0];
  return new AppError(
    422,
    "PLAN_UNSAFE",
    `This plan isn't safe for everyone: ${first.ingredient} (${first.reason}: ${first.members.join(", ")})`,
    { meals: failing.map((m) => ({ title: m.title, problems: m.problems })) },
  );
}

function noteFor(forMeals: string[]): string {
  return Array.from(`✨ for ${forMeals.join(", ")}`).slice(0, NOTE_MAX).join("");
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const agentService = {
  /** POST /agent/runs: create the run, hand it to the agent service (5 s), arm the 120 s timeout. */
  async start(groupId: string, userId: string, body: StartAgentRunBody): Promise<{ runId: string }> {
    if (!config.AGENT_URL || !config.AGENT_SHARED_SECRET) throw notConfigured("Pantry Agent");
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { zipCode: true } });
    const budgetCents = body.budgetCents ?? null;
    const { id: runId } = await agentRepo.create(groupId, userId, body.prompt, budgetCents);
    try {
      await agentClient.startRun({
        runId, groupId, prompt: body.prompt, budgetCents, zipCode: user?.zipCode ?? null,
        apiBaseUrl: config.AGENT_PUBLIC_API_URL, runToken: signAgentRunToken(userId, runId, groupId),
      });
    } catch (err) {
      logger.warn({ err, runId }, "agent service unreachable");
      await agentRepo.fail(runId, "The planner is unavailable right now");
      emitGroup(groupId, "agent:changed", userId, { runId });
      throw new AppError(503, "AGENT_UNAVAILABLE", "The Pantry Agent is unavailable right now, try again later");
    }
    scheduleTimeout(runId);
    return { runId };
  },

  async get(groupId: string, runId: string): Promise<AgentRun> {
    const row = await agentRepo.find(groupId, runId);
    if (!row) throw notFound("Agent run");
    return toRun(row);
  },

  list: async (groupId: string, limit: number): Promise<AgentRunSummary[]> => (await agentRepo.list(groupId, limit)).map(toSummary),

  /** GET /agent/household: what get_household() gives the model. */
  async household(groupId: string, userId: string): Promise<AgentHousehold> {
    const [timeZone, members, user] = await Promise.all([
      groupTimeZone(prisma, groupId),
      agentRepo.members(groupId),
      prisma.user.findUnique({ where: { id: userId }, select: { zipCode: true } }),
    ]);
    return { today: toCalendarDate(householdToday(timeZone))!, timeZone, zipCode: user?.zipCode ?? null, members };
  },

  safetyCheck: (groupId: string, body: SafetyCheckBody): Promise<SafetyCheckResponse> => safety.check(groupId, body.meals),

  /**
   * POST /agent/runs/:id/apply. Safety is re-checked here (the agent's own check is not trusted), then every insert
   * happens in ONE withRegeneration transaction that first claims the run proposed → applied (double-tap safe).
   */
  async apply(groupId: string, userId: string, runId: string): Promise<ApplyAgentRunResponse> {
    const run = await agentRepo.find(groupId, runId);
    if (!run) throw notFound("Agent run");
    if (run.status !== "proposed") throw notProposed();
    const parsed = AgentPlan.safeParse(run.plan);
    if (!parsed.success) {
      logger.error({ runId, issues: parsed.error.issues }, "stored agent plan is corrupt");
      throw new AppError(500, "PLAN_CORRUPT", "This plan is damaged and can't be applied");
    }
    const plan = parsed.data;

    // Check everything the plan tells people to buy or cook, not only meals[].ingredients: missing/uses names, the
    // title and steps (safety.check), and missingItems — the rows apply actually writes (as a final "To buy" entry).
    const toCheck: SafetyMeal[] = plan.meals.map((m) => ({
      title: m.title,
      ingredients: [...new Set([...m.ingredients, ...m.missing, ...m.uses])],
      steps: m.steps,
    }));
    if (plan.missingItems.length) toCheck.push({ title: "To buy", ingredients: plan.missingItems.map((i) => i.name) });
    const failing = (await safety.check(groupId, toCheck)).meals.filter((m) => !m.passes);
    if (failing.length) throw unsafe(failing);

    // Resolve names (outside the transaction: may create catalog items). Merge names that land on the same item.
    const wanted = new Map<string, { name: string; forMeals: string[]; item: Item }>();
    for (const m of plan.missingItems) {
      const item = await resolveItem(userId, m.name).catch((err) => {
        logger.warn({ err, name: m.name }, "could not resolve agent item");
        return null;
      });
      if (!item) continue;
      const w = wanted.get(item.id) ?? { name: m.name, forMeals: [], item };
      for (const t of m.forMeals) if (!w.forMeals.includes(t)) w.forMeals.push(t);
      wanted.set(item.id, w);
    }
    // The resolved catalog item may differ from the name (fuzzy match): check its own allergens/category too.
    const itemProblems = await safety.checkItems(groupId, [...wanted.values()].map((w) => w.item));
    if (itemProblems.length) throw unsafe([{ title: "To buy", problems: itemProblems }]);
    const itemIds = [...wanted.keys()];

    const { result } = await withRegeneration(groupId, userId, ["shopping-list:changed"], async (tx) => {
      if (!(await agentRepo.claimApply(tx, groupId, runId))) throw notProposed();
      const inCabinet = new Set(
        (await tx.cabinetItem.findMany({ where: { groupId, status: "in_stock", itemId: { in: itemIds } }, select: { itemId: true } }))
          .map((c) => c.itemId),
      );
      // Any row already on the list counts, including checked ones (already in the cart).
      const onList = new Set(
        (await tx.shoppingListItem.findMany({ where: { groupId, itemId: { in: itemIds } }, select: { itemId: true } }))
          .map((r) => r.itemId),
      );
      const skipped: ApplyAgentRunResponse["skipped"] = [];
      const rows: { itemId: string; note: string }[] = [];
      for (const [itemId, w] of wanted) {
        if (inCabinet.has(itemId)) skipped.push({ name: w.name, reason: "in_cabinet" });
        else if (onList.has(itemId)) skipped.push({ name: w.name, reason: "on_list" });
        else rows.push({ itemId, note: noteFor(w.forMeals) });
      }
      const ids = await shoppingListRepo.upsertFromAgent(tx, groupId, userId, runId, rows);
      return { ids, skipped };
    });
    emitGroup(groupId, "agent:changed", userId, { runId });

    const added = new Set(result.ids);
    const items = (await shoppingListService.list(groupId)).filter((r) => added.has(r.id));
    return { added: result.ids.length, skipped: result.skipped, items };
  },

  /**
   * POST /internal/agent-events (already authenticated by X-Agent-Secret). `envelope` is the parsed {runId, seq, type};
   * `body` the raw event. Terminal events and steps only apply to running runs (else 409).
   */
  async handleEvent(envelope: { runId: string; type: AgentEvent["type"] }, body: unknown): Promise<void> {
    const owner = await agentRepo.findOwner(envelope.runId);
    if (!owner) throw notFound("Agent run");

    if (envelope.type === "proposed") {
      const ev = AgentEvent.safeParse(body);
      if (!ev.success || ev.data.type !== "proposed") {
        const failed = await agentRepo.fail(owner.id, "Plan didn't validate");
        if (!failed) throw notRunning();
        notifyRun(owner);
        throw new AppError(422, "PLAN_INVALID", "Plan didn't validate", ev.success ? undefined : ev.error.issues.slice(0, 20));
      }
      let saved: boolean;
      try {
        saved = await agentRepo.propose(owner.id, ev.data.payload.plan, ev.data.payload.meta);
      } catch (err) {
        // A plan that can't be stored must not leave the run `running` until the timeout.
        logger.error({ err, runId: owner.id }, "could not store the proposed plan");
        if (await agentRepo.fail(owner.id, "Plan couldn't be saved")) notifyRun(owner);
        throw new AppError(422, "PLAN_INVALID", "Plan couldn't be saved");
      }
      if (!saved) throw notRunning();
    } else {
      const ev = AgentEvent.parse(body);
      if (ev.type === "step") {
        if (!(await agentRepo.upsertStep(owner.id, ev.seq, ev.payload, new Date().toISOString()))) throw notRunning();
      } else if (ev.type === "failed") {
        if (!(await agentRepo.fail(owner.id, ev.payload.message, ev.payload.meta))) throw notRunning();
      }
    }
    notifyRun(owner);
  },
};
