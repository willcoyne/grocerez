/**
 * In-place camera overlay for scanning a SmartLabel QR or barcode — over the 3D store or anywhere else (not a route).
 * Camera permission flow (web: laptop webcam on localhost/https), viewfinder + hint, torch on phones, typed-barcode fallback,
 * repeat-scan dedupe, POST /products/scan, then the label card and the actions for the scan context.
 */
import type { Product } from "@contracts/products";
import { Flashlight, FlashlightOff, Keyboard, X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, InlineAdd } from "@/components/ui";
import { useActiveGroup } from "@/state/ActiveGroupContext";

import { labelConflicts, useAllergenAudience } from "./allergens";
import { ProductCard } from "./ProductCard";
import { ShoppingActions } from "./ScanActions";
import { ScanCamera } from "./ScanCamera";
import { fixed, useThemeUi } from "./scanTheme";
import type { ScanContext } from "./types";
import { ScanButton } from "./ui";
import { useScanSession } from "./useScanSession";

export type ScanSheetProps = {
  visible: boolean;
  onClose: () => void;
  context: ScanContext;
  /** shopping: a list row was checked off with the scanned product (animate the hop into the cart). */
  onAddedToCart?: (listItemId: string, product: Product) => void;
  /** Optional title override. */
  title?: string;
};

const NOTICE_MS = 2600;

export function ScanSheet(props: ScanSheetProps) {
  const { visible, onClose, context } = props;
  const { activeGroupId } = useActiveGroup();
  const groupId = context.kind === "lookup" ? (context.groupId ?? activeGroupId ?? "") : context.groupId;
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent supportedOrientations={["portrait", "landscape"]}>
      {/* Keyed by group: switching households starts a clean session and never shows another group's data. */}
      {visible ? <ScanBody key={groupId} {...props} groupId={groupId} /> : null}
    </Modal>
  );
}

function titleFor(context: ScanContext): string {
  if (context.kind === "shopping") return "Scan to add to your cart";
  return "Scan a label";
}

function ScanBody({ onClose, context, onAddedToCart, title, groupId }: ScanSheetProps & { groupId: string }) {
  const ui = useThemeUi();
  const insets = useSafeAreaInsets();
  const session = useScanSession();
  const audience = useAllergenAudience(groupId);
  const [torch, setTorch] = useState(false);
  const [live, setLive] = useState(false);
  const [typing, setTyping] = useState(false);
  const [digits, setDigits] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  const showNotice = useCallback((text: string) => {
    setNotice(text);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  const { product, message, notFound, pending, reset } = session;
  const warnMe = product ? labelConflicts([...product.allergens, ...product.mayContain], audience).some((h) => h.mine) : false;
  const panelOpen = !!product || !!message || typing;

  const scanAnother = () => {
    reset();
    setDigits("");
  };

  return (
    <View style={styles.root} testID="scan-sheet">
      <ScanCamera
        active={!product}
        scanning={session.scanning}
        pending={pending}
        torch={torch}
        hint="Scan the SmartLabel QR or the barcode"
        onScanned={session.onScanned}
        onTypeBarcode={() => setTyping(true)}
        onLiveChange={setLive}
      />

      <View style={[styles.top, { paddingTop: insets.top + 10, paddingLeft: insets.left + 12, paddingRight: insets.right + 12 }]} pointerEvents="box-none">
        <RoundIcon label="Close scanner" onPress={onClose} testID="scan-close">
          <X size={24} color={ui.text} />
        </RoundIcon>
        <View style={[styles.titleCard, { backgroundColor: ui.panel, borderColor: ui.panelBorder, borderWidth: Math.min(ui.borderWidth, 2), borderRadius: Math.min(ui.radius, 18) }]}>
          <AppText variant="bodyS" weight="heavy" style={{ color: ui.text }} numberOfLines={2} accessibilityRole="header" testID="scan-title">
            {title ?? titleFor(context)}
          </AppText>
        </View>
        {live && Platform.OS !== "web" ? (
          <RoundIcon label={torch ? "Turn off the light" : "Turn on the light"} selected={torch} onPress={() => setTorch((t) => !t)} testID="scan-torch">
            {torch ? <FlashlightOff size={22} color={ui.text} /> : <Flashlight size={22} color={ui.text} />}
          </RoundIcon>
        ) : null}
        <RoundIcon label="Type the barcode" selected={typing} onPress={() => setTyping((t) => !t)} testID="scan-type-toggle">
          <Keyboard size={22} color={ui.text} />
        </RoundIcon>
      </View>

      {notice ? (
        <View style={[styles.noticeWrap, { top: insets.top + 74 }]} pointerEvents="none">
          <View style={styles.notice} accessibilityLiveRegion="polite">
            <AppText variant="bodyS" weight="heavy" style={{ color: fixed.okInk }} accessibilityRole="alert" testID="scan-notice">
              {notice}
            </AppText>
          </View>
        </View>
      ) : null}

      {panelOpen ? (
        <View
          style={[
            styles.panel,
            { backgroundColor: ui.panel, borderColor: ui.panelBorder, borderWidth: ui.borderWidth, borderTopLeftRadius: ui.radius, borderTopRightRadius: ui.radius },
          ]}
          testID="scan-panel"
        >
          <ScrollView contentContainerStyle={[styles.panelContent, { paddingBottom: insets.bottom + 20 }]} keyboardShouldPersistTaps="handled">
            {message ? (
              <View style={styles.message}>
                <AppText weight="bold" style={{ color: fixed.dangerInk }} accessibilityRole="alert" testID="scan-message">
                  {message}
                </AppText>
                {notFound ? (
                  <AppText variant="bodyS" style={{ color: ui.textMuted }}>
                    Try the other code on the package, or type the barcode digits.
                  </AppText>
                ) : null}
              </View>
            ) : null}

            {typing && !product ? (
              <InlineAdd
                label="Barcode digits"
                value={digits}
                onChangeText={(t) => setDigits(t.replace(/\D/g, "").slice(0, 14))}
                keyboardType="number-pad"
                placeholder="e.g. 016000275287"
                buttonLabel="Look up"
                buttonVariant="primary"
                busy={pending}
                onSubmit={() => session.submitDigits(digits)}
                testID="scan-manual"
              />
            ) : null}

            {product ? (
              <>
                <ProductCard product={product} audience={audience} testID="scan-product" />
                {context.kind === "shopping" ? (
                  <ShoppingActions
                    groupId={groupId}
                    list={context.list}
                    product={product}
                    warnMe={warnMe}
                    onAddedToCart={onAddedToCart}
                    onDone={(text) => {
                      showNotice(text);
                      scanAnother();
                    }}
                  />
                ) : null}
              </>
            ) : null}

            {product || message ? (
              <ScanButton label="Scan another" variant="ghost" onPress={scanAnother} testID="scan-again" />
            ) : null}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function RoundIcon({
  label,
  onPress,
  children,
  selected,
  testID,
}: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
  selected?: boolean;
  testID?: string;
}) {
  const ui = useThemeUi();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : { selected }}
      testID={testID}
      hitSlop={4}
      style={({ pressed }) => [
        styles.round,
        {
          backgroundColor: ui.buttonFace,
          borderColor: selected ? ui.accent : ui.buttonRing,
          borderWidth: Math.max(2, Math.min(ui.borderWidth, 3)),
          borderRadius: ui.radius ? 26 : 4,
        },
        pressed && styles.pressed,
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: fixed.cameraBg },
  top: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", gap: 8 },
  titleCard: { flex: 1, minHeight: 48, justifyContent: "center", paddingHorizontal: 12, paddingVertical: 6 },
  round: { width: 52, height: 52, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.8 },
  noticeWrap: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  notice: { backgroundColor: fixed.okBg, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 8, maxWidth: 340 },
  panel: { position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "78%" },
  panelContent: { padding: 18, gap: 12 },
  message: { gap: 4 },
});
