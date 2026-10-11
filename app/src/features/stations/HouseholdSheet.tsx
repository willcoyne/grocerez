/**
 * Household station (SPEC.md round 3: cork board on the right wall). Today's Household tab content in a station sheet:
 * recipe ideas / price my list entry points, alerts (expiring + recalls), members + invite by email, pending invites,
 * everyone's wants, household switcher + create, invites for me, and rename / leave / delete.
 *
 * Everything below the switcher is keyed by the active group id, so switching households never shows the previous
 * household's data or half-typed input (query keys are group-scoped too).
 */
import { useRouter } from "expo-router";
import { Check, ChefHat, House, Plus, Receipt } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Share, StyleSheet, View } from "react-native";

import { ApiError, errorMessage } from "@/api/client";
import {
  useCreateInvite,
  useDeleteGroup,
  useGroupDetail,
  useGroupInvites,
  useLeaveGroup,
  useRenameGroup,
} from "@/api/hooks/groups";
import { AlertsSection } from "@/components/AlertsSection";
import { EveryonesWants } from "@/components/EveryonesWants";
import { GroupInvites } from "@/components/GroupInvites";
import { GroupMembers } from "@/components/GroupMembers";
import { MyInvitesList } from "@/components/MyInvitesList";
import { AppText, Button, ErrorState, InlineAdd, LoadingState, TextField, useToast } from "@/components/ui";
import { confirm } from "@/lib/confirm";
import { isEmail, plural } from "@/lib/format";
import { useActiveGroup } from "@/state/ActiveGroupContext";
import { useAuth } from "@/state/AuthContext";
import { pressedOpacity, size, space } from "@/theme";

import { sheetTokens } from "./colors";
import { HeaderIcon, StationSection, ThemedButton, ThemedText } from "./parts";
import { StationSheet } from "./StationSheet";
import { useThemeUi } from "./theme";

export type HouseholdSheetProps = { visible: boolean; onClose: () => void };

export function HouseholdSheet({ visible, onClose }: HouseholdSheetProps) {
  const { activeGroupId, activeGroup } = useActiveGroup();
  return (
    <StationSheet
      visible={visible}
      onClose={onClose}
      title={activeGroup?.name ?? "Household"}
      subtitle={activeGroup ? plural(activeGroup.memberCount, "member") : "You're not in a household yet"}
      headerLeft={<HeaderIcon icon={House} />}
      testID="household-sheet"
    >
      {activeGroupId ? <HouseholdBody key={activeGroupId} groupId={activeGroupId} /> : <NoHousehold />}
    </StationSheet>
  );
}

function HouseholdBody({ groupId }: { groupId: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const detail = useGroupDetail(groupId);

  return (
    <>
      <View style={styles.actions}>
        <ThemedButton
          label="Recipe ideas"
          icon={ChefHat}
          accessibilityHint="Recipes from what's in the pantry"
          onPress={() => router.push("/recipes")}
          testID="household-recipes"
          style={styles.action}
        />
        <ThemedButton
          label="Price my list"
          icon={Receipt}
          variant="secondary"
          accessibilityHint="Estimate what the shopping list costs"
          onPress={() => router.push("/prices")}
          testID="household-prices"
          style={styles.action}
        />
      </View>

      <StationSection testID="household-alerts">
        <AlertsSection groupId={groupId} />
      </StationSection>

      <StationSection title="Members">
        {detail.isPending ? (
          <LoadingState testID="household-members-loading" />
        ) : detail.isError ? (
          <ErrorState message={errorMessage(detail.error)} onRetry={() => void detail.refetch()} testID="household-members-error" />
        ) : (
          <GroupMembers group={detail.data} meId={user?.id} />
        )}
        <InviteByEmail groupId={groupId} />
      </StationSection>

      <StationSection title="Pending invites">
        <GroupInvites />
      </StationSection>

      <StationSection title="Everyone's wants" subtitle="Anything here that isn't in the pantry goes on the list.">
        <EveryonesWants groupId={groupId} meId={user?.id} />
      </StationSection>

      <HouseholdSwitcher />

      <StationSection title="Invites for you">
        <MyInvitesList />
      </StationSection>

      {detail.data ? (
        <StationSection title="Manage household">
          <ManageHousehold groupId={groupId} name={detail.data.name} isOwner={detail.data.role === "owner"} />
        </StationSection>
      ) : null}
    </>
  );
}

/** Empty state: no household yet. Create one, or accept an invite (shows my email while I wait). */
function NoHousehold() {
  const router = useRouter();
  return (
    <>
      <ThemedText>Create a household, or ask someone to invite you. Invites arrive here when you sign in.</ThemedText>
      <ThemedButton label="Create a household" icon={Plus} onPress={() => router.push("/create-group")} testID="household-create" />
      <StationSection title="Invites for you">
        <MyInvitesList />
      </StationSection>
    </>
  );
}

/**
 * Invite by email (same rules as the /invite screen): the invite is tied to the Google email, so the "Tell them"
 * message carries no code or link secret.
 */
function InviteByEmail({ groupId }: { groupId: string }) {
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

  return (
    <View style={styles.invite}>
      <InlineAdd
        label="Invite by email"
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
        testID="household-invite"
      />
      <AppText variant="caption" color="muted">
        Use the email they sign in with on Google. Only that account can accept.
      </AppText>
      {lastInvited ? (
        <Button
          label="Tell them"
          variant="secondary"
          size="sm"
          onPress={() =>
            void Share.share({ message: `I invited you to our GrocerEZ household. Sign in with ${lastInvited} to accept.` })
          }
        />
      ) : null}
    </View>
  );
}

/** My households as a radio group (switches the active household) + create another one. */
function HouseholdSwitcher() {
  const { groups, activeGroupId, setActiveGroupId } = useActiveGroup();
  const router = useRouter();
  const ui = useThemeUi();
  const t = sheetTokens(ui);

  return (
    <StationSection title={groups.length > 1 ? "Your households" : "Your household"} bare>
      <View accessibilityRole="radiogroup" accessibilityLabel="Your households" style={styles.groups}>
        {groups.map((g) => {
          const selected = g.id === activeGroupId;
          return (
            <Pressable
              key={g.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={`${g.name}, ${plural(g.memberCount, "member")}`}
              accessibilityHint={selected ? undefined : "Switches to this household"}
              onPress={() => {
                if (!selected) setActiveGroupId(g.id);
              }}
              testID={`household-option-${g.id}`}
              style={({ pressed }) => [
                styles.option,
                {
                  backgroundColor: t.contentSurface,
                  borderColor: selected ? ui.accent : t.contentBorder,
                  borderWidth: selected ? Math.max(2, t.border) : Math.max(1, ui.borderWidth),
                  borderRadius: t.cardRadius,
                },
                pressed && { opacity: pressedOpacity },
              ]}
            >
              <View style={styles.flex}>
                <AppText variant="bodyL" weight="heavy">
                  {g.name}
                </AppText>
                <AppText variant="caption" color="muted">
                  {selected ? `${plural(g.memberCount, "member")} · Current` : plural(g.memberCount, "member")}
                </AppText>
              </View>
              {selected ? <Check size={22} color={ui.accent} strokeWidth={3} /> : null}
            </Pressable>
          );
        })}
      </View>
      <ThemedButton
        label="Create another household"
        icon={Plus}
        variant="secondary"
        onPress={() => router.push("/create-group")}
        testID="household-create"
      />
    </StationSection>
  );
}

/** Rename (owner), leave, delete (owner). Same behaviour as the Household tab. */
function ManageHousehold({ groupId, name, isOwner }: { groupId: string; name: string; isOwner: boolean }) {
  const rename = useRenameGroup(groupId);
  const leave = useLeaveGroup(groupId);
  const del = useDeleteGroup(groupId);
  const { show: toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState(name);
  const onError = (e: unknown) => toast(errorMessage(e), { tone: "error" });

  return (
    <View style={styles.manage}>
      {isOwner && editing ? (
        <>
          <TextField label="Household name" value={newName} onChangeText={(v) => setNewName(v.slice(0, 80))} testID="household-rename" />
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
            leave.mutate(undefined, { onSuccess: () => toast(`You left ${name}`), onError });
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
            if (await confirm("Delete household?", `${name}, its pantry and list will be deleted for everyone.`, "Delete", true)) {
              del.mutate(undefined, { onSuccess: () => toast(`${name} was deleted`), onError });
            }
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  action: { flexGrow: 1, flexBasis: 150 },
  invite: { gap: space.sm },
  groups: { gap: space.sm },
  option: {
    minHeight: size.hit + 12,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  flex: { flex: 1 },
  manage: { gap: space.sm },
});
