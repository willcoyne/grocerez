import type { Allergen } from "@contracts/dietary";
import { Search, TriangleAlert, X } from "lucide-react-native";
import { useMemo, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from "react-native-reanimated";

import { AppText } from "@/components/ui";
import { font, maxFontScale, pressedOpacity, size } from "@/theme";

import { searchItems } from "../filters";
import type { PantryItem } from "../types";
import { GROUP_CHIP, GROUP_LABEL, allergenLabel, pantry, softShadow } from "./palette";
import { useOverlayInsets } from "./useOverlayInsets";

export type SearchPanelProps = {
  visible: boolean;
  items: PantryItem[];
  onSelect: (item: PantryItem) => void;
  onClose: () => void;
  /** The signed-in user's allergens; matching rows get a red "Contains ..." chip. */
  myAllergens?: Allergen[];
  /** Same as SearchButton: override when rendered without the tab bar below. */
  bottomOffset?: number;
};

/** Search card that slides up from the search knob (bottom-left). Tapping a row hands the item to the scene. */
export function SearchPanel({ visible, items, onSelect, onClose, myAllergens = [], bottomOffset }: SearchPanelProps) {
  if (!visible) return null;
  return <SearchPanelBody items={items} onSelect={onSelect} onClose={onClose} myAllergens={myAllergens} bottomOffset={bottomOffset} />;
}

function SearchPanelBody({
  items,
  onSelect,
  onClose,
  myAllergens,
  bottomOffset,
}: Omit<SearchPanelProps, "visible" | "myAllergens"> & { myAllergens: Allergen[] }) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchItems(items, query), [items, query]);
  const inset = useOverlayInsets(bottomOffset);
  const trimmed = query.trim();

  let empty: string | null = null;
  if (items.length === 0) empty = "Your pantry is empty. Scan or add groceries to fill the shelves.";
  else if (!trimmed) empty = "Type a name or brand to find it on your shelves.";
  else if (results.length === 0) empty = `Nothing on your shelves matches “${trimmed}”.`;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID="pantry-search-panel">
      <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)} style={[StyleSheet.absoluteFill, styles.backdrop]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close search" />
      </Animated.View>

      <KeyboardAvoidingView
        style={StyleSheet.absoluteFill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        pointerEvents="box-none">
        <View style={styles.anchor} pointerEvents="box-none">
          <Animated.View
            entering={SlideInDown.springify().damping(18)}
            exiting={SlideOutDown.duration(180)}
            accessibilityViewIsModal
            style={[styles.card, softShadow, { marginLeft: inset.left, marginRight: inset.right, marginBottom: inset.bottom }]}>
            <View style={styles.inputRow}>
              <Search size={20} color={pantry.oakDark} strokeWidth={2.5} />
              <TextInput
                testID="pantry-search-input"
                autoFocus
                value={query}
                onChangeText={setQuery}
                placeholder="Search your pantry"
                placeholderTextColor={pantry.muted}
                accessibilityLabel="Search your pantry"
                returnKeyType="search"
                autoCorrect={false}
                autoCapitalize="none"
                clearButtonMode="while-editing"
                maxFontSizeMultiplier={maxFontScale}
                onSubmitEditing={() => {
                  if (results[0]) onSelect(results[0]);
                }}
                style={styles.input}
              />
              <Pressable
                testID="pantry-search-close"
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close search"
                hitSlop={4}
                style={({ pressed }) => [styles.close, pressed && { opacity: pressedOpacity }]}>
                <X size={20} color={pantry.oakDark} strokeWidth={2.5} />
              </Pressable>
            </View>

            {empty ? (
              <View style={styles.empty} testID="pantry-search-empty">
                <AppText variant="bodyS" center style={{ color: pantry.muted }}>
                  {empty}
                </AppText>
              </View>
            ) : (
              <FlatList
                data={results}
                keyExtractor={(item) => item.id}
                keyboardShouldPersistTaps="handled"
                style={styles.list}
                ItemSeparatorComponent={Separator}
                accessibilityLabel={`${results.length} ${results.length === 1 ? "result" : "results"}`}
                renderItem={({ item }) => <ResultRow item={item} myAllergens={myAllergens} onPress={() => onSelect(item)} />}
              />
            )}
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function Separator() {
  return <View style={styles.sep} />;
}

function ResultRow({ item, myAllergens, onPress }: { item: PantryItem; myAllergens: Allergen[]; onPress: () => void }) {
  const hits = item.allergens.filter((a) => myAllergens.includes(a));
  const group = GROUP_CHIP[item.group];
  const warn = hits.length ? `Contains ${hits.map(allergenLabel).join(", ")}` : null;
  const a11y = [item.name, item.brand, `${GROUP_LABEL[item.group]} shelf`, warn ? `Warning: ${warn}, one of your allergies` : null]
    .filter(Boolean)
    .join(", ");
  return (
    <Pressable
      testID={`pantry-search-result-${item.id}`}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityHint="Shows it on the shelf"
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <View style={styles.rowText}>
        <AppText variant="bodyL" weight="heavy" numberOfLines={2} style={{ color: pantry.ink }}>
          {item.name}
        </AppText>
        {item.brand ? (
          <AppText variant="caption" numberOfLines={1} style={{ color: pantry.muted }}>
            {item.brand}
          </AppText>
        ) : null}
        <View style={styles.chips}>
          <View style={[styles.chip, { backgroundColor: group.bg }]}>
            <AppText variant="micro" style={{ color: group.fg }}>
              {GROUP_LABEL[item.group]}
            </AppText>
          </View>
          {warn ? (
            <View style={[styles.chip, styles.warnChip]} testID={`pantry-search-allergen-${item.id}`}>
              <TriangleAlert size={12} color={pantry.redInk} strokeWidth={2.75} />
              <AppText variant="micro" uppercase={false} style={{ color: pantry.redInk }}>
                {warn}
              </AppText>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: "rgba(43,33,24,0.18)" },
  anchor: { flex: 1, justifyContent: "flex-end", alignItems: "flex-start" },
  card: {
    // stretch (not width:100%) so the left/right safe-area margins shrink the card instead of pushing it off-screen
    alignSelf: "stretch",
    maxWidth: 420,
    maxHeight: "70%",
    backgroundColor: pantry.cream,
    borderRadius: 24,
    borderWidth: 3,
    borderColor: pantry.oak,
    overflow: "hidden",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 14,
    paddingRight: 4,
    minHeight: 56,
    borderBottomWidth: 1,
    borderBottomColor: "#EADBC6",
    backgroundColor: "#FFFDF8",
  },
  input: {
    flex: 1,
    minHeight: size.input,
    fontFamily: font.bodySemi,
    fontSize: 16,
    color: pantry.ink,
  },
  close: { width: size.hit, height: size.hit, alignItems: "center", justifyContent: "center" },
  empty: { paddingHorizontal: 20, paddingVertical: 24 },
  list: { flexGrow: 0 },
  sep: { height: 1, marginHorizontal: 14, backgroundColor: "#EFE3D2" },
  row: { minHeight: 64, paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center" },
  rowPressed: { backgroundColor: "#F6EAD8" },
  rowText: { flex: 1, gap: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  warnChip: { backgroundColor: pantry.redTint, borderWidth: 1, borderColor: pantry.red },
});
