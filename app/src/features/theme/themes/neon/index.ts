/**
 * "Neon" theme: the Pantry at night, synthwave style. A very dark navy room under low violet light; furniture is
 * dark rough material with magenta and cyan neon running along edges and shelf lips; the "Grocer" letters and the
 * EZ sign are lit like bent-glass tubes (GrocerEZ Retro monoline glyphs + bloom); a magenta grid floor, scanline
 * grain, a little fog. Allergens pulse in hot red neon. UI: dark panels with cyan neon borders.
 * Owner: neon theme designer. See README.md.
 */
import type { SceneTheme } from "../../types";

const NIGHT = "#0A0A1E";
const MAGENTA = "#FF3FD8";
const CYAN = "#21E6FF";

const neon: SceneTheme = {
  id: "neon",
  name: "Neon",
  description: "Synthwave night: dark room, magenta and cyan neon, glowing signs.",
  swatches: [NIGHT, MAGENTA, CYAN, "#7B2FF7", "#FFD23F"],
  materialStyle: "standard", // dark, rough PBR surfaces; the glow comes from emissive edges + bloom
  textureStyle: "grid",
  palette: {
    wood: "#262852", // pantry body: dark indigo lacquer
    woodDark: "#17183D", // uprights, plinth
    woodLight: MAGENTA, // "Grocer" letters: magenta tubes (emissive)
    wall: "#191544",
    floor: "#0B0A1F",
    floorAlt: MAGENTA, // grid lines on the floor
    trim: CYAN, // baseboard / crown: cyan edge strip (emissive)
    metal: "#5B6290", // fridge steel under violet light
    knob: CYAN,
    fridgeWall: "#151B40",
    freezerWall: "#10244A",
    glass: "#4FD8FF",
    paper: "#1C1F46", // dark tags and the list note...
    ink: "#EAF7FF", // ...with light text (contrast > 12:1)
    accent: CYAN,
    allergen: "#FF2A4D", // hot red neon, clearly apart from the magenta letters
    highlight: "#FFD23F", // sodium-yellow selection ring
    plant: "#2BFFB0",
    pot: "#7B2FF7",
  },
  lighting: {
    keyColor: "#B48CFF", // violet moonlight
    keyIntensity: 1.5,
    fillColor: CYAN,
    fillIntensity: 0.55,
    hemiSky: "#3B2A7A",
    hemiGround: "#08061A",
    hemiIntensity: 0.45,
    ambientIntensity: 0.1,
    ambientColor: "#4B3B9A",
    shadows: true,
    fridgeLight: "#7FE9FF",
    freezerLight: "#5AA8FF",
  },
  background: NIGHT,
  fog: { color: "#140C33", near: 9, far: 24 },
  toneMapping: "aces",
  effects: {
    bloom: { strength: 1.1, threshold: 0.55 },
    grain: { strength: 0.14, kind: "scanline" },
    vignette: { strength: 0.35 },
  },
  font: "retro", // round-capped monoline strokes read as neon tubes
  // 1.2 s pulse (0.8 Hz): strong, but far below the 3 flashes per second limit
  allergenGlow: { style: "pulse", periodS: 1.2 },
  ui: {
    panel: "#120F2E", // drawn translucent by the overlay if it supports alpha (see README)
    panelBorder: CYAN,
    text: "#EAF6FF",
    textMuted: "#9DA8DA",
    accent: MAGENTA,
    buttonFace: "#17143C",
    buttonRing: CYAN,
    buttonIcon: CYAN,
    radius: 14,
    borderWidth: 2,
    fontFamily: null,
  },
};

export default neon;
export { neon as neonTheme };
export { neonGridImage, neonTextureImages, neonTubeImage, neonWallImage } from "./textures";
export type { NeonGridOptions, NeonTubeOptions, NeonWallOptions } from "./textures";
