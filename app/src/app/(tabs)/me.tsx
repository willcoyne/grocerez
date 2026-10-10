import { ScrollView, StyleSheet, Text, View } from "react-native";

import { Button, Card } from "@/components/ui";
import { useAuth } from "@/state/AuthContext";
import { colors, fontSize, spacing } from "@/theme";

export default function MeScreen() {
  const { user, signOut } = useAuth();
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Card>
        <View>
          <Text style={styles.name}>{user?.displayName}</Text>
          <Text style={styles.muted}>{user?.email}</Text>
        </View>
      </Card>
      <Button title="Sign out" variant="secondary" onPress={() => void signOut()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.lg },
  name: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text },
  muted: { fontSize: fontSize.sm, color: colors.textMuted },
});
