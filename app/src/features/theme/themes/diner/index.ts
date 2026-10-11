/**
 * "Diner" theme: a 1950s roadside diner. Mint-green cabinetry with cherry-red trim, cream walls, chrome everywhere,
 * a black-and-white checkerboard floor, glossy cartoon (toon, 3 bands) shading with crisp highlights under warm
 * bright light and a slight vignette. "Grocer" in bright cherry-red sign letters, chrome on trim and knobs; 3D text in GrocerEZ
 * Retro (./font.typeface.json, bold rounded squircle letters). UI: cream panels with cherry-red borders.
 * Owner: diner theme designer. See README.md.
 */
import type { SceneTheme } from "../../types";

const MINT = "#A8E6CF";
const CHERRY = "#D7263D";
const CREAM = "#FFF3D6";
const CHROME = "#DCE3E8";

const diner: SceneTheme = {
  id: "diner",
  name: "Diner",
  description: "1950s diner: mint and cherry red, chrome trim, checkerboard floor.",
  swatches: [MINT, CHERRY, CREAM, CHROME, "#1B1B1F"],
  materialStyle: "toon",
  toonSteps: 3,
  textureStyle: "checker", // floor; other surfaces stay clean, glossy colour
  palette: {
    wood: MINT, // pantry body
    woodDark: CHERRY, // uprights, plinth, crown: cherry-red trim
    woodLight: "#E23B4F", // "Grocer" letters: bright cherry sign letters (chrome stays on trim, knobs, steel)
    wall: CREAM,
    floor: "#F7F5EE", // white tiles
    floorAlt: "#1B1B1F", // black tiles
    trim: "#C3CCD3", // chrome baseboard strip
    metal: CHROME,
    knob: "#EEF2F5",
    fridgeWall: "#F3FBF7",
    freezerWall: "#D6F2E8",
    glass: "#CDF4E8",
    paper: "#FFFBEF", // order-pad paper
    ink: "#2A1A1F",
    accent: CHERRY,
    allergen: "#FF5A1F", // hot orange-red, so it can't be mistaken for the cherry trim
    highlight: "#FFC93C", // mustard
    plant: "#3FA66B",
    pot: CHERRY,
  },
  lighting: {
    keyColor: "#FFF0D4", // warm, bright, a sunny diner window
    keyIntensity: 2.6,
    fillColor: "#FFE6CC",
    fillIntensity: 0.8,
    hemiSky: "#FFF8EA",
    hemiGround: "#C9706A", // red bounce off the trim and booths
    hemiIntensity: 0.85,
    ambientIntensity: 0.3,
    ambientColor: "#FFF1DE",
    shadows: true,
    fridgeLight: "#F0FFF9",
    freezerLight: "#BDF2E4",
  },
  background: CREAM,
  fog: { color: CREAM, near: 14, far: 32 },
  toneMapping: "neutral", // keeps the toon colours clean and saturated
  effects: {
    bloom: { strength: 0.25, threshold: 0.9 }, // only the chrome highlights sparkle
    vignette: { strength: 0.22 },
  },
  font: "retro",
  allergenGlow: { style: "pulse", periodS: 2 },
  ui: {
    panel: "#FFF8E7",
    panelBorder: CHERRY,
    text: "#2A1A1F",
    textMuted: "#6B5157",
    accent: CHERRY,
    buttonFace: "#FFF8E7",
    buttonRing: CHERRY,
    buttonIcon: CHERRY,
    radius: 22,
    borderWidth: 3,
    // "retro" once the app registers a rounded display RN font (README); app font for now
    fontFamily: null,
  },
};

export default diner;
export { diner as dinerTheme };
export { checkerImage, dinerTextureImages, formicaImage } from "./textures";
export type { CheckerOptions, FormicaOptions } from "./textures";
