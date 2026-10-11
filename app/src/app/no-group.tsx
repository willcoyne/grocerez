import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MyInvitesList } from "@/components/MyInvitesList";
import { AppText, Button, SectionLabel } from "@/components/ui";
import { useAuth } from "@/state/AuthContext";
import { color, space } from "@/theme";

/** DESIGN.md §4.2 Household: signed in but not in any household. Invites first, then "Create a household". */
export default function NoGroupScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      testID="screen-household"
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 64 }]}
    >
      <View style={styles.titleBlock}>
        {user ? (
          <AppText variant="caption" weight="semi" color="muted">
            {`Signed in as ${user.displayName} · ${user.email}`}
          </AppText>
        ) : null}
        <AppText variant="h1" accessibilityRole="header">
          Join or start a household
        </AppText>
      </View>

      <View style={styles.section}>
        <SectionLabel>Invites for you</SectionLabel>
        <MyInvitesList />
      </View>

      <View style={styles.divider} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={styles.line} />
        <AppText variant="caption" weight="semi" color="muted">
          or
        </AppText>
        <View style={styles.line} />
      </View>

      <Button label="Create a household" variant="secondary" size="lg" fullWidth onPress={() => router.push("/create-group")} />
      <Button label="Sign out" variant="ghost" onPress={() => void signOut()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: space.screenX, paddingBottom: 48, gap: space.xxl, maxWidth: 560, width: "100%", alignSelf: "center" },
  titleBlock: { gap: space.xs },
  section: { gap: space.md },
  divider: { flexDirection: "row", alignItems: "center", gap: space.md },
  line: { flex: 1, height: 1, backgroundColor: color.border },
});
