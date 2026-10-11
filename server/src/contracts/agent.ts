import { z } from "zod";
import { CalendarDate } from "./common.js";
import { Allergen, Diet } from "./dietary.js";
import { ShoppingListItem } from "./shoppingList.js";

// Pantry Agent (plan/challenges/01-pantry-agent). FROZEN in Phase 0: the app, the server and agent/app/schemas.py
// (pydantic) all follow these shapes. server/test/fixtures/agent/demo-run.json must validate against AgentRun.

/** Postgres text can't hold NUL (0x00): reject it at the boundary instead of failing in the database. */
const text = () => z.string().regex(/^[^\u0000]*$/, "must not contain NUL characters");
/** seq is stored and sorted as a Postgres int4. */
const SEQ_MAX = 2_147_483_647;

// ─── Plan (what the agent proposes via propose_plan) ─────────────────────────

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export const PlanMeal = z.object({
  title: text().trim().min(1).max(120),
  day: z.enum(WEEKDAYS).nullable(),
  minutes: z.number().int().min(1).max(240),
  servings: z.number().int().min(1).max(20),
  ingredients: z.array(text().trim().min(1).max(120)).min(1).max(25),
  /** Cabinet item names this meal uses. */
  uses: z.array(text().trim().min(1).max(120)).max(15),
  /** Generic grocery names to buy ("Lemons"), no quantities. */
  missing: z.array(text().trim().min(1).max(120)).max(15),
  steps: z.array(text().trim().min(1).max(500)).min(1).max(6),
});
export type PlanMeal = z.infer<typeof PlanMeal>;

export const PlanMissingItem = z.object({
  name: text().trim().min(1).max(120),
  /** Meal titles that need this item. */
  forMeals: z.array(text().max(120)).min(1).max(7),
});

export const PlanEstimate = z.object({
  lowCents: z.number().int().min(0).max(10_000_000),
  highCents: z.number().int().min(0).max(10_000_000),
  label: z.literal("AI estimate"),
});

export const AgentPlan = z.object({
  meals: z.array(PlanMeal).min(1).max(7),
  missingItems: z.array(PlanMissingItem).max(40),
  estimate: PlanEstimate.nullable(),
  safety: z.object({
    checked: z.literal(true),
    perMeal: z.array(z.object({ title: text(), passes: z.boolean(), unknown: z.array(text()) })),
  }),
  summary: text().max(400),
});
export type AgentPlan = z.infer<typeof AgentPlan>;

// ─── Runs ────────────────────────────────────────────────────────────────────

export const AgentRunStatus = z.enum(["running", "proposed", "applied", "failed"]);
export type AgentRunStatus = z.infer<typeof AgentRunStatus>;

export const AgentStepStatus = z.enum(["running", "done", "failed"]);

export const AgentStep = z.object({
  /** Increasing per run; the order steps are shown in. */
  seq: z.number().int().min(0).max(SEQ_MAX),
  /** Stable per step so "running" can become "done" (e.g. "get_cabinet", "drafting"). */
  id: text().min(1).max(64),
  label: text().min(1).max(200),
  status: AgentStepStatus,
  detail: text().max(500).optional(),
  /** ISO timestamp set by the server when the event arrives (used by the recorded-run replay). */
  at: z.string(),
});
export type AgentStep = z.infer<typeof AgentStep>;

export const AgentRunMeta = z.object({
  provider: text().max(40),
  model: text().max(120),
  toolCalls: z.number().int().min(0),
  tokensIn: z.number().int().min(0).nullable(),
  tokensOut: z.number().int().min(0).nullable(),
  ms: z.number().int().min(0),
});

export const AgentRun = z.object({
  id: z.uuid(),
  groupId: z.uuid(),
  userId: z.uuid(),
  prompt: z.string(),
  budgetCents: z.number().int().nullable(),
  status: AgentRunStatus,
  steps: z.array(AgentStep),
  plan: AgentPlan.nullable(),
  error: z.string().nullable(),
  meta: AgentRunMeta.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  appliedAt: z.string().nullable(),
});
export type AgentRun = z.infer<typeof AgentRun>;

/** GET /agent/runs list rows: no steps. */
export const AgentRunSummary = AgentRun.omit({ steps: true });
export type AgentRunSummary = z.infer<typeof AgentRunSummary>;

export const StartAgentRunBody = z.object({
  prompt: text().trim().min(1).max(500),
  budgetCents: z.number().int().min(0).max(100_000).nullable().optional(),
});
export type StartAgentRunBody = z.infer<typeof StartAgentRunBody>;

export const StartAgentRunResponse = z.object({ runId: z.uuid() });

export const AgentRunsQuery = z.object({ limit: z.coerce.number().int().min(1).max(20).default(5) });
export const AgentRunParams = z.object({ groupId: z.uuid(), runId: z.uuid() });

export const ApplyAgentRunResponse = z.object({
  added: z.number().int(),
  skipped: z.array(z.object({ name: z.string(), reason: z.enum(["in_cabinet", "on_list"]) })),
  items: z.array(ShoppingListItem),
});
export type ApplyAgentRunResponse = z.infer<typeof ApplyAgentRunResponse>;

// ─── Tool endpoints (called by the agent with the run token) ─────────────────

export const AgentHousehold = z.object({
  /** Household "today" (YYYY-MM-DD) in its time zone. */
  today: CalendarDate,
  timeZone: z.string(),
  /** The caller's ZIP, for pricing. */
  zipCode: z.string().nullable(),
  members: z.array(z.object({ displayName: z.string(), allergens: z.array(Allergen), diets: z.array(Diet) })),
});
export type AgentHousehold = z.infer<typeof AgentHousehold>;

export const SafetyCheckBody = z.object({
  meals: z
    .array(
      z.object({
        title: text().trim().min(1).max(120),
        ingredients: z.array(text().trim().min(1).max(120)).min(1).max(25),
        /** Checked too (the same as apply does), so a plan that passes here can't 422 on apply because of a step. */
        steps: z.array(text().trim().min(1).max(500)).max(6).optional(),
      }),
    )
    .min(1)
    .max(7),
});
export type SafetyCheckBody = z.infer<typeof SafetyCheckBody>;

export const SafetyProblem = z.object({
  ingredient: z.string(),
  /** "contains peanuts", "not vegetarian", … */
  reason: z.string(),
  /** Display names of the members it conflicts with. */
  members: z.array(z.string()),
});

export const SafetyCheckResponse = z.object({
  meals: z.array(
    z.object({
      title: z.string(),
      passes: z.boolean(),
      problems: z.array(SafetyProblem),
      /** Ingredients with no catalog match and no allergen keyword hit: shown as "couldn't verify", don't fail. */
      unknown: z.array(z.string()),
    }),
  ),
});
export type SafetyCheckResponse = z.infer<typeof SafetyCheckResponse>;

// ─── Agent service ↔ server wire format (agent/API.md) ───────────────────────

/** Server → agent: POST {AGENT_URL}/runs, header X-Agent-Secret. Agent answers 202. */
export const AgentRunRequest = z.object({
  runId: z.uuid(),
  groupId: z.uuid(),
  prompt: z.string(),
  budgetCents: z.number().int().nullable(),
  zipCode: z.string().nullable(),
  /** Base URL the agent calls for tools, e.g. http://server:3000/api */
  apiBaseUrl: z.string(),
  /** 15-minute app JWT for the run's user: Authorization: Bearer <runToken>. */
  runToken: z.string(),
});
export type AgentRunRequest = z.infer<typeof AgentRunRequest>;

/** Agent → server: POST /api/internal/agent-events, header X-Agent-Secret. */
export const AgentEvent = z.discriminatedUnion("type", [
  z.object({
    runId: z.uuid(),
    seq: z.number().int().min(0).max(SEQ_MAX),
    type: z.literal("step"),
    payload: AgentStep.omit({ seq: true, at: true }),
  }),
  z.object({
    runId: z.uuid(),
    seq: z.number().int().min(0).max(SEQ_MAX),
    type: z.literal("proposed"),
    payload: z.object({ plan: AgentPlan, meta: AgentRunMeta }),
  }),
  z.object({
    runId: z.uuid(),
    seq: z.number().int().min(0).max(SEQ_MAX),
    type: z.literal("failed"),
    payload: z.object({ message: text().max(500), meta: AgentRunMeta.optional() }),
  }),
]);
export type AgentEvent = z.infer<typeof AgentEvent>;
