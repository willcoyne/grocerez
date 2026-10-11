import { ChevronLeft } from "lucide-react-native";
import { StyleSheet } from "react-native";

import { useOverlayPalette } from "./palette";
import { RoundButton } from "./RoundButton";
import { useOverlayInsets } from "./useOverlayInsets";

/** Top-left knob that closes the pantry doors (back to the `closed` phase). */
export function BackButton({ onPress }: { onPress: () => void }) {
  const P = useOverlayPalette();
  const inset = useOverlayInsets();
  return (
    <RoundButton
      testID="pantry-back-button"
      label="Close pantry"
      hint="Go back and close the pantry doors"
      onPress={onPress}
      size={52}
      style={[styles.pos, { left: inset.left, top: inset.top }]}>
      <ChevronLeft size={28} color={P.oakDark} strokeWidth={2.75} style={styles.nudge} />
    </RoundButton>
  );
}

const styles = StyleSheet.create({ pos: { position: "absolute" }, nudge: { marginLeft: -2 } });
