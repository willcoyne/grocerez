/**
 * Scene -> theme mapping layer (theme integration). The ONE place that turns a SceneTheme into the scene's derived
 * colours and per-part glow; every scene material module (exterior, shelves, food, room, store) asks here instead of
 * hard-coding colours or checking theme ids itself.
 *
 * - `sceneColors(theme)`: every colour the scene used to hard-code. Cozy returns the exact pre-theme constants (so the
 *   default theme renders exactly as before); other themes derive them from `theme.palette` / `theme.lighting`.
 * - `glowOverrides(theme, part)`: emissive for parts that light up in a theme (neon: letters, EZ sign, edge strips,
 *   knobs, shelf-lip strips, fridge display). The roles have no per-theme emissive, so it lives here.
 * - `washColor(theme, hex)`: product / prop colours (food packages, book cloth...) adapted to the theme
 *   (the sketch theme washes them toward paper so colour stays sparse, like marker on a pen drawing).
 * Owner: theme integrator.
 */
import { contrastRatio, luminance, mixHex, shadeHex } from "../../theme/color";
import type { MaterialOverrides } from "../../theme/materials";
import type { SceneTheme, ThemeId } from "../../theme/types";

// ---------------------------------------------------------------------------------------------------------------
// glow

/** Scene parts that may glow in a theme. */
export type GlowPart =
  | "letters" // "Grocer" letters on the crown
  | "signText" // "EZ" on the hanging sign
  | "edge" // crown cove step / edge strips
  | "doorEdge" // door mid-rail sill
  | "signFrame" // EZ sign border strips
  | "knob" // door knobs
  | "shelfEdge" // thin strip along each shelf lip
  | "display" // fridge / freezer temperature readout
  | "led" // fridge / freezer LED strip
  | "plant"
  | "storeSign" // store aisle sign text / logo
  | "storeTrim"; // store shelf price rails

/** Emissive intensity per glowing part (themes/neon/README.md: 1.6 to 2.6, label faces stay non-emissive). */
const GLOW: Partial<Record<ThemeId, Partial<Record<GlowPart, number>>>> = {
  neon: {
    letters: 2.6,
    signText: 2.4,
    edge: 1.8,
    doorEdge: 1.6,
    signFrame: 1.6,
    knob: 2.0,
    shelfEdge: 2.2,
    display: 2.5,
    led: 2.2,
    plant: 0.9,
    storeSign: 1.8,
    storeTrim: 1.4,
  },
};

/** The colour a glowing part lights up in. */
function glowColor(theme: SceneTheme, part: GlowPart): string {
  const p = theme.palette;
  switch (part) {
    case "letters":
      return p.woodLight;
    case "signText":
    case "edge":
    case "signFrame":
    case "shelfEdge":
    case "storeTrim":
      return p.trim;
    case "doorEdge":
      return p.accent;
    case "knob":
      return p.knob ?? p.metal;
    case "display":
      return p.glass;
    case "led":
      return theme.lighting.fridgeLight;
    case "plant":
      return p.plant;
    case "storeSign":
      return p.accent;
  }
}

/** Emissive intensity of a part in this theme, or null when it doesn't glow. */
export function glowIntensity(theme: SceneTheme, part: GlowPart): number | null {
  return GLOW[theme.id]?.[part] ?? null;
}

/** Material overrides that make `part` glow in this theme ({} when it doesn't). */
export function glowOverrides(theme: SceneTheme, part: GlowPart): MaterialOverrides {
  const k = glowIntensity(theme, part);
  return k == null ? {} : { emissive: glowColor(theme, part), emissiveIntensity: k, tag: `glow:${part}` };
}

/** Does this theme add glowing strips (extra meshes only drawn when something glows)? */
export function hasGlow(theme: SceneTheme, part: GlowPart): boolean {
  return glowIntensity(theme, part) != null;
}

export function glowColorFor(theme: SceneTheme, part: GlowPart): string {
  return glowColor(theme, part);
}

// ---------------------------------------------------------------------------------------------------------------
// colour helpers

/** The candidate with the best contrast against `bg`. */
export function bestContrast(bg: string, candidates: readonly string[]): string {
  let best = candidates[0];
  let score = -1;
  for (const c of candidates) {
    const r = contrastRatio(bg, c);
    if (r > score) {
      score = r;
      best = c;
    }
  }
  return best;
}

export function isDark(hex: string): boolean {
  return luminance(hex) < 0.18;
}

/** Product / prop colour adapted to the theme (sketch: a light marker wash over paper). */
export function washColor(theme: SceneTheme, hex: string): string {
  if (theme.materialStyle === "ink") return mixHex(hex, theme.palette.paper, 0.5);
  return hex;
}

// ---------------------------------------------------------------------------------------------------------------
// derived scene colours

export type SceneColors = {
  // exterior (vertex tints)
  crown: string;
  slat: string;
  interior: string;
  liningSide: string;
  liningTop: string;
  liningBottom: string;
  soil: string;
  leafDark: string;
  leafLight: string;
  pin: string;
  nail: string;
  string: string;
  ezText: string;
  /** knob hover/breathing glow colour */
  knobGlow: string;
  // shelves
  backWood: string;
  labelPaint: string;
  /** catch-light copy under shelf labels (null = no copy) */
  labelHighlight: string | null;
  steelDark: string;
  chrome: string;
  fridgeWallEmissive: string;
  glassEdge: string;
  glassEdgeEmissive: string;
  led: string;
  ledEmissive: string;
  fridgeLabel: string;
  freezerWallEmissive: string;
  frostGlass: string;
  frostTrim: string;
  frostLabel: string;
  iceLed: string;
  iceLedEmissive: string;
  display: string;
  readout: string;
  readoutEmissive: string;
  sparkle: string;
  mist: string;
  // food
  tagCard: string;
  tagEdge: string;
  tagText: string;
  low: string;
  warnText: string;
  labelCard: string;
  labelInk: string;
  labelMuted: string;
  labelRed: string;
  labelHeader: string;
  labelGreen: string;
  sticker: string;
  stickerRing: string;
};

const COZY: SceneColors = {
  crown: "#BA7F4E",
  slat: "#CF9766",
  interior: "#5A3A22",
  liningSide: "#6E4A2C",
  liningTop: "#634127",
  liningBottom: "#7A5333",
  soil: "#4A3326",
  leafDark: "#2E7D32",
  leafLight: "#7CB867",
  pin: "#E2483D",
  nail: "#55504B",
  string: "#8A6A4F",
  ezText: "#6B3E1C",
  knobGlow: "#FFB04A",
  backWood: "#B57B4B",
  labelPaint: "#4A2A12",
  labelHighlight: "#E9BC8A",
  steelDark: "#8E969E",
  chrome: "#E8ECEF",
  fridgeWallEmissive: "#DDEBF5",
  glassEdge: "#E9FBFF",
  glassEdgeEmissive: "#9FE3FF",
  led: "#F2FAFF",
  ledEmissive: "#EAF6FF",
  fridgeLabel: "#2F3A44",
  freezerWallEmissive: "#9CC9E8",
  frostGlass: "#E6F7FF",
  frostTrim: "#F4FBFF",
  frostLabel: "#1F5D8C",
  iceLed: "#DDF3FF",
  iceLedEmissive: "#8FD3FF",
  display: "#0E1A22",
  readout: "#8FE9FF",
  readoutEmissive: "#5CDBFF",
  sparkle: "#FFFFFF",
  mist: "#E8F6FF",
  tagCard: "#FFF8EE",
  tagEdge: "#C68B59",
  tagText: "#3B2A1A",
  low: "#FF9500",
  warnText: "#FFFFFF",
  labelCard: "#FFF8EE",
  labelInk: "#3B2A1A",
  labelMuted: "#6E5A47",
  labelRed: "#FF3B30",
  labelHeader: "#1E140B",
  labelGreen: "#2E7D32",
  sticker: "#FFFFFF",
  stickerRing: "#2E7D32",
};

/** Per-theme tweaks on top of the generic derivation (kept here so no scene file checks theme ids). */
const TWEAKS: Partial<Record<ThemeId, Partial<SceneColors>>> = {};

const cache = new Map<string, SceneColors>();

function derive(theme: SceneTheme): SceneColors {
  const p = theme.palette;
  const l = theme.lighting;
  const ink = theme.materialStyle === "ink";
  const steelDark = shadeHex(p.metal, -0.3);
  const frostTrim = mixHex(p.freezerWall, "#FFFFFF", 0.6);
  const labelOn = (bg: string) => bestContrast(bg, [p.ink, p.paper, "#1E1E24", "#FFFFFF"]);
  const dark = isDark(p.paper);
  const base: SceneColors = {
    crown: mixHex(p.wood, p.woodDark, 0.15),
    slat: p.woodDark, // louvres in the trim colour (diner: cherry slats on mint)
    interior: ink ? shadeHex(p.wood, -0.1) : shadeHex(p.wood, -0.5),
    liningSide: ink ? shadeHex(p.wood, -0.06) : shadeHex(p.wood, -0.42),
    liningTop: ink ? shadeHex(p.wood, -0.08) : shadeHex(p.wood, -0.47),
    liningBottom: ink ? shadeHex(p.wood, -0.04) : shadeHex(p.wood, -0.36),
    soil: shadeHex(p.woodDark, -0.45),
    leafDark: shadeHex(p.plant, -0.3),
    leafLight: shadeHex(p.plant, 0.25),
    pin: p.allergen,
    nail: shadeHex(p.metal, -0.55),
    string: mixHex(p.woodDark, p.wood, 0.4),
    ezText: ink ? p.ink : p.woodDark,
    knobGlow: p.highlight,
    backWood: shadeHex(p.wood, -0.08),
    labelPaint: p.ink,
    labelHighlight: null,
    steelDark,
    chrome: shadeHex(p.metal, 0.45),
    fridgeWallEmissive: l.fridgeLight,
    glassEdge: mixHex(p.glass, "#FFFFFF", 0.6),
    glassEdgeEmissive: p.glass,
    led: mixHex(l.fridgeLight, "#FFFFFF", 0.5),
    ledEmissive: l.fridgeLight,
    fridgeLabel: labelOn(p.metal),
    freezerWallEmissive: l.freezerLight,
    frostGlass: mixHex(p.freezerWall, "#FFFFFF", 0.4),
    frostTrim,
    frostLabel: labelOn(frostTrim),
    iceLed: mixHex(l.freezerLight, "#FFFFFF", 0.5),
    iceLedEmissive: l.freezerLight,
    display: ink ? p.ink : shadeHex(p.metal, -0.85),
    readout: ink ? p.paper : mixHex(p.glass, "#FFFFFF", 0.3),
    readoutEmissive: ink ? p.paper : p.glass,
    sparkle: "#FFFFFF",
    mist: mixHex(p.freezerWall, "#FFFFFF", 0.5),
    tagCard: p.paper,
    tagEdge: p.wood,
    tagText: p.ink,
    low: "#FF9500",
    warnText: bestContrast(p.allergen, ["#FFFFFF", p.ink, "#1E1E24"]),
    labelCard: p.paper,
    labelInk: p.ink,
    labelMuted: mixHex(p.ink, p.paper, 0.3),
    labelRed: dark ? mixHex(p.allergen, "#FFFFFF", 0.15) : p.allergen,
    labelHeader: p.ink,
    labelGreen: dark ? mixHex(p.accent, "#FFFFFF", 0.2) : p.accent,
    sticker: p.paper,
    stickerRing: p.accent,
  };
  return { ...base, ...TWEAKS[theme.id] };
}

/** Derived scene colours for a theme (cached; cozy = the exact pre-theme constants). */
export function sceneColors(theme: SceneTheme): SceneColors {
  if (theme.id === "cozy") return COZY;
  let c = cache.get(theme.id);
  if (!c) {
    c = derive(theme);
    cache.set(theme.id, c);
  }
  return c;
}

/** True for the default look (some modules keep their original, hand-tuned materials for it). */
export function isDefaultLook(theme: SceneTheme): boolean {
  return theme.id === "cozy";
}

/**
 * Size multiplier for small 3D text in a theme. The pixel theme renders through a ~3 px pixelation, which eats glyphs
 * whose 5x7 font pixels fall under one block: its shelf labels and name tags set larger (still clamped by the callers'
 * max widths, so layout doesn't change).
 */
export function textScaleFor(theme: SceneTheme, where: "label" | "tag"): number {
  const pixelate = theme.effects.pixelate?.pixelSize ?? 0;
  if (pixelate < 2) return 1;
  return where === "label" ? 1.5 : 1.35;
}
