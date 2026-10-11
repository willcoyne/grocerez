import type { AgentPlan, AgentRun, AgentStep } from "@contracts/agent";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, errorMessage } from "@/api/client";
import {
  agentRunTimedOut,
  pickResumableRun,
  useAgentRun,
  useApplyAgentRun,
  useRecentAgentRuns,
  useStartAgentRun,
} from "@/api/hooks/agent";
import { AgentChoiceChips, AgentPromptInput } from "@/components/AgentControls";
import { AgentMealCard } from "@/components/AgentMealCard";
import { AgentStepList } from "@/components/AgentStepList";
import { AiLabel, AppText, Button, Card, DashedEmpty, ErrorState, LoadingState, SectionLabel, useToast } from "@/components/ui";
import { formatCentsRange } from "@/lib/format";
import { useRequiredGroupId } from "@/state/ActiveGroupContext";
import { useAuth } from "@/state/AuthContext";
import { color, space } from "@/theme";

export const DEFAULT_PROMPT =
  "Plan 3 dinners for this week. Use what's expiring first, keep it under $60, and make sure everyone can eat it.";
const BUDGETS: { label: string; value: number | null }[] = [
  { label: "$40", value: 4000 },
  { label: "$60", value: 6000 },
  { label: "$80", value: 8000 },
  { label: "No limit", value: null },
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

/** The safety entry for meal i: perMeal[i] when it is that meal's entry (titles may repeat), else the first title match. */
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
  return (
    <View style={styles.screen} testID="screen-agent">
      {replay === "1" ? <ReplayFlow key={groupId} groupId={groupId} /> : <LiveFlow key={groupId} groupId={groupId} />}
    </View>
  );
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

  const close = () => router.back();
  const failed = (message: string) => <Failed message={message} onRetry={startRun} onClose={close} retrying={start.isPending} />;

  if (!runId) {
    // No agent on this server (AGENT_URL unset): say so plainly; retrying won't help.
    if (start.error instanceof ApiError && start.error.code === "NOT_CONFIGURED") return <NotSetUp onClose={close} />;
    if (start.isError) return failed(startError(start.error));
    return (
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <AiLabel text="Pantry Agent" />
        <AppText variant="bodyS" color="ink2">
          The agent reads your cabinet, list and everyone&apos;s allergies, finds real recipes, and proposes dinners. Nothing
          is added to the list until you say so.
        </AppText>
        <AgentPromptInput label="What should we plan?" value={prompt} onChangeText={setPrompt} />
        <AgentChoiceChips label="Budget" options={BUDGETS} value={budget} onChange={setBudget} />
        <Button
          label="Run"
          size="lg"
          fullWidth
          loading={start.isPending}
          disabled={!prompt.trim()}
          onPress={startRun}
          accessibilityLabel="Run the planning agent"
        />
      </ScrollView>
    );
  }

  if (run.isPending) return <Running steps={[]} onCancel={close} />;
  // Full-screen error only when there's nothing to show; one failed poll keeps the steps on screen.
  if (run.isError && !run.data) {
    return (
      <View style={styles.content}>
        <AppText variant="bodyL" weight="heavy">
          Couldn&apos;t load the plan
        </AppText>
        <ErrorState message={errorMessage(run.error)} onRetry={() => void run.refetch()} />
      </View>
    );
  }
  const data = run.data;
  if (data.status === "running") {
    if (agentRunTimedOut(data)) return failed("The agent took too long.");
    return <Running steps={displaySteps(data.steps, data.status)} onCancel={close} reconnecting={run.isError} />;
  }
  if (data.status === "failed") return failed(data.error ?? "The agent couldn't finish this plan.");
  return <PlanResult groupId={groupId} run={data} steps={displaySteps(data.steps, data.status)} onNewPlan={newPlan} />;
}

function Running({ steps, onCancel, reconnecting }: { steps: AgentStep[]; onCancel: () => void; reconnecting?: boolean }) {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <AiLabel text="Pantry Agent" />
      <View style={styles.titleBlock}>
        <AppText variant="tabTitle" accessibilityRole="header">
          Planning your week…
        </AppText>
        <AppText variant="caption" color="muted">
          Usually 15–30 seconds. You can close this; the agent keeps working.
        </AppText>
      </View>
      <Card style={styles.steps}>
        {steps.length ? (
          <AgentStepList steps={steps} announce />
        ) : (
          <AgentStepList steps={[{ seq: 0, id: "starting", label: "Starting the agent…", status: "running" }]} />
        )}
      </Card>
      {reconnecting ? (
        <AppText variant="caption" weight="semi" color="warnFg" accessibilityLiveRegion="polite">
          Connection hiccup, reconnecting…
        </AppText>
      ) : null}
      <Button label="Close" variant="secondary" fullWidth onPress={onCancel} accessibilityLabel="Close; the agent keeps working" />
    </ScrollView>
  );
}

function Failed({ message, onRetry, onClose, retrying }: { message: string; onRetry: () => void; onClose: () => void; retrying?: boolean }) {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card style={styles.failed}>
        <AppText variant="bodyL" weight="heavy" accessibilityRole="header">
          The agent couldn&apos;t finish
        </AppText>
        <AppText weight="semi" color="dangerFg" accessibilityRole="alert">
          {message}
        </AppText>
        <Button label="Try again" fullWidth loading={retrying} onPress={onRetry} />
        <Button label="Close" variant="secondary" fullWidth onPress={onClose} />
      </Card>
    </ScrollView>
  );
}

/** 503 NOT_CONFIGURED: this server has no meal-planning agent. */
function NotSetUp({ onClose }: { onClose: () => void }) {
  return (
    <View style={styles.content}>
      <DashedEmpty>
        <View style={styles.empty}>
          <AppText variant="bodyL" weight="heavy" center>
            The meal planner isn&apos;t set up on this server
          </AppText>
          <AppText color="ink2" center>
            Everything else in GrocerEZ keeps working. Ask whoever runs your server to turn on the planning agent.
          </AppText>
          <Button label="Close" variant="secondary" onPress={onClose} />
        </View>
      </DashedEmpty>
    </View>
  );
}

/** Proposed (or already applied) plan: meal cards, AI estimate, the steps recap, and one pinned primary action. */
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
  const { show: toast } = useToast();
  const insets = useSafeAreaInsets();
  const apply = useApplyAgentRun(groupId);
  /** Set on the first tap and kept after success: a second tap in the same frame (or before the refetch) is ignored. */
  const applying = useRef(false);
  const plan = run.plan;
  if (!plan) return <ErrorState message="This run has no plan." />;

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
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <AiLabel text={replayed ? "Recorded run" : "Pantry Agent"} />
        <View style={styles.titleBlock}>
          <AppText variant="tabTitle" accessibilityRole="header">
            {`${plural(plan.meals.length, "dinner")} for this week`}
          </AppText>
          {plan.summary ? (
            <AppText variant="bodyS" color="ink2">
              {plan.summary}
            </AppText>
          ) : null}
        </View>
        {plan.estimate ? (
          <View style={styles.estimate}>
            <AppText variant="bodyL" weight="heavy">
              {`${formatCentsRange(plan.estimate.lowCents, plan.estimate.highCents, true)} to buy`}
            </AppText>
            <AiLabel text={plan.estimate.label} />
          </View>
        ) : null}
        {plan.meals.map((m, i) => (
          // Index keys: the model may repeat a title, and each card must keep its own safety line.
          <AgentMealCard key={i} meal={m} safety={mealSafety(plan, i)} />
        ))}
        {steps.length ? (
          <>
            <SectionLabel style={styles.gapTop}>How the agent got here</SectionLabel>
            <Card style={styles.steps}>
              <AgentStepList steps={steps} />
            </Card>
          </>
        ) : null}
        {onNewPlan ? <Button label="Plan something else" variant="secondary" fullWidth onPress={onNewPlan} /> : null}
        <Button label="Close" variant="ghost" fullWidth onPress={() => router.back()} />
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: space.md + insets.bottom }]}>
        <Button
          label={title}
          size="lg"
          fullWidth
          loading={apply.isPending}
          disabled={applied || n === 0 || apply.isPending}
          onPress={onApply}
        />
      </View>
    </View>
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
    if (recent.isPending) return <Loading message="Finding the last run…" />;
    if (recent.isError) {
      return (
        <View style={styles.content}>
          <ErrorState message={errorMessage(recent.error)} onRetry={() => void recent.refetch()} />
        </View>
      );
    }
    return (
      <View style={styles.content}>
        <DashedEmpty>
          <View style={styles.empty}>
            <AppText variant="bodyL" weight="heavy" center>
              No recorded runs yet
            </AppText>
            <AppText color="ink2" center>
              Run “Plan our week” once, then long-press to replay it.
            </AppText>
            <Button label="Plan our week" onPress={() => router.replace("/agent")} />
          </View>
        </DashedEmpty>
      </View>
    );
  }
  if (run.isPending) return <Loading message="Loading the recorded run…" />;
  if (run.isError && !run.data) {
    return (
      <View style={styles.content}>
        <ErrorState message={errorMessage(run.error)} onRetry={() => void run.refetch()} />
      </View>
    );
  }
  return <Replayer key={run.data.id} groupId={groupId} run={run.data} />;
}

function Loading({ message }: { message: string }) {
  return (
    <View style={styles.content} accessibilityLabel={message}>
      <LoadingState />
      <AppText variant="caption" color="muted" center>
        {message}
      </AppText>
    </View>
  );
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
  screen: { flex: 1, backgroundColor: color.bg },
  content: { padding: space.screenX, gap: space.lg, paddingBottom: space.xxl * 2 },
  titleBlock: { gap: space.xs },
  steps: { paddingVertical: space.md, paddingHorizontal: space.md },
  failed: { gap: space.md },
  empty: { alignItems: "center", gap: space.md },
  estimate: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  gapTop: { marginTop: space.sm },
  footer: {
    paddingTop: 10,
    paddingHorizontal: space.screenX,
    borderTopWidth: 1,
    borderTopColor: color.border,
    backgroundColor: color.bg,
  },
});
