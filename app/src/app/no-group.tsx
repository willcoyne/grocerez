import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text } from "react-native";

import { MyInvitesList } from "@/components/MyInvitesList";
import { Button } from "@/components/ui";
import { useAuth } from "@/state/AuthContext";
import { colors, fontSize, spacing } from "@/theme";

/** Signed in but not in any household: pending invites first, then "Create a household". */
export default function NoGroupScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        Pending invites
      </Text>
      <MyInvitesList />
      <Button title="Create a household" onPress={() => router.push("/create-group")} />
      <Button title="Sign out" variant="ghost" onPress={() => void signOut()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.xl, gap: spacing.lg, maxWidth: 560, width: "100%", alignSelf: "center" },
  title: { fontSize: fontSize.xl, fontWeight: "800", color: colors.text },
});
