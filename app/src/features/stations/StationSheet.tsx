/**
 * Shared container for the room's station sheets (SPEC.md round 3). A plain React Native overlay layered over the 3D
 * room: it slides up from the bottom and leaves the top ~25 % of the scene visible so you still see the station the
 * camera flew to. Close with the × button, a tap on the visible scene (backdrop), a drag down on the header, Android
 * back or Escape on the web.
 *
 * Controlled: render it with `visible` and flip `visible` to false in `onClose`. It keeps itself mounted while the
 * slide-out runs, and unmounts its children when hidden (so hidden sheets fetch nothing).
 *
 * Render it as a sibling AFTER the canvas, inside a full-size parent (e.g. PantryScreen's root view). It fills the
 * parent. The bottom safe area is applied only where the sheet actually overlaps it (react-native-safe-area-context's
 * native SafeAreaView), so it works both above a nav bar and at the screen edge.
 */
import { X } from "lucide-react-native";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  type LayoutChangeEvent,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { pressedOpacity, size, space } from "@/theme";

import { sheetTokens, withAlpha } from "./colors";
import { ThemedText } from "./parts";
import { useThemeUi } from "./theme";

export type StationSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Header title; also the dialog's accessible name. */
  title: string;
  subtitle?: string;
  /** Leading header element (avatar, icon). */
  headerLeft?: ReactNode;
  /** Sticky content under the scroll area (stays above the keyboard and the safe area). */
  footer?: ReactNode;
  children: ReactNode;
  /** Fraction of the scene left visible above the sheet. Default 0.25. */
  sceneVisibleFraction?: number;
  /** Prefix for test IDs: `{testID}`, `{testID}-close`, `{testID}-backdrop`, `{testID}-handle`, `{testID}-scroll`. */
  testID?: string;
};

const OPEN_MS = 280;
const CLOSE_MS = 200;

/** Drag-to-close rule: far enough (a quarter of the sheet, capped at 140 pt) or flicked down fast enough. */
export function shouldDismiss(dy: number, vy: number, sheetHeight: number): boolean {
  return dy > Math.min(140, Math.max(60, sheetHeight * 0.25)) || (dy > 20 && vy > 0.9);
}

export function StationSheet({
  visible,
  onClose,
  title,
  subtitle,
  headerLeft,
  footer,
  children,
  sceneVisibleFraction = 0.25,
  testID = "station-sheet",
}: StationSheetProps) {
  const ui = useThemeUi();
  const t = sheetTokens(ui);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  const [mounted, setMounted] = useState(visible);
  const [sheetHeight, setSheetHeight] = useState(0);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [progress] = useState(() => new Animated.Value(visible ? 0 : 1)); // 0 = open, 1 = hidden below
  const [drag] = useState(() => new Animated.Value(0));
  const [reduceMotion, setReduceMotion] = useState(false);
  const onCloseRef = useRef(onClose);
  const visibleRef = useRef(visible);
  const sheetRef = useRef<View>(null);
  const titleRef = useRef<View>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
    visibleRef.current = visible;
  }, [onClose, visible]);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => {});
  }, []);

  // Reduced motion (and tests) skip the slides.
  const instant = reduceMotion || !!process.env.JEST_WORKER_ID;
  // Mount as soon as it should show; without a slide-out, unmount as soon as it should hide.
  if (visible && !mounted) setMounted(true);
  if (!visible && mounted && instant) setMounted(false);

  // Slide in / out. Hidden sheets unmount after the slide-out.
  useEffect(() => {
    if (visible) {
      drag.setValue(0);
      if (instant) progress.setValue(0);
      else Animated.timing(progress, { toValue: 0, duration: OPEN_MS, useNativeDriver: Platform.OS !== "web" }).start();
      return;
    }
    if (instant) {
      progress.setValue(1);
      return;
    }
    Animated.timing(progress, { toValue: 1, duration: CLOSE_MS, useNativeDriver: Platform.OS !== "web" }).start(
      ({ finished }) => {
        if (finished && !visibleRef.current) setMounted(false);
      },
    );
  }, [visible, instant, progress, drag]);

  // Modal focus: move the screen reader (or web keyboard focus) into the sheet when it opens.
  useEffect(() => {
    if (!visible || !mounted) return;
    const id = setTimeout(() => {
      if (Platform.OS === "web") {
        (sheetRef.current as unknown as { focus?: () => void } | null)?.focus?.();
      } else if (titleRef.current) {
        AccessibilityInfo.sendAccessibilityEvent(titleRef.current, "focus");
      }
    }, 350);
    return () => clearTimeout(id);
  }, [visible, mounted]);

  // Android back button and Escape on the web close the sheet.
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onCloseRef.current();
      return true;
    });
    const target = Platform.OS === "web" ? (globalThis as unknown as WebKeyTarget) : null;
    const onKey = (e: { key?: string }) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    target?.addEventListener?.("keydown", onKey);
    return () => {
      sub.remove();
      target?.removeEventListener?.("keydown", onKey);
    };
  }, [visible]);

  // While typing, the sheet grows towards the top so the field and its neighbours stay visible.
  useEffect(() => {
    if (!visible) return;
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => setKeyboardOpen(true));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [visible]);

  // Drag down on the header to close (the slide-out continues from where the finger let go).
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_e, g) => drag.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_e, g) => {
          if (shouldDismiss(g.dy, g.vy, sheetHeight || windowHeight)) onClose();
          else Animated.spring(drag, { toValue: 0, useNativeDriver: Platform.OS !== "web", friction: 8 }).start();
        },
        onPanResponderTerminate: () => Animated.spring(drag, { toValue: 0, useNativeDriver: Platform.OS !== "web" }).start(),
      }),
    [drag, onClose, sheetHeight, windowHeight],
  );

  const travel = sheetHeight || windowHeight;
  const translateY = useMemo(() => Animated.add(Animated.multiply(progress, travel), drag), [progress, drag, travel]);
  const backdropOpacity = useMemo(() => progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }), [progress]);

  if (!mounted) return null;

  const onSheetLayout = (e: LayoutChangeEvent) => setSheetHeight(e.nativeEvent.layout.height);
  const fraction = Math.min(0.6, Math.max(0.05, sceneVisibleFraction));
  const closeLabel = `Close ${title}`;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" accessibilityViewIsModal testID={testID}>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: t.backdrop, opacity: backdropOpacity }]}
      />
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        pointerEvents="box-none"
      >
        {/* The visible part of the scene: tapping it closes the sheet. */}
        <Pressable
          style={keyboardOpen ? { height: insets.top + space.sm } : { flexBasis: `${fraction * 100}%` }}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          testID={`${testID}-backdrop`}
        />
        <Animated.View
          ref={sheetRef}
          onLayout={onSheetLayout}
          role="dialog"
          // Native modal scoping is on the root view (so the backdrop "Close" button stays reachable); web needs it here.
          aria-modal={Platform.OS === "web"}
          aria-label={title}
          tabIndex={-1}
          style={[
            styles.sheet,
            {
              backgroundColor: ui.panel,
              borderColor: ui.panelBorder,
              borderTopLeftRadius: t.radius,
              borderTopRightRadius: t.radius,
              borderLeftWidth: t.border,
              borderRightWidth: t.border,
              borderTopWidth: t.border + 3,
              transform: [{ translateY }],
            },
            t.pixel ? styles.pixelShadow : styles.softShadow,
            t.pixel ? { shadowColor: ui.panelBorder } : null,
          ]}
        >
          <SafeAreaView edges={["bottom", "left", "right"]} style={styles.fill}>
            <View {...pan.panHandlers} style={styles.header} testID={`${testID}-handle`}>
              <View
                style={[styles.grabber, { backgroundColor: withAlpha(ui.panelBorder, 0.55), borderRadius: t.pixel ? 0 : 3 }]}
                accessible={false}
              />
              <View style={styles.headerRow}>
                {headerLeft}
                <View
                  ref={titleRef}
                  style={styles.titleBlock}
                  accessible
                  accessibilityRole="header"
                  accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
                  accessibilityHint="Drag down or use the close button to go back to the room"
                >
                  <ThemedText variant="h1" weight="display" numberOfLines={2} style={styles.title}>
                    {title}
                  </ThemedText>
                  {subtitle ? (
                    <ThemedText variant="caption" weight="semi" muted numberOfLines={2}>
                      {subtitle}
                    </ThemedText>
                  ) : null}
                </View>
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel={closeLabel}
                  hitSlop={4}
                  testID={`${testID}-close`}
                  style={({ pressed }) => [
                    styles.close,
                    {
                      backgroundColor: ui.buttonFace,
                      borderColor: ui.buttonRing,
                      borderWidth: Math.max(2, t.border),
                      borderRadius: t.pixel ? 0 : size.hit / 2 + 2,
                    },
                    pressed && { opacity: pressedOpacity },
                  ]}
                >
                  <X size={22} color={ui.buttonIcon} strokeWidth={2.6} />
                </Pressable>
              </View>
            </View>
            <ScrollView
              style={styles.fill}
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
              testID={`${testID}-scroll`}
            >
              {children}
            </ScrollView>
            {footer ? <View style={[styles.footer, { borderTopColor: withAlpha(ui.panelBorder, 0.35) }]}>{footer}</View> : null}
          </SafeAreaView>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

type WebKeyTarget = {
  addEventListener?: (type: "keydown", fn: (e: { key?: string }) => void) => void;
  removeEventListener?: (type: "keydown", fn: (e: { key?: string }) => void) => void;
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
  sheet: { flex: 1, overflow: "hidden" },
  softShadow: {
    shadowColor: "#2B2118",
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  pixelShadow: { shadowOpacity: 1, shadowRadius: 0, shadowOffset: { width: 0, height: -4 }, elevation: 0 },
  header: { paddingHorizontal: space.screenX, paddingTop: space.sm, paddingBottom: space.md },
  grabber: { alignSelf: "center", width: 44, height: 5, marginBottom: space.sm },
  headerRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  titleBlock: { flex: 1, gap: 2 },
  title: { fontSize: 26, lineHeight: 30 },
  close: { width: size.hit + 4, height: size.hit + 4, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: space.screenX, paddingTop: space.xs, paddingBottom: space.xxl * 2, gap: space.xl },
  footer: { paddingHorizontal: space.screenX, paddingTop: space.md, paddingBottom: space.md, borderTopWidth: 1 },
});
