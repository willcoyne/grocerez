/**
 * "Sketch" theme: the Pantry as the team's pen drawings (plan/frontend/drawing-ideas). Off-white paper everywhere,
 * paper-white surfaces outlined in black felt-tip, shadows drawn as cross-hatching, paper grain over the frame,
 * hand-lettered 3D text (GrocerEZ Hand, ./font.typeface.json) and a notebook-style UI. Colour is used like a
 * student would: a red marker for allergens, a yellow highlighter for search, a blue ballpoint accent.
 * Owner: sketch theme designer. See README.md.
 */
import type { SceneTheme } from "../../types";

const PAPER = "#F7F4EC"; // the page
const INK = "#1E1D1A"; // felt-tip black

const sketch: SceneTheme = {
  id: "sketch",
  name: "Sketch",
  description: "Hand-drawn ink on paper, like the first pantry doodles.",
  swatches: [PAPER, "#FFFFFF", INK, "#E0312B", "#FFE45C"],
  materialStyle: "ink",
  toonSteps: 3, // ink shading bands: paper / light hatch / cross-hatch
  textureStyle: "hatch",
  palette: {
    wood: "#FBF9F3", // pantry body: paper white
    woodDark: "#E7E3D8", // uprights / trim: a touch greyer so hatching reads
    woodLight: INK, // "Grocer" letters are drawn in solid marker, like the drawing
    wall: PAPER,
    floor: "#F1EDE2",
    floorAlt: "#E3DED1",
    trim: "#FFFFFF",
    metal: "#DAD8D2", // fridge steel: pencil grey
    knob: INK, // the drawing's knobs are inked blobs
    fridgeWall: "#FDFDFA",
    freezerWall: "#EDF3F6", // the faintest blue pencil
    glass: "#E6EEF2",
    paper: "#FFFFFF",
    ink: INK,
    accent: "#2F5BD3", // blue ballpoint
    allergen: "#E0312B", // red marker
    highlight: "#FFE45C", // yellow highlighter
    plant: "#B9D7A8", // light green pencil wash
    pot: "#E9C3AC",
  },
  lighting: {
    // Even, nearly white light: the drawing gets its depth from outlines and hatching, not from colour.
    keyColor: "#FFFFFF",
    keyIntensity: 1.7,
    fillColor: "#FFFFFF",
    fillIntensity: 0.8,
    hemiSky: "#FFFFFF",
    hemiGround: "#E8E4D9",
    hemiIntensity: 0.95,
    ambientIntensity: 0.45,
    ambientColor: "#FFFFFF",
    shadows: true, // shadows are where the hatching goes
    fridgeLight: "#FFFFFF",
    freezerLight: "#F0F6FF",
  },
  background: PAPER,
  fog: { color: PAPER, near: 16, far: 34 }, // far things fade into the page
  toneMapping: "neutral", // keeps paper white (ACES would grey it)
  effects: {
    outline: { color: INK, thickness: 1.75, strength: 1 },
    grain: { strength: 0.22, kind: "paper" },
    vignette: { strength: 0.08 },
  },
  font: "hand",
  // a red marker scribble around the item (no flashing); one slow redraw cycle
  allergenGlow: { style: "outline", periodS: 1.8 },
  ui: {
    panel: "#FFFFFF",
    panelBorder: INK,
    text: INK,
    textMuted: "#5B5850",
    accent: "#2F5BD3",
    buttonFace: "#FFFFFF",
    buttonRing: INK,
    buttonIcon: INK,
    radius: 6,
    borderWidth: 2,
    // "hand" once the app registers a handwriting RN font (README); unknown families error on iOS, so app font for now
    fontFamily: null,
  },
};

export default sketch;
export { sketch as sketchTheme };
export { hatchImage, paperImage, sketchTextureImages } from "./textures";
export type { HatchOptions, PaperOptions } from "./textures";
export { imageToDataTexture } from "./textureImage";
export type { ThemeImage } from "./textureImage";
