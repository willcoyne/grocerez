import { StyleSheet, Text, View } from "react-native";

import { errorMessage } from "@/api/client";
import { useGroupInvites, useRevokeInvite } from "@/api/hooks/groups";
import { timeAgo } from "@/lib/format";
import { useActiveGroup } from "@/state/ActiveGroupContext";
import { useAuth } from "@/state/AuthContext";
import { colors, fontSize, spacing } from "@/theme";
import { ErrorState } from "./States";
import { useToast } from "@/components/ui";
import { Button } from "./ui";

/** Pending invites of the active group: email, "invited by Ian · 2h ago", and Revoke (owner or the inviter only). */
export function GroupInvites() {
  const { activeGroup } = useActiveGroup();
  const { user } = useAuth();
  const groupId = activeGroup?.id ?? "";
  const invites = useGroupInvites(groupId);
  const revoke = useRevokeInvite(groupId);
  const { show: toast } = useToast();

  if (invites.isPending) return <Text style={styles.muted}>Loading invites…</Text>;
  if (invites.isError) return <ErrorState error={invites.error} onRetry={() => invites.refetch()} />;
  if (invites.data.length === 0) return <Text style={styles.muted}>No pending invites.</Text>;

  return (
    <View style={styles.list}>
      {invites.data.map((inv) => {
        const canRevoke = activeGroup?.role === "owner" || inv.invitedBy?.id === user?.id;
        return (
          <View key={inv.id} style={styles.row}>
            <View style={styles.flex}>
              <Text style={styles.email}>{inv.email}</Text>
              <Text style={styles.muted}>
                invited by {inv.invitedBy?.displayName ?? "a former member"} · {timeAgo(inv.createdAt)}
              </Text>
            </View>
            {canRevoke ? (
              <Button
                title="Revoke"
                variant="ghost"
                compact
                accessibilityLabel={`Revoke invite for ${inv.email}`}
                onPress={() => revoke.mutate(inv.id, { onError: (e) => toast(errorMessage(e), { tone: "error" }) })}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  flex: { flex: 1 },
  email: { fontSize: fontSize.md, color: colors.text, fontWeight: "600" },
  muted: { fontSize: fontSize.sm, color: colors.textMuted },
});
