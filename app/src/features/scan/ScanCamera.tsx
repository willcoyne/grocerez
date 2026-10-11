/**
 * Camera layer of the scan overlay: permission flow, the live camera with a viewfinder + hint, and the "no camera" /
 * "camera blocked" explanations (web works with a laptop webcam on localhost or https). Reports codes via `onScanned`.
 */
import { CameraView, useCameraPermissions, type BarcodeType } from "expo-camera";
import { CameraOff } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui";

import { fixed, useThemeUi } from "./scanTheme";
import { ScanButton } from "./ui";

export const BARCODE_TYPES: BarcodeType[] = ["qr", "ean13", "upc_a", "upc_e", "ean8"];

const web = Platform.OS === "web";

export type ScanCameraProps = {
  /** Report codes only while true (paused while a request is in flight or a result is shown). */
  scanning: boolean;
  /** Keep the camera running at all (false when the overlay is hidden). */
  active: boolean;
  pending: boolean;
  torch: boolean;
  hint: string;
  onScanned: (r: { type: string; data: string }) => void;
  /** Opens the manual barcode entry. */
  onTypeBarcode: () => void;
  /** Called once we know whether a live camera is showing (the torch button only makes sense then). */
  onLiveChange?: (live: boolean) => void;
};

function insecureWebContext(): boolean {
  return web && typeof window !== "undefined" && (window as { isSecureContext?: boolean }).isSecureContext === false;
}

export function ScanCamera({ scanning, active, pending, torch, hint, onScanned, onTypeBarcode, onLiveChange }: ScanCameraProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [available, setAvailable] = useState<boolean | null>(web ? null : true);
  const [mountError, setMountError] = useState<string | null>(null);
  const insecure = insecureWebContext();

  useEffect(() => {
    if (!web) return;
    let alive = true;
    CameraView.isAvailableAsync()
      .then((ok) => alive && setAvailable(ok))
      .catch(() => alive && setAvailable(false));
    return () => {
      alive = false;
    };
  }, []);

  const granted = !!permission?.granted;
  const live = granted && available === true && !insecure && !mountError;
  useEffect(() => onLiveChange?.(live), [live, onLiveChange]);

  if (insecure) {
    return (
      <Explain
        testID="scan-camera-insecure"
        title="Camera needs a secure page"
        body="Browsers only allow the camera on https:// or http://localhost. Open the app that way, or type the barcode."
        onTypeBarcode={onTypeBarcode}
      />
    );
  }
  if (available === false) {
    return (
      <Explain
        testID="scan-camera-unavailable"
        title="No camera found"
        body={
          web
            ? "We couldn't find a camera on this computer. Plug in a webcam and reload, or type the barcode digits."
            : "This device has no camera we can use. Type the barcode digits instead."
        }
        onTypeBarcode={onTypeBarcode}
      />
    );
  }
  if (!permission || available === null) {
    return (
      <View style={[styles.fill, styles.center]} testID="scan-camera-checking">
        <ActivityIndicator color={fixed.onCamera} accessibilityLabel="Checking the camera" />
      </View>
    );
  }
  if (!granted) {
    const blocked = !permission.canAskAgain;
    return (
      <Explain
        testID="scan-camera-permission"
        title="Camera access"
        body={
          blocked
            ? web
              ? "Your browser blocked the camera. Allow it from the camera icon in the address bar, then try again."
              : "Camera access is off for GrocerEZ. Turn it on in Settings to scan SmartLabel QR codes and barcodes."
            : "GrocerEZ uses the camera to scan SmartLabel QR codes and barcodes. Nothing is recorded."
        }
        action={
          blocked
            ? web
              ? { label: "Try again", onPress: () => void requestPermission() }
              : { label: "Open Settings", onPress: () => void Linking.openSettings() }
            : { label: "Allow camera", onPress: () => void requestPermission() }
        }
        onTypeBarcode={onTypeBarcode}
      />
    );
  }
  if (mountError) {
    return (
      <Explain
        testID="scan-camera-error"
        title="Couldn't start the camera"
        body={`${mountError} Another app may be using it. You can type the barcode instead.`}
        action={{ label: "Try again", onPress: () => setMountError(null) }}
        onTypeBarcode={onTypeBarcode}
      />
    );
  }

  return (
    <View style={styles.fill} testID="scan-camera">
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        active={active}
        enableTorch={!web && torch}
        barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
        onBarcodeScanned={scanning && active ? onScanned : undefined}
        onMountError={(e) => setMountError(e.message || "The camera didn't start.")}
        testID="scan-camera-view"
      />
      <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
        <View style={styles.frame} accessible={false}>
          <Corner pos="tl" />
          <Corner pos="tr" />
          <Corner pos="bl" />
          <Corner pos="br" />
        </View>
        <View style={styles.hint} accessibilityLiveRegion="polite">
          {pending ? <ActivityIndicator color={fixed.onCamera} /> : null}
          <AppText variant="bodyS" weight="bold" style={{ color: fixed.onCamera }} center testID="scan-hint">
            {pending ? "Looking it up…" : hint}
          </AppText>
        </View>
      </View>
    </View>
  );
}

function Corner({ pos }: { pos: "tl" | "tr" | "bl" | "br" }) {
  const s = {
    tl: { top: -3, left: -3, borderTopWidth: 5, borderLeftWidth: 5, borderTopLeftRadius: 18 },
    tr: { top: -3, right: -3, borderTopWidth: 5, borderRightWidth: 5, borderTopRightRadius: 18 },
    bl: { bottom: -3, left: -3, borderBottomWidth: 5, borderLeftWidth: 5, borderBottomLeftRadius: 18 },
    br: { bottom: -3, right: -3, borderBottomWidth: 5, borderRightWidth: 5, borderBottomRightRadius: 18 },
  }[pos];
  return <View style={[styles.corner, s]} />;
}

function Explain({
  title,
  body,
  action,
  onTypeBarcode,
  testID,
}: {
  title: string;
  body: string;
  action?: { label: string; onPress: () => void };
  onTypeBarcode: () => void;
  testID: string;
}) {
  const ui = useThemeUi();
  return (
    <View style={[styles.fill, styles.center, styles.pad]} testID={testID}>
      <View style={[styles.card, { backgroundColor: ui.panel, borderColor: ui.panelBorder, borderWidth: ui.borderWidth, borderRadius: ui.radius }]}>
        <CameraOff size={28} color={ui.buttonIcon} />
        <AppText variant="bodyL" weight="heavy" style={{ color: ui.text }} accessibilityRole="header">
          {title}
        </AppText>
        <AppText variant="bodyS" style={{ color: ui.textMuted }}>
          {body}
        </AppText>
        {action ? <ScanButton label={action.label} onPress={action.onPress} testID={`${testID}-action`} /> : null}
        <ScanButton label="Type the barcode" variant="secondary" onPress={onTypeBarcode} testID={`${testID}-type`} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: fixed.cameraBg },
  center: { alignItems: "center", justifyContent: "center", gap: 18 },
  pad: { padding: 20 },
  frame: { width: 270, height: 190 },
  corner: { position: "absolute", width: 44, height: 44, borderColor: fixed.frame },
  hint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    maxWidth: 320,
    backgroundColor: fixed.scrim,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 14,
  },
  card: { width: "100%", maxWidth: 420, padding: 18, gap: 12, alignItems: "flex-start" },
});
