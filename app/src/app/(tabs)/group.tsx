import { useRouter } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";

import { errorMessage } from "@/api/client";
import { useDeleteGroup, useGroupDetail, useLeaveGroup, useRenameGroup } from "@/api/hooks/groups";
import { AlertsSection } from "@/components/AlertsSection";
import { EveryonesWants } from "@/components/EveryonesWants";
import { GroupInvites } from "@/components/GroupInvites";
import { GroupMembers } from "@/components/GroupMembers";
import { InviteBanner } from "@/components/InviteBanner";
import { ErrorState, LoadingState } from "@/components/States";
import { useToast } from "@/components/Toast";
import { Button, Card, Input, SectionHeader } from "@/components/ui";
import { confirm } from "@/lib/confirm";
import { useActiveGroup } from "@/state/ActiveGroupContext";
import { spacing } from "@/theme";

export default function GroupScreen() {
  const { activeGroupId } = useActiveGroup();
  const detail = useGroupDetail(activeGroupId);
  const router = useRouter();

  if (detail.isPending) return <LoadingState />;
  if (detail.isError) return <ErrorState error={detail.error} onRetry={() => detail.refetch()} />;
  const group = detail.data;

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={detail.isRefetching} onRefresh={() => void detail.refetch()} />}
    >
      <InviteBanner />
      <View style={styles.inner}>
        <AlertsSection groupId={group.id} />

        <SectionHeader
          title={`Members (${group.members.length})`}
          right={<Button title="Invite" compact onPress={() => router.push("/invite")} />}
        />
        <Card>
          <GroupMembers group={group} />
        </Card>

        <SectionHeader title="Pending invites" />
        <Card>
          <GroupInvites />
        </Card>

        <SectionHeader title="Everyone's wants" />
        <Card>
          <EveryonesWants groupId={group.id} />
        </Card>

        <SectionHeader title="Settings" />
        <GroupSettings groupId={group.id} name={group.name} isOwner={group.role === "owner"} />
      </View>
    </ScrollView>
  );
}

function GroupSettings({ groupId, name, isOwner }: { groupId: string; name: string; isOwner: boolean }) {
  const rename = useRenameGroup(groupId);
  const leave = useLeaveGroup(groupId);
  const del = useDeleteGroup(groupId);
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState(name);
  const onError = (e: unknown) => toast(errorMessage(e), { tone: "error" });

  return (
    <Card>
      {isOwner && editing ? (
        <View style={styles.gap}>
          <Input label="Household name" value={newName} onChangeText={setNewName} maxLength={80} />
          <Button
            title="Save name"
            disabled={!newName.trim()}
            loading={rename.isPending}
            onPress={() => rename.mutate(newName.trim(), { onSuccess: () => setEditing(false), onError })}
          />
        </View>
      ) : null}
      {isOwner && !editing ? <Button title="Rename household" variant="secondary" onPress={() => setEditing(true)} /> : null}
      <Button
        title="Leave household"
        variant="secondary"
        loading={leave.isPending}
        onPress={async () => {
          if (await confirm("Leave household?", `Your preferences in ${name} will be removed.`, "Leave", true)) {
            leave.mutate(undefined, { onError });
          }
        }}
      />
      {isOwner ? (
        <Button
          title="Delete household"
          variant="danger"
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
  container: { paddingBottom: spacing.xxl },
  inner: { paddingHorizontal: spacing.lg },
  gap: { gap: spacing.sm },
});
