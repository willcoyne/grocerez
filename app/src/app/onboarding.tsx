import type { Dietary } from "@contracts/dietary";
import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { errorMessage } from "@/api/client";
import { useUpdateDietary, useUpdateMe } from "@/api/hooks/me";
import { DietaryPicker } from "@/components/DietaryPicker";
import { MyInvitesList } from "@/components/MyInvitesList";
import { useToast } from "@/components/ui";
import { Button, Input } from "@/components/ui";
import { useActiveGroup } from "@/state/ActiveGroupContext";
import { useAuth } from "@/state/AuthContext";
import { colors, fontSize, spacing } from "@/theme";

const ZIP = /^\d{5}$/;

/** Three short, skippable steps: name + ZIP → diets + allergens → join or create a household. */
export default function OnboardingScreen() {
  const { user, finishOnboarding } = useAuth();
  const { groups } = useActiveGroup();
  const router = useRouter();
  const { show: toast } = useToast();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(user?.displayName ?? "");
  const [zip, setZip] = useState(user?.zipCode ?? "");
  const [dietary, setDietary] = useState<Dietary>({ diets: [], allergens: [] });
  const updateMe = useUpdateMe();
  const updateDietary = useUpdateDietary();

  const zipInvalid = zip.length > 0 && !ZIP.test(zip);

  function saveProfile() {
    const body: { displayName?: string; zipCode?: string | null } = {};
    if (name.trim() && name.trim() !== user?.displayName) body.displayName = name.trim();
    if (zip && zip !== user?.zipCode) body.zipCode = zip;
    if (Object.keys(body).length === 0) return setStep(1);
    updateMe.mutate(body, {
      onSuccess: () => setStep(1),
      onError: (e) => toast(errorMessage(e), { tone: "error" }),
    });
  }

  function saveDietary() {
    updateDietary.mutate(dietary, {
      onSuccess: () => setStep(2),
      onError: (e) => toast(errorMessage(e), { tone: "error" }),
    });
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.safe}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.progress} accessibilityLabel={`Step ${step + 1} of 3`}>
            Step {step + 1} of 3
          </Text>

          {step === 0 ? (
            <View style={styles.step}>
              <Text style={styles.title} accessibilityRole="header">
                Welcome! What should we call you?
              </Text>
              <Input label="Display name" value={name} onChangeText={setName} autoComplete="name" maxLength={80} />
              <Input
                label="ZIP code (for price estimates)"
                value={zip}
                onChangeText={(t) => setZip(t.replace(/\D/g, "").slice(0, 5))}
                keyboardType="number-pad"
                maxLength={5}
                placeholder="64105"
              />
              {zipInvalid ? <Text style={styles.error}>ZIP codes have 5 digits.</Text> : null}
              <Button title="Next" onPress={saveProfile} loading={updateMe.isPending} disabled={zipInvalid} />
              <Button title="Skip" variant="ghost" onPress={() => setStep(1)} />
            </View>
          ) : null}

          {step === 1 ? (
            <View style={styles.step}>
              <Text style={styles.title} accessibilityRole="header">
                Any diets or allergies?
              </Text>
              <Text style={styles.muted}>Your allergens are flagged on your household&apos;s shopping list.</Text>
              <DietaryPicker value={dietary} onChange={setDietary} />
              <Button title="Next" onPress={saveDietary} loading={updateDietary.isPending} />
              <Button title="Skip" variant="ghost" onPress={() => setStep(2)} />
            </View>
          ) : null}

          {step === 2 ? (
            <View style={styles.step}>
              <Text style={styles.title} accessibilityRole="header">
                Join your household
              </Text>
              <MyInvitesList onAccepted={finishOnboarding} />
              {groups.length > 0 ? (
                <Button title="Go to my household" onPress={finishOnboarding} />
              ) : (
                <Button title="Create a household" variant="secondary" onPress={() => router.push("/create-group")} />
              )}
              <Button title="Skip for now" variant="ghost" onPress={finishOnboarding} />
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { padding: spacing.xl, gap: spacing.lg, maxWidth: 560, width: "100%", alignSelf: "center" },
  progress: { color: colors.textMuted, fontSize: fontSize.sm, fontWeight: "600" },
  step: { gap: spacing.md },
  title: { fontSize: fontSize.xl, fontWeight: "800", color: colors.text },
  muted: { color: colors.textMuted, fontSize: fontSize.md },
  error: { color: colors.danger, fontSize: fontSize.sm },
});
