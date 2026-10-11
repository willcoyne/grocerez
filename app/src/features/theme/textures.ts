/**
 * Procedural surface textures per theme (`themedTexture`). DataTextures only (no canvas, no image files), so they
 * upload through expo-gl on native and WebGL on web. Cached per theme id + kind + options; never dispose a returned
 * texture yourself, call `disposeThemeTextures(themeId)` (or `disposeThemeCaches` from ./materials).
 *
 * Colour contract (read `texture.userData.baked`):
 * - baked === false (wood, woodPlanks, wall, frost, paper in most styles): a grey multiplier. Use it as `map` on a
 *   material whose colour is the palette colour (or white + vertex colours).
 * - baked === true (floor in every style; pixel wallpaper): palette colours are baked in (sRGB). Use material colour white.
 * `userData.emissiveMask` (grid floors): a white-on-black line mask to use as `emissiveMap` (neon glow lines).
 * `userData.pixelArt` (pixel style): nearest filtering, no mipmaps.
 *
 * Style "grain" is the cozy look, ported unchanged from scene/exterior/materials.ts (wood, floor) and
 * scene/shelves/materials.ts (wood "board" variant, woodPlanks = beadboard, frost).
 * Owner: theme core.
 */
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NearestFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from "three";

import { hexToRgb, mixHex } from "./color";
import { checkerImage } from "./themes/diner/textures";
import { neonGridImage } from "./themes/neon/textures";
import { pixelTextureImages, type PixelImage } from "./themes/pixel/textures";
import { paperImage } from "./themes/sketch/textures";
import type { SceneTheme, ThemePalette } from "./types";

export type TextureKind = "wood" | "woodPlanks" | "floor" | "wall" | "frost" | "paper";

export type ThemedTextureOptions = {
  /** texture.repeat (default [1, 1]) */
  repeat?: [number, number];
  /**
   * UV tiles per world unit of the target geometry (e.g. exterior wood UVs are 1.7 per metre). For pixel textures the
   * repeat is then derived so one texel = 1 / theme.texelsPerUnit world units (multiplied with `repeat`).
   */
  uvPerUnit?: number;
  /** "board": the shelf-board grain (cozy shelves); default: the exterior grain. Only affects kind "wood". */
  variant?: "board";
};

export type ThemedTextureData = {
  baked: boolean;
  pixelArt: boolean;
  emissiveMask?: DataTexture;
};

// ---------------------------------------------------------------------------------------------------------------
// noise helpers (deterministic: textures must look the same on every launch)

/** xorshift used by the exterior textures (kept identical for the cozy port). */
function xorRng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/** mulberry32 used by the shelf textures (kept identical for the cozy port). */
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

function smoothTable(n: number, seed: number, passes = 3): Float32Array {
  const r = xorRng(seed);
  let t = new Float32Array(n).map(() => r());
  for (let p = 0; p < passes; p++) {
    const next = new Float32Array(n);
    for (let i = 0; i < n; i++) next[i] = (t[(i - 1 + n) % n] + t[i] * 2 + t[(i + 1) % n]) / 4;
    t = next;
  }
  return t;
}

function valueNoise2D(w: number, h: number, cell: number, rand: () => number) {
  const gw = Math.ceil(w / cell) + 1;
  const gh = Math.ceil(h / cell) + 1;
  const grid = new Float32Array(gw * gh).map(() => rand());
  return (x: number, y: number) => {
    const gx = x / cell;
    const gy = y / cell;
    const x0 = Math.floor(gx) % (gw - 1);
    const y0 = Math.floor(gy) % (gh - 1);
    const fx = gx - Math.floor(gx);
    const fy = gy - Math.floor(gy);
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const g = (ix: number, iy: number) => grid[iy * gw + ix];
    const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * sx;
    const b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
}

/** Tileable value noise (lattice wraps at `period` cells). */
function tileNoise(size: number, cells: number, rand: () => number) {
  const grid = new Float32Array(cells * cells).map(() => rand());
  return (x: number, y: number) => {
    const gx = (x / size) * cells;
    const gy = (y / size) * cells;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const g = (ix: number, iy: number) => grid[(((iy % cells) + cells) % cells) * cells + (((ix % cells) + cells) % cells)];
    const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * sx;
    const b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
}

const TAU = Math.PI * 2;
const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

type Px = [number, number, number, number];

type TexOpts = { srgb: boolean; nearest?: boolean };

function finish(tex: DataTexture, o: TexOpts): DataTexture {
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  if (o.nearest) {
    tex.magFilter = NearestFilter;
    tex.minFilter = NearestFilter;
    tex.generateMipmaps = false;
  } else {
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
  }
  tex.colorSpace = o.srgb ? SRGBColorSpace : NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function makeTex(w: number, h: number, fill: (x: number, y: number) => Px, o: TexOpts): DataTexture {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = fill(x, y);
      const i = (y * w + x) * 4;
      data[i] = p[0];
      data[i + 1] = p[1];
      data[i + 2] = p[2];
      data[i + 3] = p[3];
    }
  }
  return finish(new DataTexture(data, w, h, RGBAFormat, UnsignedByteType), o);
}

const grey = (v: number): Px => {
  const c = clamp255(v * 255);
  return [c, c, c, 255];
};

function fromPixelImage(img: PixelImage, srgb: boolean, transpose = false): DataTexture {
  const { width: w0, height: h0, data } = img;
  const w = transpose ? h0 : w0;
  const h = transpose ? w0 : h0;
  // DataTexture row 0 = bottom (v = 0); pixel images are drawn top-down.
  return makeTex(
    w,
    h,
    (x, y) => {
      const sx = transpose ? h0 - 1 - y : x;
      const sy = transpose ? x : h0 - 1 - y;
      const i = (sy * w0 + sx) * 4;
      return [data[i], data[i + 1], data[i + 2], data[i + 3]];
    },
    { srgb, nearest: true },
  );
}

// ---------------------------------------------------------------------------------------------------------------
// grain (cozy) — ported verbatim

function grainWood(): DataTexture {
  const size = 128;
  const fibre = smoothTable(size, 7, 1).map((f) => f * f * 1.6);
  const fine = xorRng(11);
  return makeTex(
    size,
    size,
    (x, y) => {
      const v = y / size;
      const u = x / size;
      const warp = 0.22 * Math.sin(TAU * (v + 0.5 * u)) + 0.08 * Math.sin(TAU * (3 * v + u) + 1.7);
      const t = u * 5 + warp;
      const ring = Math.pow(0.5 + 0.5 * Math.cos(TAU * t), 6);
      const val = 1 - 0.12 * ring - 0.11 * fibre[x] - 0.02 * fine();
      const c = clamp255(val * 255);
      return [c, Math.round(c * 0.985), Math.round(c * 0.96), 255];
    },
    { srgb: false },
  );
}

function grainBoard(): DataTexture {
  const rand = mulberry32(7);
  const w = 256;
  const h = 64;
  const n = valueNoise2D(w, h, 16, rand);
  const fine = valueNoise2D(w, h, 3, rand);
  return makeTex(
    w,
    h,
    (x, y) => {
      const warp = n(x, y) * 6;
      const rings = Math.sin((y + warp) * 0.9) * 0.5 + 0.5;
      const v = 205 + rings * 30 + (fine(x, y) - 0.5) * 22 + (n(x * 0.5, y * 2) - 0.5) * 20;
      const c = clamp255(v);
      return [c, clamp255(c * 0.97), clamp255(c * 0.93), 255];
    },
    { srgb: true },
  );
}

function grainBeadboard(): DataTexture {
  const rand = mulberry32(21);
  const w = 128;
  const h = 256;
  const n = valueNoise2D(w, h, 14, rand);
  const fine = valueNoise2D(w, h, 2, rand);
  const plankW = w / 4;
  const tones = [0, 1, 2, 3].map(() => 0.9 + rand() * 0.12);
  return makeTex(
    w,
    h,
    (x, y) => {
      const p = Math.floor(x / plankW);
      const local = x % plankW;
      const warp = n(x, y) * 5;
      const g = Math.sin((x + warp) * 1.4) * 0.5 + 0.5;
      let v = (208 + g * 16 + (fine(x, y) - 0.5) * 14) * tones[p];
      if (local < 1.5) v *= 0.55;
      else if (local < 3) v *= 0.82;
      else if (local > plankW - 2) v *= 1.07;
      const c = clamp255(v);
      return [c, clamp255(c * 0.97), clamp255(c * 0.92), 255];
    },
    { srgb: true },
  );
}

function grainFloor(p: ThemePalette): DataTexture {
  const size = 256;
  const [br, bg, bb] = hexToRgb(p.floor);
  const r = xorRng(23);
  const planks = 4;
  const tones = Array.from({ length: planks }, () => 0.86 + r() * 0.22);
  const seams = Array.from({ length: planks }, () => r());
  const fibre = smoothTable(size, 31, 1);
  const fine = xorRng(5);
  const bandH = size / planks;
  return makeTex(
    size,
    size,
    (x, y) => {
      const band = Math.floor(y / bandH);
      const inBand = (y % bandH) / bandH;
      const u = x / size;
      const warp = 0.18 * Math.sin(TAU * (u * 2 + band * 0.3)) + 0.06 * Math.sin(TAU * u * 5 + band);
      const ring = Math.pow(0.5 + 0.5 * Math.cos(TAU * (inBand * 3 + warp)), 5);
      let val = tones[band] * (1 - 0.14 * ring - 0.05 * fibre[y] - 0.03 * fine());
      const edge = y % bandH;
      if (edge < 2) val *= 0.45;
      else if (edge < 4) val *= 0.82;
      else if (edge > bandH - 3) val *= 1.06;
      const su = (u - seams[band] + 1) % 0.5;
      if (su < 1.5 / size) val *= 0.5;
      else if (su < 3 / size) val *= 0.85;
      return [Math.min(255, Math.round(br * val)), Math.min(255, Math.round(bg * val)), Math.min(255, Math.round(bb * val)), 255];
    },
    { srgb: true },
  );
}

function grainFrost(): DataTexture {
  const rand = mulberry32(99);
  const w = 128;
  const h = 128;
  const big = valueNoise2D(w, h, 24, rand);
  const mid = valueNoise2D(w, h, 8, rand);
  return makeTex(
    w,
    h,
    (x, y) => {
      const v = big(x, y) * 0.55 + mid(x, y) * 0.35 + rand() * 0.1;
      const speck = rand() > 0.985 ? 40 : 0;
      return [clamp255(200 + v * 55 + speck), clamp255(225 + v * 30 + speck), 255, 255];
    },
    { srgb: true },
  );
}

/** Near-flat plaster / paper fibre multiplier (0.95..1). */
function softNoise(seed: number, amount: number): DataTexture {
  const size = 128;
  const rand = mulberry32(seed);
  const a = tileNoise(size, 8, rand);
  const b = tileNoise(size, 32, rand);
  return makeTex(size, size, (x, y) => grey(1 - amount * (0.6 * a(x, y) + 0.4 * b(x, y))), { srgb: false });
}

// ---------------------------------------------------------------------------------------------------------------
// pixel — wood / floor / wall come from the pixel theme designer's images, drawn with this theme's palette

function pixelFrost(): DataTexture {
  const rand = mulberry32(41);
  const cells = Array.from({ length: 256 }, () => rand());
  return makeTex(
    16,
    16,
    (x, y) => {
      const r = cells[y * 16 + x];
      const sparkle = (x + y * 3) % 7 === 0 && r > 0.6;
      const v = sparkle ? 1 : r > 0.75 ? 0.86 : 0.93;
      const c = clamp255(v * 255);
      return [clamp255(c * (sparkle ? 1 : 0.94)), clamp255(c * 0.98), c, 255];
    },
    { srgb: false, nearest: true },
  );
}

function pixelPaper(): DataTexture {
  return makeTex(16, 16, (x, y) => grey(y === 3 ? 0.86 : (x * 7 + y * 13) % 23 === 0 ? 0.94 : 1), { srgb: false, nearest: true });
}

// ---------------------------------------------------------------------------------------------------------------
// hatch — pen strokes on white (multipliers), floor baked with the palette

const INK = 0.3;

/** Soft line profile: 1 on the line centre, 0 at `w` away. */
const stroke = (d: number, w: number) => Math.max(0, 1 - Math.abs(d) / w);

function hatchWood(): DataTexture {
  const size = 128;
  return makeTex(
    size,
    size,
    (x, y) => {
      const u = x / size;
      const v = y / size;
      // a few long wavy grain strokes along v, broken into dashes
      let ink = 0;
      for (let k = 0; k < 3; k++) {
        const cx = (k + 0.3 + 0.08 * Math.sin(TAU * (v * 2 + k * 0.37))) / 3;
        let du = Math.abs(u - cx);
        du = Math.min(du, 1 - du);
        const dash = 0.5 + 0.5 * Math.sin(TAU * (v * (3 + k) + k * 0.21));
        ink = Math.max(ink, stroke(du * size, 0.9) * (dash > 0.25 ? 1 : 0));
      }
      return grey(1 - (1 - INK) * ink * 0.75);
    },
    { srgb: false },
  );
}

function hatchPlanks(): DataTexture {
  const size = 128;
  return makeTex(
    size,
    size,
    (x, y) => {
      const local = x % (size / 4);
      let ink = stroke(local, 1.2); // seam
      const v = y / size;
      const sx = (x % 32) - 16 - 6 * Math.sin(TAU * (v + x / 64));
      if (Math.sin(TAU * v * 2 + Math.floor(x / 32)) > 0.4) ink = Math.max(ink, stroke(sx, 0.7) * 0.6);
      return grey(1 - (1 - INK) * ink);
    },
    { srgb: false },
  );
}

function hatchFloor(p: ThemePalette): DataTexture {
  const size = 256;
  const base = hexToRgb(p.floor);
  const alt = hexToRgb(p.floorAlt);
  const ink = hexToRgb(p.ink);
  const bandH = size / 4;
  const seams = [0.13, 0.62, 0.37, 0.86];
  return makeTex(
    size,
    size,
    (x, y) => {
      const band = Math.floor(y / bandH);
      const c = band % 2 ? alt : base;
      const u = x / size;
      let a = stroke(y % bandH, 1.3);
      const su = (u - seams[band] + 1) % 0.5;
      a = Math.max(a, stroke(Math.min(su, 0.5 - su) * size, 1.1));
      // sparse grain strokes
      const gy = ((y % bandH) / bandH) * 3 + 0.15 * Math.sin(TAU * (u * 2 + band));
      if (Math.sin(TAU * u * 3 + band * 1.7) > 0.3) a = Math.max(a, stroke((gy - Math.round(gy)) * bandH * 0.33, 0.6) * 0.5);
      return [clamp255(c[0] + (ink[0] - c[0]) * a), clamp255(c[1] + (ink[1] - c[1]) * a), clamp255(c[2] + (ink[2] - c[2]) * a), 255];
    },
    { srgb: true },
  );
}

function hatchFrost(): DataTexture {
  const size = 64;
  return makeTex(
    size,
    size,
    (x, y) => {
      const cx = (x % 32) - 16;
      const cy = (y % 32) - 16;
      const star = Math.max(stroke(cx, 0.6) * (Math.abs(cy) < 5 ? 1 : 0), stroke(cy, 0.6) * (Math.abs(cx) < 5 ? 1 : 0));
      const diag = stroke(cx - cy, 0.6) * (Math.abs(cx) < 3 ? 1 : 0);
      return grey(1 - (1 - 0.55) * Math.max(star, diag));
    },
    { srgb: false },
  );
}

// ---------------------------------------------------------------------------------------------------------------
// checker — diner: checker floor, tiled wall, formica wood

function checkerFloor(p: ThemePalette): DataTexture {
  // diner designer's linoleum checkerboard, drawn with this theme's floor / floorAlt
  const t = fromPixelImage(
    checkerImage({ size: 128, tiles: 2, light: p.floor, dark: p.floorAlt, grout: mixHex(p.floor, p.floorAlt, 0.5) }),
    true,
  );
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  return t;
}

/** Sketch designer's drawing paper as a grey multiplier (tint white; the material colour tints it). */
function sketchPaper(seed: number): DataTexture {
  const t = fromPixelImage(paperImage({ size: 128, tint: "#FFFFFF", seed }), false);
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  return t;
}

function tiles(cells: number, groutDepth: number): DataTexture {
  const size = 128;
  const step = size / cells;
  return makeTex(
    size,
    size,
    (x, y) => {
      const lx = x % step;
      const ly = y % step;
      const g = lx < 1.5 || ly < 1.5 ? 1 - groutDepth : lx > step - 2 || ly > step - 2 ? 0.97 : 1;
      return grey(g);
    },
    { srgb: false },
  );
}

function formica(): DataTexture {
  const size = 128;
  const rand = mulberry32(73);
  const flecks = new Float32Array(size * size).map(() => rand());
  return makeTex(size, size, (x, y) => {
    const f = flecks[y * size + x];
    return grey(f > 0.97 ? 0.82 : f < 0.03 ? 1 : 0.95 + f * 0.04);
  }, { srgb: false });
}

function panels(): DataTexture {
  const size = 128;
  return makeTex(size, size, (x) => {
    const local = x % (size / 2);
    return grey(local < 2 ? 0.7 : local < 4 ? 0.9 : local > size / 2 - 2 ? 1.0 : 0.97);
  }, { srgb: false });
}

// ---------------------------------------------------------------------------------------------------------------
// grid — neon: dark floor with glowing lines (+ emissive mask), faint grid walls

function gridFloor(p: ThemePalette): { tex: DataTexture; mask: DataTexture } {
  // neon designer's synthwave grid, drawn with this theme's floor (base) and floorAlt (lines)
  const img = neonGridImage({ size: 128, cells: 2, base: p.floor, line: p.floorAlt });
  const tex = fromPixelImage(img, true);
  const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
  const [br, bg, bb] = hexToRgb(p.floor);
  const [lr, lg, lb] = hexToRgb(p.floorAlt);
  const l0 = lum(br, bg, bb);
  const span = Math.max(1, Math.abs(lum(lr, lg, lb) - l0));
  const maskImg: PixelImage = { width: img.width, height: img.height, data: new Uint8Array(img.data.length) };
  for (let i = 0; i < img.data.length; i += 4) {
    const v = clamp255((Math.abs(lum(img.data[i], img.data[i + 1], img.data[i + 2]) - l0) / span) * 255);
    maskImg.data.set([v, v, v, 255], i);
  }
  const mask = fromPixelImage(maskImg, false);
  for (const t of [tex, mask]) {
    t.magFilter = LinearFilter;
    t.minFilter = LinearMipmapLinearFilter;
    t.generateMipmaps = true;
  }
  return { tex, mask };
}

function gridLines(cells: number, depth: number, vertical = true, horizontal = true): DataTexture {
  const size = 128;
  const step = size / cells;
  return makeTex(
    size,
    size,
    (x, y) => {
      const lx = Math.min(x % step, step - (x % step));
      const ly = Math.min(y % step, step - (y % step));
      const a = Math.max(vertical ? stroke(lx, 1.2) : 0, horizontal ? stroke(ly, 1.2) : 0);
      return grey(1 - depth * a);
    },
    { srgb: false },
  );
}

// ---------------------------------------------------------------------------------------------------------------
// none

function solid(hex: string | null): DataTexture {
  const [r, g, b] = hex ? hexToRgb(hex) : [255, 255, 255];
  return makeTex(1, 1, () => [r, g, b, 255], { srgb: !!hex, nearest: true });
}

// ---------------------------------------------------------------------------------------------------------------

type Built = { tex: DataTexture; baked: boolean; mask?: DataTexture };

function build(theme: SceneTheme, kind: TextureKind, variant: "board" | undefined): Built {
  const p = theme.palette;
  switch (theme.textureStyle) {
    case "grain":
      switch (kind) {
        case "wood":
          return { tex: variant === "board" ? grainBoard() : grainWood(), baked: false };
        case "woodPlanks":
          return { tex: grainBeadboard(), baked: false };
        case "floor":
          return { tex: grainFloor(p), baked: true };
        case "wall":
          return { tex: softNoise(13, 0.04), baked: false };
        case "frost":
          return { tex: grainFrost(), baked: false };
        case "paper":
          return { tex: softNoise(17, 0.05), baked: false };
      }
      break;
    case "pixel":
      switch (kind) {
        case "wood":
          return {
            tex: fromPixelImage((variant === "board" ? pixelTextureImages.crateBoards : pixelTextureImages.woodPlanks)({ palette: p, mode: "luma" }), false),
            baked: false,
          };
        case "woodPlanks":
          return { tex: fromPixelImage(pixelTextureImages.woodPlanks({ palette: p, mode: "luma", seed: 5 }), false, true), baked: false };
        case "floor":
          return { tex: fromPixelImage(pixelTextureImages.floorBoards({ palette: p, mode: "color" }), true), baked: true };
        case "wall":
          return { tex: fromPixelImage(pixelTextureImages.wallpaper({ palette: p, mode: "color" }), true), baked: true };
        case "frost":
          return { tex: pixelFrost(), baked: false };
        case "paper":
          return { tex: pixelPaper(), baked: false };
      }
      break;
    case "hatch":
      switch (kind) {
        case "wood":
          return { tex: hatchWood(), baked: false };
        case "woodPlanks":
          return { tex: hatchPlanks(), baked: false };
        case "floor":
          return { tex: hatchFloor(p), baked: true };
        case "wall":
          return { tex: sketchPaper(7), baked: false };
        case "frost":
          return { tex: hatchFrost(), baked: false };
        case "paper":
          return { tex: sketchPaper(19), baked: false };
      }
      break;
    case "checker":
      switch (kind) {
        case "wood":
          return { tex: formica(), baked: false };
        case "woodPlanks":
          return { tex: panels(), baked: false };
        case "floor":
          return { tex: checkerFloor(p), baked: true };
        case "wall":
          return { tex: tiles(4, 0.12), baked: false };
        case "frost":
          return { tex: grainFrost(), baked: false };
        case "paper":
          return { tex: softNoise(17, 0.05), baked: false };
      }
      break;
    case "grid":
      switch (kind) {
        case "wood":
          return { tex: gridLines(8, 0.12, false, true), baked: false };
        case "woodPlanks":
          return { tex: gridLines(4, 0.3, true, false), baked: false };
        case "floor": {
          const g = gridFloor(p);
          return { tex: g.tex, baked: true, mask: g.mask };
        }
        case "wall":
          return { tex: gridLines(4, 0.18), baked: false };
        case "frost":
          return { tex: gridLines(8, 0.1), baked: false };
        case "paper":
          return { tex: softNoise(17, 0.05), baked: false };
      }
      break;
    case "none":
      break;
  }
  return kind === "floor" ? { tex: solid(p.floor), baked: true } : { tex: solid(null), baked: false };
}

// ---------------------------------------------------------------------------------------------------------------
// cache

/** themeId -> key -> texture. Base textures (repeat 1) are shared; repeat variants are clones sharing the Source. */
const cache = new Map<string, Map<string, DataTexture>>();

function bucket(themeId: string) {
  let b = cache.get(themeId);
  if (!b) {
    b = new Map();
    cache.set(themeId, b);
  }
  return b;
}

function baseTexture(theme: SceneTheme, kind: TextureKind, variant: "board" | undefined): DataTexture {
  const key = `${kind}|${variant ?? ""}`;
  const b = bucket(theme.id);
  const hit = b.get(key);
  if (hit) return hit;
  const built = build(theme, kind, variant);
  const tex = built.tex;
  tex.name = `${theme.id}:${kind}${variant ? `:${variant}` : ""}`;
  const data: ThemedTextureData = { baked: built.baked, pixelArt: tex.magFilter === NearestFilter };
  if (built.mask) data.emissiveMask = built.mask;
  Object.assign(tex.userData, data);
  b.set(key, tex);
  return tex;
}

/** Repeat implied by the options (pixel textures follow theme.texelsPerUnit when uvPerUnit is given). */
export function textureRepeat(theme: SceneTheme, tex: DataTexture, opts: ThemedTextureOptions = {}): [number, number] {
  const [rx, ry] = opts.repeat ?? [1, 1];
  const img = tex.image as { width: number; height: number };
  if (opts.uvPerUnit && tex.userData.pixelArt && img.width > 1) {
    const tpu = theme.texelsPerUnit ?? 32;
    return [(rx * tpu) / (img.width * opts.uvPerUnit), (ry * tpu) / (img.height * opts.uvPerUnit)];
  }
  return [rx, ry];
}

/**
 * Procedural texture of `kind` in the theme's TextureStyle. Shared + cached: don't mutate or dispose it.
 * See the file header for the baked / multiplier contract (`texture.userData.baked`).
 */
export function themedTexture(theme: SceneTheme, kind: TextureKind, opts: ThemedTextureOptions = {}): DataTexture {
  const variant = kind === "wood" ? opts.variant : undefined;
  const base = baseTexture(theme, kind, variant);
  const [rx, ry] = textureRepeat(theme, base, opts);
  if (rx === 1 && ry === 1) return base;
  const key = `${kind}|${variant ?? ""}|${rx.toFixed(4)},${ry.toFixed(4)}`;
  const b = bucket(theme.id);
  const hit = b.get(key);
  if (hit) return hit;
  // Texture.copy JSON-clones userData; strip it so the mask texture isn't serialised.
  const ud = base.userData;
  base.userData = {};
  const t = base.clone(); // shares base.source: one GPU upload
  base.userData = ud;
  t.repeat.set(rx, ry);
  t.userData = { ...ud };
  const mask = ud.emissiveMask as DataTexture | undefined;
  if (mask) {
    const m = mask.clone();
    m.repeat.set(rx, ry);
    t.userData.emissiveMask = m;
  }
  t.needsUpdate = true;
  b.set(key, t);
  return t;
}

/** Dispose every texture created for `themeId` (call after its materials are gone). */
export function disposeThemeTextures(themeId: string): void {
  const b = cache.get(themeId);
  if (!b) return;
  for (const t of b.values()) {
    (t.userData.emissiveMask as DataTexture | undefined)?.dispose();
    t.dispose();
  }
  cache.delete(themeId);
}

/** Test / debug: number of cached textures for a theme. */
export function cachedTextureCount(themeId: string): number {
  return cache.get(themeId)?.size ?? 0;
}
