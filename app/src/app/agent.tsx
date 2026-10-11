import type { AgentPlan, AgentRun, AgentStep } from "@contracts/agent";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { ApiError, errorMessage } from "@/api/client";
import {
  agentRunTimedOut,
  pickResumableRun,
  useAgentRun,
  useApplyAgentRun,
  useRecentAgentRuns,
  useStartAgentRun,
} from "@/api/hooks/agent";
import { AgentMealCard } from "@/components/AgentMealCard";
import { AgentStepList } from "@/components/AgentStepList";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { useToast } from "@/components/Toast";
import { AiLabel, Button, Card, Chip, Input } from "@/components/ui";
import { formatCentsRange } from "@/lib/format";
import { useRequiredGroupId } from "@/state/ActiveGroupContext";
import { useAuth } from "@/state/AuthContext";
import { colors, fontSize, spacing } from "@/theme";

export const DEFAULT_PROMPT =
  "Plan 3 dinners for this week. Use what's expiring first, keep it under $60, and make sure everyone can eat it.";
const BUDGETS: { label: string; cents: number | null }[] = [
  { label: "$40", cents: 4000 },
  { label: "$60", cents: 6000 },
  { label: "$80", cents: 8000 },
  { label: "No limit", cents: null },
];
/** Recorded-run replay: each gap between steps is replayed as it happened, capped at 3 s. */
export const REPLAY_GAP_CAP_MS = 3000;

function startError(e: unknown): string {
  if (e instanceof ApiError && e.code === "AGENT_UNAVAILABLE") return "The planning agent is offline right now.";
  return errorMessage(e);
}

function applyError(e: unknown): string {
  if (e instanceof ApiError && e.code === "RUN_NOT_PROPOSED") return "This plan was already added.";
  if (e instanceof ApiError && e.code === "PLAN_UNSAFE") return "The server's safety check rejected this plan. Try planning again.";
  return errorMessage(e);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

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

/** The safety line for meal i: perMeal[i] when it is that meal's entry (titles may repeat), else the first title match. */
function mealSafety(plan: AgentPlan, i: number) {
  const byIndex = plan.safety.perMeal[i];
  if (byIndex && byIndex.title === plan.meals[i].title) return byIndex;
  return plan.safety.perMeal.find((s) => s.title === plan.meals[i].title);
}

/** Pantry Agent: compose → running (live steps) → proposed (meal cards) → applied, or failed. `?replay=1` replays the last run. */
export default function AgentScreen() {
  const groupId = useRequiredGroupId();
  const { replay } = useLocalSearchParams<{ replay?: string }>();
  // Keyed by group: switching households mid-run starts clean and never asks group B for group A's run.
  return replay === "1" ? <ReplayFlow key={groupId} groupId={groupId} /> : <LiveFlow key={groupId} groupId={groupId} />;
}

function LiveFlow({ groupId }: { groupId: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [budget, setBudget] = useState<number | null>(6000);
  /** The run this sheet started, tagged with its group so a late answer can never attach to another household. */
  const [started, setStarted] = useState<{ groupId: string; runId: string } | null>(null);
  /** Once the user starts (or dismisses) something here, don't auto-resume an older run. */
  const [touched, setTouched] = useState(false);
  const starting = useRef(false);
  const recent = useRecentAgentRuns(groupId);
  const start = useStartAgentRun(groupId);

  // Reopening the sheet picks up my in-flight or just-proposed run ("You can close this; the agent keeps working").
  const resumable = touched ? null : pickResumableRun(recent.data, user?.id);
  const runId = (started?.groupId === groupId ? started.runId : null) ?? resumable?.id ?? null;
  const run = useAgentRun(groupId, runId);

  function startRun() {
    if (starting.current) return; // a double tap in one frame must not start two runs
    starting.current = true;
    setTouched(true);
    setStarted(null);
    start.mutate(
      { prompt: prompt.trim(), budgetCents: budget },
      {
        onSuccess: (res) => setStarted({ groupId, runId: res.runId }),
        onSettled: () => {
          starting.current = false;
        },
      },
    );
  }

  function newPlan() {
    setTouched(true);
    setStarted(null);
    start.reset();
  }

  const failed = (message: string) => (
    <Failed message={message} onRetry={startRun} onClose={() => router.back()} retrying={start.isPending} />
  );

  if (!runId) {
    // No agent on this server (AGENT_URL unset): say so plainly; retrying won't help.
    if (start.error instanceof ApiError && start.error.code === "NOT_CONFIGURED") return <NotSetUp onClose={() => router.back()} />;
    if (start.isError) return failed(startError(start.error));
    return (
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <AiLabel text="AI agent" />
        <Input
          label="What should we plan?"
          value={prompt}
          onChangeText={setPrompt}
          multiline
          maxLength={500}
          style={styles.prompt}
        />
        <Text style={styles.label}>Budget</Text>
        <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Budget">
          {BUDGETS.map((b) => (
            <Chip
              key={b.label}
              label={b.label}
              role="radio"
              selected={budget === b.cents}
              accessibilityLabel={`Budget ${b.label}`}
              onPress={() => setBudget(b.cents)}
            />
          ))}
        </View>
        <Button title="Run" loading={start.isPending} disabled={!prompt.trim()} onPress={startRun} accessibilityLabel="Run the planning agent" />
        <Text style={styles.muted}>The agent reads your cabinet, list and allergies, then proposes meals. Nothing is added until you say so.</Text>
      </ScrollView>
    );
  }

  if (run.isPending) return <Running steps={[]} onCancel={() => router.back()} />;
  // Full-screen error only when there's nothing to show; one failed poll keeps the steps on screen.
  if (run.isError && !run.data) return <ErrorState error={run.error} onRetry={() => void run.refetch()} title="Couldn't load the plan" />;
  const data = run.data;
  if (data.status === "running") {
    if (agentRunTimedOut(data)) return failed("The agent took too long.");
    return <Running steps={displaySteps(data.steps, data.status)} onCancel={() => router.back()} reconnecting={run.isError} />;
  }
  if (data.status === "failed") return failed(data.error ?? "The agent couldn't finish this plan.");
  return <PlanResult groupId={groupId} run={data} steps={displaySteps(data.steps, data.status)} onNewPlan={newPlan} />;
}

function Running({ steps, onCancel, reconnecting }: { steps: AgentStep[]; onCancel: () => void; reconnecting?: boolean }) {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <AiLabel text="AI agent" />
      <Text style={styles.heading} accessibilityRole="header">
        Planning your week…
      </Text>
      <Card>
        {steps.length ? (
          <AgentStepList steps={steps} announce />
        ) : (
          <AgentStepList steps={[{ seq: 0, id: "starting", label: "Starting the agent…", status: "running" }]} />
        )}
      </Card>
      {reconnecting ? (
        <Text style={styles.muted} accessibilityLiveRegion="polite">
          Connection hiccup, reconnecting…
        </Text>
      ) : null}
      <Text style={styles.muted}>This usually takes 15–30 seconds. You can close this; the agent keeps working.</Text>
      <Button title="Cancel" variant="secondary" onPress={onCancel} accessibilityLabel="Close; the agent keeps working" />
    </ScrollView>
  );
}

function Failed({ message, onRetry, onClose, retrying }: { message: string; onRetry: () => void; onClose: () => void; retrying?: boolean }) {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Card>
        <Text style={styles.heading} accessibilityRole="header">
          The agent couldn&apos;t finish
        </Text>
        <Text style={styles.error} accessibilityRole="alert">
          {message}
        </Text>
        <Button title="Try again" loading={retrying} onPress={onRetry} />
        <Button title="Close" variant="secondary" onPress={onClose} />
      </Card>
    </ScrollView>
  );
}

/** 503 NOT_CONFIGURED: this server has no meal-planning agent. */
function NotSetUp({ onClose }: { onClose: () => void }) {
  return (
    <EmptyState title="The meal planner isn't set up on this server" message="Everything else in GrocerEZ keeps working. Ask whoever runs your server to turn on the planning agent.">
      <Button title="Close" variant="secondary" onPress={onClose} />
    </EmptyState>
  );
}

/** Proposed (or already applied) plan: steps recap, meal cards, AI estimate, and the one write button. */
function PlanResult({
  groupId,
  run,
  steps,
  replayed,
  onNewPlan,
}: {
  groupId: string;
  run: AgentRun;
  steps: AgentStep[];
  replayed?: boolean;
  onNewPlan?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const apply = useApplyAgentRun(groupId);
  /** Set on the first tap and kept after success: a second tap in the same frame (or before the refetch) is ignored. */
  const applying = useRef(false);
  const plan = run.plan;
  if (!plan) return <ErrorState error={new Error("This run has no plan.")} title="No plan" />;

  const n = plan.missingItems.length;
  const applied = run.status === "applied";
  const title = applied ? "Already added" : n === 0 ? "Nothing to buy" : `Add ${plural(n, "item")} to the list`;

  function onApply() {
    if (applying.current) return;
    applying.current = true;
    apply.mutate(run.id, {
      onSuccess: (res) => {
        const skipped = res.skipped.length ? ` · ${res.skipped.length} skipped (already have)` : "";
        toast(`Added ${plural(res.added, "item")}${skipped}`);
        router.dismissTo("/");
      },
      onError: (e) => {
        applying.current = false;
        toast(applyError(e), { tone: "error" });
      },
    });
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <AiLabel text={replayed ? "AI agent · recorded run" : "AI agent"} />
      {steps.length ? (
        <Card>
          <AgentStepList steps={steps} />
        </Card>
      ) : null}
      <Text style={styles.heading} accessibilityRole="header">
        {plural(plan.meals.length, "dinner")} for this week
      </Text>
      {plan.summary ? <Text style={styles.body}>{plan.summary}</Text> : null}
      {plan.estimate ? (
        <Text style={styles.estimate} accessibilityLabel={`${formatCentsRange(plan.estimate.lowCents, plan.estimate.highCents, true)} to buy, AI estimate`}>
          ✨ {formatCentsRange(plan.estimate.lowCents, plan.estimate.highCents, true)} to buy · {plan.estimate.label}
        </Text>
      ) : null}
      {plan.meals.map((m, i) => (
        // Index keys: the model may repeat a title, and each card must keep its own safety line.
        <AgentMealCard key={i} meal={m} safety={mealSafety(plan, i)} />
      ))}
      <Button title={title} loading={apply.isPending} disabled={applied || n === 0 || apply.isPending} onPress={onApply} />
      {onNewPlan ? <Button title="Plan something else" variant="secondary" onPress={onNewPlan} /> : null}
      <Button title="Close" variant="ghost" onPress={() => router.back()} />
    </ScrollView>
  );
}

// ─── Recorded-run replay (spec §7.7) ─────────────────────────────────────────

function ReplayFlow({ groupId }: { groupId: string }) {
  const router = useRouter();
  const recent = useRecentAgentRuns(groupId);
  const picked = recent.data?.find((r) => r.status === "proposed" || r.status === "applied")?.id ?? null;
  // Snapshot the choice once: a newer run landing in the list mid-replay must not restart it.
  const [lockedId, setLockedId] = useState<string | null>(null);
  if (lockedId === null && picked !== null) setLockedId(picked);
  const runId = lockedId ?? picked;
  const run = useAgentRun(groupId, runId);

  if (!runId) {
    if (recent.isPending) return <LoadingState message="Finding the last run…" />;
    if (recent.isError) return <ErrorState error={recent.error} onRetry={() => void recent.refetch()} />;
    return (
      <EmptyState title="No recorded runs yet" message="Run “Plan our week” once, then long-press to replay it.">
        <Button title="Plan our week" onPress={() => router.replace("/agent")} />
      </EmptyState>
    );
  }
  if (run.isPending) return <LoadingState message="Loading the recorded run…" />;
  if (run.isError && !run.data) return <ErrorState error={run.error} onRetry={() => void run.refetch()} />;
  return <Replayer key={run.data.id} groupId={groupId} run={run.data} />;
}

/** Gaps between consecutive steps (from the run's start), each capped at 3 s. */
export function replayDelays(steps: Pick<AgentStep, "at">[], startedAt: string, cap = REPLAY_GAP_CAP_MS): number[] {
  let prev = Date.parse(startedAt);
  return steps.map((s) => {
    const t = Date.parse(s.at);
    const gap = Number.isFinite(t) && Number.isFinite(prev) ? Math.max(0, t - prev) : 0;
    if (Number.isFinite(t)) prev = t;
    return Math.min(gap, cap);
  });
}

function Replayer({ groupId, run }: { groupId: string; run: AgentRun }) {
  const router = useRouter();
  // Snapshot once: socket refetches of this run must not restart the replay.
  const [steps] = useState(() => displaySteps(run.steps, run.status));
  const [delays] = useState(() => replayDelays(steps, run.createdAt));
  const [shown, setShown] = useState(0);

  useEffect(() => {
    let i = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const next = () => {
      if (i >= delays.length) return;
      timer = setTimeout(() => {
        i += 1;
        setShown(i);
        next();
      }, delays[i]);
    };
    next();
    return () => clearTimeout(timer);
  }, [delays]);

  if (shown < steps.length) {
    // Steps already "arrived" keep their (settled) status; the next one spins until its time comes.
    const visible = [...steps.slice(0, shown), { ...steps[shown], status: "running" as const }];
    return <Running steps={visible} onCancel={() => router.back()} />;
  }
  return <PlanResult groupId={groupId} run={run} steps={steps} replayed />;
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  prompt: { minHeight: 110, textAlignVertical: "top" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  heading: { fontSize: fontSize.lg, fontWeight: "800", color: colors.text },
  label: { fontSize: fontSize.sm, color: colors.textMuted, fontWeight: "600" },
  body: { fontSize: fontSize.md, color: colors.text },
  muted: { fontSize: fontSize.sm, color: colors.textMuted },
  estimate: { fontSize: fontSize.md, fontWeight: "700", color: colors.ai },
  error: { fontSize: fontSize.md, color: colors.danger },
});
