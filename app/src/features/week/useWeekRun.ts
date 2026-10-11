import type { AgentRun, AgentStep, PlanMeal } from "@contracts/agent";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { ApiError, errorMessage } from "@/api/client";
import {
  agentRunTimedOut,
  displaySteps,
  pickResumableRun,
  useAgentRun,
  useApplyAgentRun,
  useRecentAgentRuns,
  useStartAgentRun,
} from "@/api/hooks/agent";
import { keys } from "@/api/keys";
import { useToast } from "@/components/ui";
import { plural } from "@/lib/format";
import { useAuth } from "@/state/AuthContext";

import { dayLabels } from "./weekDates";

export type WeekRunKind = "plan" | "swap";

/** A meal found mid-run (step.preview) before the plan is proposed: rows fill in "pencil" as recipes are found. */
export type DayPreview = { title: string; site: string | null };

export type WeekRunView =
  | { state: "idle" }
  | { state: "starting"; dates: string[] }
  | { state: "running"; run: AgentRun | null; steps: AgentStep[]; dates: string[]; previews: Map<string, DayPreview>; reconnecting: boolean }
  | { state: "proposed"; run: AgentRun; steps: AgentStep[]; proposed: Map<string, PlanMeal>; toBuy: number }
  | { state: "failed"; message: string; notConfigured: boolean };

const BUDGET_CENTS = 6000;

/** The prompt for a run over these dates (the server/agent only need the dates; the prompt is the household's ask). */
export function weekPrompt(dates: readonly string[], kind: WeekRunKind): string {
  const days = dates.map((d) => dayLabels(d).short).join(", ");
  const ask = kind === "swap" ? `Find a different dinner for ${days}.` : `Plan ${plural(dates.length, "dinner")} for ${days}.`;
  return `${ask} Use what's expiring first, keep it under $60, and make sure everyone can eat it.`;
}

/** Previews from step events, by date (last one wins: a revised meal replaces its first find). */
export function previewsByDate(steps: readonly AgentStep[]): Map<string, DayPreview> {
  const out = new Map<string, DayPreview>();
  for (const s of steps) if (s.preview?.date) out.set(s.preview.date, { title: s.preview.title, site: s.preview.site });
  return out;
}

/** Proposed meals by their planned date (meals without a date are skipped: they can't go on the calendar). */
export function proposedByDate(run: AgentRun): Map<string, PlanMeal> {
  return new Map((run.plan?.meals ?? []).filter((m) => m.date).map((m) => [m.date as string, m]));
}

/**
 * The Pantry Agent run behind the Week sheet. Same guarantees as the "Plan our week" modal (breaker fixes):
 * reopening resumes my in-flight/just-proposed run; a run is tagged with its group (the sheet is also keyed by group);
 * double taps on Plan and Save are ignored; a run stuck past the server's timeout stops polling and reads as failed.
 */
export function useWeekRun(groupId: string) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { show: toast } = useToast();
  const recent = useRecentAgentRuns(groupId);
  const start = useStartAgentRun(groupId);
  const apply = useApplyAgentRun(groupId);

  const [started, setStarted] = useState<{ groupId: string; runId: string; dates: string[] } | null>(null);
  const [pendingDates, setPendingDates] = useState<string[]>([]);
  /** After the user starts, saves or dismisses something here, don't auto-resume an older run. */
  const [touched, setTouched] = useState(false);
  const starting = useRef(false);
  const applying = useRef(false);
  /** Set synchronously on Save (mutation state lags a render), so Discard can disable right away. */
  const [saving, setSaving] = useState(false);
  const lastStart = useRef<{ dates: string[]; kind: WeekRunKind; replacePlannedMealId?: string } | null>(null);

  const resumable = touched ? null : pickResumableRun(recent.data, user?.id);
  const mine = started?.groupId === groupId ? started : null;
  const runId = mine?.runId ?? resumable?.id ?? null;
  const run = useAgentRun(groupId, runId);

  function begin(dates: string[], kind: WeekRunKind, replacePlannedMealId?: string) {
    if (starting.current || dates.length === 0) return; // a double tap must not start two runs
    starting.current = true;
    lastStart.current = { dates, kind, replacePlannedMealId };
    setTouched(true);
    setStarted(null);
    setPendingDates(dates);
    start.mutate(
      { prompt: weekPrompt(dates, kind), budgetCents: BUDGET_CENTS, dates, ...(replacePlannedMealId ? { replacePlannedMealId } : {}) },
      {
        onSuccess: (res) => setStarted({ groupId, runId: res.runId, dates }),
        onSettled: () => {
          starting.current = false;
        },
      },
    );
  }

  function retry() {
    const last = lastStart.current;
    if (last) begin(last.dates, last.kind, last.replacePlannedMealId);
  }

  /** Forget the current run (after saving, or "Dismiss" on a failure / proposal). */
  function dismiss() {
    setTouched(true);
    setStarted(null);
    setPendingDates([]);
    start.reset();
    applying.current = false;
    setSaving(false);
  }

  function save() {
    const current = run.data;
    if (!current || applying.current) return;
    applying.current = true;
    setSaving(true);
    apply.mutate(current.id, {
      onSuccess: async (res) => {
        const saved = res.planned ?? proposedByDate(current).size;
        const skipped = res.skipped.length ? ` · ${res.skipped.length} skipped (already have)` : "";
        toast(`Saved ${plural(saved, "dinner")} · added ${plural(res.added, "item")}${skipped}`);
        // Show the saved rows before letting go of the proposal, so days don't blink empty.
        await qc.invalidateQueries({ queryKey: keys.mealPlans(groupId) });
        dismiss();
      },
      onError: (e) => {
        applying.current = false;
        setSaving(false);
        toast(
          e instanceof ApiError && e.code === "PLAN_UNSAFE"
            ? "The server's safety check rejected this plan. Try planning again."
            : e instanceof ApiError && e.code === "RUN_NOT_PROPOSED"
              ? "This plan was already saved."
              : errorMessage(e),
          { tone: "error" },
        );
      },
    });
  }

  let view: WeekRunView = { state: "idle" };
  if (!runId) {
    if (start.isPending) view = { state: "starting", dates: pendingDates };
    else if (start.isError) {
      const notConfigured = start.error instanceof ApiError && start.error.code === "NOT_CONFIGURED";
      view = {
        state: "failed",
        notConfigured,
        message: notConfigured
          ? "The meal planner isn't set up on this server."
          : start.error instanceof ApiError && start.error.code === "AGENT_UNAVAILABLE"
            ? "The planning agent is offline right now."
            : errorMessage(start.error),
      };
    }
  } else if (run.isPending) {
    view = { state: "running", run: null, steps: [], dates: mine?.dates ?? pendingDates, previews: new Map(), reconnecting: false };
  } else if (run.isError && !run.data) {
    view = { state: "failed", notConfigured: false, message: `Couldn't load the plan: ${errorMessage(run.error)}` };
  } else if (run.data) {
    const data = run.data;
    const steps = displaySteps(data.steps, data.status);
    if (data.status === "running") {
      view = agentRunTimedOut(data)
        ? { state: "failed", notConfigured: false, message: "The agent took too long." }
        : { state: "running", run: data, steps, dates: mine?.dates ?? [], previews: previewsByDate(steps), reconnecting: run.isError };
    } else if (data.status === "failed") {
      view = { state: "failed", notConfigured: false, message: data.error ?? "The agent couldn't finish this plan." };
    } else if (data.status === "proposed") {
      view = { state: "proposed", run: data, steps, proposed: proposedByDate(data), toBuy: data.plan?.missingItems.length ?? 0 };
    }
    // `applied` (saved here or elsewhere): the saved rows come from the meal plan; nothing left to show.
  }

  return { view, begin, retry, dismiss, save, saving };
}
