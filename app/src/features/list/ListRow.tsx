import type { ShoppingListItem } from "@contracts/shoppingList";
import { ScanBarcode, Sparkles, X } from "lucide-react-native";
import { StyleSheet, View } from "react-native";

import { AppText, Card, Checkbox, IconButton, StatusChip, type ChipTone } from "@/components/ui";
import { color, radius, space } from "@/theme";

export type ListRowProps = {
  row: ShoppingListItem;
  meId: string | undefined;
  /** userId → display name (members of the active household). */
  names: Map<string, string>;
  runningLow: boolean;
  syncing: boolean;
  /** "~$3.49" from the last price estimate (Prices screen), when there is one. */
  priceText?: string | null;
  onToggle: (row: ShoppingListItem) => void;
  onScan: (row: ShoppingListItem) => void;
  onDelete: (row: ShoppingListItem) => void;
};

function who(userId: string | null, meId: string | undefined, names: Map<string, string>): string {
  if (!userId) return "someone";
  if (userId === meId) return "you";
  return names.get(userId) ?? "someone";
}

function metaFor(row: ShoppingListItem, meId: string | undefined, names: Map<string, string>): string {
  if (row.checked) return `In the cart · checked by ${who(row.checkedBy, meId, names)}`;
  if (row.reason === "manual") return "Not in anyone's preferences";
  return `For ${row.wantedBy.map((w) => (w.userId === meId ? "you" : w.displayName)).join(", ")}`;
}

/** One shopping-list row (DESIGN.md §4.5), plus carson's scan and delete actions. */
export function ListRow({ row, meId, names, runningLow, syncing, priceText, onToggle, onScan, onDelete }: ListRowProps) {
  const name = row.item.name;
  const chips: { key: string; label: string; tone: ChipTone }[] = [
    ...row.allergenFlags.map((f) => ({
      key: `a-${f.userId}-${f.allergen}`,
      label: `Contains ${f.allergen.replace(/_/g, " ")} · ${f.userId === meId ? "you" : f.displayName}`,
      tone: "danger" as const,
    })),
    ...(runningLow ? [{ key: "low", label: "Running low at home", tone: "warn" as const }] : []),
    ...(row.reason === "manual"
      ? [{ key: "manual", label: row.addedBy ? `Added by ${who(row.addedBy, meId, names)}` : "Added by hand", tone: "neutral" as const }]
      : []),
  ];

  return (
    <Card muted={row.checked} style={styles.card} testID={`row-${row.itemId}`}>
      <Checkbox checked={row.checked} name={name} onPress={() => onToggle(row)} testID={`row-${row.itemId}-check`} />
      <View style={styles.body}>
        <View style={styles.titleLine}>
          <AppText variant="bodyL" weight="heavy" color={row.checked ? "muted" : "ink"} strike={row.checked} style={styles.name}>
            {name}
          </AppText>
          {priceText ? (
            <AppText variant="bodyS" weight="semi" color="ink2" testID={`row-${row.itemId}-price`}>
              {priceText}
            </AppText>
          ) : null}
          {syncing ? <View style={styles.syncDot} accessible accessibilityLabel="Syncing" testID={`row-${row.itemId}-syncing`} /> : null}
        </View>
        <AppText variant="caption" color="muted">
          {row.quantityText ? `${row.quantityText} · ` : ""}
          {metaFor(row, meId, names)}
        </AppText>
        {row.note ? <AgentNote note={row.note} /> : null}
        {chips.length > 0 ? (
          <View style={styles.chips}>
            {chips.map((c) => (
              <StatusChip key={c.key} label={c.label} tone={c.tone} />
            ))}
          </View>
        ) : null}
      </View>
      <View style={styles.actions}>
        <IconButton label={`Scan a product for ${name}`} onPress={() => onScan(row)}>
          <ScanBarcode size={20} color={color.ink2} />
        </IconButton>
        {row.reason === "manual" ? (
          <IconButton label={`Delete ${name} from the list`} onPress={() => onDelete(row)}>
            <X size={20} color={color.ink2} />
          </IconButton>
        ) : null}
      </View>
    </Card>
  );
}

/** The Pantry Agent's note ("✨ for Lemon chicken (Tue)"), marked as AI with a Sparkles icon instead of the emoji. */
function AgentNote({ note }: { note: string }) {
  const text = note.replace(/^✨\s*/, "");
  return (
    <View style={styles.note} accessible accessibilityLabel={`AI note: ${text}`}>
      <Sparkles size={12} color={color.ink2} strokeWidth={2.5} />
      <AppText variant="caption" weight="semi" color="ink2" style={styles.name}>
        {text.charAt(0).toUpperCase() + text.slice(1)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  note: { flexDirection: "row", alignItems: "center", gap: space.xs },
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.sm,
    paddingTop: space.sm,
    paddingRight: space.xs,
    paddingBottom: 10,
    paddingLeft: 6,
  },
  body: { flex: 1, gap: 2, paddingTop: space.sm },
  titleLine: { flexDirection: "row", alignItems: "center", gap: space.sm },
  name: { flexShrink: 1 },
  syncDot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: color.muted },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: space.xs },
  actions: { flexDirection: "row" },
});
