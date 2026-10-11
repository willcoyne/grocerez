/**
 * Scene theme contract (shared by the theme system and every theme definition).
 * Owner: orchestrator. Builders: don't change shapes without asking; add optional fields only.
 *
 * A theme restyles the 3D Pantry (and the store / overlays) without changing layout or behaviour:
 * palette tokens, a material style, lighting, background/fog, full-screen effects, the 3D font, and RN overlay colours.
 */
export type ThemeId = "cozy" | "pixel" | "sketch" | "neon" | "diner";

/**
 * How surfaces are shaded:
 * - "standard": PBR MeshStandardMaterial (cozy default)
 * - "toon":     MeshToonMaterial with a stepped gradient map (2–4 bands)
 * - "flat":     MeshLambertMaterial / unlit-ish, flatShading, no specular (pixel art)
 * - "ink":      paper-white fill + dark outlines + hatching (hand-drawn sketch)
 */
export type MaterialStyle = "standard" | "toon" | "flat" | "ink";

/** Procedural surface texture family for wood / floor / wall (generated as DataTextures; native-safe). */
export type TextureStyle = "grain" | "pixel" | "hatch" | "none" | "checker" | "grid";

export type ThemePalette = {
  wood: string; // pantry body, shelves
  woodDark: string; // uprights, trim, plinth
  woodLight: string; // "Grocer" letters, sign
  wall: string;
  floor: string;
  floorAlt: string; // second plank / tile colour
  trim: string; // baseboard, crown highlights
  metal: string; // knobs, fridge steel
  fridgeWall: string;
  freezerWall: string;
  glass: string;
  paper: string; // list note, labels, name tags
  ink: string; // text on paper, label text
  accent: string; // brand accent (badges, highlights)
  allergen: string; // allergen glow colour
  highlight: string; // search/selection ring
  plant: string;
  pot: string;
  /** optional (theme core): door knobs / handles; defaults to `metal` */
  knob?: string;
};

export type ThemeLighting = {
  keyColor: string;
  keyIntensity: number;
  fillColor: string;
  fillIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  ambientIntensity?: number;
  /** optional (theme core): ambient light colour; defaults to `fillColor` */
  ambientColor?: string;
  shadows: boolean;
  /** cool light in fridge/freezer sections */
  fridgeLight: string;
  freezerLight: string;
};

export type ThemeEffects = {
  /** render at low resolution and upscale with nearest filtering; size of one "pixel" in CSS px */
  pixelate?: { pixelSize: number };
  /** limit colours per channel (pixel art / retro) */
  posterize?: { levels: number };
  /** screen-space outlines from depth/normal edges */
  outline?: { color: string; thickness: number; strength?: number };
  /** soft glow on emissive / bright areas (cheap approximation is fine) */
  bloom?: { strength: number; threshold: number };
  vignette?: { strength: number };
  /** paper grain / scanline style overlay */
  grain?: { strength: number; kind: "paper" | "scanline" | "noise" };
  /** optional ordered dithering (pixel themes) */
  dither?: { strength: number };
};

export type ThemeUi = {
  panel: string; // overlay panel background
  panelBorder: string;
  text: string;
  textMuted: string;
  accent: string;
  buttonFace: string;
  buttonRing: string;
  buttonIcon: string;
  radius: number; // 0 for pixel UI
  borderWidth: number;
  /** font family key registered in app (null = app default) */
  fontFamily: string | null;
  /** pixel-style chunky borders/shadows */
  pixelBorders?: boolean;
};

export type SceneTheme = {
  id: ThemeId;
  name: string;
  description: string;
  /** 4–5 colours for the settings picker preview */
  swatches: string[];
  materialStyle: MaterialStyle;
  /** toon/flat band count (toon gradient steps) */
  toonSteps?: number;
  textureStyle: TextureStyle;
  /** texture pixels per world unit for "pixel" textures (nearest filtering) */
  texelsPerUnit?: number;
  palette: ThemePalette;
  lighting: ThemeLighting;
  background: string;
  fog: { color: string; near: number; far: number } | null;
  toneMapping: "aces" | "neutral" | "none";
  effects: ThemeEffects;
  /** 3D text font: bundled helvetiker or a theme-provided typeface JSON module */
  font: "helvetiker" | "pixel" | "hand" | "retro";
  /** allergen glow animation */
  allergenGlow: { style: "pulse" | "blink" | "outline"; periodS: number };
  ui: ThemeUi;
};
