import { useRouter } from "expo-router";
import { useEffect } from "react";
import { AppState, Pressable, StyleSheet, Text } from "react-native";

import { useMyInvites } from "@/api/hooks/groups";
import { colors, fontSize, spacing, TAP_TARGET } from "@/theme";

/** "You've been invited to X" banner on the tabs. Refetches my invites whenever the app returns to the foreground. */
export function InviteBanner() {
  const invites = useMyInvites();
  const router = useRouter();
  const { refetch } = invites;

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void refetch();
    });
    return () => sub.remove();
  }, [refetch]);

  const list = invites.data ?? [];
  if (list.length === 0) return null;
  const text =
    list.length === 1 ? `You've been invited to ${list[0].group.name}` : `You've been invited to ${list.length} households`;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${text}. Open invites`} style={styles.banner} onPress={() => router.push("/invites")}>
      <Text style={styles.text}>✉️ {text} ›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: colors.primaryLight, minHeight: TAP_TARGET, justifyContent: "center", paddingHorizontal: spacing.lg },
  text: { color: colors.primaryDark, fontWeight: "700", fontSize: fontSize.md },
});
