import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { errorMessage } from "@/api/client";
import { colors, fontSize, spacing } from "@/theme";
import { Button } from "./ui";

/** The four states every list screen handles: loading, empty, error (retry), data. */
export function LoadingState({ message = "Loading…" }: { message?: string }) {
  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={message}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.muted}>{message}</Text>
    </View>
  );
}

export function ErrorState({ error, onRetry, title = "Couldn't load this" }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <View style={styles.center} accessibilityRole="alert">
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.muted}>{errorMessage(error)}</Text>
      {onRetry ? <Button title="Try again" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

export function EmptyState({ title, message, children }: { title: string; message?: ReactNode; children?: ReactNode }) {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.muted}>{message}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  title: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text, textAlign: "center" },
  muted: { fontSize: fontSize.md, color: colors.textMuted, textAlign: "center" },
});
