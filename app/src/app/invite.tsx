import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Share, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, errorMessage } from "@/api/client";
import { useCreateInvite, useGroupInvites } from "@/api/hooks/groups";
import { GroupInvites } from "@/components/GroupInvites";
import { AppText, Button, InlineAdd, SectionLabel, useToast } from "@/components/ui";
import { isEmail } from "@/lib/format";
import { useActiveGroup } from "@/state/ActiveGroupContext";
import { color, space } from "@/theme";

/**
 * DESIGN.md §4.4 Invite by email. Reachable from onboarding (`?from=onboarding`) and the Household tab.
 * "Tell them" shares a message with no code or secret: the invite is tied to the Google email.
 */
export default function InviteSheet() {
  const { from } = useLocalSearchParams<{ from?: string }>();
  const fromOnboarding = from === "onboarding";
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { activeGroup } = useActiveGroup();
  const groupId = activeGroup?.id ?? "";
  const create = useCreateInvite(groupId);
  const pending = useGroupInvites(groupId);
  const { show: toast } = useToast();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lastInvited, setLastInvited] = useState<string | null>(null);

  function submit() {
    const address = email.trim().toLowerCase();
    if (!isEmail(address)) return setError("Enter a full email address, like name@example.com");
    if (pending.data?.some((i) => i.email.toLowerCase() === address)) return setError(`You already invited ${address}`);
    create.mutate(address, {
      onSuccess: (inv) => {
        setLastInvited(inv.email);
        setEmail("");
        toast(`Invited ${inv.email}. They'll see it when they sign in.`);
      },
      onError: (e) => {
        if (e instanceof ApiError && e.code === "ALREADY_MEMBER") setError("They're already in this household.");
        else toast(errorMessage(e), { tone: "error" });
      },
    });
  }

  function finish() {
    if (!fromOnboarding && router.canGoBack()) router.back();
    else router.replace("/");
  }

  return (
    <KeyboardAvoidingView testID="screen-invite" style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.titleBlock}>
          {activeGroup ? (
            <AppText variant="caption" weight="semi" color="muted">
              {activeGroup.name}
            </AppText>
          ) : null}
          <AppText variant="h1" accessibilityRole="header">
            Invite your household
          </AppText>
          <AppText color="ink2">
            {"Enter the email they use with Google. Only that account can accept, and they'll see the invite when they sign in."}
          </AppText>
        </View>

        <InlineAdd
          label="Email address"
          placeholder="name@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          value={email}
          onChangeText={(t) => {
            setEmail(t);
            setError(null);
          }}
          onSubmit={submit}
          buttonLabel="Invite"
          buttonVariant="primary"
          busy={create.isPending}
          error={error}
          testID="invite-email"
        />

        {lastInvited ? (
          <Button
            label="Tell them"
            variant="secondary"
            onPress={() =>
              void Share.share({ message: `I invited you to our GrocerEZ household. Sign in with ${lastInvited} to accept.` })
            }
          />
        ) : null}

        <View style={styles.section}>
          <SectionLabel>Pending invites</SectionLabel>
          <GroupInvites />
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Button
          label={fromOnboarding ? "Continue to the app" : "Done"}
          variant="dark"
          size="lg"
          fullWidth
          onPress={finish}
          testID="invite-finish"
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: space.screenX, paddingBottom: 32, gap: space.xxl, maxWidth: 560, width: "100%", alignSelf: "center" },
  titleBlock: { gap: space.sm },
  section: { gap: space.md },
  footer: { paddingHorizontal: space.screenX, paddingTop: space.md, backgroundColor: color.bg },
});
