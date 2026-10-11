import type { GroupDetail } from "@contracts/groups";
import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";

import { errorMessage } from "@/api/client";
import { useRemoveMember } from "@/api/hooks/groups";
import { AppText, Avatar, Button, Card, useToast } from "@/components/ui";
import { confirm } from "@/lib/confirm";
import { size, space } from "@/theme";

type Member = GroupDetail["members"][number];

/** Allergens per member, when the API includes them (see DECISIONS "Needs backend change"). null = unknown. */
function memberAllergens(m: Member): string[] | null {
  const value = (m as Member & { allergens?: unknown }).allergens;
  return Array.isArray(value) ? value.filter((a): a is string => typeof a === "string") : null;
}

/** Household tab → Members (DESIGN.md §4.8): one Card per member, plus Remove for the owner. */
export function GroupMembers({ group, meId }: { group: GroupDetail; meId?: string }) {
  const remove = useRemoveMember(group.id);
  const { show: toast } = useToast();
  const isOwner = group.role === "owner";

  return (
    <View style={styles.list}>
      {group.members.map((m) => {
        const allergens = memberAllergens(m);
        const me = m.id === meId;
        return (
          <Card key={m.id} style={styles.row} testID={`member-${m.id}`}>
            {m.avatarUrl ? (
              <Image source={{ uri: m.avatarUrl }} style={styles.avatar} accessibilityIgnoresInvertColors />
            ) : (
              <Avatar userId={m.id} name={m.displayName} />
            )}
            <View style={styles.flex}>
              <AppText variant="bodyL" weight="heavy">
                {me ? `${m.displayName} (you)` : m.displayName}
              </AppText>
              <AppText variant="caption" color="muted" numberOfLines={1}>
                {allergens === null
                  ? m.email
                  : allergens.length > 0
                    ? `Allergic to ${allergens.map((a) => a.replace(/_/g, " ")).join(", ")}`
                    : "No allergies set"}
              </AppText>
            </View>
            <View style={styles.right}>
              <AppText variant="micro" weight="bold" color="ink2">
                {m.role === "owner" ? "Owner" : "Member"}
              </AppText>
              {isOwner && !me ? (
                <Button
                  label="Remove"
                  variant="danger-secondary"
                  size="sm"
                  accessibilityLabel={`Remove ${m.displayName} from the household`}
                  onPress={async () => {
                    if (!(await confirm("Remove member?", `${m.displayName} will lose access to ${group.name}.`, "Remove", true))) return;
                    remove.mutate(m.id, { onError: (e) => toast(errorMessage(e), { tone: "error" }) });
                  }}
                />
              ) : null}
            </View>
          </Card>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  flex: { flex: 1, gap: 2 },
  right: { alignItems: "flex-end", gap: space.xs },
  avatar: { width: size.avatar, height: size.avatar, borderRadius: size.avatar / 2 },
});
