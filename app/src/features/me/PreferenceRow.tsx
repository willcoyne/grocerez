import type { Preference } from "@contracts/preferences";
import { X } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText, Button, Card, IconButton, StatusChip } from "@/components/ui";
import { color, space } from "@/theme";

/** Where the item stands for the household: in the cabinet, on the list, or neither (yet). */
export type PrefStatus = "in_cabinet" | "on_list" | null;

/**
 * One of my preferences (DESIGN.md §4.7): name, recurrence + status chips, Make one-time/staple, and X remove.
 * Tapping the name opens the quantity/note editor (carson extra).
 */
export function PreferenceRow({
  pref,
  status,
  disabled,
  onEdit,
  onToggleRecurrence,
  onRemove,
}: {
  pref: Preference;
  status: PrefStatus;
  /** Optimistic row not yet saved. */
  disabled?: boolean;
  onEdit: () => void;
  onToggleRecurrence: () => void;
  onRemove: () => void;
}) {
  const name = pref.item.name;
  const staple = pref.recurrence === "staple";
  const detail = [pref.quantityText, pref.note].filter(Boolean).join(" · ");
  return (
    <Card style={styles.card} testID={`row-${pref.itemId}`}>
      <Pressable
        style={styles.main}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${name}`}
        disabled={disabled}
        onPress={onEdit}
      >
        <AppText variant="bodyL" weight="heavy">
          {name}
        </AppText>
        {detail ? (
          <AppText variant="caption" color="muted">
            {detail}
          </AppText>
        ) : null}
        <View style={styles.chips}>
          <StatusChip tone="neutral" label={staple ? "Staple" : "This week only"} />
          {status === "in_cabinet" ? <StatusChip tone="ok" label="In cabinet" /> : null}
          {status === "on_list" ? <StatusChip tone="warn" label="On the list" /> : null}
        </View>
      </Pressable>
      <View style={styles.actions}>
        <Button
          label={staple ? "Make one-time" : "Make staple"}
          variant="ghost"
          size="sm"
          disabled={disabled}
          onPress={onToggleRecurrence}
          accessibilityLabel={staple ? `Make ${name} one-time` : `Make ${name} a staple`}
        />
        <IconButton label={`Remove ${name}`} onPress={onRemove} disabled={disabled}>
          <X size={20} color={color.ink2} />
        </IconButton>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    paddingTop: space.sm,
    paddingRight: 6,
    paddingBottom: space.sm,
    paddingLeft: space.lg,
    gap: space.xs,
  },
  main: { flex: 1, minWidth: 140, gap: space.xs },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  actions: { flexDirection: "row", alignItems: "center", marginLeft: "auto" },
});
