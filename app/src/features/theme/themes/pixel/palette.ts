/**
 * Pixel theme colours: a warm, cozy farmhouse-at-sunset palette inspired by 16-bit farming games. These are original
 * colours, not sampled from any game. Kept apart from index.ts so textures.ts can use them without an import cycle.
 */
import type { ThemePalette, ThemeUi } from "../../types";

export const PIXEL_PALETTE: ThemePalette = {
  wood: "#C9853F", // golden oak planks
  woodDark: "#6E3F22", // deep brown: uprights, trim, the "outline" brown
  woodLight: "#EBB767", // honey highlight: "Grocer" letters, EZ sign
  wall: "#F3D9AE", // cream-peach wallpaper
  floor: "#B66D35",
  floorAlt: "#A15D2C",
  trim: "#8A4F2A", // baseboard / crown
  metal: "#B9B4A8", // warm pewter (fridge steel)
  knob: "#E3AE45", // brass knobs
  fridgeWall: "#EAF3EC",
  freezerWall: "#CDE9F2",
  glass: "#B8E2EE",
  paper: "#FFF1CF", // parchment
  ink: "#4A2B1A", // dark brown ink instead of black
  accent: "#5FA83B", // grass green
  allergen: "#E5372A", // tomato red
  highlight: "#FFE15A", // sunny selection ring
  plant: "#5A9E36",
  pot: "#C4613A", // terracotta
};

/** Chunky farming-game menu: parchment panels in a dark wooden frame, oak buttons, square corners. */
export const PIXEL_UI: ThemeUi = {
  panel: "#FBE6B8",
  panelBorder: "#6E3F22",
  text: "#3E2414",
  textMuted: "#73492A",
  accent: "#35701F", // darker than palette.accent so it passes 4.5:1 as text on the panel
  buttonFace: "#FBE6B8",
  buttonRing: "#C9853F",
  buttonIcon: "#6E3F22",
  radius: 0,
  borderWidth: 3,
  fontFamily: null, // no pixel font is installed for RN text; overlays keep the app font with pixel borders
  pixelBorders: true,
};
