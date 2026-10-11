/**
 * The paper notepad sheet shared by the shopping List and the Week calendar (spec §13: "match the List exactly"):
 * cream lined paper that lands from its pin, red margin line, red pushpin, the hand-lettered title with its pencil
 * squiggle, brown small-caps section labels, and the green full-width primary button. Plain React Native (web + native).
 */
import { X } from "lucide-react-native";
import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Animated, Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/components/ui";
import { font } from "@/theme";

import { pantry, softShadow } from "./palette";

/** Notepad colours, matching the 3D note (cream paper, blue rules, red margin, red pin). */
export const NOTE_PAPER = {
  paper: "#FFFBF2",
  rule: "#CFDDEA",
  margin: "#E58A7E",
  pin: "#D64541",
  pinShine: "#F08A80",
  ink: pantry.ink,
  pencil: pantry.oakInk,
} as const;

/** Row rhythm (also the minimum tap height) and the left margin the text starts after. */
export const PAPER_RULE = 44;
export const PAPER_MARGIN_X = 50;

export type PaperSheetProps = {
  /** Root testID; the backdrop and close button get `${testID}-backdrop` / `${testID}-close`. */
  testID: string;
  /** Hand-lettered title ("List", "Week"). */
  title: string;
  /** Accessibility label for the backdrop and the ✕ ("Close shopping list"). */
  closeLabel: string;
  onClose: () => void;
  /** Lines under the title (counts, date range). */
  subheader?: ReactNode;
  /** Scrolling paper content. */
  children: ReactNode;
  /** Pinned under the scroll area (the primary button, a confirm bar). */
  footer?: ReactNode;
  /** Rendered above the sheet (pickers, a recipe card). */
  overlay?: ReactNode;
  /**
   * The overlay is an in-tree modal on top (the Week recipe card): the sheet then stops being the accessibility modal,
   * or screen readers could never reach the card (a modal view hides its siblings).
   */
  overlayIsModal?: boolean;
};

export function PaperSheet({ testID, title, closeLabel, onClose, subheader, children, footer, overlay, overlayIsModal }: PaperSheetProps) {
  const insets = useSafeAreaInsets();
  // Paper "lands" from the lifted 3D note: fade + settle.
  const [appear] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.spring(appear, { toValue: 1, useNativeDriver: Platform.OS !== "web", friction: 8, tension: 70 }).start();
  }, [appear]);

  return (
    <View style={StyleSheet.absoluteFill} testID={testID}>
      <Pressable
        style={[StyleSheet.absoluteFill, styles.backdrop]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        testID={`${testID}-backdrop`}
      />
      <Animated.View
        accessibilityViewIsModal={!overlayIsModal}
        importantForAccessibility={overlayIsModal ? "no-hide-descendants" : "auto"}
        style={[
          styles.sheet,
          { top: insets.top + 18, bottom: insets.bottom + 12 },
          {
            opacity: appear,
            transform: [
              { translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) },
              { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
              { rotate: appear.interpolate({ inputRange: [0, 1], outputRange: ["-3deg", "-0.6deg"] }) },
            ],
          },
        ]}
      >
        <View style={styles.margin} pointerEvents="none" />
        <View style={styles.header}>
          <View style={styles.titleWrap}>
            <AppText weight="display" style={styles.title} accessibilityRole="header">
              {title}
            </AppText>
            <View style={styles.squiggle} />
          </View>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={closeLabel}
            hitSlop={6}
            style={({ pressed }) => [styles.close, pressed && paperStyles.pressed]}
            testID={`${testID}-close`}
          >
            <X size={22} color={NOTE_PAPER.pencil} />
          </Pressable>
        </View>
        {subheader}
        {children}
        {footer}

        {/* the pin the paper came off */}
        <View style={styles.pin} pointerEvents="none">
          <View style={styles.pinShine} />
        </View>
      </Animated.View>
      {overlay}
    </View>
  );
}

/** Brown small-caps section label with a rule under it ("PRODUCE", "MON 12"). */
export function PaperSection({ title, testID }: { title: string; testID?: string }) {
  return (
    <AppText variant="micro" style={paperStyles.section} accessibilityRole="header" testID={testID}>
      {title}
    </AppText>
  );
}

/** Pencil line under the title ("3 to buy · 1 in the cart"). */
export function PaperCaption({ children, strong, testID }: { children: ReactNode; strong?: boolean; testID?: string }) {
  return (
    <AppText
      variant={strong ? "bodyS" : "caption"}
      weight={strong ? "semi" : undefined}
      style={[paperStyles.pencil, paperStyles.count]}
      testID={testID}
    >
      {children}
    </AppText>
  );
}

/** The green full-width primary button at the bottom of the paper ("Start shopping", "Plan our week"). */
export function PaperPrimaryButton({
  label,
  icon,
  onPress,
  disabled,
  loading,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
}: {
  label: string;
  icon?: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      style={({ pressed }) => [paperStyles.primary, inactive && paperStyles.primaryOff, pressed && !inactive && paperStyles.pressed, style]}
      testID={testID}
    >
      {loading ? <ActivityIndicator color="#FFFFFF" /> : icon}
      <AppText weight="bold" style={paperStyles.primaryText}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** Shared text/row styles for paper content (hand lettering, pencil captions, ruled rows). */
export const paperStyles = StyleSheet.create({
  hand: { fontFamily: font.display, color: NOTE_PAPER.pencil },
  pencil: { color: pantry.muted },
  count: { paddingLeft: PAPER_MARGIN_X, paddingRight: 16, marginTop: 6 },
  section: {
    color: pantry.oakDark,
    paddingLeft: PAPER_MARGIN_X,
    paddingTop: 14,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: NOTE_PAPER.rule,
    letterSpacing: 1.2,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    minHeight: PAPER_RULE,
    borderBottomWidth: 1,
    borderBottomColor: NOTE_PAPER.rule,
  },
  scroll: { flex: 1, marginTop: 8 },
  scrollContent: { paddingBottom: 24 },
  center: {
    flexGrow: 1,
    minHeight: 220,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingLeft: PAPER_MARGIN_X,
    paddingRight: 20,
  },
  primary: {
    minHeight: 54,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 16,
    borderRadius: 27,
    backgroundColor: pantry.green,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    ...softShadow,
  },
  primaryOff: { opacity: 0.55 },
  primaryText: { color: "#FFFFFF", fontSize: 18, lineHeight: 24 },
  pressed: { opacity: 0.75 },
});

const styles = StyleSheet.create({
  backdrop: { backgroundColor: pantry.backdrop },
  sheet: {
    position: "absolute",
    left: 14,
    right: 14,
    backgroundColor: NOTE_PAPER.paper,
    borderRadius: 6,
    paddingTop: 26,
    overflow: "visible",
    ...softShadow,
  },
  margin: { position: "absolute", top: 0, bottom: 0, left: PAPER_MARGIN_X - 10, width: 2, backgroundColor: NOTE_PAPER.margin },
  header: { flexDirection: "row", alignItems: "flex-start", paddingLeft: PAPER_MARGIN_X, paddingRight: 8 },
  titleWrap: { flex: 1, paddingTop: 4 },
  title: {
    fontFamily: font.display,
    fontSize: 40,
    lineHeight: 46,
    color: NOTE_PAPER.pencil,
    transform: [{ rotate: "-3deg" }],
  },
  squiggle: {
    width: 84,
    height: 4,
    borderRadius: 2,
    backgroundColor: NOTE_PAPER.pencil,
    opacity: 0.7,
    marginTop: 2,
    transform: [{ rotate: "-2deg" }],
  },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  pin: {
    position: "absolute",
    top: -10,
    alignSelf: "center",
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: NOTE_PAPER.pin,
    ...softShadow,
  },
  pinShine: { position: "absolute", top: 5, left: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: NOTE_PAPER.pinShine },
});
