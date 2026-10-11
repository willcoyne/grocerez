/**
 * Recipe books station (SPEC.md round 3 addendum). The recipe collection is a later feature: this sheet shows a
 * "coming soon" placeholder shaped like the real thing (a shelf of recipe-card slots) plus two working entry points:
 * AI recipe ideas from the pantry (/recipes) and the meal-prep calendar.
 *
 * When the collection lands, replace <RecipeShelfPlaceholder/> with the real shelf; the rest of the sheet stays.
 */
import { useRouter } from "expo-router";
import { BookOpen, CalendarDays, ChefHat } from "lucide-react-native";
import { StyleSheet, View } from "react-native";

import { AiLabel } from "@/components/ui";
import { space } from "@/theme";

import { sheetTokens, withAlpha } from "./colors";
import { HeaderIcon, SoonTag, StationSection, ThemedButton, ThemedText } from "./parts";
import { StationSheet } from "./StationSheet";
import { useThemeUi } from "./theme";

export type RecipesSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** "Plan meals" link; the parent closes this sheet and opens the meal-prep station. Hidden when not given. */
  onOpenMealPrep?: () => void;
};

const SLOTS = ["Breakfast", "Weeknight dinners", "Baking", "Family favourites"];

export function RecipesSheet({ visible, onClose, onOpenMealPrep }: RecipesSheetProps) {
  const router = useRouter();
  return (
    <StationSheet
      visible={visible}
      onClose={onClose}
      title="Recipes"
      subtitle="Recipe collection — coming soon"
      headerLeft={<HeaderIcon icon={BookOpen} />}
      testID="recipes-sheet"
    >
      <ThemedText>
        Soon you&apos;ll keep your household&apos;s favourite recipes here, and cook from what&apos;s already in the pantry.
      </ThemedText>

      <StationSection title="Your collection" bare>
        <RecipeShelfPlaceholder />
      </StationSection>

      <View style={styles.cta}>
        <ThemedButton
          label="Recipe ideas from my pantry"
          icon={ChefHat}
          accessibilityHint="Suggests recipes that use what's in the pantry"
          onPress={() => router.push("/recipes")}
          testID="recipes-ideas"
        />
        <View style={styles.aiRow}>
          <AiLabel text="AI suggestions" />
        </View>
        {onOpenMealPrep ? (
          <ThemedButton
            label="Plan meals"
            icon={CalendarDays}
            variant="secondary"
            accessibilityHint="Opens the meal-prep calendar"
            onPress={onOpenMealPrep}
            testID="recipes-plan-meals"
          />
        ) : null}
      </View>
    </StationSheet>
  );
}

/** Empty recipe-card slots on a little shelf; not interactive yet. */
function RecipeShelfPlaceholder() {
  const ui = useThemeUi();
  const t = sheetTokens(ui);
  return (
    <View
      accessible
      accessibilityLabel="Recipe collection, coming soon. Saved recipes will appear on this shelf."
      accessibilityState={{ disabled: true }}
      testID="recipes-shelf-placeholder"
    >
      <View style={styles.slots}>
        {SLOTS.map((name, i) => (
          <View
            key={name}
            style={[
              styles.slot,
              {
                borderColor: withAlpha(ui.panelBorder, 0.7),
                backgroundColor: withAlpha(ui.buttonFace, 0.6),
                borderRadius: t.pixel ? 0 : Math.min(t.cardRadius, 12),
                transform: [{ rotate: `${[-2, 1.5, -1, 2][i]}deg` }],
              },
            ]}
          >
            <View style={[styles.slotLine, { backgroundColor: withAlpha(ui.textMuted, 0.35) }]} />
            <View style={[styles.slotLine, styles.slotLineShort, { backgroundColor: withAlpha(ui.textMuted, 0.25) }]} />
            <ThemedText variant="caption" weight="bold" muted numberOfLines={2} style={styles.slotName}>
              {name}
            </ThemedText>
            <SoonTag />
          </View>
        ))}
      </View>
      <View style={[styles.shelf, { backgroundColor: ui.panelBorder, borderRadius: t.pixel ? 0 : 3 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  cta: { gap: space.sm },
  aiRow: { flexDirection: "row" },
  slots: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, paddingHorizontal: space.xs },
  slot: {
    flexGrow: 1,
    flexBasis: 120,
    minHeight: 104,
    borderWidth: 2,
    borderStyle: "dashed",
    padding: space.sm,
    gap: 6,
    justifyContent: "flex-end",
  },
  slotLine: { height: 3, borderRadius: 2, width: "80%" },
  slotLineShort: { width: "55%" },
  slotName: { marginTop: 2 },
  shelf: { height: 8, marginTop: space.sm },
});
