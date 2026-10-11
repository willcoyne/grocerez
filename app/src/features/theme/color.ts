/** Tiny hex colour helpers (no three dependency) shared by textures, materials and tests. Owner: theme core. */

export const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_RE.test(value);
}

/** "#rgb" / "#rrggbb" -> [r, g, b] 0..255 (invalid -> magenta so mistakes are visible). */
export function hexToRgb(hex: string): [number, number, number] {
  if (!isHexColor(hex)) return [255, 0, 255];
  let h = hex.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const to2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${to2(r)}${to2(g)}${to2(b)}`.toUpperCase();
}

/** Linear blend in sRGB space: t=0 -> a, t=1 -> b. */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/** amount > 0 lightens toward white, < 0 darkens toward black. */
export function shadeHex(hex: string, amount: number): string {
  return amount >= 0 ? mixHex(hex, "#FFFFFF", amount) : mixHex(hex, "#000000", -amount);
}

/** Relative luminance 0..1 (WCAG). */
export function luminance(hex: string): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
