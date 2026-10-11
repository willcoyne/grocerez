/**
 * Pixel-art surface textures for the "pixel" theme: original, hand-tuned procedural art (no image files), generated
 * as DataTextures so they upload through expo-gl on native as well as WebGL on web.
 *
 * Every texture is drawn on a small grid with a 5-tone ramp per base colour (outline, shadow, base, light, highlight).
 * Shadows shift toward warm purple and highlights toward butter yellow, the way pixel artists hue-shift. Each texture
 * tiles seamlessly (all features wrap around the tile edges), uses nearest filtering and no mipmaps.
 *
 * Two modes:
 * - "color" (default): palette-coloured sRGB texture; use it with material colour white.
 * - "luma": grey multiplier (base tone ~0.88, highlights 1.0); use it on tinted / vertex-coloured materials such as the
 *   exterior's shared wood material.
 *
 * Tile size: `width / texelsPerUnit` world units (default 32 texels per unit, see `pixel.texelsPerUnit`). For a surface
 * of S world units set `texture.repeat` to `S * texelsPerUnit / width` (also stored in `texture.userData`).
 * The generators are pure factories (no caching): callers own the result and dispose it.
 */
import {
  DataTexture,
  NearestFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from "three";

import type { ThemePalette } from "../../types";
import { PIXEL_PALETTE } from "./palette";

export type PixelTextureMode = "color" | "luma";

export type PixelTextureOptions = {
  mode?: PixelTextureMode;
  /** colours to draw with (defaults: the pixel theme palette) */
  palette?: Partial<ThemePalette>;
  /** variation seed (deterministic) */
  seed?: number;
  /** stored in userData to help callers compute `repeat`; default 32 */
  texelsPerUnit?: number;
};

/** Raw RGBA pixels, row 0 = top of the image. */
export type PixelImage = { width: number; height: number; data: Uint8Array };

export type PixelTextureKind = "woodPlanks" | "floorBoards" | "wallpaper" | "crateBoards";

// --- colour helpers -------------------------------------------------------------------------------------------------

type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  const n = parseInt(full.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const scale = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
const round = (a: RGB): RGB => a.map((v) => Math.max(0, Math.min(255, Math.round(v)))) as RGB;

const SHADOW_HUE: RGB = [74, 36, 72]; // warm plum
const LIGHT_HUE: RGB = [255, 238, 170]; // butter

/** Tone indices into a ramp. */
const OUTLINE = 0;
const SHADOW = 1;
const BASE = 2;
const LIGHT = 3;
const HIGHLIGHT = 4;
type Tone = 0 | 1 | 2 | 3 | 4;

/** 5-tone hue-shifted ramp: outline, shadow, base, light, highlight. */
export function rampOf(hex: string): RGB[] {
  const b = hexToRgb(hex);
  return [
    round(mix(scale(b, 0.5), SHADOW_HUE, 0.3)),
    round(mix(scale(b, 0.8), SHADOW_HUE, 0.12)),
    round(b),
    round(mix(b, LIGHT_HUE, 0.22)),
    round(mix(b, LIGHT_HUE, 0.45)),
  ];
}

/** Grey multipliers for the same tones in "luma" mode. */
const LUMA = [0.46, 0.72, 0.88, 0.95, 1.0];

// --- deterministic noise ----------------------------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- canvas of (colour key, tone) cells ---------------------------------------------------------------------------------

/** A drawing grid: every cell stores which base colour (index into `bases`) and which tone of its ramp to use. */
class Grid {
  readonly key: Uint8Array;
  readonly tone: Uint8Array;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.key = new Uint8Array(width * height);
    this.tone = new Uint8Array(width * height).fill(BASE);
  }
  private idx(x: number, y: number) {
    const w = this.width;
    const h = this.height;
    return (((y % h) + h) % h) * w + (((x % w) + w) % w); // wraps: features may cross the tile edge
  }
  set(x: number, y: number, tone: Tone, key?: number) {
    const i = this.idx(x, y);
    this.tone[i] = tone;
    if (key !== undefined) this.key[i] = key;
  }
  get(x: number, y: number): Tone {
    return this.tone[this.idx(x, y)] as Tone;
  }
  fillKey(y0: number, y1: number, key: number) {
    for (let y = y0; y < y1; y++) for (let x = 0; x < this.width; x++) this.key[this.idx(x, y)] = key;
  }
}

function render(grid: Grid, bases: string[], mode: PixelTextureMode, keyLuma: number[] = []): PixelImage {
  const { width, height } = grid;
  const data = new Uint8Array(width * height * 4);
  const ramps = bases.map(rampOf);
  for (let i = 0; i < width * height; i++) {
    const key = grid.key[i];
    const tone = grid.tone[i];
    let rgb: RGB;
    if (mode === "luma") {
      const g = Math.round(255 * Math.min(1, LUMA[tone] * (keyLuma[key] ?? 1)));
      rgb = [g, g, g];
    } else {
      rgb = ramps[key][tone];
    }
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

// --- shared plank painter --------------------------------------------------------------------------------------------

type PlankOpts = {
  plankH: number;
  /** butt joints per plank per tile */
  joints: number;
  knots: number;
  nails: boolean;
  /** colour key per plank row (cycled) */
  keys: number[];
};

/** Horizontal planks: 1px dark seam on top, light top edge, shadowed bottom edge, grain streaks, joints, knots, nails. */
function paintPlanks(grid: Grid, rand: () => number, o: PlankOpts) {
  const { width: w, height: h } = grid;
  const planks = Math.floor(h / o.plankH);
  for (let p = 0; p < planks; p++) {
    const y0 = p * o.plankH;
    const key = o.keys[p % o.keys.length];
    grid.fillKey(y0, y0 + o.plankH, key);
    for (let x = 0; x < w; x++) {
      grid.set(x, y0, OUTLINE);
      grid.set(x, y0 + 1, LIGHT);
      grid.set(x, y0 + o.plankH - 1, SHADOW);
    }
    // grain: short horizontal streaks of shadow, a few light flecks
    const streaks = Math.round((w / 8) * (0.8 + rand() * 0.6));
    for (let s = 0; s < streaks; s++) {
      const y = y0 + 2 + Math.floor(rand() * (o.plankH - 3));
      const x = Math.floor(rand() * w);
      const len = 2 + Math.floor(rand() * 7);
      for (let k = 0; k < len; k++) grid.set(x + k, y, SHADOW);
    }
    const flecks = Math.round(w / 10);
    for (let s = 0; s < flecks; s++) {
      const y = y0 + 2 + Math.floor(rand() * (o.plankH - 3));
      const x = Math.floor(rand() * w);
      if (grid.get(x, y) === BASE) {
        grid.set(x, y, LIGHT);
        grid.set(x + 1, y, LIGHT);
      }
    }
    // butt joints, evenly spread with a random phase per plank (staggered)
    const phase = Math.floor(rand() * w);
    for (let j = 0; j < o.joints; j++) {
      const x = phase + Math.round((j * w) / o.joints);
      for (let y = y0 + 1; y < y0 + o.plankH; y++) {
        grid.set(x, y, OUTLINE);
        grid.set(x + 1, y, y === y0 + o.plankH - 1 ? SHADOW : LIGHT);
      }
      if (o.nails) {
        const ny = y0 + Math.floor(o.plankH / 2);
        grid.set(x - 2, ny, OUTLINE);
        grid.set(x + 3, ny, OUTLINE);
        grid.set(x - 2, ny - 1, HIGHLIGHT);
        grid.set(x + 3, ny - 1, HIGHLIGHT);
      }
    }
  }
  // knots: little dark eyes with a shadow ring, the grain line beside them
  for (let k = 0; k < o.knots; k++) {
    const p = Math.floor(rand() * planks);
    const cx = Math.floor(rand() * w);
    const cy = p * o.plankH + Math.floor(o.plankH / 2);
    for (const [dx, dy] of [
      [-2, 0], [-1, -1], [0, -1], [1, -1], [2, 0], [1, 1], [0, 1], [-1, 1],
    ]) {
      grid.set(cx + dx, cy + dy, SHADOW);
    }
    grid.set(cx, cy, OUTLINE);
    grid.set(cx - 1, cy, OUTLINE);
    grid.set(cx + 1, cy, SHADOW);
    for (let x = cx + 3; x < cx + 7; x++) grid.set(x, cy, SHADOW);
    grid.set(cx - 1, cy - 1, LIGHT);
  }
}

// --- the four textures (pure pixel images) ----------------------------------------------------------------------------

function pal(o?: PixelTextureOptions): ThemePalette {
  return { ...PIXEL_PALETTE, ...(o?.palette ?? {}) };
}

/** Golden oak planks with knots (pantry body, doors, stool): long boards, no butt joints (joints read as bricks on
 * narrow uprights). 64x64 texels, planks 8 texels tall. */
export function woodPlanksImage(o?: PixelTextureOptions): PixelImage {
  const p = pal(o);
  const grid = new Grid(64, 64);
  paintPlanks(grid, mulberry32(o?.seed ?? 11), { plankH: 8, joints: 0, knots: 3, nails: false, keys: [0, 0, 1, 0, 0, 1, 0, 0] });
  return render(grid, [p.wood, p.woodLight], o?.mode ?? "color", [1, 1.06]);
}

/** Floor boards: wider planks alternating floor / floorAlt, staggered joints with nail heads. 64x64 texels. */
export function floorBoardsImage(o?: PixelTextureOptions): PixelImage {
  const p = pal(o);
  const grid = new Grid(64, 64);
  paintPlanks(grid, mulberry32(o?.seed ?? 23), { plankH: 8, joints: 2, knots: 2, nails: true, keys: [0, 1, 0, 0, 1, 0, 1, 1] });
  return render(grid, [p.floor, p.floorAlt], o?.mode ?? "color", [1, 0.92]);
}

/** Cream/peach wallpaper: soft vertical stripes and a tiny four-petal flower on a staggered lattice. 32x32 texels. */
export function wallpaperImage(o?: PixelTextureOptions): PixelImage {
  const p = pal(o);
  const grid = new Grid(32, 32);
  // keys: 0 wall, 1 petal (wall pushed toward the pot's terracotta), 2 leaf (plant), 3 flower centre (woodLight)
  const petal = mixHex(p.wall, p.pot, 0.35);
  // soft stripes: solid light seams every 16 texels, dotted light seams halfway between
  for (let y = 0; y < 32; y++) {
    for (const x of [0, 16]) grid.set(x, y, LIGHT);
    if (y % 2 === 0) for (const x of [8, 24]) grid.set(x, y, LIGHT);
  }
  const flower = (cx: number, cy: number) => {
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) grid.set(cx + dx, cy + dy, BASE, 1);
    grid.set(cx, cy, LIGHT, 3);
    grid.set(cx + 1, cy + 2, SHADOW, 2); // leaf
    grid.set(cx + 2, cy + 2, BASE, 2);
  };
  for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 2; gx++) flower(4 + gx * 16 + (gy % 2) * 8, 4 + gy * 8);
  return render(grid, [p.wall, petal, p.plant, p.woodLight], o?.mode ?? "color", [1, 0.97, 0.9, 1]);
}

/** Crate / shelf boards: light boards with a nail at each end. 32x32 texels, boards 8 texels tall. */
export function crateBoardsImage(o?: PixelTextureOptions): PixelImage {
  const p = pal(o);
  const grid = new Grid(32, 32);
  paintPlanks(grid, mulberry32(o?.seed ?? 37), { plankH: 8, joints: 0, knots: 1, nails: false, keys: [0, 1, 0, 1] });
  for (let b = 0; b < 4; b++) {
    for (const x of [2, 29]) {
      grid.set(x, b * 8 + 4, OUTLINE);
      grid.set(x, b * 8 + 3, HIGHLIGHT);
    }
  }
  return render(grid, [mixHex(p.wood, p.woodLight, 0.45), p.woodLight], o?.mode ?? "color", [1, 1.05]);
}

function mixHex(a: string, b: string, t: number): string {
  const c = round(mix(hexToRgb(a), hexToRgb(b), t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// --- DataTexture wrapper ---------------------------------------------------------------------------------------------

/** Nearest-filtered, mipmap-free, repeating DataTexture (sRGB in color mode, linear grey in luma mode). */
export function toDataTexture(img: PixelImage, mode: PixelTextureMode = "color", texelsPerUnit = 32): DataTexture {
  // DataTexture row 0 is the bottom (v = 0); our images are drawn top-down.
  const { width: w, height: h, data } = img;
  const flipped = new Uint8Array(data.length);
  for (let y = 0; y < h; y++) flipped.set(data.subarray(y * w * 4, (y + 1) * w * 4), (h - 1 - y) * w * 4);
  const tex = new DataTexture(flipped, w, h, RGBAFormat, UnsignedByteType);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = mode === "color" ? SRGBColorSpace : NoColorSpace;
  tex.userData = { pixelArt: true, texels: [w, h], texelsPerUnit, tileWorldSize: [w / texelsPerUnit, h / texelsPerUnit] };
  tex.needsUpdate = true;
  return tex;
}

const IMAGES: Record<PixelTextureKind, (o?: PixelTextureOptions) => PixelImage> = {
  woodPlanks: woodPlanksImage,
  floorBoards: floorBoardsImage,
  wallpaper: wallpaperImage,
  crateBoards: crateBoardsImage,
};

const make = (kind: PixelTextureKind) => (o?: PixelTextureOptions) =>
  toDataTexture(IMAGES[kind](o), o?.mode ?? "color", o?.texelsPerUnit ?? 32);

/**
 * Optional hook for the theme core (`themedTexture`): factories returning a fresh DataTexture.
 * `wood`, `floor`, `wall`, `shelf` are aliases matching the usual surface names.
 */
export const pixelTextures = {
  woodPlanks: make("woodPlanks"),
  floorBoards: make("floorBoards"),
  wallpaper: make("wallpaper"),
  crateBoards: make("crateBoards"),
  wood: make("woodPlanks"),
  floor: make("floorBoards"),
  wall: make("wallpaper"),
  shelf: make("crateBoards"),
} as const;

export const pixelTextureImages = IMAGES;
