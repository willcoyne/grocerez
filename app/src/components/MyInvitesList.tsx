import * as Clipboard from "expo-clipboard";
import { StyleSheet, Text, View } from "react-native";

import { errorMessage } from "@/api/client";
import { useAcceptInvite, useDeclineInvite, useMyInvites } from "@/api/hooks/groups";
import { useActiveGroup } from "@/state/ActiveGroupContext";
import { useAuth } from "@/state/AuthContext";
import { colors, fontSize, spacing } from "@/theme";
import { ErrorState, LoadingState } from "./States";
import { useToast } from "@/components/ui";
import { Button, Card } from "./ui";

/** "Waiting to join someone? Ask them to invite you@gmail.com" with a copy button. */
export function WaitingForInvite() {
  const { user } = useAuth();
  const { show: toast } = useToast();
  if (!user) return null;
  return (
    <Card>
      <Text style={styles.body}>
        Waiting to join someone? Ask them to invite <Text style={styles.email}>{user.email}</Text>.
      </Text>
      <Text style={styles.muted}>Invites appear here when you sign in with that Google account.</Text>
      <Button
        title="Copy my email"
        variant="secondary"
        compact
        onPress={async () => {
          await Clipboard.setStringAsync(user.email);
          toast("Email copied");
        }}
      />
    </Card>
  );
}

/**
 * Pending invites for my verified email (GET /me/invites) with Accept / Decline.
 * Accept → refresh groups → make it the active group → `onAccepted` (usually: go to the tabs).
 */
export function MyInvitesList({ onAccepted, showWaiting = true }: { onAccepted?: () => void; showWaiting?: boolean }) {
  const invites = useMyInvites();
  const accept = useAcceptInvite();
  const decline = useDeclineInvite();
  const { setActiveGroupId } = useActiveGroup();
  const { show: toast } = useToast();

  if (invites.isPending) return <LoadingState message="Checking for invites…" />;
  if (invites.isError) return <ErrorState error={invites.error} onRetry={() => invites.refetch()} />;
  if (invites.data.length === 0) return showWaiting ? <WaitingForInvite /> : null;

  return (
    <View style={styles.list}>
      {invites.data.map((inv) => {
        const busy = (accept.isPending && accept.variables === inv.id) || (decline.isPending && decline.variables === inv.id);
        const members = `${inv.group.memberCount} member${inv.group.memberCount === 1 ? "" : "s"}`;
        return (
          <Card key={inv.id}>
            <Text style={styles.body} accessibilityRole="text">
              {inv.invitedBy?.displayName ?? "Someone"} invited you to <Text style={styles.groupName}>{inv.group.name}</Text>
              {" · "}
              {members}
            </Text>
            <View style={styles.row}>
              <Button
                title="Accept"
                accessibilityLabel={`Accept invite to ${inv.group.name}`}
                loading={accept.isPending && accept.variables === inv.id}
                disabled={busy}
                style={styles.flex}
                onPress={() =>
                  accept.mutate(inv.id, {
                    onSuccess: (group) => {
                      setActiveGroupId(group.id);
                      toast(`You joined ${group.name}`);
                      onAccepted?.();
                    },
                    onError: (e) => toast(errorMessage(e), { tone: "error" }),
                  })
                }
              />
              <Button
                title="Decline"
                variant="secondary"
                accessibilityLabel={`Decline invite to ${inv.group.name}`}
                loading={decline.isPending && decline.variables === inv.id}
                disabled={busy}
                style={styles.flex}
                onPress={() => decline.mutate(inv.id, { onError: (e) => toast(errorMessage(e), { tone: "error" }) })}
              />
            </View>
          </Card>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  row: { flexDirection: "row", gap: spacing.sm },
  flex: { flex: 1 },
  body: { fontSize: fontSize.md, color: colors.text },
  groupName: { fontWeight: "700", fontStyle: "italic" },
  email: { fontWeight: "700" },
  muted: { fontSize: fontSize.sm, color: colors.textMuted },
});
