/**
 * Cozy: the original Pantry look (SPEC "Look & feel"). Every value here is copied from the pre-theme scene so the
 * default theme renders exactly as before:
 * - palette: scene/exterior/materials.ts PALETTE, scene/shelves/materials.ts COLORS, scene/food/materials.ts
 * - lighting: scene/Lights.tsx (key / fill / hemi / ambient) and shelves/ShelfColumn.tsx ApplianceLights
 * - background + fog: scene/sceneConfig.ts WALL_COLOR, PantryCanvas fog args [WALL_COLOR, 14, 30]
 * - ui: pantry/overlay/palette.ts (cream panels, oak rings, green accent)
 * Owner: theme core.
 */
import type { SceneTheme } from "../../types";

const cozy: SceneTheme = {
  id: "cozy",
  name: "Cozy",
  description: "Honey oak, cream walls and warm afternoon light.",
  swatches: ["#C68B59", "#8B5A2B", "#F3E9DC", "#FFF8EE", "#2E7D32"],
  materialStyle: "standard",
  textureStyle: "grain",
  palette: {
    wood: "#C68B59",
    woodDark: "#8B5A2B",
    woodLight: "#E0B07A",
    wall: "#F3E9DC",
    floor: "#B9804F",
    // The grain floor only uses `floor` (per-plank tone jitter); floorAlt is a natural darker plank for other styles.
    floorAlt: "#A06C40",
    trim: "#FFF8EE", // cream baseboard
    metal: "#C9CED3", // fridge steel
    knob: "#D2A24C", // brass knobs
    fridgeWall: "#F4F7FA",
    freezerWall: "#CFEFFF",
    glass: "#BFE6FF",
    paper: "#FFF8EE",
    ink: "#2B2730",
    accent: "#2E7D32",
    allergen: "#FF3B30",
    highlight: "#FFD24A",
    plant: "#4E9A51",
    pot: "#C96B43",
  },
  lighting: {
    keyColor: "#FFD9A8",
    keyIntensity: 2.3,
    fillColor: "#FFF1E0",
    fillIntensity: 0.55,
    hemiSky: "#FFF4E2",
    hemiGround: "#8B5A2B",
    hemiIntensity: 0.75,
    ambientIntensity: 0.18,
    ambientColor: "#FFE9CF",
    shadows: true,
    fridgeLight: "#EAF4FF",
    freezerLight: "#9FD8FF",
  },
  background: "#F3E9DC",
  fog: { color: "#F3E9DC", near: 14, far: 30 },
  toneMapping: "aces",
  effects: {},
  font: "helvetiker",
  allergenGlow: { style: "pulse", periodS: 2.5 },
  ui: {
    panel: "#FFF8EE",
    panelBorder: "#C68B59",
    text: "#2B2118",
    textMuted: "#6E5A47",
    accent: "#2E7D32",
    buttonFace: "#FFF8EE",
    buttonRing: "#C68B59",
    buttonIcon: "#8B5A2B",
    radius: 24,
    borderWidth: 3,
    fontFamily: null,
  },
};

export default cozy;
