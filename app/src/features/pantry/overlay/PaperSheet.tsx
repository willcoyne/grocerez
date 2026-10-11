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

import { type OverlayPalette, pantry, shadowFor, useOverlayPalette, useOverlayStyles } from "./palette";

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
  /**
   * A plain page instead of a sheet over the 3D room (the simple interface, state/uiPrefs.tsx): fills its screen,
   * no backdrop, no landing animation, no pin, and no ✕ (the tab bar navigates away).
   */
  page?: boolean;
};

export function PaperSheet({ testID, title, closeLabel, onClose, subheader, children, footer, overlay, overlayIsModal, page }: PaperSheetProps) {
  const P = useOverlayPalette();
  const styles = useOverlayStyles(makeStyles);
  const paper = useOverlayStyles(makePaperStyles);
  const insets = useSafeAreaInsets();
  // Paper "lands" from the lifted 3D note: fade + settle.
  const [appear] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (page) return;
    Animated.spring(appear, { toValue: 1, useNativeDriver: Platform.OS !== "web", friction: 8, tension: 70 }).start();
  }, [appear, page]);

  if (page) {
    return (
      <View style={styles.pageWrap} testID={testID}>
        <View style={[styles.sheet, styles.page]}>
          <View style={styles.margin} pointerEvents="none" />
          <View style={styles.header}>
            <View style={styles.titleWrap}>
              <AppText weight="display" style={styles.title} accessibilityRole="header">
                {title}
              </AppText>
              <View style={styles.squiggle} />
            </View>
          </View>
          {subheader}
          {children}
          {footer}
        </View>
        {overlay}
      </View>
    );
  }

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
            style={({ pressed }) => [styles.close, pressed && paper.pressed]}
            testID={`${testID}-close`}
          >
            <X size={22} color={P.oakInk} />
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
  const P = useOverlayPalette();
  const styles = useOverlayStyles(makeStyles);
  const paper = useOverlayStyles(makePaperStyles);
  return (
    <AppText variant="micro" style={paper.section} accessibilityRole="header" testID={testID}>
      {title}
    </AppText>
  );
}

/** Pencil line under the title ("3 to buy · 1 in the cart"). */
export function PaperCaption({ children, strong, testID }: { children: ReactNode; strong?: boolean; testID?: string }) {
  const P = useOverlayPalette();
  const styles = useOverlayStyles(makeStyles);
  const paper = useOverlayStyles(makePaperStyles);
  return (
    <AppText
      variant={strong ? "bodyS" : "caption"}
      weight={strong ? "semi" : undefined}
      style={[paper.pencil, paper.count]}
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
  const P = useOverlayPalette();
  const styles = useOverlayStyles(makeStyles);
  const paper = useOverlayStyles(makePaperStyles);
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      style={({ pressed }) => [paper.primary, inactive && paper.primaryOff, pressed && !inactive && paper.pressed, style]}
      testID={testID}
    >
      {loading ? <ActivityIndicator color="#FFFFFF" /> : icon}
      <AppText weight="bold" style={paper.primaryText}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** Shared text/row styles for paper content (hand lettering, pencil captions, ruled rows). */
export const makePaperStyles = (P: OverlayPalette) =>
  StyleSheet.create({
  hand: { fontFamily: font.display, color: P.oakInk },
  pencil: { color: P.muted },
  count: { paddingLeft: PAPER_MARGIN_X, paddingRight: 16, marginTop: 6 },
  section: {
    color: P.oakDark,
    paddingLeft: PAPER_MARGIN_X,
    paddingTop: 14,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: P.noteRule,
    letterSpacing: 1.2,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    minHeight: PAPER_RULE,
    borderBottomWidth: 1,
    borderBottomColor: P.noteRule,
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
    backgroundColor: P.green,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    ...shadowFor(P),
  },
  primaryOff: { opacity: 0.55 },
  primaryText: { color: "#FFFFFF", fontSize: 18, lineHeight: 24 },
  pressed: { opacity: 0.75 },
});

const makeStyles = (P: OverlayPalette) =>
  StyleSheet.create({
  backdrop: { backgroundColor: P.backdrop },
  sheet: {
    position: "absolute",
    left: 14,
    right: 14,
    backgroundColor: P.notePaper,
    borderRadius: 6,
    paddingTop: 26,
    overflow: "visible",
    ...shadowFor(P),
  },
  margin: { position: "absolute", top: 0, bottom: 0, left: PAPER_MARGIN_X - 10, width: 2, backgroundColor: P.noteMargin },
  header: { flexDirection: "row", alignItems: "flex-start", paddingLeft: PAPER_MARGIN_X, paddingRight: 8 },
  titleWrap: { flex: 1, paddingTop: 4 },
  title: {
    fontFamily: font.display,
    fontSize: 40,
    lineHeight: 46,
    color: P.oakInk,
    transform: [{ rotate: "-3deg" }],
  },
  squiggle: {
    width: 84,
    height: 4,
    borderRadius: 2,
    backgroundColor: P.oakInk,
    opacity: 0.7,
    marginTop: 2,
    transform: [{ rotate: "-2deg" }],
  },
  pageWrap: { flex: 1 },
  page: { position: "relative", flex: 1, left: 0, right: 0, marginHorizontal: 12, marginTop: 8, marginBottom: 8, paddingTop: 16 },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  pin: {
    position: "absolute",
    top: -10,
    alignSelf: "center",
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: P.notePin,
    ...shadowFor(P),
  },
  pinShine: { position: "absolute", top: 5, left: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: P.notePinShine },
});
