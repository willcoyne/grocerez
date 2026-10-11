import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { errorMessage } from "@/api/client";
import { DEMO_USERS } from "@/auth/demoUsers";
import { LogoMark } from "@/components/brand/LogoMark";
import { HealthBadge } from "@/components/HealthBadge";
import { AppText, Button, SectionLabel, useToast } from "@/components/ui";
import { config, missingConfig } from "@/config";
import { useAuth } from "@/state/AuthContext";
import { color, space } from "@/theme";

/** DESIGN.md §4.1 SignIn, plus the dev-only demo users and the server health line. */
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
    <ScrollView testID="screen-signin" style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.top}>
        <LogoMark />
        <AppText variant="hero" accessibilityRole="header">
          GrocerEZ
        </AppText>
        <AppText variant="lead" color="ink2" style={styles.tagline}>
          One shared grocery list for your household. Everyone adds what they want, and the app works out what to buy.
        </AppText>
      </View>

      <View style={styles.bottom}>
        <Button
          label="Continue with Google"
          variant="dark"
          size="lg"
          fullWidth
          loading={busy === "google"}
          disabled={!!busy && busy !== "google"}
          onPress={() => void run("google", signInWithGoogle)}
          testID="signin-google"
        />
        <AppText variant="caption" color="muted" center>
          Household invites go to the email on your Google account.
        </AppText>

        {showDemo ? (
          <View style={styles.demo}>
            <SectionLabel>Demo users (development only)</SectionLabel>
            {DEMO_USERS.map((u) => (
              <Button
                key={u.id}
                label={`${u.name} · ${u.note}`}
                variant="secondary"
                size="sm"
                fullWidth
                loading={busy === u.id}
                disabled={!!busy && busy !== u.id}
                accessibilityLabel={`Sign in as ${u.name}, ${u.note}`}
                onPress={() => void run(u.id, () => signInAsDemo(u.id))}
                testID={`demo-user-${u.id}`}
              />
            ))}
          </View>
        ) : null}

        <View style={styles.footer}>
          <HealthBadge />
          {__DEV__ && missing.length > 0 ? (
            <AppText variant="caption" weight="bold" color="warnFg" center>
              {`Missing config: ${missing.join(", ")} (see app/.env.example)`}
            </AppText>
          ) : null}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: {
    flexGrow: 1,
    justifyContent: "space-between",
    paddingTop: 120,
    paddingHorizontal: 28,
    paddingBottom: 48,
    gap: 32,
    maxWidth: 520,
    width: "100%",
    alignSelf: "center",
  },
  top: { gap: space.xl },
  tagline: { maxWidth: 300 },
  bottom: { gap: space.md },
  demo: { gap: space.sm, marginTop: space.md },
  footer: { gap: space.xs, marginTop: space.md },
});
