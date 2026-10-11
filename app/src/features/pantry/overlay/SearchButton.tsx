import { Search } from "lucide-react-native";
import { StyleSheet } from "react-native";

import { useOverlayPalette } from "./palette";
import { RoundButton } from "./RoundButton";
import { useOverlayInsets } from "./useOverlayInsets";

/** Floating search knob, bottom-left (infinite-shelves.jpg). */
export function SearchButton({ onPress, bottomOffset }: { onPress: () => void; bottomOffset?: number }) {
  const P = useOverlayPalette();
  const inset = useOverlayInsets(bottomOffset);
  return (
    <RoundButton
      testID="pantry-search-button"
      label="Search pantry"
      hint="Find an item on your shelves"
      onPress={onPress}
      style={[styles.pos, { left: inset.left, bottom: inset.bottom }]}>
      <Search size={26} color={P.oakDark} strokeWidth={2.5} />
    </RoundButton>
  );
}

const styles = StyleSheet.create({ pos: { position: "absolute" } });
