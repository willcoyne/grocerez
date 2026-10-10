import type { MyInvite } from '@contracts/models';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Avatar, Button, Card, DashedEmpty, ErrorState, LoadingState, SectionLabel } from '@/components/ui';
import { plural } from '@/lib/format';
import { color, radius, space } from '@/theme';

import type { HouseholdViewProps } from './useOnboarding';

function InviteCard({
  invite,
  accepting,
  onAccept,
  onDecline,
}: {
  invite: MyInvite;
  accepting: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const inviter = invite.invitedBy?.displayName ?? 'Someone';
  const groupName = invite.group.name;
  return (
    <Card style={styles.inviteCard} testID={`invite-${invite.id}`}>
      <View style={styles.inviteHead}>
        <Avatar userId={invite.invitedBy?.id ?? invite.id} name={inviter} />
        <View style={styles.flexText}>
          <AppText variant="bodyL" weight="heavy">{`${inviter} invited you`}</AppText>
          <AppText variant="caption" color="muted">
            {`${groupName} · ${plural(invite.group.memberCount, 'member')}`}
          </AppText>
        </View>
      </View>
      <View style={styles.actions}>
        <Button
          label="Accept"
          variant="primary"
          flex
          loading={accepting}
          onPress={onAccept}
          accessibilityLabel={`Accept invite to ${groupName}`}
          testID={`accept-${invite.id}`}
        />
        <Button
          label="Decline"
          variant="secondary"
          flex
          disabled={accepting}
          onPress={onDecline}
          accessibilityLabel={`Decline invite to ${groupName}`}
          testID={`decline-${invite.id}`}
        />
      </View>
    </Card>
  );
}

/** DESIGN.md §4.2 Household (signed in, no group yet). */
export function HouseholdView({
  user,
  invites,
  status,
  onRetry,
  acceptingId,
  onAccept,
  onDecline,
  onCreate,
}: HouseholdViewProps) {
  let body: React.ReactNode;
  if (status === 'pending') body = <LoadingState />;
  else if (status === 'error') body = <ErrorState onRetry={onRetry} />;
  else if (!invites?.length)
    body = <DashedEmpty>{`No invites yet. Ask someone in your household to invite ${user?.email ?? 'your email'}.`}</DashedEmpty>;
  else
    body = invites.map((inv) => (
      <InviteCard
        key={inv.id}
        invite={inv}
        accepting={acceptingId === inv.id}
        onAccept={() => onAccept(inv)}
        onDecline={() => onDecline(inv)}
      />
    ));

  return (
    <ScrollView testID="screen-household" style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.titleBlock}>
        {user ? (
          <AppText variant="caption" weight="semi" color="muted">
            {`Signed in as ${user.displayName} · ${user.email}`}
          </AppText>
        ) : null}
        <AppText variant="h1" accessibilityRole="header">
          Join or start a household
        </AppText>
      </View>

      <View style={styles.section}>
        <SectionLabel>Invites for you</SectionLabel>
        {body}
      </View>

      <View style={styles.divider} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={styles.line} />
        <AppText variant="caption" weight="semi" color="muted">
          or
        </AppText>
        <View style={styles.line} />
      </View>

      <Button label="Create a household" variant="secondary" size="lg" fullWidth onPress={onCreate} testID="household-create" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { paddingTop: 64, paddingHorizontal: space.screenX, paddingBottom: 48, gap: space.xxl },
  titleBlock: { gap: space.xs },
  section: { gap: space.md },
  inviteCard: { borderRadius: radius.cardLg, padding: 16, gap: space.lg },
  inviteHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flexText: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  divider: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  line: { flex: 1, height: 1, backgroundColor: color.border },
});
