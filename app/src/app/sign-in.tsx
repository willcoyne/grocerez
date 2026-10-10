import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { errorMessage } from "@/api/client";
import { DEMO_USERS } from "@/auth/demoUsers";
import { HealthBadge } from "@/components/HealthBadge";
import { useToast } from "@/components/ui";
import { Button, Card } from "@/components/ui";
import { config, missingConfig } from "@/config";
import { useAuth } from "@/state/AuthContext";
import { colors, fontSize, spacing } from "@/theme";

export default function SignInScreen() {
  const { signInWithGoogle, signInAsDemo } = useAuth();
  const { show: toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const showDemo = __DEV__ || !!config.demoKey;
  const missing = missingConfig();

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    try {
      await fn();
    } catch (e) {
      toast(errorMessage(e), { tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.logo} accessibilityRole="header">
            🛒 GrocerEZ
          </Text>
          <Text style={styles.tagline}>One shared grocery list for your whole household.</Text>
        </View>

        <Button
          title="Continue with Google"
          loading={busy === "google"}
          disabled={!!busy}
          onPress={() => run("google", signInWithGoogle)}
        />

        {showDemo ? (
          <Card style={styles.demo}>
            <Text style={styles.demoTitle}>Demo users (development only)</Text>
            {DEMO_USERS.map((u) => (
              <Button
                key={u.id}
                title={`${u.name} · ${u.note}`}
                variant="secondary"
                compact
                loading={busy === u.id}
                disabled={!!busy}
                accessibilityLabel={`Sign in as ${u.name}, ${u.note}`}
                onPress={() => run(u.id, () => signInAsDemo(u.id))}
              />
            ))}
          </Card>
        ) : null}

        <View style={styles.footer}>
          <HealthBadge />
          {__DEV__ && missing.length > 0 ? (
            <Text style={styles.missing}>Missing config: {missing.join(", ")} (see app/.env.example)</Text>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, justifyContent: "center", padding: spacing.xl, gap: spacing.lg, maxWidth: 520, width: "100%", alignSelf: "center" },
  hero: { alignItems: "center", gap: spacing.sm, marginBottom: spacing.xl },
  logo: { fontSize: 36, fontWeight: "800", color: colors.primary },
  tagline: { fontSize: fontSize.md, color: colors.textMuted, textAlign: "center" },
  demo: { gap: spacing.sm },
  demoTitle: { fontSize: fontSize.sm, fontWeight: "700", color: colors.textMuted },
  footer: { alignItems: "center", gap: spacing.xs, marginTop: spacing.lg },
  missing: { fontSize: fontSize.xs, color: colors.warning, textAlign: "center" },
});
