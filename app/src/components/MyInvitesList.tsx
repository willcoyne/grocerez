import * as Clipboard from "expo-clipboard";
import { StyleSheet, View } from "react-native";

import { errorMessage } from "@/api/client";
import { useAcceptInvite, useDeclineInvite, useMyInvites } from "@/api/hooks/groups";
import { AppText, Avatar, Button, Card, DashedEmpty, ErrorState, LoadingState, useToast } from "@/components/ui";
import { plural } from "@/lib/format";
import { useActiveGroup } from "@/state/ActiveGroupContext";
import { useAuth } from "@/state/AuthContext";
import { radius, space } from "@/theme";

/** "No invites yet. Ask someone in your household to invite {email}." with a copy button. */
function WaitingForInvite() {
  const { user } = useAuth();
  const { show: toast } = useToast();
  if (!user) return null;
  return (
    <DashedEmpty>
      <View style={styles.waiting}>
        <AppText color="ink2" center>
          {`No invites yet. Ask someone in your household to invite ${user.email}.`}
        </AppText>
        <Button
          label="Copy my email"
          variant="secondary"
          size="sm"
          onPress={async () => {
            await Clipboard.setStringAsync(user.email);
            toast("Email copied");
          }}
        />
      </View>
    </DashedEmpty>
  );
}

/**
 * Pending invites for my verified email (GET /me/invites) as DESIGN.md §4.2 invite cards with Accept / Decline.
 * Accept → refresh groups → make it the active group → `onAccepted` (usually: go to the tabs).
 */
export function MyInvitesList({ onAccepted, showWaiting = true }: { onAccepted?: () => void; showWaiting?: boolean }) {
  const invites = useMyInvites();
  const accept = useAcceptInvite();
  const decline = useDeclineInvite();
  const { setActiveGroupId } = useActiveGroup();
  const { show: toast } = useToast();

  if (invites.isPending) return <LoadingState />;
  if (invites.isError) return <ErrorState message={errorMessage(invites.error)} onRetry={() => invites.refetch()} />;
  if (invites.data.length === 0) return showWaiting ? <WaitingForInvite /> : null;

  return (
    <View style={styles.list}>
      {invites.data.map((inv) => {
        const accepting = accept.isPending && accept.variables === inv.id;
        const declining = decline.isPending && decline.variables === inv.id;
        const inviter = inv.invitedBy?.displayName ?? "Someone";
        return (
          <Card key={inv.id} style={styles.card} testID={`invite-${inv.id}`}>
            <View style={styles.head}>
              <Avatar userId={inv.invitedBy?.id ?? inv.id} name={inviter} />
              <View style={styles.flex}>
                <AppText variant="bodyL" weight="heavy">{`${inviter} invited you`}</AppText>
                <AppText variant="caption" color="muted">
                  {`${inv.group.name} · ${plural(inv.group.memberCount, "member")}`}
                </AppText>
              </View>
            </View>
            <View style={styles.actions}>
              <Button
                label="Accept"
                flex
                accessibilityLabel={`Accept invite to ${inv.group.name}`}
                loading={accepting}
                disabled={declining}
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
                label="Decline"
                variant="secondary"
                flex
                accessibilityLabel={`Decline invite to ${inv.group.name}`}
                loading={declining}
                disabled={accepting}
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
  list: { gap: space.md },
  card: { borderRadius: radius.cardLg, padding: 16, gap: space.lg },
  head: { flexDirection: "row", alignItems: "center", gap: space.md },
  flex: { flex: 1, gap: 2 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  waiting: { alignItems: "center", gap: space.md },
});
