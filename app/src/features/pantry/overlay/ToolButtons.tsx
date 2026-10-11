import { LayoutList, Plus, ScanLine } from "lucide-react-native";
import { StyleSheet, View } from "react-native";

import { type OverlayPalette, useOverlayPalette, useOverlayStyles } from "./palette";
import { RoundButton } from "./RoundButton";
import { useOverlayInsets } from "./useOverlayInsets";

const SIZE = 48;

/**
 * Top-right knobs that keep the old Cabinet's tools one tap away from the 3D scene: switch to the list view (every
 * cabinet action), add items by name, and scan a product. `compact` (closed pantry) shows only the list-view knob.
 */
export function ToolButtons({
  onListView,
  onAdd,
  onScan,
  compact,
}: {
  onListView?: () => void;
  onAdd: () => void;
  onScan: () => void;
  compact?: boolean;
}) {
  const P = useOverlayPalette();
  const styles = useOverlayStyles(makeStyles);
  const inset = useOverlayInsets();
  return (
    <View style={[styles.column, { right: inset.right, top: inset.top }]} pointerEvents="box-none">
      {onListView ? (
        <RoundButton testID="pantry-listview-button" label="Simple view" hint="Switch to plain screens without 3D or animation" onPress={onListView} size={SIZE}>
          <LayoutList size={22} color={P.oakDark} strokeWidth={2.5} />
        </RoundButton>
      ) : null}
      {compact ? null : (
        <>
          <RoundButton testID="pantry-add-button" label="Add items" hint="Add items to the pantry by name" onPress={onAdd} size={SIZE}>
            <Plus size={24} color={P.oakDark} strokeWidth={2.75} />
          </RoundButton>
          <RoundButton testID="pantry-scan-button" label="Scan a product" hint="Scan a barcode to add it" onPress={onScan} size={SIZE}>
            <ScanLine size={22} color={P.oakDark} strokeWidth={2.5} />
          </RoundButton>
        </>
      )}
    </View>
  );
}

const makeStyles = (P: OverlayPalette) =>
  StyleSheet.create({ column: { position: "absolute", gap: 10 } });
