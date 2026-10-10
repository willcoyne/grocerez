import { useState } from "react";
import { ScrollView, Share, StyleSheet, Text } from "react-native";

import { ApiError, errorMessage } from "@/api/client";
import { useCreateInvite } from "@/api/hooks/groups";
import { GroupInvites } from "@/components/GroupInvites";
import { useToast } from "@/components/ui";
import { Button, Input, SectionHeader } from "@/components/ui";
import { useActiveGroup } from "@/state/ActiveGroupContext";
import { colors, fontSize, spacing } from "@/theme";

/** Invite by email. The "Tell them" message contains no code or secret: the invite is tied to the Google email. */
export default function InviteSheet() {
  const { activeGroup } = useActiveGroup();
  const create = useCreateInvite(activeGroup?.id ?? "");
  const { show: toast } = useToast();
  const [email, setEmail] = useState("");
  const [lastInvited, setLastInvited] = useState<string | null>(null);
  const valid = /^\S+@\S+\.\S+$/.test(email.trim());

  function submit() {
    if (!valid) return;
    const address = email.trim().toLowerCase();
    create.mutate(address, {
      onSuccess: (inv) => {
        setLastInvited(inv.email);
        setEmail("");
        toast(`Invited ${inv.email}. They'll see it when they sign in with that Google account.`);
      },
      onError: (e) => {
        if (e instanceof ApiError && e.code === "ALREADY_MEMBER") toast("They're already in this household.", { tone: "error" });
        else toast(errorMessage(e), { tone: "error" });
      },
    });
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.hint}>
        Invite someone to <Text style={styles.bold}>{activeGroup?.name}</Text> with the email of their Google account.
      </Text>
      <Input
        label="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        placeholder="will@gmail.com"
        returnKeyType="send"
        onSubmitEditing={submit}
      />
      <Button title="Send invite" onPress={submit} loading={create.isPending} disabled={!valid} />
      {lastInvited ? (
        <Button
          title="Tell them"
          variant="secondary"
          onPress={() =>
            void Share.share({
              message: `I invited you to our GrocerEZ household. Sign in with ${lastInvited} to accept.`,
            })
          }
        />
      ) : null}
      <SectionHeader title="Pending invites" />
      <GroupInvites />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.xl, gap: spacing.md },
  hint: { color: colors.textMuted, fontSize: fontSize.md },
  bold: { fontWeight: "700", color: colors.text },
});
