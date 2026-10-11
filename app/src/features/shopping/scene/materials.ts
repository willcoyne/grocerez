/**
 * Shared geometries/materials for the store scene (created lazily once, never disposed: the scene is small and the
 * route is revisited often). Bright supermarket palette: pale tile, white/steel gondolas, brand-green signage.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

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

type Mats = ReturnType<typeof create>;
let mats: Mats | null = null;

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

function create() {
  const floorTex = tileTexture();
  return {
    floorTex,
    floor: std("#FFFFFF", 0.28, 0.0, { map: floorTex }),
    wall: std(STORE.wall, 0.9),
    wallBand: std(STORE.wallBand, 0.7),
    ceiling: std(STORE.ceiling, 0.95),
    steel: std(STORE.steel, 0.35, 0.65),
    steelDark: std(STORE.steelDark, 0.4, 0.6),
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
    cable: std(STORE.steelDark, 0.5, 0.5),
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
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
    shelfReflection: new THREE.MeshBasicMaterial({ color: "#9AA3AA", transparent: true, opacity: 0.12, depthWrite: false }),
    cartWire: std(STORE.cartWire, 0.25, 0.85),
    cartHandle: std(STORE.cartHandle, 0.5, 0.1),
    cartWheel: std("#2B2B2B", 0.7),
    logoRed: std("#E53935", 0.5),
    logoText: new THREE.MeshBasicMaterial({ color: "#FFFFFF", toneMapped: false }),
    logoBoard: std("#1F5D24", 0.5),
  };
}

export function getStoreMaterials(): Mats {
  if (!mats) mats = create();
  return mats;
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
