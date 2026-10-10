import { useRouter } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";

import { errorMessage } from "@/api/client";
import { useDeleteGroup, useGroupDetail, useGroupInvites, useLeaveGroup, useRenameGroup } from "@/api/hooks/groups";
import { AlertsSection } from "@/components/AlertsSection";
import { EveryonesWants } from "@/components/EveryonesWants";
import { GroupMembers } from "@/components/GroupMembers";
import { TabHeader } from "@/components/GroupSwitcher";
import { InviteBanner } from "@/components/InviteBanner";
import { AppText, Button, Card, ErrorState, LoadingState, SectionLabel, TextField, useToast } from "@/components/ui";
import { confirm } from "@/lib/confirm";
import { useActiveGroup } from "@/state/ActiveGroupContext";
import { useAuth } from "@/state/AuthContext";
import { space } from "@/theme";

/** Household tab (DESIGN.md §4.8) plus carson extras: alerts, recipes, and "Manage household". */
export default function GroupScreen() {
  const { activeGroupId } = useActiveGroup();
  const { user } = useAuth();
  const detail = useGroupDetail(activeGroupId);
  const invites = useGroupInvites(activeGroupId);
  const router = useRouter();
  const pending = invites.data?.length ?? 0;

  return (
    <View style={styles.screen} testID="tab-group">
      <TabHeader title="Household" />
      {detail.isPending ? (
        <LoadingState />
      ) : detail.isError ? (
        <View style={styles.content}>
          <ErrorState message={errorMessage(detail.error)} onRetry={() => void detail.refetch()} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={detail.isRefetching} onRefresh={() => void detail.refetch()} />}
        >
          <InviteBanner />
          <AlertsSection groupId={detail.data.id} />

          <SectionLabel>Members</SectionLabel>
          <GroupMembers group={detail.data} meId={user?.id} />
          <Button
            label={pending > 0 ? `Invite someone · ${pending} pending` : "Invite someone"}
            variant="secondary"
            fullWidth
            onPress={() => router.push("/invite")}
          />

          <SectionLabel style={styles.gapTop}>Everyone&apos;s wants</SectionLabel>
          <AppText variant="caption" color="muted">
            All preferences combined. Anything here that isn&apos;t in the cabinet goes on the list.
          </AppText>
          <EveryonesWants groupId={detail.data.id} meId={user?.id} />
          <Button label="What can we cook?" variant="secondary" fullWidth onPress={() => router.push("/recipes")} />

          <SectionLabel style={styles.gapTop}>Manage household</SectionLabel>
          <GroupSettings groupId={detail.data.id} name={detail.data.name} isOwner={detail.data.role === "owner"} />
        </ScrollView>
      )}
    </View>
  );
}

function GroupSettings({ groupId, name, isOwner }: { groupId: string; name: string; isOwner: boolean }) {
  const rename = useRenameGroup(groupId);
  const leave = useLeaveGroup(groupId);
  const del = useDeleteGroup(groupId);
  const { show: toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState(name);
  const onError = (e: unknown) => toast(errorMessage(e), { tone: "error" });

  return (
    <Card style={styles.settings}>
      {isOwner && editing ? (
        <>
          <TextField label="Household name" value={newName} onChangeText={(t) => setNewName(t.slice(0, 80))} />
          <Button
            label="Save name"
            fullWidth
            disabled={!newName.trim()}
            loading={rename.isPending}
            onPress={() => rename.mutate(newName.trim(), { onSuccess: () => setEditing(false), onError })}
          />
        </>
      ) : null}
      {isOwner && !editing ? <Button label="Rename household" variant="secondary" fullWidth onPress={() => setEditing(true)} /> : null}
      <Button
        label="Leave household"
        variant="secondary"
        fullWidth
        loading={leave.isPending}
        onPress={async () => {
          if (await confirm("Leave household?", `Your preferences in ${name} will be removed.`, "Leave", true)) {
            leave.mutate(undefined, { onError });
          }
        }}
      />
      {isOwner ? (
        <Button
          label="Delete household"
          variant="danger-secondary"
          fullWidth
          loading={del.isPending}
          onPress={async () => {
            if (await confirm("Delete household?", `${name}, its cabinet and list will be deleted for everyone.`, "Delete", true)) {
              del.mutate(undefined, { onError });
            }
          }}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: space.screenX, gap: space.md, paddingBottom: space.xxl * 2 },
  gapTop: { marginTop: space.sm },
  settings: { gap: space.sm },
});
