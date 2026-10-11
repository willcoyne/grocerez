/**
 * Shared geometries/materials for the store scene (created lazily, kept per theme: the scene is small and the route is
 * revisited often; another theme's set is freed when a new theme is built). Cozy: the bright supermarket palette
 * (pale tile, white/steel gondolas, brand-green signage), exactly as before theming. Other themes map every store
 * surface to the theme palette through the theme material factory (`createThemed`).
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import { bestContrast, glowIntensity, sceneColors } from "../../pantry/scene/sceneTheme";
import { mixHex, shadeHex } from "../../theme/color";
import { createThemedMaterial, themedMaterial } from "../../theme/materials";
import { getActiveTheme } from "../../theme/store";
import type { SceneTheme } from "../../theme/types";

export const STORE = {
  sky: "#EEF3F4", // clear colour / fog
  wall: "#E9EEEE",
  wallBand: "#2E7D32",
  floor: "#F4F3EE",
  grout: "#D3D7D6",
  steel: "#C9CED3",
  steelDark: "#8C949C",
  white: "#FAFBFB",
  shelf: "#E4E8EB",
  backPeg: "#DCE1E4",
  produce: "#5E8C3A",
  produceCrate: "#B88452",
  bakery: "#C68B59",
  cooler: "#F5F8FA",
  coolerLight: "#DDF1FF",
  freezer: "#CFE8F6",
  glass: "#BFE3F5",
  sign: "#2E7D32",
  signText: "#FFFFFF",
  tag: "#FFF6C7", // pale yellow shelf-edge price tag
  tagText: "#1C1B19",
  tagRim: "#F2C94C",
  red: "#FF3B30",
  redInk: "#B3261E",
  green: "#2E7D32",
  cartWire: "#D9DEE3",
  cartHandle: "#2E7D32",
  ceiling: "#F7F8F8",
  tube: "#FFFFFF",
} as const;


function std(color: string, roughness = 0.6, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}

function tileTexture() {
  // 2×2 tiles per repeat: soft checker of two near-white tones with grey grout lines.
  const n = 128;
  const data = new Uint8Array(n * n * 4);
  const a = new THREE.Color(STORE.floor);
  const b = new THREE.Color("#ECEDE8");
  const g = new THREE.Color(STORE.grout);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const half = n / 2;
      const tx = x % half;
      const ty = y % half;
      const grout = tx < 2 || ty < 2;
      const alt = (Math.floor(x / half) + Math.floor(y / half)) % 2 === 1;
      const c = grout ? g : alt ? b : a;
      const i = (y * n + x) * 4;
      data[i] = Math.round(c.r * 255);
      data[i + 1] = Math.round(c.g * 255);
      data[i + 2] = Math.round(c.b * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Soft radial falloff (alpha map) for fake floor reflections. */
let soft: THREE.DataTexture | null = null;
function softTexture() {
  if (soft) return soft;
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5;
      const dy = (y + 0.5) / n - 0.5;
      const d = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2);
      const a = Math.round(255 * Math.pow(1 - d, 2));
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = a;
      data[i + 3] = 255;
    }
  }
  soft = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  soft.magFilter = THREE.LinearFilter;
  soft.minFilter = THREE.LinearFilter;
  soft.needsUpdate = true;
  return soft;
}

/** Cozy: the original store materials. */
function createCozy() {
  const floorTex = tileTexture();
  return {
    floorTex,
    floor: std("#FFFFFF", 0.28, 0.0, { map: floorTex }),
    wall: std(STORE.wall, 0.9),
    wallBand: std(STORE.wallBand, 0.7),
    ceiling: std(STORE.ceiling, 0.95),
    steel: std(STORE.steel, 0.4, 0.2),
    steelDark: std(STORE.steelDark, 0.5, 0.2),
    shelf: std(STORE.shelf, 0.45, 0.25),
    backPeg: std(STORE.backPeg, 0.85),
    white: std(STORE.white, 0.5),
    produceBack: std(STORE.produce, 0.85),
    crate: std(STORE.produceCrate, 0.8),
    bakery: std(STORE.bakery, 0.7),
    cooler: std(STORE.cooler, 0.4, 0.1),
    coolerGlow: new THREE.MeshBasicMaterial({ color: STORE.coolerLight, toneMapped: false }),
    freezerBack: std(STORE.freezer, 0.35, 0.05, { emissive: new THREE.Color("#7FB8DA"), emissiveIntensity: 0.25 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: STORE.glass,
      transparent: true,
      opacity: 0.18,
      roughness: 0.05,
      metalness: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    glassShine: new THREE.MeshBasicMaterial({ color: "#FFFFFF", transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false }),
    sign: std(STORE.sign, 0.55),
    signText: new THREE.MeshBasicMaterial({ color: STORE.signText, toneMapped: false }),
    signRim: std("#FFFFFF", 0.5),
    cable: std(STORE.steelDark, 0.5, 0.2),
    tag: std(STORE.tag, 0.7),
    tagRim: std(STORE.tagRim, 0.6),
    tagText: new THREE.MeshBasicMaterial({ color: STORE.tagText }),
    tagMuted: new THREE.MeshBasicMaterial({ color: "#5A5A55" }),
    tagDone: new THREE.MeshBasicMaterial({ color: STORE.green }),
    badge: new THREE.MeshBasicMaterial({ color: STORE.red, toneMapped: false }),
    badgeText: new THREE.MeshBasicMaterial({ color: "#FFFFFF", toneMapped: false }),
    tube: new THREE.MeshBasicMaterial({ color: STORE.tube, toneMapped: false }),
    tubeHousing: std("#E3E6E8", 0.6, 0.3),
    floorGlow: new THREE.MeshBasicMaterial({
      color: "#FFFFFF",
      alphaMap: softTexture(),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
    shelfReflection: new THREE.MeshBasicMaterial({ color: "#7D868E", alphaMap: softTexture(), transparent: true, opacity: 0.22, depthWrite: false }),
    cartWire: std(STORE.cartWire, 0.3, 0.35),
    cartHandle: std(STORE.cartHandle, 0.5, 0.1),
    cartWheel: std("#2B2B2B", 0.7),
    logoRed: std("#E53935", 0.5),
    logoText: new THREE.MeshBasicMaterial({ color: "#FFFFFF", toneMapped: false }),
    logoBoard: std("#1F5D24", 0.5),
  };
}

type MatKey = Exclude<keyof ReturnType<typeof createCozy>, "floorTex">;
export type StoreMaterials = { floorTex: THREE.Texture } & Record<MatKey, THREE.Material>;

/** Every store surface from the theme palette. Store boxes are scaled unit boxes, so only the floor is textured. */
function createThemed(theme: SceneTheme): StoreMaterials {
  const p = theme.palette;
  const l = theme.lighting;
  const c = sceneColors(theme);
  const t = theme;
  const flat = { map: false as const, tag: "store" };
  const floor = createThemedMaterial(t, "floor", { roughness: 0.28 });
  // the floor texture's repeat/offset follows the aisle (StoreEnvironment): own clone, shared image
  const floorTex = (floor.map ?? new THREE.Texture()).clone();
  floorTex.needsUpdate = true;
  floor.map = floorTex;
  const glowSign = glowIntensity(t, "storeSign");
  const signBoard = glowSign != null ? p.woodDark : p.accent;
  const signText = glowSign != null ? p.accent : bestContrast(p.accent, ["#FFFFFF", p.paper, p.ink, "#1E1E24"]);
  const logoBoard = glowSign != null ? p.woodDark : shadeHex(p.accent, -0.35);
  const logoText = glowSign != null ? p.woodLight : bestContrast(logoBoard, ["#FFFFFF", p.paper, p.ink, "#1E1E24"]);
  const tube = mixHex("#FFFFFF", l.fillColor, 0.4);
  const unlit = (color: string, k = 1) => themedMaterial(t, "emissive", { color, emissiveIntensity: k, tag: "store" });
  return {
    floorTex,
    floor,
    wall: themedMaterial(t, "wall", { ...flat }),
    wallBand: themedMaterial(t, "accent", { ...flat }),
    ceiling: themedMaterial(t, "generic", { ...flat, color: mixHex(p.wall, "#FFFFFF", 0.35), roughness: 0.95 }),
    steel: themedMaterial(t, "metal", { ...flat }),
    steelDark: themedMaterial(t, "metal", { ...flat, color: c.steelDark, roughness: 0.5 }),
    shelf: themedMaterial(t, "metal", { ...flat, color: mixHex(p.metal, "#FFFFFF", 0.3), roughness: 0.45 }),
    backPeg: themedMaterial(t, "generic", { ...flat, color: mixHex(p.wall, p.metal, 0.35), roughness: 0.85 }),
    white: themedMaterial(t, "fridgeWall", { ...flat, emissiveIntensity: 0 }),
    produceBack: themedMaterial(t, "generic", { ...flat, color: shadeHex(p.plant, -0.35), roughness: 0.85 }),
    crate: themedMaterial(t, "wood", { ...flat }),
    bakery: themedMaterial(t, "wood", { ...flat, color: shadeHex(p.wood, 0.08) }),
    cooler: themedMaterial(t, "fridgeWall", { ...flat }),
    coolerGlow: unlit(l.fridgeLight),
    freezerBack: themedMaterial(t, "freezerWall", { ...flat, emissive: l.freezerLight, emissiveIntensity: 0.25 }),
    glass: themedMaterial(t, "glass", { ...flat, opacity: 0.18, side: "double" }),
    glassShine: new THREE.MeshBasicMaterial({ color: "#FFFFFF", transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false }),
    sign: themedMaterial(t, "generic", { ...flat, color: signBoard, roughness: 0.55 }),
    signText: unlit(signText, glowSign ?? 1),
    signRim: themedMaterial(t, "trim", { ...flat }),
    cable: themedMaterial(t, "metal", { ...flat, color: c.steelDark }),
    tag: themedMaterial(t, "paper", { ...flat, hatch: false }),
    tagRim: themedMaterial(t, "highlight", { ...flat }),
    tagText: unlit(p.ink),
    tagMuted: unlit(mixHex(p.ink, p.paper, 0.35)),
    tagDone: unlit(c.labelGreen),
    badge: unlit(p.allergen),
    badgeText: unlit(c.warnText),
    tube: unlit(tube, 1.4),
    tubeHousing: themedMaterial(t, "metal", { ...flat }),
    floorGlow: new THREE.MeshBasicMaterial({
      color: tube,
      alphaMap: softTexture(),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
    shelfReflection: new THREE.MeshBasicMaterial({ color: shadeHex(p.floor, -0.5), alphaMap: softTexture(), transparent: true, opacity: 0.22, depthWrite: false }),
    cartWire: themedMaterial(t, "metal", { ...flat }),
    cartHandle: themedMaterial(t, "accent", { ...flat }),
    cartWheel: themedMaterial(t, "generic", { ...flat, color: shadeHex(p.woodDark, -0.6) }),
    logoRed: themedMaterial(t, "generic", { ...flat, color: p.woodLight, ...(glowSign != null ? { emissive: p.woodLight, emissiveIntensity: 0.6 } : {}) }),
    logoText: unlit(logoText, glowSign ?? 1),
    logoBoard: themedMaterial(t, "generic", { ...flat, color: logoBoard }),
  };
}

const cache = new Map<string, StoreMaterials>();

/** Store materials for a theme (default: the active one); building a new theme's set frees the previous one. */
export function getStoreMaterials(theme: SceneTheme = getActiveTheme()): StoreMaterials {
  const hit = cache.get(theme.id);
  if (hit) return hit;
  for (const [id, old] of cache) {
    // cozy owns all its materials; themed sets own only the floor, the clone and the basic overlays
    if (id === "cozy") for (const v of Object.values(old)) (v as { dispose?: () => void }).dispose?.();
    else {
      old.floor.dispose();
      old.floorTex.dispose();
      old.glassShine.dispose();
      old.floorGlow.dispose();
      old.shelfReflection.dispose();
    }
    cache.delete(id);
  }
  const m: StoreMaterials = theme.id === "cozy" ? createCozy() : createThemed(theme);
  cache.set(theme.id, m);
  return m;
}

type Geos = ReturnType<typeof createGeos>;
let geos: Geos | null = null;

function createGeos() {
  return {
    unitBox: new THREE.BoxGeometry(1, 1, 1),
    roundBox: new RoundedBoxGeometry(1, 1, 1, 2, 0.08),
    plane: new THREE.PlaneGeometry(1, 1),
    cylinder: new THREE.CylinderGeometry(1, 1, 1, 12),
    circle: new THREE.CircleGeometry(1, 20),
    torus: new THREE.TorusGeometry(1, 0.18, 8, 20),
  };
}

export function getStoreGeometries(): Geos {
  if (!geos) geos = createGeos();
  return geos;
}

/** Meshes that must never take taps (glass doors, decorations in front of items). */
export const noRaycast = () => null;
