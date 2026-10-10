import type { CabinetItem } from "@contracts/cabinet";
import type { AllergenFlag } from "@contracts/shoppingList";
import { StyleSheet, Text, View } from "react-native";

import { daysUntil, labelize, shortDate } from "@/lib/format";
import { colors, fontSize, radius, spacing } from "@/theme";

/** "⚠ Peanuts — Will": names the allergen and the member, readable without color (icon + words). */
export function AllergenBadge({ flag }: { flag: AllergenFlag }) {
  const allergen = labelize(flag.allergen);
  return (
    <View style={[styles.pill, styles.danger]} accessibilityLabel={`Allergen warning: ${allergen}, ${flag.displayName}`}>
      <Text style={[styles.text, { color: colors.danger }]} maxFontSizeMultiplier={1.8}>
        ⚠ {allergen} — {flag.displayName}
      </Text>
    </View>
  );
}

/** Expiration pill: green > 3 days, amber ≤ 3, red expired, "est." when the date is estimated. Words carry the meaning too. */
export function ExpirationPill({ expiresAt, source }: { expiresAt: string | null; source: CabinetItem["expirationSource"] }) {
  if (!expiresAt) return null;
  const days = daysUntil(expiresAt);
  const est = source === "estimated" ? " est." : "";
  const [tone, label] =
    days < 0
      ? [styles.danger, `Expired ${shortDate(expiresAt)}`]
      : days === 0
        ? [styles.warning, "Expires today"]
        : days <= 3
          ? [styles.warning, `Expires in ${days}d`]
          : [styles.success, `Exp ${shortDate(expiresAt)}`];
  const color = tone === styles.danger ? colors.danger : tone === styles.warning ? colors.warning : colors.success;
  return (
    <View style={[styles.pill, tone]} accessibilityLabel={`${label}${source === "estimated" ? ", estimated" : ""}`}>
      <Text style={[styles.text, { color }]} maxFontSizeMultiplier={1.8}>
        {label}
        {est}
      </Text>
    </View>
  );
}

export function StatusChip({ status }: { status: CabinetItem["status"] }) {
  if (status !== "running_low") return null;
  return (
    <View style={[styles.pill, styles.warning]} accessibilityLabel="Running low, on the shopping list">
      <Text style={[styles.text, { color: colors.warning }]}>Low · on list</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, borderWidth: 1, alignSelf: "flex-start" },
  text: { fontSize: fontSize.xs, fontWeight: "700" },
  danger: { backgroundColor: colors.dangerLight, borderColor: colors.danger },
  warning: { backgroundColor: colors.warningLight, borderColor: colors.warning },
  success: { backgroundColor: colors.successLight, borderColor: colors.success },
});
