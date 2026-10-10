import type { GroupDetail } from "@contracts/groups";
import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";

import { errorMessage } from "@/api/client";
import { useRemoveMember } from "@/api/hooks/groups";
import { confirm } from "@/lib/confirm";
import { labelize } from "@/lib/format";
import { useAuth } from "@/state/AuthContext";
import { colors, fontSize, spacing } from "@/theme";
import { useToast } from "@/components/ui";
import { Button, Chip } from "./ui";

type Member = GroupDetail["members"][number];

/** Allergens per member, if the API includes them (see DECISIONS "Needs backend change"). */
function memberAllergens(m: Member): string[] {
  const value = (m as Member & { allergens?: unknown }).allergens;
  return Array.isArray(value) ? value.filter((a): a is string => typeof a === "string") : [];
}

export function GroupMembers({ group }: { group: GroupDetail }) {
  const { user } = useAuth();
  const remove = useRemoveMember(group.id);
  const { show: toast } = useToast();
  const isOwner = group.role === "owner";

  return (
    <View style={styles.list}>
      {group.members.map((m) => {
        const allergens = memberAllergens(m);
        return (
          <View key={m.id} style={styles.row} accessibilityLabel={`${m.displayName}, ${m.role}`}>
            {m.avatarUrl ? (
              <Image source={{ uri: m.avatarUrl }} style={styles.avatar} accessibilityIgnoresInvertColors />
            ) : (
              <View style={[styles.avatar, styles.initials]}>
                <Text style={styles.initialsText}>{m.displayName.slice(0, 1).toUpperCase()}</Text>
              </View>
            )}
            <View style={styles.flex}>
              <Text style={styles.name}>
                {m.displayName}
                {m.id === user?.id ? " (you)" : ""}
                {m.role === "owner" ? " · owner" : ""}
              </Text>
              <Text style={styles.muted}>{m.email}</Text>
              {allergens.length > 0 ? (
                <View style={styles.chips}>
                  {allergens.map((a) => (
                    <Chip key={a} tone="danger" label={`⚠ ${labelize(a)}`} accessibilityLabel={`${m.displayName} is allergic to ${labelize(a)}`} />
                  ))}
                </View>
              ) : null}
            </View>
            {isOwner && m.id !== user?.id ? (
              <Button
                title="Remove"
                variant="ghost"
                compact
                accessibilityLabel={`Remove ${m.displayName} from the household`}
                onPress={async () => {
                  if (!(await confirm("Remove member?", `${m.displayName} will lose access to ${group.name}.`, "Remove", true))) return;
                  remove.mutate(m.id, { onError: (e) => toast(errorMessage(e), { tone: "error" }) });
                }}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  flex: { flex: 1, gap: 2 },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  initials: { backgroundColor: colors.primaryLight, alignItems: "center", justifyContent: "center" },
  initialsText: { color: colors.primaryDark, fontWeight: "700", fontSize: fontSize.md },
  name: { fontSize: fontSize.md, fontWeight: "600", color: colors.text },
  muted: { fontSize: fontSize.sm, color: colors.textMuted },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xs },
});
