import type { Invite } from "@contracts/groups";
import { StyleSheet, View } from "react-native";

import { errorMessage } from "@/api/client";
import { useGroupInvites, useRevokeInvite } from "@/api/hooks/groups";
import { AppText, Button, Card, DashedEmpty, ErrorState, LoadingState, useToast } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import { useActiveGroup } from "@/state/ActiveGroupContext";
import { useAuth } from "@/state/AuthContext";
import { space } from "@/theme";

/** Pending invites of the active group (DESIGN.md §4.4 rows). Revoke is shown to the owner or the inviter only. */
export function GroupInvites() {
  const { activeGroup } = useActiveGroup();
  const { user } = useAuth();
  const groupId = activeGroup?.id ?? "";
  const invites = useGroupInvites(groupId);
  const revoke = useRevokeInvite(groupId);
  const { show: toast } = useToast();

  if (invites.isPending) return <LoadingState />;
  if (invites.isError) return <ErrorState message={errorMessage(invites.error)} onRetry={() => invites.refetch()} />;
  if (invites.data.length === 0) return <DashedEmpty>No pending invites yet.</DashedEmpty>;

  const onRevoke = (inv: Invite) =>
    revoke.mutate(inv.id, {
      onSuccess: () => toast(`Invite to ${inv.email} revoked`),
      onError: (e) => toast(errorMessage(e), { tone: "error" }),
    });

  return (
    <View style={styles.list}>
      {invites.data.map((inv) => {
        const canRevoke = activeGroup?.role === "owner" || inv.invitedBy?.id === user?.id;
        return (
          <Card key={inv.id} style={styles.row} testID={`row-${inv.id}`}>
            <View style={styles.text}>
              <AppText weight="bold" numberOfLines={1} ellipsizeMode="tail">
                {inv.email}
              </AppText>
              <AppText variant="caption" color="muted">
                {`Waiting for them to sign in · invited by ${inv.invitedBy?.displayName ?? "a former member"} ${timeAgo(inv.createdAt)}`}
              </AppText>
            </View>
            {canRevoke ? (
              <Button
                label="Revoke"
                variant="secondary"
                size="sm"
                loading={revoke.isPending && revoke.variables === inv.id}
                accessibilityLabel={`Revoke invite to ${inv.email}`}
                onPress={() => onRevoke(inv)}
              />
            ) : null}
          </Card>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.md },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.md },
  text: { flex: 1, minWidth: 160, gap: 2 },
});
