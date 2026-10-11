import type { AgentStep } from "@contracts/agent";
import { Check, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Animated, StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui";
import { color, radius, space } from "@/theme";

const STATUS_WORD: Record<AgentStep["status"], string> = { running: "in progress", done: "done", failed: "failed" };
const ICON = 24;

type StepLike = Pick<AgentStep, "id" | "seq" | "label" | "status" | "detail">;

/** True when animations may run: not under reduce-motion, and not in Jest (DESIGN.md §7). */
function useMotionAllowed() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (process.env.JEST_WORKER_ID) return;
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => live && setOk(!reduce))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return ok;
}

/**
 * The agent's steps as they happen: a spinner (and a soft pulse) on the running step, a check that pops in when a step
 * finishes, ✕ on failure. Every row says its status in words for screen readers (never color alone). With `announce`,
 * the latest step is spoken when it changes (accessibilityLiveRegion only works on Android).
 */
export function AgentStepList({ steps, announce }: { steps: StepLike[]; announce?: boolean }) {
  const motion = useMotionAllowed();
  const latest = steps[steps.length - 1];
  const message = announce && latest ? `${latest.label}, ${STATUS_WORD[latest.status]}` : null;
  useEffect(() => {
    if (message) AccessibilityInfo.announceForAccessibility(message);
  }, [message]);

  return (
    <View style={styles.list} accessibilityLiveRegion="polite" accessibilityLabel="Agent steps">
      {steps.map((s, i) => (
        <StepRow key={`${s.seq}-${s.id}`} step={s} motion={motion} last={i === steps.length - 1} />
      ))}
    </View>
  );
}

function StepRow({ step, motion, last }: { step: StepLike; motion: boolean; last: boolean }) {
  const running = step.status === "running";
  const [pulse] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!motion || !running) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.55, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      pulse.setValue(1);
    };
  }, [motion, running, pulse]);

  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${step.label}${step.detail ? `, ${step.detail}` : ""}, ${STATUS_WORD[step.status]}`}
    >
      <View style={styles.rail}>
        <StepIcon status={step.status} motion={motion} />
        {last ? null : <View style={[styles.line, step.status === "done" && styles.lineDone]} />}
      </View>
      <Animated.View style={[styles.text, { opacity: pulse }]}>
        <AppText variant="bodyS" weight={running ? "bold" : "semi"} color={step.status === "failed" ? "dangerFg" : "ink"}>
          {step.label}
        </AppText>
        {step.detail ? (
          <AppText variant="caption" color="muted">
            {step.detail}
          </AppText>
        ) : null}
      </Animated.View>
    </View>
  );
}

function StepIcon({ status, motion }: { status: AgentStep["status"]; motion: boolean }) {
  // The check "pops" in when a step goes running → done (skipped under reduce motion).
  const [scale] = useState(() => new Animated.Value(1));
  const prev = useRef(status);
  useEffect(() => {
    const was = prev.current;
    prev.current = status;
    if (!motion || status !== "done" || was !== "running") return;
    scale.setValue(0.4);
    Animated.spring(scale, { toValue: 1, friction: 5, tension: 160, useNativeDriver: true }).start();
  }, [motion, status, scale]);

  if (status === "running") {
    return (
      <View style={[styles.icon, styles.iconRunning]}>
        <ActivityIndicator size="small" color={color.primary} />
      </View>
    );
  }
  const failed = status === "failed";
  return (
    <Animated.View style={[styles.icon, failed ? styles.iconFailed : styles.iconDone, { transform: [{ scale }] }]}>
      {failed ? <X size={14} color={color.dangerFg} strokeWidth={3} /> : <Check size={14} color={color.okFg} strokeWidth={3} />}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 0 },
  row: { flexDirection: "row", gap: space.md, minHeight: 36 },
  rail: { width: ICON, alignItems: "center" },
  line: { flex: 1, width: 2, minHeight: 8, marginVertical: 2, borderRadius: radius.pill, backgroundColor: color.border },
  lineDone: { backgroundColor: color.okBg },
  icon: { width: ICON, height: ICON, borderRadius: ICON / 2, alignItems: "center", justifyContent: "center" },
  iconRunning: { backgroundColor: color.segment },
  iconDone: { backgroundColor: color.okBg },
  iconFailed: { backgroundColor: color.dangerBg },
  text: { flex: 1, paddingTop: 2, paddingBottom: space.md },
});
