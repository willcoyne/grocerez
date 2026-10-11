import type {
  AgentRun,
  AgentRunSummary,
  AgentStep,
  ApplyAgentRunResponse,
  StartAgentRunBody,
  StartAgentRunResponse,
} from "@contracts/agent";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";

import { api } from "../client";
import { keys } from "../keys";

/** How often a running run is polled. The socket ("agent:changed") usually beats it; polling covers a dropped socket. */
export const AGENT_POLL_MS = 1500;
/** The server fails a run after 180 s; past this (+10 s slack) a still-`running` run is treated as stuck. */
export const AGENT_RUN_TIMEOUT_MS = 190_000;
/** A proposed plan the user walked away from is reopened for this long. */
export const RESUME_PROPOSED_MS = 30 * 60_000;

type RunTimes = Pick<AgentRunSummary, "status" | "createdAt">;

/**
 * Steps in display order. Once the run is over, a step left `running` (e.g. the agent's last "done" event arrived
 * after the plan and was rejected) is shown as finished, never as an endless spinner.
 */
export function displaySteps(steps: AgentStep[], runStatus: AgentRun["status"]): AgentStep[] {
  const sorted = [...steps].sort((a, b) => a.seq - b.seq);
  if (runStatus === "running") return sorted;
  const settled = runStatus === "failed" ? "failed" : "done";
  return sorted.map((s) => (s.status === "running" ? { ...s, status: settled } : s));
}

/** True when a run still says `running` long after the server should have finished or failed it. */
export function agentRunTimedOut(run: RunTimes, now = Date.now()): boolean {
  return run.status === "running" && now - Date.parse(run.createdAt) > AGENT_RUN_TIMEOUT_MS;
}

/**
 * The run to reopen when "Plan our week" is opened again: the group's newest run, if it's mine and either still
 * running (within the timeout) or a recently proposed plan. Otherwise the compose form.
 */
export function pickResumableRun(
  runs: AgentRunSummary[] | undefined,
  userId: string | undefined,
  now = Date.now(),
): AgentRunSummary | null {
  const newest = runs?.[0];
  if (!newest || !userId || newest.userId !== userId) return null;
  if (newest.status === "running") return agentRunTimedOut(newest, now) ? null : newest;
  if (newest.status === "proposed") return now - Date.parse(newest.updatedAt) <= RESUME_PROPOSED_MS ? newest : null;
  return null;
}

/**
 * Start a Pantry Agent run → 202 {runId}. Never retried automatically (rate-limited 10/hour/group).
 * Errors: 503 NOT_CONFIGURED (no agent on this server → the sheet says the planner isn't set up), 503 AGENT_UNAVAILABLE, 429.
 */
export function useStartAgentRun(groupId: string) {
  return useMutation({
    mutationFn: (body: StartAgentRunBody) =>
      api<z.infer<typeof StartAgentRunResponse>>(`/groups/${groupId}/agent/runs`, { method: "POST", body }),
    retry: false,
  });
}

/** One run with its steps. Polls every 1.5 s while the agent is still working, then stops (also once it's stuck). */
export function useAgentRun(groupId: string, runId: string | null) {
  return useQuery({
    queryKey: keys.agentRun(groupId, runId ?? ""),
    queryFn: () => api<AgentRun>(`/groups/${groupId}/agent/runs/${runId}`),
    enabled: !!groupId && !!runId,
    refetchInterval: (q) => {
      const run = q.state.data;
      return run?.status === "running" && !agentRunTimedOut(run) ? AGENT_POLL_MS : false;
    },
  });
}

/**
 * Put the plan's missing items on the shopping list. The server re-checks safety (422 PLAN_UNSAFE) and claims the run
 * once (409 RUN_NOT_PROPOSED on a second tap). Success or not, the list and the run are refetched afterwards.
 */
export function useApplyAgentRun(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) =>
      api<ApplyAgentRunResponse>(`/groups/${groupId}/agent/runs/${runId}/apply`, { method: "POST", body: {} }),
    retry: false,
    onSettled: (_data, _error, runId) => {
      void qc.invalidateQueries({ queryKey: keys.shoppingList(groupId) });
      void qc.invalidateQueries({ queryKey: keys.agentRun(groupId, runId) });
      void qc.invalidateQueries({ queryKey: keys.agentRuns(groupId), exact: true });
      // Apply also writes the run's planned meals (spec §13).
      void qc.invalidateQueries({ queryKey: keys.mealPlans(groupId) });
    },
  });
}

/** Recent runs, newest first, without steps. The recorded-run replay uses it to find the last proposed/applied run. */
export function useRecentAgentRuns(groupId: string, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: keys.agentRuns(groupId),
    queryFn: () => api<AgentRunSummary[]>(`/groups/${groupId}/agent/runs`, { query: { limit: 5 } }),
    enabled: !!groupId && (opts.enabled ?? true),
  });
}
