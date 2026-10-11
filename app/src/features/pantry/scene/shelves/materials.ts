/**
 * Shared geometries / materials / textures for the shelf column. Geometries are theme independent (created lazily
 * once); materials come from the theme material factory per theme (cached per theme id, the previous theme's owned
 * resources are freed when another theme is built). Cozy reproduces the pre-theme materials exactly. Textures are
 * procedural DataTextures (theme core + two soft sprites here), so they work on native via expo-gl.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import { createThemedMaterial, themedMaterial, type ThemedMaterial } from "../../../theme/materials";
import { getActiveTheme } from "../../../theme/store";
import type { SceneTheme } from "../../../theme/types";
import { glowIntensity, glowOverrides, sceneColors } from "../sceneTheme";
import { DEPTH, INNER_WIDTH, LIP_HEIGHT, UPRIGHT_THICKNESS } from "./layout";

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/** Soft round sprite (white, alpha falloff) for sparkles and mist. */
function softDotTexture(size: number, hardness: number) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const d = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = clamp255(Math.pow(1 - d, hardness) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------------------------------------------
// geometries + sprites (theme independent)

/** Height of the glowing strip along each shelf lip (themes that light shelf edges). */
export const EDGE_STRIP_H = 0.012;

let shared: ReturnType<typeof buildShared> | null = null;

function buildShared() {
  return {
    sparkle: softDotTexture(32, 2.2),
    mist: softDotTexture(64, 1.6),
    geometries: {
      board: new RoundedBoxGeometry(INNER_WIDTH, 0.045, DEPTH - 0.03, 2, 0.012),
      lip: new RoundedBoxGeometry(INNER_WIDTH + 0.01, LIP_HEIGHT, 0.04, 2, 0.014),
      glass: new THREE.BoxGeometry(INNER_WIDTH - 0.02, 0.014, DEPTH - 0.05),
      glassEdge: new THREE.BoxGeometry(INNER_WIDTH - 0.02, 0.008, 0.012),
      trim: new RoundedBoxGeometry(INNER_WIDTH, LIP_HEIGHT * 0.78, 0.03, 2, 0.008),
      upright: new RoundedBoxGeometry(UPRIGHT_THICKNESS, 1, DEPTH + 0.06, 2, 0.012), // scaled in y
      back: new THREE.PlaneGeometry(INNER_WIDTH + 0.02, 1), // scaled in y
      unitBox: new THREE.BoxGeometry(1, 1, 1),
      unitPlane: new THREE.PlaneGeometry(1, 1),
      header: new RoundedBoxGeometry(INNER_WIDTH + 0.01, 1, 0.06, 3, 0.02), // scaled in y
      edgeStrip: new THREE.BoxGeometry(INNER_WIDTH + 0.01, EDGE_STRIP_H, 0.01),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// per-theme materials

/**
 * Every shelf material gets its own cache key: the scene sets clippingPlanes on the shelf subtree's materials, so they
 * must never be the same instances the exterior / room / store use.
 */
const SHELF = { tag: "shelf" } as const;

function build(theme: SceneTheme) {
  shared ??= buildShared();
  const c = sceneColors(theme);
  const t = theme;

  // The beadboard's repeat/offset is animated with the scroll window (ShelfColumn), so the back panel owns its
  // material and a clone of the theme texture (the clone shares the image: one upload).
  const backWood = createThemedMaterial(t, "wood", { color: c.backWood, map: "woodPlanks", roughness: 0.85 });
  const beadboard = (backWood.map as THREE.DataTexture).clone();
  beadboard.needsUpdate = true;
  backWood.map = beadboard;

  const sparkle = new THREE.PointsMaterial({
    map: shared.sparkle,
    color: c.sparkle,
    size: 0.035,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mist = new THREE.MeshBasicMaterial({ map: shared.mist, color: c.mist, transparent: true, opacity: 0.16, depthWrite: false });

  const materials = {
    wood: themedMaterial(t, "wood", { ...SHELF, texture: { variant: "board" }, roughness: 0.72 }),
    darkWood: themedMaterial(t, "woodDark", { ...SHELF, texture: { variant: "board" } }),
    backWood,
    labelPaint: themedMaterial(t, "ink", { ...SHELF, color: c.labelPaint, roughness: 0.9 }),
    labelHighlight: c.labelHighlight ? themedMaterial(t, "generic", { ...SHELF, color: c.labelHighlight, roughness: 0.8 }) : null,
    /** glowing strip along each shelf lip (only drawn when the theme lights shelf edges) */
    edgeStrip: themedMaterial(t, "trim", { ...SHELF, ...glowOverrides(t, "shelfEdge"), map: false }),

    steel: themedMaterial(t, "metal", SHELF),
    steelDark: themedMaterial(t, "metal", { ...SHELF, color: c.steelDark, roughness: 0.4, metalness: 0.8 }),
    chrome: themedMaterial(t, "metal", { ...SHELF, color: c.chrome, roughness: 0.15, metalness: 0.95 }),
    fridgeWall: themedMaterial(t, "fridgeWall", { ...SHELF, emissive: c.fridgeWallEmissive, emissiveIntensity: 0.12 }),
    glass: themedMaterial(t, "glass", SHELF),
    glassEdge: themedMaterial(t, "generic", { ...SHELF, color: c.glassEdge, emissive: c.glassEdgeEmissive, emissiveIntensity: 0.7, roughness: 0.1 }),
    led: themedMaterial(t, "generic", { ...SHELF, color: c.led, emissive: c.ledEmissive, emissiveIntensity: glowIntensity(t, "led") ?? 1.6, roughness: 1 }),
    fridgeLabel: themedMaterial(t, "ink", { ...SHELF, color: c.fridgeLabel, roughness: 0.6 }),

    frostWall: themedMaterial(t, "freezerWall", { ...SHELF, emissive: c.freezerWallEmissive, emissiveIntensity: 0.18 }),
    frostGlass: themedMaterial(t, "glass", { ...SHELF, color: c.frostGlass, map: "frost", roughness: 0.6, metalness: 0, opacity: 0.55 }),
    frostTrim: themedMaterial(t, "generic", { ...SHELF, color: c.frostTrim, roughness: 0.5 }),
    frostLabel: themedMaterial(t, "ink", { ...SHELF, color: c.frostLabel, roughness: 0.7 }),
    iceLed: themedMaterial(t, "generic", { ...SHELF, color: c.iceLed, emissive: c.iceLedEmissive, emissiveIntensity: glowIntensity(t, "led") ?? 1.4, roughness: 1 }),

    /** temperature readout: dark display + glowing digits */
    display: themedMaterial(t, "generic", { ...SHELF, color: c.display, roughness: 0.25, metalness: 0.2, hatch: false }),
    readout: themedMaterial(t, "generic", {
      ...SHELF,
      color: c.readout,
      emissive: c.readoutEmissive,
      emissiveIntensity: glowIntensity(t, "display") ?? 1.2,
      roughness: 1,
      hatch: false,
    }),
    sparkle,
    mist,
  } satisfies Record<string, ThemedMaterial | THREE.Material | null>;

  return {
    themeId: theme.id,
    /** does this theme draw the glowing shelf-lip strips? */
    edgeGlow: glowIntensity(t, "shelfEdge") != null,
    textures: { beadboard, sparkle: shared.sparkle, mist: shared.mist },
    geometries: shared.geometries,
    materials,
  };
}

export type ShelfAssets = ReturnType<typeof build>;

const cache = new Map<string, ShelfAssets>();

function disposeAssets(a: ShelfAssets) {
  a.materials.backWood.dispose();
  a.textures.beadboard.dispose();
  a.materials.sparkle.dispose();
  a.materials.mist.dispose();
}

/** Shelf assets for a theme (default: the active one). Cached; building another theme frees the previous one's. */
export function shelfAssets(theme: SceneTheme = getActiveTheme()): ShelfAssets {
  const hit = cache.get(theme.id);
  if (hit) return hit;
  for (const [id, old] of cache) {
    disposeAssets(old);
    cache.delete(id);
  }
  const a = build(theme);
  cache.set(theme.id, a);
  return a;
}
