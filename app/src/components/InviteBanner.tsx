import { useRouter } from "expo-router";
import { ChevronRight, Mail } from "lucide-react-native";
import { useEffect } from "react";
import { AppState, Pressable, StyleSheet } from "react-native";

import { useMyInvites } from "@/api/hooks/groups";
import { AppText } from "@/components/ui";
import { color, pressedOpacity, radius, size, space } from "@/theme";

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
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${text}. Open invites`}
      style={({ pressed }) => [styles.banner, pressed && { opacity: pressedOpacity }]}
      onPress={() => router.push("/invites")}
    >
      <Mail size={18} color={color.warnFg} />
      <AppText variant="bodyS" weight="bold" style={styles.flex}>
        {text}
      </AppText>
      <ChevronRight size={18} color={color.ink2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: size.hit,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    marginHorizontal: space.screenX,
    marginTop: space.md,
    backgroundColor: color.suggestBg,
    borderWidth: 1,
    borderColor: color.suggestBorder,
    borderRadius: radius.control,
  },
  flex: { flex: 1 },
});
