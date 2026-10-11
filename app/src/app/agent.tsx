import type { AgentRun, AgentStep } from "@contracts/agent";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { ApiError, errorMessage } from "@/api/client";
import { useAgentRun, useApplyAgentRun, useRecentAgentRuns, useStartAgentRun } from "@/api/hooks/agent";
import { AgentMealCard } from "@/components/AgentMealCard";
import { AgentStepList } from "@/components/AgentStepList";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { useToast } from "@/components/Toast";
import { AiLabel, Button, Card, Chip, Input } from "@/components/ui";
import { formatCentsRange } from "@/lib/format";
import { useRequiredGroupId } from "@/state/ActiveGroupContext";
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

/** Pantry Agent: compose → running (live steps) → proposed (meal cards) → applied, or failed. `?replay=1` replays the last run. */
export default function AgentScreen() {
  const groupId = useRequiredGroupId();
  const { replay } = useLocalSearchParams<{ replay?: string }>();
  return replay === "1" ? <ReplayFlow groupId={groupId} /> : <LiveFlow groupId={groupId} />;
}

function LiveFlow({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [budget, setBudget] = useState<number | null>(6000);
  const [runId, setRunId] = useState<string | null>(null);
  const start = useStartAgentRun(groupId);
  const run = useAgentRun(groupId, runId);

  function startRun() {
    setRunId(null);
    start.mutate(
      { prompt: prompt.trim(), budgetCents: budget },
      {
        onSuccess: (res) => setRunId(res.runId),
        // No agent on this server: the quick recipe screen is the fallback.
        onError: (e) => {
          if (e instanceof ApiError && e.code === "NOT_CONFIGURED") router.replace("/recipes");
        },
      },
    );
  }

  const failed = (message: string) => (
    <Failed message={message} onRetry={startRun} onRecipes={() => router.replace("/recipes")} retrying={start.isPending} />
  );

  if (!runId) {
    if (start.isError && !(start.error instanceof ApiError && start.error.code === "NOT_CONFIGURED")) {
      return failed(startError(start.error));
    }
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
        <View style={styles.chips}>
          {BUDGETS.map((b) => (
            <Chip
              key={b.label}
              label={b.label}
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
  if (run.isError) return <ErrorState error={run.error} onRetry={() => void run.refetch()} title="Couldn't load the plan" />;
  const data = run.data;
  if (data.status === "running") return <Running steps={sortSteps(data.steps)} onCancel={() => router.back()} />;
  if (data.status === "failed") return failed(data.error ?? "The agent couldn't finish this plan.");
  return <PlanResult groupId={groupId} run={data} steps={sortSteps(data.steps)} />;
}

const sortSteps = (steps: AgentStep[]) => [...steps].sort((a, b) => a.seq - b.seq);

function Running({ steps, onCancel }: { steps: AgentStep[]; onCancel: () => void }) {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <AiLabel text="AI agent" />
      <Text style={styles.heading} accessibilityRole="header">
        Planning your week…
      </Text>
      <Card>
        {steps.length ? (
          <AgentStepList steps={steps} />
        ) : (
          <AgentStepList steps={[{ seq: 0, id: "starting", label: "Starting the agent…", status: "running" }]} />
        )}
      </Card>
      <Text style={styles.muted}>This usually takes 15–30 seconds. You can close this; the agent keeps working.</Text>
      <Button title="Cancel" variant="secondary" onPress={onCancel} accessibilityLabel="Close; the agent keeps working" />
    </ScrollView>
  );
}

function Failed({ message, onRetry, onRecipes, retrying }: { message: string; onRetry: () => void; onRecipes: () => void; retrying?: boolean }) {
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
        <Button title="Use quick recipes instead" variant="secondary" onPress={onRecipes} />
      </Card>
    </ScrollView>
  );
}

/** Proposed (or already applied) plan: steps recap, meal cards, AI estimate, and the one write button. */
function PlanResult({ groupId, run, steps, replayed }: { groupId: string; run: AgentRun; steps: AgentStep[]; replayed?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const apply = useApplyAgentRun(groupId);
  const plan = run.plan;
  if (!plan) return <ErrorState error={new Error("This run has no plan.")} title="No plan" />;

  const n = plan.missingItems.length;
  const applied = run.status === "applied";
  const title = applied ? "Already added" : n === 0 ? "Nothing to buy" : `Add ${plural(n, "item")} to the list`;

  function onApply() {
    apply.mutate(run.id, {
      onSuccess: (res) => {
        const skipped = res.skipped.length ? ` · ${res.skipped.length} skipped (already have)` : "";
        toast(`Added ${plural(res.added, "item")}${skipped}`);
        router.dismissTo("/");
      },
      onError: (e) => toast(applyError(e), { tone: "error" }),
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
      {plan.meals.map((m) => (
        <AgentMealCard key={m.title} meal={m} safety={plan.safety.perMeal.find((s) => s.title === m.title)} />
      ))}
      <Button title={title} loading={apply.isPending} disabled={applied || n === 0 || apply.isPending} onPress={onApply} />
      <Button title="Close" variant="ghost" onPress={() => router.back()} />
    </ScrollView>
  );
}

// ─── Recorded-run replay (spec §7.7) ─────────────────────────────────────────

function ReplayFlow({ groupId }: { groupId: string }) {
  const router = useRouter();
  const recent = useRecentAgentRuns(groupId);
  const last = recent.data?.find((r) => r.status === "proposed" || r.status === "applied") ?? null;
  const run = useAgentRun(groupId, last?.id ?? null);

  if (recent.isPending) return <LoadingState message="Finding the last run…" />;
  if (recent.isError) return <ErrorState error={recent.error} onRetry={() => void recent.refetch()} />;
  if (!last) {
    return (
      <EmptyState title="No recorded runs yet" message="Run “Plan our week” once, then long-press to replay it.">
        <Button title="Plan our week" onPress={() => router.replace("/agent")} />
      </EmptyState>
    );
  }
  if (run.isPending) return <LoadingState message="Loading the recorded run…" />;
  if (run.isError) return <ErrorState error={run.error} onRetry={() => void run.refetch()} />;
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
  const [steps] = useState(() => sortSteps(run.steps));
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
    // Steps already "arrived" keep their recorded status; the next one spins until its time comes.
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
