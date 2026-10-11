import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Gap between floating buttons and the screen edge. */
export const OVERLAY_GAP = 20;

/**
 * Edge offsets for floating overlay controls. The pantry lives inside the tab navigator, whose custom TabBar already
 * sits below the scene and pads for the bottom safe area, so by default the bottom offset ignores `insets.bottom`.
 * Pass `bottomOffset` when the overlay is rendered full-screen without a tab bar (e.g. `insets.bottom + 20`).
 */
export function useOverlayInsets(bottomOffset?: number) {
  const insets = useSafeAreaInsets();
  return {
    top: insets.top + 12,
    bottom: bottomOffset ?? OVERLAY_GAP,
    left: insets.left + OVERLAY_GAP,
    right: insets.right + OVERLAY_GAP,
  };
}
