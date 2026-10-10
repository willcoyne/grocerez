import type { Invite } from '@contracts/models';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, Card, DashedEmpty, ErrorState, InlineAdd, LoadingState, SectionLabel } from '@/components/ui';
import { color, space } from '@/theme';

import type { InviteViewProps } from './useOnboarding';

function PendingRow({ invite, canRevoke, onRevoke }: { invite: Invite; canRevoke: boolean; onRevoke: () => void }) {
  return (
    <Card style={styles.row} testID={`row-${invite.id}`}>
      <View style={styles.rowText}>
        <AppText weight="bold" numberOfLines={1} ellipsizeMode="tail">
          {invite.email}
        </AppText>
        <AppText variant="caption" color="muted">
          Waiting for them to sign in
        </AppText>
      </View>
      {canRevoke ? (
        <Button
          label="Revoke"
          variant="secondary"
          size="sm"
          onPress={onRevoke}
          accessibilityLabel={`Revoke invite to ${invite.email}`}
          testID={`revoke-${invite.id}`}
        />
      ) : null}
    </Card>
  );
}

/** DESIGN.md §4.4 Invite (stack screen, from onboarding or the Household tab). */
export function InviteView({
  groupName,
  email,
  onChangeEmail,
  error,
  sending,
  onSubmit,
  invites,
  status,
  onRetry,
  canRevoke,
  onRevoke,
  fromOnboarding,
  onFinish,
}: InviteViewProps) {
  const insets = useSafeAreaInsets();

  let pending: React.ReactNode;
  if (status === 'pending') pending = <LoadingState />;
  else if (status === 'error') pending = <ErrorState onRetry={onRetry} />;
  else if (!invites?.length) pending = <DashedEmpty>No pending invites yet.</DashedEmpty>;
  else
    pending = invites.map((inv) => (
      <PendingRow key={inv.id} invite={inv} canRevoke={canRevoke(inv)} onRevoke={() => onRevoke(inv)} />
    ));

  return (
    <KeyboardAvoidingView
      testID="screen-invite"
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 24 }]}
        keyboardShouldPersistTaps="handled">
        <View style={styles.titleBlock}>
          {groupName ? (
            <AppText variant="caption" weight="semi" color="muted">
              {groupName}
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
          onChangeText={onChangeEmail}
          onSubmit={onSubmit}
          buttonLabel="Invite"
          buttonVariant="primary"
          busy={sending}
          error={error}
          testID="invite-email"
        />

        <View style={styles.section}>
          <SectionLabel>Pending invites</SectionLabel>
          {pending}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Button
          label={fromOnboarding ? 'Continue to the app' : 'Done'}
          variant="dark"
          size="lg"
          fullWidth
          onPress={onFinish}
          testID="invite-finish"
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: space.screenX, paddingBottom: 32, gap: space.xxl },
  titleBlock: { gap: space.sm },
  section: { gap: space.md },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md },
  rowText: { flex: 1, minWidth: 160, gap: 2 },
  footer: { paddingHorizontal: space.screenX, paddingTop: space.md, backgroundColor: color.bg },
});
