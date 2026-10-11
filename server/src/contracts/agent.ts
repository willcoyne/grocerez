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
  /**
   * The web recipe this meal comes from (Tavily search → the page's schema.org Recipe JSON-LD). null = no recipe
   * found, the model wrote it (the app labels it "AI-created"). We show ingredients + our short steps and link out
   * for the full method; we don't copy the site's instructions.
   */
  source: z
    .object({
      url: text().max(2000).regex(/^https:\/\//, "must be an https URL"),
      /** Publisher shown in the citation, e.g. "Serious Eats". */
      site: text().trim().min(1).max(80),
      /** The recipe's title on that site. */
      title: text().trim().min(1).max(200),
      imageUrl: text().max(2000).regex(/^https:\/\//, "must be an https URL").nullable(),
    })
    .nullable()
    .default(null),
  /** The source's ingredient lines with quantities ("2 cups cooked rice"), for display. Empty when there's no source. */
  ingredientLines: z.array(text().trim().min(1).max(200)).max(40).default([]),
  /** Calendar date this dinner is planned for (spec §13). null for plans made before the week calendar. */
  date: CalendarDate.nullable().default(null),
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
  /** Early peek at a meal as soon as it's found (spec §13), so the Week sheet can fill a day before the plan is proposed. */
  preview: z
    .object({ date: CalendarDate.nullable(), title: text().trim().min(1).max(120), site: text().trim().min(1).max(80).nullable() })
    .optional(),
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
  /** Dates to plan dinners for (spec §13). Omitted = the next 3 days starting today in the household's time zone. */
  dates: z.array(CalendarDate).min(1).max(7).optional(),
  /** Swap: replace this planned meal (its date is the only date planned). */
  replacePlannedMealId: z.uuid().optional(),
});
export type StartAgentRunBody = z.infer<typeof StartAgentRunBody>;

export const StartAgentRunResponse = z.object({ runId: z.uuid() });

export const AgentRunsQuery = z.object({ limit: z.coerce.number().int().min(1).max(20).default(5) });
export const AgentRunParams = z.object({ groupId: z.uuid(), runId: z.uuid() });

export const ApplyAgentRunResponse = z.object({
  added: z.number().int(),
  skipped: z.array(z.object({ name: z.string(), reason: z.enum(["in_cabinet", "on_list"]) })),
  items: z.array(ShoppingListItem),
  /** Planned meals written to the week calendar (spec §13). */
  planned: z.number().int().optional(),
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
        /** The cited recipe's lines (same bounds as PlanMeal.ingredientLines): keyword-scanned only, never `unknown`. */
        ingredientLines: z.array(text().trim().min(1).max(200)).max(40).optional(),
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
  /** Dates to plan, one dinner each (spec §13). The agent sets PlanMeal.date to these. */
  dates: z.array(CalendarDate).max(7).default([]),
  /** Meals already planned on nearby dates, so the agent avoids repeats. */
  alreadyPlanned: z.array(z.object({ date: CalendarDate, title: z.string() })).max(31).default([]),
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

// ─── Recipe index (spec §12): crawled once, embedded with Akamai, searched by find_recipe before Tavily ─────

const httpsUrl = () => text().max(2000).regex(/^https:\/\//, "must be an https URL");

/** One crawled recipe as the crawler sends it (parsed from the page's schema.org Recipe JSON-LD). */
export const IndexedRecipe = z.object({
  url: httpsUrl(),
  site: text().trim().min(1).max(80),
  title: text().trim().min(1).max(200),
  imageUrl: httpsUrl().nullable(),
  minutes: z.number().int().min(1).max(1440).nullable(),
  servings: z.number().int().min(1).max(50).nullable(),
  /** Source lines with quantities, as published. */
  ingredientLines: z.array(text().trim().min(1).max(200)).min(1).max(40),
  /** Cleaned generic names ("Mozzarella"), from the agent's deterministic cleaner. */
  ingredients: z.array(text().trim().min(1).max(120)).min(1).max(40),
});
export type IndexedRecipe = z.infer<typeof IndexedRecipe>;

/** Crawler → server: POST /api/internal/recipes (X-Agent-Secret). Upsert by url; the server computes allergens and embeddings. */
export const RecipeIngestBody = z.object({ recipes: z.array(IndexedRecipe).min(1).max(100) });
export const RecipeIngestResponse = z.object({ upserted: z.number().int(), embedded: z.number().int() });

/** Agent (run token) → server: POST /groups/:gid/agent/recipes/search. */
export const RecipeSearchBody = z.object({
  /** Free-text idea, e.g. "lemon chicken with spinach rice". Embedded server-side with Akamai. */
  query: text().trim().min(1).max(200),
  /** Cabinet items to prefer (expiring first); boosts recipes that use them. */
  mustUse: z.array(text().trim().min(1).max(120)).max(10).default([]),
  limit: z.number().int().min(1).max(10).default(6),
});
export type RecipeSearchBody = z.infer<typeof RecipeSearchBody>;

export const RecipeSearchResponse = z.object({
  /**
   * Best matches first. Recipes whose precomputed allergens hit ANY member's allergens, or whose lines conflict with
   * a member's diet, are already excluded; the agent still runs the full safety check before using one.
   */
  recipes: z.array(
    IndexedRecipe.extend({
      id: z.uuid(),
      /** Cosine distance to the query (0 = identical). */
      distance: z.number(),
      /** Which mustUse items it uses. */
      uses: z.array(z.string()),
    }),
  ),
  /** false when embeddings aren't configured or the index is empty → the agent falls back to Tavily. */
  available: z.boolean(),
});
export type RecipeSearchResponse = z.infer<typeof RecipeSearchResponse>;
