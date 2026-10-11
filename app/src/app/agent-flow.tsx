import type { AgentRun, AgentStep } from "@contracts/agent";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { errorMessage } from "@/api/client";
import { useAgentRun, useApplyAgentRun, useRecentAgentRuns, useStartAgentRun } from "@/api/hooks/agent";
import { AgentPromptInput } from "@/components/AgentControls";
import { AppText, Button, Card, DashedEmpty, SectionLabel, StatusChip, type ChipTone } from "@/components/ui";
import { useActiveGroup } from "@/state/ActiveGroupContext";
import { color, pressedOpacity, radius, size, space } from "@/theme";

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
  find_recipe: {
    who: "Agent tool → Web",
    what: "recipe index, else Tavily search → recipe page JSON-LD → server safety check → cite (else AI-created)",
  },
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
  { n: "5", title: "Find a real recipe", body: "Tavily search → recipe page JSON-LD → safety check → cite. find_recipe checks our recipe index first, else searches allowlisted recipe sites, parses the page's schema.org Recipe, safety-checks its real ingredients, and cites the first one that passes. None passes → the model's own meal, labeled \"AI-created\"." },
  { n: "6", title: "Safety in code", body: "Every meal goes through the server's deterministic allergen/diet check. Failures go back to the model to fix." },
  { n: "7", title: "Prices", body: "Once safety passes, a second Strands agent prices the missing items in the background (≤ 8 s, else skipped). Labeled \"AI estimate\"." },
  { n: "8", title: "Propose", body: "propose_plan validates and posts the plan. Every step is posted to /internal/agent-events → server emits agent:changed → app refetches." },
  { n: "9", title: "Human applies", body: "You tap Add. Server re-checks safety, writes the list in one transaction, emits shopping-list:changed → every phone updates." },
];

export default function AgentFlowScreen() {
  const { activeGroupId } = useActiveGroup();
  if (!activeGroupId) {
    return (
      <View style={styles.pad}>
        <DashedEmpty>Pick a household first.</DashedEmpty>
      </View>
    );
  }
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
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="screen-agent-flow">
      <SectionLabel>Architecture</SectionLabel>
      <Card>
        <Diagram />
      </Card>

      <SectionLabel style={styles.gapTop}>The flow</SectionLabel>
      <Card style={styles.flowCard}>
        {FLOW.map((f) => (
          <View key={f.n} style={styles.flowRow}>
            <View style={styles.flowNum}>
              <AppText variant="micro" weight="bold" color="onPrimary">
                {f.n}
              </AppText>
            </View>
            <View style={styles.flex}>
              <AppText variant="bodyS" weight="bold">
                {f.title}
              </AppText>
              <AppText variant="caption" color="ink2">
                {f.body}
              </AppText>
            </View>
          </View>
        ))}
      </Card>

      <SectionLabel style={styles.gapTop}>Try it</SectionLabel>
      <Card style={styles.gap}>
        <AgentPromptInput label="Prompt" value={prompt} onChangeText={setPrompt} />
        <Button
          label="Run the agent"
          fullWidth
          loading={start.isPending}
          disabled={!prompt.trim() || run.data?.status === "running"}
          onPress={() => start.mutate({ prompt: prompt.trim(), budgetCents: 6000 }, { onSuccess: (r) => setRunId(r.runId) })}
        />
        {start.error ? (
          <AppText variant="caption" weight="bold" color="dangerFg" accessibilityRole="alert">
            {errorMessage(start.error)}
          </AppText>
        ) : null}
      </Card>

      {runId ? <Trace run={run.data} loading={run.isLoading} /> : null}

      {run.data?.status === "proposed" ? (
        <Card style={styles.gap}>
          <Button
            label="Apply: add missing items to the list"
            fullWidth
            loading={apply.isPending}
            disabled={apply.isSuccess}
            onPress={() => apply.mutate(run.data!.id)}
          />
          {apply.data ? (
            <AppText variant="caption" color="ink2">
              {`Server re-checked safety, added ${apply.data.added}, skipped ${
                apply.data.skipped.map((s) => `${s.name} (${s.reason})`).join(", ") || "none"
              }. Emitted shopping-list:changed once.`}
            </AppText>
          ) : null}
          {apply.error ? (
            <AppText variant="caption" weight="bold" color="dangerFg">
              {errorMessage(apply.error)}
            </AppText>
          ) : null}
        </Card>
      ) : null}

      <SectionLabel style={styles.gapTop}>Recent runs (tap to inspect)</SectionLabel>
      <Card>
        {(recent.data ?? []).length === 0 ? (
          <AppText variant="caption" color="muted">
            No runs yet.
          </AppText>
        ) : null}
        {(recent.data ?? []).map((r) => (
          <Pressable
            key={r.id}
            accessibilityRole="button"
            accessibilityLabel={`Inspect the ${r.status} run from ${new Date(r.createdAt).toLocaleTimeString()}`}
            onPress={() => setRunId(r.id)}
            style={({ pressed }) => [styles.recentRow, pressed && { opacity: pressedOpacity }]}
          >
            <StatusChip label={r.status} tone={statusTone(r.status)} />
            <AppText variant="caption" color="ink2" numberOfLines={1} style={styles.flex}>
              {`${new Date(r.createdAt).toLocaleTimeString()} · ${r.meta ? `${Math.round(r.meta.ms / 1000)} s · ${r.meta.toolCalls} tools` : "…"}`}
            </AppText>
          </Pressable>
        ))}
      </Card>
    </ScrollView>
  );
}

function Diagram() {
  const box = (title: string, sub: string, accent?: boolean) => (
    <View style={[styles.box, accent && styles.boxAccent]}>
      <AppText variant="bodyS" weight="bold">
        {title}
      </AppText>
      <AppText variant="caption" color="muted">
        {sub}
      </AppText>
    </View>
  );
  const arrow = (label: string) => (
    <AppText variant="caption" color="muted" style={styles.arrow}>
      {`↓ ${label}`}
    </AppText>
  );
  return (
    <View>
      {box("Expo app (this phone)", "REST + Socket.IO room group:<gid>", true)}
      {arrow("POST /agent/runs · ↑ agent:changed, shopping-list:changed")}
      {box("Server (Express + Postgres)", "agent_runs, safety check, apply, run token")}
      {arrow("POST /runs (X-Agent-Secret) · ↑ /internal/agent-events")}
      {box("Agent service (Python, AWS Strands)", "tools over our REST API · hooks stream steps · background price sub-agent")}
      {arrow("OpenAI-compatible chat + tool calls · recipe index / Tavily for real recipes")}
      {box("Akamai inference", "hackathon-chat (Qwen3.8-27B on vLLM)")}
    </View>
  );
}

function Trace({ run, loading }: { run: AgentRun | undefined; loading: boolean }) {
  const [raw, setRaw] = useState(false);
  if (!run) {
    return (
      <Card>
        <AppText variant="caption" color="muted">
          {loading ? "Starting…" : "Run not found."}
        </AppText>
      </Card>
    );
  }
  const t0 = Date.parse(run.createdAt);
  const steps = [...run.steps].sort((a, b) => a.seq - b.seq);
  return (
    <>
      <SectionLabel style={styles.gapTop}>Live trace</SectionLabel>
      <Card style={styles.gap}>
        <View style={styles.recentRow}>
          <StatusChip label={run.status} tone={statusTone(run.status)} />
          <AppText variant="caption" color="ink2" style={styles.flex}>
            {run.meta
              ? `${run.meta.provider}/${run.meta.model} · ${(run.meta.ms / 1000).toFixed(1)} s · ${run.meta.toolCalls} tool calls · ${run.meta.tokensIn ?? "?"} in / ${run.meta.tokensOut ?? "?"} out`
              : "agent working… (socket agent:changed + 1.5 s poll)"}
          </AppText>
        </View>
        {steps.map((s) => (
          <StepRow key={s.id} step={s} t0={t0} done={run.status !== "running"} />
        ))}
        {run.error ? (
          <AppText variant="caption" weight="bold" color="dangerFg">
            {run.error}
          </AppText>
        ) : null}
      </Card>

      {run.plan ? (
        <>
          <SectionLabel style={styles.gapTop}>Plan (what propose_plan sent)</SectionLabel>
          <Card style={styles.gap}>
            <AppText variant="bodyS">{run.plan.summary}</AppText>
            {run.plan.meals.map((m, i) => {
              const safe = run.plan!.safety.perMeal[i];
              return (
                <View key={i} style={styles.meal}>
                  <AppText variant="bodyS" weight="bold">
                    {`${m.day ?? "–"} · ${m.title} · ${m.minutes} min`}
                  </AppText>
                  {m.source ? (
                    <Pressable
                      accessibilityRole="link"
                      accessibilityLabel={`Open the full recipe on ${m.source.site}`}
                      onPress={() => void WebBrowser.openBrowserAsync(m.source!.url)}
                      style={({ pressed }) => [styles.link, pressed && { opacity: pressedOpacity }]}
                    >
                      <AppText variant="caption" weight="bold" color="primary">
                        {`source: ${m.source.site} · ${m.source.url} ↗`}
                      </AppText>
                    </Pressable>
                  ) : (
                    <AppText variant="caption" color="muted">
                      source: none (AI-created)
                    </AppText>
                  )}
                  {m.ingredientLines.length ? (
                    <AppText variant="caption" color="muted">{`recipe lines: ${m.ingredientLines.join("; ")}`}</AppText>
                  ) : null}
                  <AppText variant="caption" color="muted">{`ingredients: ${m.ingredients.join(", ")}`}</AppText>
                  <AppText variant="caption" color="muted">{`uses (cabinet): ${m.uses.join(", ") || "–"}`}</AppText>
                  <AppText variant="caption" color="muted">{`missing (to buy): ${m.missing.join(", ") || "–"}`}</AppText>
                  <AppText variant="caption" weight="bold" color={safe?.passes ? "okFg" : "dangerFg"}>
                    {`safety: ${safe ? (safe.passes ? "pass" : "FAIL") : "not checked"}${
                      safe?.unknown.length ? ` · couldn't verify: ${safe.unknown.join(", ")}` : ""
                    }`}
                  </AppText>
                </View>
              );
            })}
            <AppText variant="caption" color="ink2">
              {`Missing items → list: ${run.plan.missingItems.map((m) => m.name).join(", ") || "none"}`}
            </AppText>
            <AppText variant="caption" color="ink2">
              {`Estimate: ${
                run.plan.estimate
                  ? `${dollars(run.plan.estimate.lowCents)}–${dollars(run.plan.estimate.highCents)} (${run.plan.estimate.label})`
                  : "none"
              }`}
            </AppText>
          </Card>
        </>
      ) : null}

      <Button label={raw ? "Hide raw run JSON" : "Show raw run JSON"} variant="secondary" size="sm" onPress={() => setRaw(!raw)} />
      {raw ? (
        <Card>
          <AppText selectable variant="micro" weight="medium" uppercase={false} style={styles.mono}>
            {JSON.stringify(run, null, 2)}
          </AppText>
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
    <View style={styles.stepRow} accessible accessibilityLabel={`${step.label}, ${status}, at ${secs} seconds, by ${src.who}`}>
      <AppText variant="bodyS" weight="bold" color={status === "failed" ? "dangerFg" : status === "done" ? "okFg" : "muted"} style={styles.stepIcon}>
        {icon}
      </AppText>
      <View style={styles.flex}>
        <AppText variant="bodyS" weight="semi">
          {step.label}
        </AppText>
        <AppText variant="caption" color="muted">{`+${secs}s · #${step.seq} · ${src.who}: ${src.what}`}</AppText>
        {step.detail ? (
          <AppText variant="caption" color="muted">
            {step.detail}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function statusTone(status: AgentRun["status"]): ChipTone {
  if (status === "failed") return "danger";
  if (status === "running") return "neutral";
  if (status === "proposed") return "warn";
  return "ok";
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { padding: space.screenX, gap: space.md, paddingBottom: space.xxl * 2 },
  pad: { padding: space.screenX },
  flex: { flex: 1 },
  gap: { gap: space.sm },
  gapTop: { marginTop: space.sm },
  flowCard: { gap: space.md },
  flowRow: { flexDirection: "row", gap: space.sm },
  flowNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: color.primary, alignItems: "center", justifyContent: "center" },
  box: { borderWidth: 1.5, borderColor: color.borderStrong, borderRadius: radius.control, padding: space.sm },
  boxAccent: { borderColor: color.primary },
  arrow: { marginVertical: space.xs, marginLeft: space.sm },
  recentRow: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: size.hit },
  stepRow: { flexDirection: "row", gap: space.sm, paddingVertical: space.xs },
  stepIcon: { width: 18 },
  meal: { gap: 2, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: color.border },
  link: { minHeight: size.hit, justifyContent: "center" },
  mono: { fontFamily: "Courier", fontSize: 11, lineHeight: 15 },
});
