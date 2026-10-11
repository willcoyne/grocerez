/**
 * "Pixel" theme: a Stardew-Valley-ish cozy farmhouse rendered as pixel art in Three.js. The scene is rendered at low
 * resolution and upscaled with nearest filtering, posterized to a few warm tones with a light ordered dither, and drawn
 * with flat (Lambert, faceted) shading, nearest-filtered pixel textures and the GrocerPixel 5x7 font.
 * Owner: pixel theme designer. See README.md.
 */
import type { SceneTheme } from "../../types";
import { PIXEL_PALETTE, PIXEL_UI } from "./palette";

const pixel: SceneTheme = {
  id: "pixel",
  name: "Pixel",
  description: "Cozy pixel-art farmhouse: chunky pixels, golden oak planks and sunset light.",
  swatches: [PIXEL_PALETTE.wood, PIXEL_PALETTE.woodDark, PIXEL_PALETTE.wall, PIXEL_PALETTE.plant, PIXEL_PALETTE.highlight],
  materialStyle: "flat",
  toonSteps: 3,
  textureStyle: "pixel",
  texelsPerUnit: 32,
  palette: PIXEL_PALETTE,
  lighting: {
    keyColor: "#FFD7A0", // late-afternoon golden sun
    keyIntensity: 2.8,
    fillColor: "#C3B2EC", // lavender sky bounce: cool shadows against warm light
    fillIntensity: 0.55,
    hemiSky: "#FFF0D8",
    hemiGround: "#6E3F22",
    hemiIntensity: 0.95,
    ambientIntensity: 0.3,
    ambientColor: "#FFF0E0",
    shadows: true,
    fridgeLight: "#E4F6FF",
    freezerLight: "#AEE2FF",
  },
  background: "#EFCB98",
  fog: { color: "#EFCB98", near: 12, far: 28 },
  toneMapping: "none",
  effects: {
    pixelate: { pixelSize: 3 },
    // Tuned in a headless preview of the real exterior: 7 levels turned everything a muddy orange and a 0.35 dither read as
    // grime; 16 levels + a light dither keep the warm palette clean while still banding the shading, pixel size 4 broke up
    // the letters and door gap. A soft dark-brown 1px outline gives the sprite look.
    posterize: { levels: 16 },
    dither: { strength: 0.08 },
    outline: { color: "#3B2314", thickness: 1, strength: 0.35 },
    vignette: { strength: 0.25 },
  },
  font: "pixel",
  // two-frame blink (on / off), 1 Hz: well under the 3 flashes per second accessibility limit
  allergenGlow: { style: "blink", periodS: 1 },
  ui: PIXEL_UI,
};

export default pixel;
export { pixel as pixelTheme, PIXEL_PALETTE, PIXEL_UI };
export { pixelTextures, pixelTextureImages, rampOf, toDataTexture } from "./textures";
export type { PixelImage, PixelTextureKind, PixelTextureMode, PixelTextureOptions } from "./textures";
