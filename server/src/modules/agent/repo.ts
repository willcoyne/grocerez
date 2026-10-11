import type { Prisma } from "../../../generated/prisma/client.js";
import type { AgentPlan, AgentStep } from "../../contracts/agent.js";
import type { Allergen, Diet } from "../../contracts/dietary.js";
import { prisma, type Db } from "../../db.js";

type RunOwner = { id: string; groupId: string; userId: string };
type StepInput = Pick<AgentStep, "id" | "label" | "status" | "detail" | "preview">;

const summarySelect = {
  id: true, groupId: true, userId: true, prompt: true, budgetCents: true, status: true, plan: true, error: true, meta: true,
  createdAt: true, updatedAt: true, appliedAt: true,
} as const;

/** Every group-facing function takes groupId and filters by it. The internal (agent-event) writes are keyed by run id. */
export const agentRepo = {
  /** Each member's display name, allergens and diets (safety check + household tool). */
  members: async (groupId: string, db: Db = prisma) => {
    const rows = await db.groupMember.findMany({
      where: { groupId },
      orderBy: { joinedAt: "asc" },
      select: {
        user: {
          select: {
            displayName: true,
            allergens: { select: { allergen: true }, orderBy: { allergen: "asc" } },
            diets: { select: { diet: true }, orderBy: { diet: "asc" } },
          },
        },
      },
    });
    return rows.map((r) => ({
      displayName: r.user.displayName,
      allergens: r.user.allergens.map((a) => a.allergen as Allergen),
      diets: r.user.diets.map((d) => d.diet as Diet),
    }));
  },

  create: (groupId: string, userId: string, prompt: string, budgetCents: number | null, replacePlannedMealId: string | null = null) =>
    prisma.agentRun.create({ data: { groupId, userId, prompt, budgetCents, replacePlannedMealId, isSwap: replacePlannedMealId !== null }, select: { id: true } }),

  find: (groupId: string, id: string, db: Db = prisma) => db.agentRun.findFirst({ where: { id, groupId } }),

  findOwner: (id: string): Promise<RunOwner | null> =>
    prisma.agentRun.findUnique({ where: { id }, select: { id: true, groupId: true, userId: true } }),

  list: (groupId: string, limit: number) =>
    prisma.agentRun.findMany({ where: { groupId }, orderBy: { createdAt: "desc" }, take: limit, select: summarySelect }),

  /**
   * Atomic step upsert in ONE UPDATE (no read-modify-write in JS, so concurrent events can't lose steps).
   * A step keeps the position (seq) it was first seen at; a later event for the same id replaces label/status/detail/at,
   * unless it is older (lower event seq) than the one already applied. `_ev` (last applied event seq) is internal and
   * stripped on read. Only touches running runs; returns null otherwise.
   */
  upsertStep: async (runId: string, seq: number, step: StepInput, at: string): Promise<RunOwner | null> => {
    const incoming = JSON.stringify({
      seq, _ev: seq, id: step.id, label: step.label, status: step.status, ...(step.detail !== undefined ? { detail: step.detail } : {}),
      // Early meal peek (spec §13) so the Week sheet can fill a day before `proposed`.
      ...(step.preview !== undefined ? { preview: step.preview } : {}), at,
    });
    const rows = await prisma.$queryRaw<RunOwner[]>`
      UPDATE agent_runs r
      SET steps = (
            SELECT COALESCE(jsonb_agg(s ORDER BY (s->>'seq')::int, s->>'id'), '[]'::jsonb)
            FROM (
              SELECT e AS s FROM jsonb_array_elements(r.steps) e WHERE e->>'id' <> ${step.id}
              UNION ALL
              SELECT CASE
                       WHEN old.e IS NULL THEN ${incoming}::jsonb
                       WHEN COALESCE((old.e->>'_ev')::int, (old.e->>'seq')::int) > ${seq} THEN old.e
                       -- a later event keeps an earlier preview unless it sends its own
                       ELSE CASE WHEN old.e ? 'preview' THEN jsonb_build_object('preview', old.e->'preview') ELSE '{}'::jsonb END
                            || ${incoming}::jsonb
                            || jsonb_build_object('seq', LEAST((old.e->>'seq')::int, ${seq}))
                     END
              FROM (SELECT (SELECT e FROM jsonb_array_elements(r.steps) e WHERE e->>'id' = ${step.id} LIMIT 1) AS e) old
            ) x
          ),
          updated_at = now()
      WHERE r.id = ${runId}::uuid AND r.status = 'running'
      RETURNING r.id, r.group_id AS "groupId", r.user_id AS "userId"`;
    return rows[0] ?? null;
  },

  /** running → proposed. Returns false if the run wasn't running. */
  propose: async (runId: string, plan: AgentPlan, meta: unknown) =>
    (
      await prisma.agentRun.updateMany({
        where: { id: runId, status: "running" },
        data: { status: "proposed", plan: plan as Prisma.InputJsonValue, meta: meta as Prisma.InputJsonValue },
      })
    ).count === 1,

  /** running → failed. Returns false if the run wasn't running. */
  fail: async (runId: string, error: string, meta?: unknown) =>
    (
      await prisma.agentRun.updateMany({
        where: { id: runId, status: "running" },
        data: { status: "failed", error, ...(meta !== undefined ? { meta: meta as Prisma.InputJsonValue } : {}) },
      })
    ).count === 1,

  /** Fails every run still running that started before `before`; returns them (for emits). */
  failStale: (before: Date, error: string) =>
    prisma.$queryRaw<RunOwner[]>`
      UPDATE agent_runs SET status = 'failed', error = ${error}, updated_at = now()
      WHERE status = 'running' AND created_at < ${before}
      RETURNING id, group_id AS "groupId", user_id AS "userId"`,

  /** Every run still running (boot: re-arm their timeouts). */
  running: () => prisma.agentRun.findMany({ where: { status: "running" }, select: { id: true, createdAt: true } }),

  /** proposed → applied, the double-tap guard inside apply's transaction. */
  claimApply: async (db: Db, groupId: string, runId: string) =>
    (
      await db.agentRun.updateMany({
        where: { id: runId, groupId, status: "proposed" },
        data: { status: "applied", appliedAt: new Date() },
      })
    ).count === 1,
};
