import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";

import { errorMessage } from "@/api/client";
import { useCreateGroup } from "@/api/hooks/groups";
import { useToast } from "@/components/ui";
import { Button, Input } from "@/components/ui";
import { useActiveGroup } from "@/state/ActiveGroupContext";
import { useAuth } from "@/state/AuthContext";
import { colors, fontSize, spacing } from "@/theme";

/** Name → POST /groups → make it the active group → straight to the Invite sheet. */
export default function CreateGroupScreen() {
  const [name, setName] = useState("");
  const create = useCreateGroup();
  const { setActiveGroupId } = useActiveGroup();
  const { finishOnboarding } = useAuth();
  const router = useRouter();
  const { show: toast } = useToast();

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(trimmed, {
      onSuccess: (group) => {
        setActiveGroupId(group.id);
        finishOnboarding();
        router.replace("/invite");
      },
      onError: (e) => toast(errorMessage(e), { tone: "error" }),
    });
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.hint}>Give your household a name everyone will recognize.</Text>
      <Input
        label="Household name"
        value={name}
        onChangeText={setName}
        placeholder="Hack Midwest House"
        maxLength={80}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={submit}
      />
      <Button title="Create" onPress={submit} loading={create.isPending} disabled={!name.trim()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.xl, gap: spacing.lg },
  hint: { color: colors.textMuted, fontSize: fontSize.md },
});
