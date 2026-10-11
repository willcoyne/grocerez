import type { AgentStep } from "@contracts/agent";
import { useEffect } from "react";
import { AccessibilityInfo, ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { colors, fontSize, spacing } from "@/theme";

const STATUS_WORD: Record<AgentStep["status"], string> = { running: "in progress", done: "done", failed: "failed" };

/**
 * The agent's steps as they happen: spinner while running, ✓ when done, ✕ when failed. Each row also says its
 * status in words for screen readers (never color alone). With `announce`, the latest step is spoken when it changes
 * (accessibilityLiveRegion only works on Android).
 */
export function AgentStepList({
  steps,
  announce,
}: {
  steps: Pick<AgentStep, "id" | "seq" | "label" | "status" | "detail">[];
  announce?: boolean;
}) {
  const latest = steps[steps.length - 1];
  const message = announce && latest ? `${latest.label}, ${STATUS_WORD[latest.status]}` : null;
  useEffect(() => {
    if (message) AccessibilityInfo.announceForAccessibility(message);
  }, [message]);

  return (
    <View style={styles.list} accessibilityLiveRegion="polite" accessibilityLabel="Agent steps">
      {steps.map((s) => (
        <View
          key={`${s.seq}-${s.id}`}
          style={styles.row}
          accessible
          accessibilityLabel={`${s.label}${s.detail ? `, ${s.detail}` : ""}, ${STATUS_WORD[s.status]}`}
        >
          <View style={styles.icon}>
            {s.status === "running" ? (
              <ActivityIndicator size="small" color={colors.ai} />
            ) : (
              <Text style={[styles.mark, s.status === "failed" ? styles.failed : styles.done]}>{s.status === "failed" ? "✕" : "✓"}</Text>
            )}
          </View>
          <View style={styles.text}>
            <Text style={[styles.label, s.status === "running" && styles.labelRunning]}>{s.label}</Text>
            {s.detail ? <Text style={styles.detail}>{s.detail}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, minHeight: 28 },
  icon: { width: 24, alignItems: "center", paddingTop: 2 },
  mark: { fontSize: fontSize.md, fontWeight: "800" },
  done: { color: colors.success },
  failed: { color: colors.danger },
  text: { flex: 1 },
  label: { fontSize: fontSize.md, color: colors.text },
  labelRunning: { fontWeight: "700" },
  detail: { fontSize: fontSize.sm, color: colors.textMuted },
});
