import type { AgentRun, AgentStep } from "@contracts/agent";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { errorMessage } from "@/api/client";
import { useAgentRun, useApplyAgentRun, useRecentAgentRuns, useStartAgentRun } from "@/api/hooks/agent";
import { EmptyState } from "@/components/States";
import { Button, Card, Input, SectionHeader } from "@/components/ui";
import { useActiveGroup } from "@/state/ActiveGroupContext";
import { colors, fontSize, radius, spacing } from "@/theme";

/**
 * "How the Pantry Agent works": a test bench that shows the architecture, starts a real run, and traces every step
 * (who did it, which endpoint, when) plus the raw plan and the apply result. Same API as the "Plan our week" sheet.
 * Full write-up: plan/challenges/01-pantry-agent/ARCHITECTURE.md.
 */

const DEFAULT_PROMPT =
  "Plan 3 dinners for this week. Use what's expiring first, keep it under $60, and make sure everyone can eat it.";

/** Which part of the system produced each step id (see agent/app/hooks.py STEP labels). */
const STEP_SOURCE: Record<string, { who: string; what: string }> = {
  get_household: { who: "Agent tool → Server", what: "GET /groups/:gid/agent/household (members, allergens, diets)" },
  get_cabinet: { who: "Agent tool → Server", what: "GET /groups/:gid/cabinet (+ expiry math, blocked items)" },
  get_shopping_list: { who: "Agent tool → Server", what: "GET /groups/:gid/shopping-list (don't add twice)" },
  get_wants: { who: "Agent tool → Server", what: "GET /groups/:gid/preferences?userId=all" },
  drafting: { who: "Model (Akamai)", what: "hackathon-chat writes the meals" },
  check_meal_safety: { who: "Agent tool → Server code", what: "POST /groups/:gid/agent/safety-check (deterministic, not the model)" },
  revise_meal: { who: "Agent tool", what: "patches one meal, re-checks only it" },
  estimate_prices: { who: "Price sub-agent (Akamai)", what: "second Strands agent, runs in the background once safety passes" },
  propose_plan: { who: "Agent → Server", what: "POST /internal/agent-events {type:'proposed'} → run saved" },
};

const FLOW: { n: string; title: string; body: string }[] = [
  { n: "1", title: "App → Server", body: "POST /groups/:gid/agent/runs {prompt, budget}. Server inserts an agent_runs row (running), mints a 15-min run token scoped to this group, answers 202 {runId}." },
  { n: "2", title: "Server → Agent", body: "POST agent:8000/runs with X-Agent-Secret. The Python service (FastAPI + Strands) starts the run in the background." },
  { n: "3", title: "Agent reads", body: "Tools call the normal REST API with the run token: household, cabinet, list, wants. Same authz as the user; read-only." },
  { n: "4", title: "Model drafts", body: "Akamai hackathon-chat (Qwen, OpenAI-compatible) drafts meals that use expiring items." },
  { n: "5", title: "Safety in code", body: "Every meal goes through the server's deterministic allergen/diet check. Failures go back to the model to fix." },
  { n: "6", title: "Prices", body: "Once safety passes, a second Strands agent prices the missing items in the background (≤ 8 s, else skipped). Labeled \"AI estimate\"." },
  { n: "7", title: "Propose", body: "propose_plan validates and posts the plan. Every step is posted to /internal/agent-events → server emits agent:changed → app refetches." },
  { n: "8", title: "Human applies", body: "You tap Add. Server re-checks safety, writes the list in one transaction, emits shopping-list:changed → every phone updates." },
];

export default function AgentFlowScreen() {
  const { activeGroupId } = useActiveGroup();
  if (!activeGroupId) return <EmptyState title="No household selected" message="Pick a household first." />;
  return <Bench groupId={activeGroupId} />;
}

function Bench({ groupId }: { groupId: string }) {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [runId, setRunId] = useState<string | null>(null);
  const start = useStartAgentRun(groupId);
  const run = useAgentRun(groupId, runId);
  const recent = useRecentAgentRuns(groupId);
  const apply = useApplyAgentRun(groupId);

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <SectionHeader title="Architecture" />
      <Card>
        <Diagram />
      </Card>

      <SectionHeader title="The flow" />
      <Card>
        {FLOW.map((f) => (
          <View key={f.n} style={styles.flowRow}>
            <Text style={styles.flowNum}>{f.n}</Text>
            <View style={styles.flex}>
              <Text style={styles.flowTitle}>{f.title}</Text>
              <Text style={styles.small}>{f.body}</Text>
            </View>
          </View>
        ))}
      </Card>

      <SectionHeader title="Try it" />
      <Card>
        <Input label="Prompt" value={prompt} onChangeText={setPrompt} multiline maxLength={500} />
        <Button
          title="Run the agent"
          loading={start.isPending}
          disabled={!prompt.trim() || run.data?.status === "running"}
          onPress={() =>
            start.mutate({ prompt: prompt.trim(), budgetCents: 6000 }, { onSuccess: (r) => setRunId(r.runId) })
          }
        />
        {start.error ? <Text style={styles.error}>{errorMessage(start.error)}</Text> : null}
      </Card>

      {runId ? <Trace run={run.data} loading={run.isLoading} /> : null}

      {run.data?.status === "proposed" ? (
        <Card>
          <Button
            title="Apply: add missing items to the list"
            loading={apply.isPending}
            disabled={apply.isSuccess}
            onPress={() => apply.mutate(run.data!.id)}
          />
          {apply.data ? (
            <Text style={styles.small}>
              Server re-checked safety, added {apply.data.added}, skipped{" "}
              {apply.data.skipped.map((s) => `${s.name} (${s.reason})`).join(", ") || "none"}. Emitted shopping-list:changed once.
            </Text>
          ) : null}
          {apply.error ? <Text style={styles.error}>{errorMessage(apply.error)}</Text> : null}
        </Card>
      ) : null}

      <SectionHeader title="Recent runs (tap to inspect)" />
      <Card>
        {(recent.data ?? []).length === 0 ? <Text style={styles.small}>No runs yet.</Text> : null}
        {(recent.data ?? []).map((r) => (
          <Pressable key={r.id} accessibilityRole="button" onPress={() => setRunId(r.id)} style={styles.recentRow}>
            <Text style={[styles.badge, badgeTone(r.status)]}>{r.status}</Text>
            <Text style={[styles.small, styles.flex]} numberOfLines={1}>
              {new Date(r.createdAt).toLocaleTimeString()} · {r.meta ? `${Math.round(r.meta.ms / 1000)} s · ${r.meta.toolCalls} tools` : "…"}
            </Text>
          </Pressable>
        ))}
      </Card>
    </ScrollView>
  );
}

function Diagram() {
  const box = (title: string, sub: string, tone: string) => (
    <View style={[styles.box, { borderColor: tone }]}>
      <Text style={styles.boxTitle}>{title}</Text>
      <Text style={styles.xs}>{sub}</Text>
    </View>
  );
  const arrow = (label: string) => <Text style={styles.arrow}>↓ {label}</Text>;
  return (
    <View>
      {box("Expo app (this phone)", "REST + Socket.IO room group:<gid>", colors.primary)}
      {arrow("POST /agent/runs · ↑ agent:changed, shopping-list:changed")}
      {box("Server (Express + Postgres)", "agent_runs, safety check, apply, run token", colors.text)}
      {arrow("POST /runs (X-Agent-Secret) · ↑ /internal/agent-events")}
      {box("Agent service (Python, AWS Strands)", "tools over our REST API · hooks stream steps · background price sub-agent", colors.text)}
      {arrow("OpenAI-compatible chat + tool calls")}
      {box("Akamai inference", "hackathon-chat (Qwen3.8-27B on vLLM)", colors.text)}
    </View>
  );
}

function Trace({ run, loading }: { run: AgentRun | undefined; loading: boolean }) {
  const [raw, setRaw] = useState(false);
  if (!run) return <Card><Text style={styles.small}>{loading ? "Starting…" : "Run not found."}</Text></Card>;
  const t0 = Date.parse(run.createdAt);
  const steps = [...run.steps].sort((a, b) => a.seq - b.seq);
  return (
    <>
      <SectionHeader title="Live trace" />
      <Card>
        <View style={styles.recentRow}>
          <Text style={[styles.badge, badgeTone(run.status)]}>{run.status}</Text>
          <Text style={[styles.small, styles.flex]}>
            {run.meta
              ? `${run.meta.provider}/${run.meta.model} · ${(run.meta.ms / 1000).toFixed(1)} s · ${run.meta.toolCalls} tool calls · ${run.meta.tokensIn ?? "?"} in / ${run.meta.tokensOut ?? "?"} out`
              : "agent working… (socket agent:changed + 1.5 s poll)"}
          </Text>
        </View>
        {steps.map((s) => (
          <StepRow key={s.id} step={s} t0={t0} done={run.status !== "running"} />
        ))}
        {run.error ? <Text style={styles.error}>{run.error}</Text> : null}
      </Card>

      {run.plan ? (
        <>
          <SectionHeader title="Plan (what propose_plan sent)" />
          <Card>
            <Text style={styles.small}>{run.plan.summary}</Text>
            {run.plan.meals.map((m, i) => {
              const safe = run.plan!.safety.perMeal[i];
              return (
                <View key={i} style={styles.meal}>
                  <Text style={styles.flowTitle}>
                    {m.day ?? "–"} · {m.title} · {m.minutes} min
                  </Text>
                  <Text style={styles.xs}>ingredients: {m.ingredients.join(", ")}</Text>
                  <Text style={styles.xs}>uses (cabinet): {m.uses.join(", ") || "–"}</Text>
                  <Text style={styles.xs}>missing (to buy): {m.missing.join(", ") || "–"}</Text>
                  <Text style={[styles.xs, { color: safe?.passes ? colors.success : colors.danger }]}>
                    safety: {safe ? (safe.passes ? "pass" : "FAIL") : "not checked"}
                    {safe?.unknown.length ? ` · couldn't verify: ${safe.unknown.join(", ")}` : ""}
                  </Text>
                </View>
              );
            })}
            <Text style={styles.small}>
              Missing items → list: {run.plan.missingItems.map((m) => m.name).join(", ") || "none"}
            </Text>
            <Text style={styles.small}>
              Estimate: {run.plan.estimate ? `${dollars(run.plan.estimate.lowCents)}–${dollars(run.plan.estimate.highCents)} (${run.plan.estimate.label})` : "none"}
            </Text>
          </Card>
        </>
      ) : null}

      <Button title={raw ? "Hide raw run JSON" : "Show raw run JSON"} variant="secondary" compact onPress={() => setRaw(!raw)} />
      {raw ? (
        <Card>
          <Text selectable style={styles.mono}>{JSON.stringify(run, null, 2)}</Text>
        </Card>
      ) : null}
    </>
  );
}

function StepRow({ step, t0, done }: { step: AgentStep; t0: number; done: boolean }) {
  const src = STEP_SOURCE[step.id] ?? { who: "Agent", what: step.id };
  // A step left `running` after the run ended is shown as finished (its "done" event can arrive after the terminal one).
  const status = done && step.status === "running" ? "done" : step.status;
  const icon = status === "done" ? "✓" : status === "failed" ? "✕" : "…";
  const secs = ((Date.parse(step.at) - t0) / 1000).toFixed(1);
  return (
    <View style={styles.stepRow} accessibilityLabel={`${step.label}, ${status}, at ${secs} seconds, by ${src.who}`}>
      <Text style={styles.stepIcon}>{icon}</Text>
      <View style={styles.flex}>
        <Text style={styles.flowTitle}>{step.label}</Text>
        <Text style={styles.xs}>
          +{secs}s · #{step.seq} · {src.who}: {src.what}
        </Text>
        {step.detail ? <Text style={styles.xs}>{step.detail}</Text> : null}
      </View>
    </View>
  );
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function badgeTone(status: AgentRun["status"]) {
  if (status === "failed") return { backgroundColor: colors.danger };
  if (status === "running") return { backgroundColor: colors.textMuted };
  return { backgroundColor: colors.success };
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  flex: { flex: 1 },
  flowRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  flowNum: { width: 22, height: 22, borderRadius: 11, textAlign: "center", lineHeight: 22, backgroundColor: colors.primary, color: "#fff", fontWeight: "700", fontSize: fontSize.xs, overflow: "hidden" },
  flowTitle: { fontWeight: "600", fontSize: fontSize.sm, color: colors.text },
  small: { fontSize: fontSize.sm, color: colors.text, marginTop: spacing.xs },
  xs: { fontSize: fontSize.xs, color: colors.textMuted },
  error: { color: colors.danger, marginTop: spacing.sm },
  box: { borderWidth: 1.5, borderRadius: radius.md, padding: spacing.sm },
  boxTitle: { fontWeight: "700", fontSize: fontSize.sm, color: colors.text },
  arrow: { fontSize: fontSize.xs, color: colors.textMuted, marginVertical: spacing.xs, marginLeft: spacing.sm },
  recentRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs },
  badge: { color: "#fff", fontSize: fontSize.xs, fontWeight: "700", paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, overflow: "hidden" },
  stepRow: { flexDirection: "row", gap: spacing.sm, paddingVertical: spacing.xs },
  stepIcon: { width: 18, fontSize: fontSize.md, color: colors.text },
  meal: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  mono: { fontFamily: "Courier", fontSize: 11, color: colors.text },
});
