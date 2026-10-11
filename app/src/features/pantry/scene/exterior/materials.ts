// Materials and palette for the exterior, per theme. Every surface goes through the theme material factory
// (themedMaterial: shared, cached per theme); colours live in the merged geometry as vertex tints rebuilt from
// `exteriorPalette(theme)`, so the materials stay white (vertexColors) and only shading / texture differ per theme.
// Cozy reproduces the pre-theme look exactly (same colours, roughness and procedural grain).
import { MeshBasicMaterial } from "three";

import { createThemedMaterial, themedMaterial, type MaterialOverrides, type ThemedMaterial } from "../../../theme/materials";
import { getActiveTheme } from "../../../theme/store";
import type { SceneTheme } from "../../../theme/types";
import { glowIntensity, glowOverrides, sceneColors, type GlowPart } from "../sceneTheme";

/** Cozy (default theme) exterior colours. Other themes: `exteriorPalette(theme)`. */
export const PALETTE = {
  wood: "#C68B59",
  woodDark: "#8B5A2B",
  woodLight: "#E0B07A",
  crown: "#BA7F4E",
  slat: "#CF9766",
  interior: "#5A3A22",
  liningSide: "#6E4A2C",
  liningTop: "#634127",
  liningBottom: "#7A5333",
  wall: "#F3E9DC",
  cream: "#FFF8EE",
  ink: "#2B2730",
  brass: "#D2A24C",
  terracotta: "#C96B43",
  soil: "#4A3326",
  leaf: "#4E9A51",
  leafDark: "#2E7D32",
  leafLight: "#7CB867",
  pin: "#E2483D",
  nail: "#55504B",
  string: "#8A6A4F",
  ezText: "#6B3E1C",
  floor: "#B9804F",
} as const;

export type ExteriorPalette = { [K in keyof typeof PALETTE]: string };

const palettes = new Map<string, ExteriorPalette>();

/** Vertex-tint colours of the exterior for a theme (cozy: PALETTE). */
export function exteriorPalette(theme: SceneTheme = getActiveTheme()): ExteriorPalette {
  if (theme.id === "cozy") return PALETTE;
  const hit = palettes.get(theme.id);
  if (hit) return hit;
  const p = theme.palette;
  const c = sceneColors(theme);
  const out: ExteriorPalette = {
    wood: p.wood,
    woodDark: p.woodDark,
    woodLight: p.woodLight,
    crown: c.crown,
    slat: c.slat,
    interior: c.interior,
    liningSide: c.liningSide,
    liningTop: c.liningTop,
    liningBottom: c.liningBottom,
    wall: p.wall,
    cream: p.trim,
    ink: p.ink,
    brass: p.knob ?? p.metal,
    terracotta: p.pot,
    soil: c.soil,
    leaf: p.plant,
    leafDark: c.leafDark,
    leafLight: c.leafLight,
    pin: c.pin,
    nail: c.nail,
    string: c.string,
    ezText: c.ezText,
    floor: p.floor,
  };
  palettes.set(theme.id, out);
  return out;
}

export type ExteriorMaterials = {
  /** all wood: vertex-tinted, grain map. */
  wood: ThemedMaterial;
  /** "Grocer" letters (= wood unless the theme lights them up) */
  letters: ThemedMaterial;
  /** "EZ" lettering on the sign */
  signText: ThemedMaterial;
  /** sign border strips */
  signFrame: ThemedMaterial;
  /** crown cove step (edge strip) */
  edge: ThemedMaterial;
  /** door mid-rail sill */
  doorEdge: ThemedMaterial;
  /** painted / non-wood static bits (pot, soil, pin, nail): vertex-tinted. */
  paint: ThemedMaterial;
  leaf: ThemedMaterial;
  /** knobs; its emissiveIntensity is animated (breathing "tap me" glow) on top of the theme's base glow */
  knob: ThemedMaterial;
  paper: ThemedMaterial;
  ink: ThemedMaterial;
  hit: MeshBasicMaterial;
};

/** Exterior wood UVs are 1.7 tiles per metre (geometry.ts); pixel textures derive their texel size from it. */
const WOOD: MaterialOverrides = { vertexColors: true, texture: { uvPerUnit: 1.7 } };

/**
 * The knob's emissiveIntensity is driven every frame by the door animation (0 .. ~0.8 breathing glow). Themes whose
 * knobs glow on their own keep that base glow underneath: the animated value is added on top of `base`.
 */
function withGlowBase(m: ThemedMaterial, base: number) {
  let animated = 0;
  Object.defineProperty(m, "emissiveIntensity", {
    configurable: true,
    enumerable: true,
    get: () => base + animated,
    set: (v: number) => {
      animated = v;
    },
  });
}

const cache = new Map<string, ExteriorMaterials>();
// One invisible but raycastable tap-target material, theme independent.
let hitMat: MeshBasicMaterial | null = null;

function woodFor(theme: SceneTheme, part: GlowPart): ThemedMaterial {
  return themedMaterial(theme, "wood", { ...WOOD, ...glowOverrides(theme, part) });
}

export function getMaterials(theme: SceneTheme = getActiveTheme()): ExteriorMaterials {
  const hit = cache.get(theme.id);
  if (hit) return hit;
  const c = sceneColors(theme);
  const knobGlow = glowIntensity(theme, "knob");
  // the knob's colour follows the theme; its animated glow uses the hover colour (or the theme's knob glow)
  const knob = createThemedMaterial(theme, "knob", {
    emissive: knobGlow != null ? (theme.palette.knob ?? theme.palette.metal) : c.knobGlow,
    emissiveIntensity: 0,
  });
  if (knobGlow != null) withGlowBase(knob, knobGlow);
  hitMat ??= new MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 });
  const mats: ExteriorMaterials = {
    wood: themedMaterial(theme, "wood", WOOD),
    letters: woodFor(theme, "letters"),
    signText: woodFor(theme, "signText"),
    signFrame: woodFor(theme, "signFrame"),
    edge: woodFor(theme, "edge"),
    doorEdge: woodFor(theme, "doorEdge"),
    paint: themedMaterial(theme, "generic", { vertexColors: true, roughness: 0.78 }),
    leaf: themedMaterial(theme, "plant", { vertexColors: true, ...glowOverrides(theme, "plant") }),
    knob,
    paper: themedMaterial(theme, "paper"),
    ink: themedMaterial(theme, "ink"),
    hit: hitMat,
  };
  cache.set(theme.id, mats);
  return mats;
}

/** Drop a theme's exterior materials (the shared themed ones belong to the theme cache; only the knob is ours). */
export function disposeExteriorMaterials(themeId: string) {
  const m = cache.get(themeId);
  if (!m) return;
  m.knob.dispose();
  cache.delete(themeId);
}
