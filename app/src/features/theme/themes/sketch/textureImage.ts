/**
 * Small helpers shared by the sketch / neon / diner texture generators: an RGBA image type (rows top-down, same shape
 * as the pixel theme's PixelImage), a seeded PRNG, tileable value noise, and a native-safe DataTexture wrapper.
 * Generators stay pure (no three import) so they are cheap to unit-test; only `imageToDataTexture` touches three.
 * Owner: sketch / neon / diner theme designer.
 */
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from "three";

export type ThemeImage = { width: number; height: number; data: Uint8Array };
export type RGB = [number, number, number];

export function makeImage(width: number, height: number): ThemeImage {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

export function setPixel(img: ThemeImage, x: number, y: number, [r, g, b]: RGB, a = 255): void {
  const i = (y * img.width + x) * 4;
  img.data[i] = r;
  img.data[i + 1] = g;
  img.data[i + 2] = b;
  img.data[i + 3] = a;
}

export function getPixel(img: ThemeImage, x: number, y: number): [number, number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

export function hexRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

export const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** mulberry32: deterministic, so textures look the same on every launch and platform. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise that wraps every `period` pixels (period must divide the image size for seamless tiles). */
export function tileNoise(period: number, cells: number, rand: () => number): (x: number, y: number) => number {
  const grid = new Float32Array(cells * cells).map(() => rand());
  const cell = period / cells;
  return (x, y) => {
    const gx = x / cell, gy = y / cell;
    const ix = Math.floor(gx), iy = Math.floor(gy);
    const fx = gx - ix, fy = gy - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const at = (i: number, j: number) => grid[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)];
    const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
    const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
    return a + (b - a) * sy;
  };
}

/** Distance from point p to segment ab (pixels). */
export function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const ll = dx * dx + dy * dy;
  let t = ll > 0 ? ((px - ax) * dx + (py - ay) * dy) / ll : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/**
 * Wrap a ThemeImage in a repeating, mipmapped DataTexture (procedural, no image files: uploads through expo-gl on
 * native and WebGL on web). `color` = sRGB albedo / emissive map; false = linear data (masks, roughness).
 */
export function imageToDataTexture(img: ThemeImage, color = true): DataTexture {
  const { width: w, height: h, data } = img;
  const flipped = new Uint8Array(data.length); // DataTexture row 0 is the bottom
  for (let y = 0; y < h; y++) flipped.set(data.subarray(y * w * 4, (y + 1) * w * 4), (h - 1 - y) * w * 4);
  const tex = new DataTexture(flipped, w, h, RGBAFormat, UnsignedByteType);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = color ? SRGBColorSpace : NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
