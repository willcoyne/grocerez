/**
 * Tiny colour helpers for theme-driven overlays (UI contrast only, no app logic).
 * Theme colours are hex strings; anything unparsable is treated as a light colour.
 */
import type { ThemeUi } from "@/features/theme/types";

type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function luminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 1;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function isLight(hex: string): boolean {
  return luminance(hex) > 0.45;
}

/** Linear mix: t = 0 → a, t = 1 → b. */
export function mix(a: string, b: string, t: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  if (!x || !y) return a;
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/** Black-ish or white text, whichever reads better on `bg`. */
export function readableOn(bg: string): string {
  return contrastRatio(bg, "#FFFFFF") >= contrastRatio(bg, "#1C1B19") ? "#FFFFFF" : "#1C1B19";
}

/** Hex colour with alpha (falls back to the colour itself if unparsable). */
export function withAlpha(hex: string, alpha: number): string {
  const rgb = parseHex(hex);
  return rgb ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})` : hex;
}

/**
 * Derived tokens for a station sheet. The reused app components (MyPreferences, GroupMembers…) are drawn with the
 * app's light design tokens, so they always sit on a light "content" surface; on dark themes that surface stays light
 * so their dark text keeps ≥ 4.5:1 contrast.
 */
export function sheetTokens(ui: ThemeUi) {
  const pixel = !!ui.pixelBorders;
  const light = isLight(ui.panel);
  const border = pixel ? Math.max(ui.borderWidth, 3) : ui.borderWidth;
  return {
    pixel,
    border,
    radius: pixel ? 0 : ui.radius,
    cardRadius: pixel ? 0 : Math.min(Math.round(ui.radius * 0.66), 18),
    buttonRadius: pixel ? 0 : Math.min(ui.radius, 24),
    contentSurface: light ? mix(ui.panel, "#FFFFFF", 0.6) : "#FBF9F4",
    contentBorder: light ? mix(ui.panelBorder, ui.panel, 0.55) : ui.panelBorder,
    onAccent: readableOn(ui.accent),
    backdrop: light ? "rgba(43,33,24,0.18)" : "rgba(0,0,0,0.3)",
    fontFamily: ui.fontFamily ?? undefined,
  };
}

export type SheetTokens = ReturnType<typeof sheetTokens>;
