import { ScrollView, StyleSheet, View } from 'react-native';

import {
  AppText,
  Avatar,
  Button,
  Card,
  DashedEmpty,
  ErrorState,
  LoadingState,
  ScreenHeader,
  SectionLabel,
  StatusChip,
} from '@/components/ui';
import { color, space } from '@/theme';

import type { MemberRow } from './useHousehold';
import type { WantRow } from './wants';

export type GroupViewProps = {
  groupName?: string;
  memberCount?: number;
  status: 'loading' | 'error' | 'ready';
  members: MemberRow[] | null;
  wants: WantRow[] | null;
  pendingInvites: number;
  onInvite: () => void;
  onRetry: () => void;
};

/** Presentational Household tab (DESIGN.md §4.8). */
export function GroupView({
  groupName,
  memberCount,
  status,
  members,
  wants,
  pendingInvites,
  onInvite,
  onRetry,
}: GroupViewProps) {
  return (
    <View testID="tab-group" style={styles.root}>
      <ScreenHeader groupName={groupName} memberCount={memberCount} title="Household" />
      <ScrollView contentContainerStyle={styles.content}>
        {status === 'loading' ? <LoadingState /> : null}
        {status === 'error' ? <ErrorState onRetry={onRetry} /> : null}
        {status === 'ready' && members && wants ? (
          <>
            <SectionLabel>Members</SectionLabel>
            <View style={styles.list}>
              {members.map((m) => (
                <MemberCard key={m.id} member={m} />
              ))}
            </View>
            <Button
              label={pendingInvites > 0 ? `Invite someone · ${pendingInvites} pending` : 'Invite someone'}
              variant="secondary"
              size="md"
              fullWidth
              onPress={onInvite}
              testID="invite-button"
            />

            <View style={styles.wantsHead}>
              <SectionLabel>Everyone&apos;s wants</SectionLabel>
              <AppText variant="caption" color="muted">
                All preferences combined. Anything here that isn&apos;t in the cabinet goes on the list.
              </AppText>
            </View>
            {wants.length === 0 ? (
              <DashedEmpty testID="wants-empty">No one has added preferences yet.</DashedEmpty>
            ) : (
              <View style={styles.list}>
                {wants.map((w) => (
                  <WantCard key={w.itemId} want={w} />
                ))}
              </View>
            )}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function MemberCard({ member }: { member: MemberRow }) {
  return (
    <Card
      testID={`member-${member.id}`}
      accessible
      accessibilityLabel={`${member.name}, ${member.roleLabel}, ${member.allergyLine}`}
      style={styles.row}>
      <Avatar userId={member.id} name={member.displayName} />
      <View style={styles.rowMain}>
        <AppText variant="bodyL" weight="heavy">
          {member.name}
        </AppText>
        <AppText variant="caption" color="muted">
          {member.allergyLine}
        </AppText>
      </View>
      <AppText variant="micro" weight="bold" color="ink2">
        {member.roleLabel}
      </AppText>
    </Card>
  );
}

function WantCard({ want }: { want: WantRow }) {
  const chip = want.inCabinet ? 'In cabinet' : 'On the list';
  return (
    <Card
      testID={`row-${want.itemId}`}
      accessible
      accessibilityLabel={`${want.name}, wanted by ${want.wantedBy}, ${chip}`}
      style={[styles.row, styles.wantRow]}>
      <View style={styles.rowMain}>
        <AppText variant="bodyL" weight="heavy">
          {want.name}
        </AppText>
        <AppText variant="caption" color="muted">
          {`Wanted by ${want.wantedBy}`}
        </AppText>
      </View>
      <StatusChip label={chip} tone={want.inCabinet ? 'ok' : 'warn'} testID={`status-${want.itemId}`} />
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: space.screenX, paddingVertical: space.xl, gap: space.md },
  list: { gap: space.sm },
  wantsHead: { gap: space.xs, marginTop: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  wantRow: { paddingVertical: 10, paddingHorizontal: space.md },
  rowMain: { flex: 1, minWidth: 120, gap: 2 },
});
