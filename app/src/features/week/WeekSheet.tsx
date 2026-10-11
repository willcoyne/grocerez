/**
 * The Week calendar as a paper sheet (spec §13), the same sheet and feel as the shopping List: one section per day
 * (MON 12 … SUN 18), saved dinners, "+ Plan a dinner" on empty days, and the agent working ON the sheet: its steps as
 * handwritten lines at the top, day rows pencilled in as each recipe is found, then the proposal and "save week".
 *
 * Thin client: the plan, household `today`, safety and recipes come from the server; the app only lays out days.
 */
import type { AgentStep, PlanMeal } from "@contracts/agent";
import type { ExpiryWarning, PlannedMeal } from "@contracts/mealPlan";
import * as WebBrowser from "expo-web-browser";
import { Check, CircleAlert, Pencil, Plus, Sparkles, X } from "lucide-react-native";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { errorMessage } from "@/api/client";
import { useMealPlan } from "@/api/hooks/mealPlan";
import { stepSpoken, useStepAnnouncement } from "@/components/AgentStepList";
import { AppText, ErrorState } from "@/components/ui";
import {
  NOTE_PAPER,
  PAPER_MARGIN_X,
  PaperCaption,
  PaperPrimaryButton,
  PaperSection,
  PaperSheet,
  paperStyles,
} from "@/features/pantry/overlay/PaperSheet";
import { pantry } from "@/features/pantry/overlay/palette";
import { confirm } from "@/lib/confirm";
import { plural } from "@/lib/format";

import { useWeekRun, type DayPreview } from "./useWeekRun";
import { WeekRecipeCard } from "./WeekRecipeCard";
import { UseSoonSection } from "./UseSoonSection";
import { byDate, datesToPlan, dayLabels, rangeLabel, warningText, weekDates } from "./weekDates";

export type WeekSheetProps = { visible: boolean; groupId: string; onClose: () => void };

export function WeekSheet({ visible, groupId, onClose }: WeekSheetProps) {
  if (!visible) return null;
  return <Sheet groupId={groupId} onClose={onClose} />;
}

function Sheet({ groupId, onClose }: Omit<WeekSheetProps, "visible">) {
  const plan = useMealPlan(groupId);
  const week = useWeekRun(groupId);
  const [openId, setOpenId] = useState<string | null>(null);

  const dates = useMemo(() => (plan.data ? weekDates(plan.data.from) : []), [plan.data]);
  const planned = useMemo(() => byDate(plan.data?.meals), [plan.data]);
  const inWeek = dates.map((d) => planned.get(d)).filter((m): m is PlannedMeal => !!m);
  const toBuy = inWeek.reduce((n, m) => n + m.meal.missing.length, 0);
  const open = openId ? (inWeek.find((m) => m.id === openId) ?? null) : null;

  const v = week.view;
  const busy = v.state === "starting" || v.state === "running";
  const runDates = new Set(v.state === "starting" || v.state === "running" ? v.dates : []);
  const previews = v.state === "running" ? v.previews : new Map<string, DayPreview>();
  const proposed = v.state === "proposed" ? v.proposed : new Map<string, PlanMeal>();

  // "Plan a dinner with these": the earliest free date in the week (the agent already puts expiring items first).
  // Unsaved proposal on the sheet counts as busy: starting another run would silently discard it.
  const locked = busy || v.state === "proposed";
  // Week full: it targets the earliest day and replaces that dinner (after a confirm).
  const freeDate = dates.find((d) => !planned.has(d));
  const useSoonTarget = freeDate ?? dates[0];
  const planUseSoon = async () => {
    if (!useSoonTarget) return;
    const existing = planned.get(useSoonTarget);
    if (existing && !(await confirm(`Replace ${existing.meal.title}?`, `${dayLabels(useSoonTarget).spoken} has no free dinner slot.`, "Replace"))) return;
    week.begin([useSoonTarget], "plan");
  };
  const planWeek = () => week.begin(datesToPlan(dates, planned), "plan");

  let body: React.ReactNode;
  if (plan.isPending) {
    body = (
      <View style={paperStyles.center} testID="week-loading" accessibilityRole="progressbar" accessibilityLabel="Loading the week">
        <ActivityIndicator color={NOTE_PAPER.pencil} />
        <AppText variant="bodyS" style={paperStyles.pencil}>
          Loading the week…
        </AppText>
      </View>
    );
  } else if (plan.isError) {
    body = (
      <View style={paperStyles.center} testID="week-error">
        <ErrorState message={errorMessage(plan.error)} onRetry={() => void plan.refetch()} />
      </View>
    );
  } else {
    const useSoon = (
      <UseSoonSection items={plan.data.expiring} canPlan={!locked && !!useSoonTarget} onPlan={() => void planUseSoon()} />
    );
    const days = dates.map((d) => {
      const saved = planned.get(d);
      const proposal = proposed.get(d);
      const preview = previews.get(d);
      let row: React.ReactNode;
      if (proposal) row = <MealRow date={d} meal={proposal} pending />;
      else if (preview) row = <PreviewRow date={d} preview={preview} />;
      else if (busy && runDates.has(d)) row = <FindingRow date={d} />;
      else if (saved) row = <MealRow date={d} meal={saved.meal} warnings={saved.warnings} onPress={() => setOpenId(saved.id)} />;
      else row = <EmptyRow date={d} disabled={locked} onPress={() => week.begin([d], "plan")} />;
      return (
        <View key={d}>
          <PaperSection title={dayLabels(d).section} testID={`week-day-${d}`} />
          {row}
        </View>
      );
    });
    body = (
      <>
        {useSoon}
        {days}
      </>
    );
  }

  const footer =
    v.state === "proposed" ? (
      <View>
        <PaperPrimaryButton
          label={v.toBuy > 0 ? `Add ${plural(v.toBuy, "item")} & save week` : "Save week"}
          icon={<Check size={20} color="#FFFFFF" strokeWidth={2.8} />}
          onPress={week.save}
          loading={week.saving}
          testID="week-save"
        />
        <TextButton label="Discard" accessibilityLabel="Discard this plan" onPress={week.dismiss} disabled={week.saving} testID="week-discard" />
      </View>
    ) : dates.length ? (
      <PaperPrimaryButton
        label={inWeek.length ? "Re-plan" : "Plan our week"}
        icon={<Sparkles size={20} color="#FFFFFF" />}
        accessibilityHint={inWeek.length ? "The agent plans the open days, or re-plans the next three" : "The agent plans the next three dinners"}
        onPress={planWeek}
        disabled={busy}
        loading={v.state === "starting"}
        testID="week-plan"
      />
    ) : null;

  return (
    <PaperSheet
      testID="week-note"
      title="Week"
      closeLabel="Close week plan"
      onClose={onClose}
      subheader={
        plan.data ? (
          <>
            <PaperCaption strong>{rangeLabel(plan.data.from, plan.data.to)}</PaperCaption>
            <PaperCaption testID="week-summary">{`${plural(inWeek.length, "dinner")} planned · ${toBuy} to buy`}</PaperCaption>
          </>
        ) : null
      }
      footer={footer}
      overlayIsModal={!!open}
      overlay={
        open ? (
          <WeekRecipeCard
            groupId={groupId}
            planned={open}
            dates={dates}
            expiring={plan.data?.expiring}
            allPlanned={inWeek}
            busy={locked}
            onClose={() => setOpenId(null)}
            onSwap={(m) => {
              setOpenId(null);
              week.begin([m.date], "swap", m.id);
            }}
          />
        ) : null
      }
    >
      <ScrollView style={paperStyles.scroll} contentContainerStyle={paperStyles.scrollContent}>
        {v.state === "running" || v.state === "starting" ? (
          <AgentLines steps={v.state === "running" ? v.steps : []} reconnecting={v.state === "running" && v.reconnecting} />
        ) : null}
        {v.state === "failed" ? (
          <RunProblem message={v.message} canRetry={!v.notConfigured} onRetry={week.retry} onDismiss={week.dismiss} />
        ) : null}
        {body}
      </ScrollView>
    </PaperSheet>
  );
}

/** The agent's steps as handwritten lines at the top of the sheet ("Reading the cabinet… ✓"). */
function AgentLines({ steps, reconnecting }: { steps: AgentStep[]; reconnecting: boolean }) {
  const lines = steps.length ? steps : [{ seq: 0, id: "starting", label: "Starting the agent…", status: "running" as const }];
  useStepAnnouncement(steps);
  return (
    <View style={styles.lines} accessibilityLabel="Agent steps" testID="week-agent-lines">
      {lines.map((s) => (
        <View key={`${s.seq}-${s.id}`} style={styles.line} accessible accessibilityLabel={stepSpoken(s)}>
          <AppText weight="display" style={[paperStyles.hand, styles.lineText, s.status === "failed" && styles.failedText]}>
            {s.label}
          </AppText>
          {s.status === "running" ? (
            <ActivityIndicator size="small" color={NOTE_PAPER.pencil} />
          ) : s.status === "failed" ? (
            <X size={18} color={pantry.redInk} strokeWidth={3} />
          ) : (
            <Check size={18} color={pantry.green} strokeWidth={3} />
          )}
        </View>
      ))}
      {reconnecting ? (
        <AppText variant="caption" style={paperStyles.pencil}>
          Connection hiccup, reconnecting…
        </AppText>
      ) : null}
    </View>
  );
}

function RunProblem({
  message,
  canRetry,
  onRetry,
  onDismiss,
}: {
  message: string;
  canRetry: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <View style={styles.problem} testID="week-run-problem">
      <AppText weight="semi" style={styles.failedText} accessibilityRole="alert">
        {message}
      </AppText>
      <View style={styles.problemActions}>
        {canRetry ? <TextButton label="Try again" onPress={onRetry} /> : null}
        <TextButton label="Dismiss" onPress={onDismiss} />
      </View>
    </View>
  );
}

function TextButton({
  label,
  onPress,
  accessibilityLabel,
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.textButton, disabled && styles.faint, pressed && paperStyles.pressed]}
      testID={testID}
    >
      <AppText variant="bodyS" weight="bold" style={styles.green}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** A dinner on a day: saved (tap → recipe card) or proposed by the agent (pencil, not saved yet). */
function MealRow({
  date,
  meal,
  pending,
  warnings = [],
  onPress,
}: {
  date: string;
  meal: PlanMeal;
  pending?: boolean;
  warnings?: readonly ExpiryWarning[];
  onPress?: () => void;
}) {
  const day = dayLabels(date);
  const uses = meal.uses.length ? `uses ${meal.uses.slice(0, 3).map((u) => u.toLowerCase()).join(", ")}` : null;
  // Title + time open the card; the citation is its own link next to it (never a link nested inside a button).
  const main = (
    <>
      <AppText variant="bodyL" weight="heavy" style={pending ? styles.pendingName : styles.name}>
        {meal.title}
      </AppText>
      <AppText variant="caption" style={paperStyles.pencil}>
        {[`${meal.minutes} min`, uses].filter(Boolean).join(" · ")}
      </AppText>
    </>
  );
  return (
    <View style={[paperStyles.row, styles.rowPad]} testID={`week-row-${date}`}>
      <View style={styles.bullet}>{pending ? <Pencil size={16} color={NOTE_PAPER.pencil} /> : <View style={styles.dot} />}</View>
      <View style={styles.rowText}>
        {onPress ? (
          <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={`${day.spoken}: ${meal.title}, ${meal.minutes} minutes. Open the recipe card`}
            style={({ pressed }) => [styles.rowMain, pressed && paperStyles.pressed]}
            testID={`week-open-${date}`}
          >
            {main}
          </Pressable>
        ) : (
          <View style={styles.rowMain} accessible accessibilityLabel={`${day.spoken}: proposed ${meal.title}, ${meal.minutes} minutes`}>
            {main}
          </View>
        )}
        <View style={styles.metaLine}>
          {meal.source ? (
            <Pressable
              onPress={() => void WebBrowser.openBrowserAsync(meal.source!.url)}
              accessibilityRole="link"
              accessibilityLabel={`Open the full recipe on ${meal.source.site}`}
              hitSlop={10}
              style={({ pressed }) => [styles.cite, pressed && paperStyles.pressed]}
              testID={`week-cite-${date}`}
            >
              <AppText variant="caption" weight="bold" style={styles.green}>{`${meal.source.site} ↗`}</AppText>
            </Pressable>
          ) : (
            <View style={styles.aiCreated} accessible accessibilityLabel="AI-created recipe">
              <Sparkles size={12} color={pantry.muted} />
              <AppText variant="caption" style={paperStyles.pencil}>
                AI-created
              </AppText>
            </View>
          )}
          {pending ? (
            <AppText variant="caption" weight="semi" style={paperStyles.pencil}>
              · Proposed, not saved yet
            </AppText>
          ) : null}
        </View>
        {warnings.map((w) => (
          <View key={w.item} style={styles.warnLine} accessible accessibilityLabel={`Warning: ${warningText(w)}`} testID={`week-warning-${date}`}>
            <CircleAlert size={14} color={pantry.redInk} />
            <AppText variant="caption" weight="semi" style={styles.failedText}>
              {warningText(w)}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

/** A day pencilled in as soon as the agent finds its recipe (step preview), before the plan is proposed. */
function PreviewRow({ date, preview }: { date: string; preview: DayPreview }) {
  return (
    <View
      style={[paperStyles.row, styles.rowPad]}
      accessible
      accessibilityLabel={`${dayLabels(date).spoken}: found ${preview.title}${preview.site ? ` on ${preview.site}` : ""}`}
      testID={`week-preview-${date}`}
    >
      <View style={styles.bullet}>
        <Pencil size={16} color={NOTE_PAPER.pencil} />
      </View>
      <View style={styles.rowText}>
        <AppText weight="display" style={[paperStyles.hand, styles.sketch]}>
          {preview.title}
        </AppText>
        <AppText variant="caption" style={paperStyles.pencil}>
          {preview.site ? `found on ${preview.site}…` : "AI-created…"}
        </AppText>
      </View>
    </View>
  );
}

function FindingRow({ date }: { date: string }) {
  return (
    <View
      style={[paperStyles.row, styles.rowPad]}
      accessible
      accessibilityLabel={`${dayLabels(date).spoken}: finding a recipe`}
      testID={`week-finding-${date}`}
    >
      <View style={styles.bullet}>
        <ActivityIndicator size="small" color={NOTE_PAPER.pencil} />
      </View>
      <AppText weight="display" style={[paperStyles.hand, styles.sketch, styles.faint]}>
        Finding a recipe…
      </AppText>
    </View>
  );
}

function EmptyRow({ date, disabled, onPress }: { date: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`Plan a dinner for ${dayLabels(date).spoken}`}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [paperStyles.row, styles.empty, disabled && styles.faint, pressed && paperStyles.pressed]}
      testID={`week-plan-day-${date}`}
    >
      <Plus size={20} color={pantry.green} strokeWidth={2.6} />
      <AppText weight="display" style={[paperStyles.hand, styles.addText]}>
        Plan a dinner
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  lines: { paddingLeft: PAPER_MARGIN_X, paddingRight: 16, paddingTop: 8, paddingBottom: 6, gap: 2 },
  line: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 30 },
  lineText: { fontSize: 18, lineHeight: 24, flexShrink: 1 },
  failedText: { color: pantry.redInk },
  problem: { paddingLeft: PAPER_MARGIN_X, paddingRight: 16, paddingVertical: 10, gap: 4 },
  problemActions: { flexDirection: "row", gap: 16 },
  textButton: { minHeight: 44, justifyContent: "center", alignSelf: "center", paddingHorizontal: 12 },
  green: { color: pantry.green },
  rowPad: { paddingVertical: 6, paddingRight: 12 },
  bullet: { width: PAPER_MARGIN_X, alignItems: "center", paddingTop: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: NOTE_PAPER.pencil, marginTop: 2 },
  rowText: { flex: 1, gap: 2 },
  rowMain: { gap: 2, alignSelf: "stretch" },
  cite: { minHeight: 24, justifyContent: "center" },
  name: { color: NOTE_PAPER.ink },
  pendingName: { color: NOTE_PAPER.pencil },
  metaLine: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4 },
  warnLine: { flexDirection: "row", alignItems: "center", gap: 4 },
  aiCreated: { flexDirection: "row", alignItems: "center", gap: 3 },
  sketch: { fontSize: 19, lineHeight: 25, transform: [{ rotate: "-0.8deg" }] },
  faint: { opacity: 0.6 },
  empty: { alignItems: "center", gap: 8, paddingLeft: PAPER_MARGIN_X - 2 },
  addText: { fontSize: 20, lineHeight: 26, color: pantry.green },
});
