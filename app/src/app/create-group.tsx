import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { errorMessage } from "@/api/client";
import { useCreateGroup } from "@/api/hooks/groups";
import { AppText, Button, TextField, useToast } from "@/components/ui";
import { useActiveGroup } from "@/state/ActiveGroupContext";
import { useAuth } from "@/state/AuthContext";
import { color, space } from "@/theme";

const DEFAULT_NAME = "Our house";

/** DESIGN.md §4.3 Create: name → POST /groups → make it the active group → the Invite screen. */
export default function CreateGroupScreen() {
  const [name, setName] = useState(DEFAULT_NAME);
  const create = useCreateGroup();
  const { groups, setActiveGroupId } = useActiveGroup();
  const { finishOnboarding } = useAuth();
  const router = useRouter();
  const { show: toast } = useToast();
  const insets = useSafeAreaInsets();

  function submit() {
    if (create.isPending) return;
    const fromOnboarding = groups.length === 0;
    create.mutate(name.trim() || DEFAULT_NAME, {
      onSuccess: (group) => {
        setActiveGroupId(group.id);
        finishOnboarding();
        router.replace(fromOnboarding ? "/invite?from=onboarding" : "/invite");
      },
      onError: (e) => toast(errorMessage(e), { tone: "error" }),
    });
  }

  return (
    <KeyboardAvoidingView testID="screen-create" style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.back}>
          <Button label="Back" variant="ghost" size="sm" onPress={() => router.back()} />
        </View>
        <View style={styles.titleBlock}>
          <AppText variant="h1" accessibilityRole="header">
            Name your household
          </AppText>
          <AppText color="ink2">{"You'll be the owner. You can invite people on the next screen."}</AppText>
        </View>
        <TextField
          label="Household name"
          value={name}
          onChangeText={setName}
          returnKeyType="done"
          onSubmitEditing={submit}
          autoFocus
          testID="create-name"
        />
        <Button label="Create household" size="lg" fullWidth loading={create.isPending} onPress={submit} testID="create-submit" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: space.screenX, paddingBottom: 48, gap: space.xxl, maxWidth: 560, width: "100%", alignSelf: "center" },
  back: { alignItems: "flex-start", marginLeft: -space.md },
  titleBlock: { gap: space.sm },
});
