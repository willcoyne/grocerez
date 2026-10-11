import type { Dietary } from "@contracts/dietary";
import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { errorMessage } from "@/api/client";
import { useUpdateDietary, useUpdateMe } from "@/api/hooks/me";
import { DietaryPicker } from "@/components/DietaryPicker";
import { MyInvitesList } from "@/components/MyInvitesList";
import { AppText, Button, SectionLabel, TextField, useToast } from "@/components/ui";
import { useActiveGroup } from "@/state/ActiveGroupContext";
import { useAuth } from "@/state/AuthContext";
import { color, space } from "@/theme";

const ZIP = /^\d{5}$/;

/** Three short, skippable steps: name + ZIP → diets + allergens → join or create a household. */
export default function OnboardingScreen() {
  const { user, finishOnboarding } = useAuth();
  const { groups } = useActiveGroup();
  const router = useRouter();
  const { show: toast } = useToast();
  const insets = useSafeAreaInsets();
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
    <KeyboardAvoidingView testID="screen-onboarding" behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.screen}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 48 }]}
        keyboardShouldPersistTaps="handled"
      >
        <AppText variant="micro" color="muted" accessibilityLabel={`Step ${step + 1} of 3`}>
          {`Step ${step + 1} of 3`}
        </AppText>

        {step === 0 ? (
          <View style={styles.step}>
            <AppText variant="h1" accessibilityRole="header">
              Welcome! What should we call you?
            </AppText>
            <TextField label="Display name" value={name} onChangeText={setName} autoComplete="name" />
            <TextField
              label="ZIP code (for price estimates)"
              value={zip}
              onChangeText={(t) => setZip(t.replace(/\D/g, "").slice(0, 5))}
              keyboardType="number-pad"
              placeholder="64105"
              error={zipInvalid ? "ZIP codes have 5 digits." : null}
            />
            <Button label="Next" size="lg" fullWidth onPress={saveProfile} loading={updateMe.isPending} disabled={zipInvalid} />
            <Button label="Skip" variant="ghost" onPress={() => setStep(1)} />
          </View>
        ) : null}

        {step === 1 ? (
          <View style={styles.step}>
            <AppText variant="h1" accessibilityRole="header">
              Any diets or allergies?
            </AppText>
            <AppText color="ink2">{"Your allergies are flagged on the household's shopping list, with your name."}</AppText>
            <DietaryPicker value={dietary} onChange={setDietary} />
            <Button label="Next" size="lg" fullWidth onPress={saveDietary} loading={updateDietary.isPending} />
            <Button label="Skip" variant="ghost" onPress={() => setStep(2)} />
          </View>
        ) : null}

        {step === 2 ? (
          <View style={styles.step}>
            <AppText variant="h1" accessibilityRole="header">
              Join your household
            </AppText>
            <SectionLabel>Invites for you</SectionLabel>
            <MyInvitesList onAccepted={finishOnboarding} />
            {groups.length > 0 ? (
              <Button label="Go to my household" size="lg" fullWidth onPress={finishOnboarding} />
            ) : (
              <Button label="Create a household" variant="secondary" size="lg" fullWidth onPress={() => router.push("/create-group")} />
            )}
            <Button label="Skip for now" variant="ghost" onPress={finishOnboarding} />
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: space.screenX, paddingBottom: 48, gap: space.lg, maxWidth: 560, width: "100%", alignSelf: "center" },
  step: { gap: space.lg },
});
