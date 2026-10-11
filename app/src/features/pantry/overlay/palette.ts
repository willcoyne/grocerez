import type { Allergen } from "@contracts/dietary";

import { useMemo } from "react";

import { contrastRatio, hexToRgb, luminance, mixHex } from "../../theme/color";
import { useSceneTheme } from "../../theme/ThemeProvider";
import type { SceneTheme } from "../../theme/types";
import type { ShelfGroup } from "../types";

/** Pantry overlay palette (SPEC.md "Look & feel"). Text pairs were checked for >= 4.5:1 contrast. */
export const pantry = {
  cream: "#FFF8EE",
  creamDeep: "#F6EAD8",
  wall: "#F3E9DC",
  oak: "#C68B59",
  oakDark: "#8B5A2B", // icon/text on cream: ~5.6:1
  oakInk: "#5C3A1A", // body text on cream
  ink: "#2B2118",
  muted: "#6E5A47", // captions on cream: ~5.9:1
  green: "#2E7D32",
  red: "#FF3B30",
  redInk: "#A3221A", // allergen text on dangerTint: ~6:1
  redTint: "#FDE3E0",
  backdrop: "rgba(43,33,24,0.35)",
  shadow: "#5C3A1A",
} as const;

export type OverlayPalette = { [K in keyof typeof pantry]: string } & {
  /** panel background (may be translucent: neon draws its dark panels at ~88% opacity) */
  panel: string;
  /** button face (cream on cozy) */
  face: string;
  /** soft secondary panel (sections, search field) */
  panelAlt: string;
  divider: string;
  dividerSoft: string;
  pressed: string;
  idleBorder: string;
  track: string;
  faceBorder: string;
  /** text / icons on the accent and danger fills */
  onAccent: string;
  /** panel border colour (theme ui.panelBorder) */
  border: string;
  /** panel frame width (theme ui.borderWidth; cozy 3) */
  frame: number;
  /** light scrim behind the search card */
  backdropSoft: string;
  /** text / icons on the danger (redInk) fill */
  onDanger: string;
  /** border of the soft danger chip */
  redBorder: string;
  /** shopping-list notepad (matches the 3D note) */
  notePaper: string;
  noteRule: string;
  noteMargin: string;
  notePin: string;
  notePinShine: string;
  /** chunky pixel-art frames (square corners, thick borders) */
  pixel: boolean;
  /** theme corner radius relative to cozy (24): r(20) -> scaled radius */
  r: (cozyRadius: number) => number;
  /** border width: pixel themes get chunky borders */
  bw: (cozyWidth: number) => number;
};

const COZY_OVERLAY: OverlayPalette = {
  ...pantry,
  panel: pantry.cream,
  face: pantry.cream,
  panelAlt: "#FFFDF8",
  divider: "#EADBC6",
  dividerSoft: "#EFE3D2",
  pressed: "#F6EAD8",
  idleBorder: "#D9C3A5",
  track: "#E3D5C2",
  faceBorder: "#E3C9A8",
  onAccent: "#FFFFFF",
  border: pantry.oak,
  frame: 3,
  backdropSoft: "rgba(43,33,24,0.18)",
  onDanger: "#FFFFFF",
  redBorder: "#F2B8B1",
  notePaper: "#FFFBF2",
  noteRule: "#CFDDEA",
  noteMargin: "#E58A7E",
  notePin: "#D64541",
  notePinShine: "#F08A80",
  pixel: false,
  r: (n) => n,
  bw: (n) => n,
};

const rgba = (hex: string, a: number) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};

const overlayCache = new Map<string, OverlayPalette>();

/** Overlay colours for a theme (cozy: exactly `pantry` + the original hard-coded tints). */
export function overlayPaletteFor(theme: SceneTheme): OverlayPalette {
  if (theme.id === "cozy") return COZY_OVERLAY;
  const hit = overlayCache.get(theme.id);
  if (hit) return hit;
  const u = theme.ui;
  const dark = luminance(u.panel) < 0.18;
  const allergen = theme.palette.allergen;
  const radius = (n: number) => Math.round((n * u.radius) / 24);
  const best = (bg: string, list: string[]) => list.reduce((b, c) => (contrastRatio(bg, c) > contrastRatio(bg, b) ? c : b), list[0]);
  const redInk = dark ? mixHex(allergen, "#FFFFFF", 0.35) : mixHex(allergen, "#000000", 0.35);
  const redTint = mixHex(u.panel, allergen, dark ? 0.22 : 0.14);
  const paper = theme.palette.paper;
  const out: OverlayPalette = {
    cream: u.panel,
    creamDeep: mixHex(u.panel, u.textMuted, 0.1),
    wall: mixHex(u.panel, u.textMuted, 0.06),
    oak: u.buttonRing,
    oakDark: u.buttonIcon,
    oakInk: mixHex(u.text, u.buttonIcon, 0.3),
    ink: u.text,
    muted: u.textMuted,
    green: u.accent,
    red: allergen,
    redInk,
    redTint,
    backdrop: dark ? "rgba(0,0,0,0.55)" : rgba(u.text, 0.35),
    shadow: u.pixelBorders ? u.panelBorder : dark ? u.buttonRing : u.text,
    // neon: "dark translucent panels" (the contract only has a solid hex)
    panel: dark ? rgba(u.panel, 0.88) : u.panel,
    face: u.buttonFace,
    panelAlt: dark ? mixHex(u.panel, u.text, 0.06) : mixHex(u.panel, "#FFFFFF", 0.5),
    divider: mixHex(u.panel, u.panelBorder, 0.3),
    dividerSoft: mixHex(u.panel, u.panelBorder, 0.18),
    pressed: mixHex(u.panel, u.textMuted, 0.14),
    idleBorder: mixHex(u.panel, u.panelBorder, 0.5),
    track: mixHex(u.panel, u.textMuted, 0.28),
    faceBorder: mixHex(u.buttonFace, u.buttonRing, 0.35),
    onAccent: best(u.accent, ["#FFFFFF", u.panel, u.text]),
    border: u.panelBorder,
    frame: u.borderWidth,
    backdropSoft: dark ? "rgba(0,0,0,0.3)" : rgba(u.text, 0.18),
    onDanger: best(redInk, ["#FFFFFF", u.panel, u.text]),
    redBorder: mixHex(redTint, allergen, 0.35),
    notePaper: paper,
    noteRule: mixHex(paper, theme.palette.accent, 0.22),
    noteMargin: mixHex(paper, allergen, 0.5),
    notePin: allergen,
    notePinShine: mixHex(allergen, "#FFFFFF", 0.4),
    pixel: !!u.pixelBorders,
    r: radius,
    bw: (n) => (u.pixelBorders ? Math.max(n, u.borderWidth) : n),
  };
  overlayCache.set(theme.id, out);
  return out;
}

/** Overlay colours of the active theme (re-renders on a theme change). */
export function useOverlayPalette(): OverlayPalette {
  return overlayPaletteFor(useSceneTheme());
}

/** Memoised per-palette StyleSheet: `const styles = useOverlayStyles(makeStyles)`. */
export function useOverlayStyles<T>(make: (P: OverlayPalette) => T): T {
  const P = useOverlayPalette();
  return useMemo(() => make(P), [make, P]);
}

/** Soft drop shadow in the theme's shadow colour (pixel themes: a hard offset block shadow; neon: a glow). */
export function shadowFor(P: OverlayPalette) {
  if (P === COZY_OVERLAY) return softShadow;
  return P.pixel
    ? ({ shadowColor: P.shadow, shadowOpacity: 0.9, shadowRadius: 0, shadowOffset: { width: 3, height: 3 }, elevation: 4 } as const)
    : ({ ...softShadow, shadowColor: P.shadow, shadowOpacity: 0.3 } as const);
}

/** Official Nutri-Score colours. `fg` is the readable text colour on the fill. */
export const NUTRI_SCORE = [
  { letter: "a", bg: "#038141", fg: "#FFFFFF" },
  { letter: "b", bg: "#85BB2F", fg: "#1C1B19" },
  { letter: "c", bg: "#FECB02", fg: "#1C1B19" },
  { letter: "d", bg: "#EE8100", fg: "#1C1B19" },
  { letter: "e", bg: "#E63E11", fg: "#FFFFFF" },
] as const;

export const CALORIE_STEPS: (number | null)[] = [null, 100, 200, 300, 500];

export const GROUP_LABEL: Record<ShelfGroup, string> = {
  snacks: "Snacks",
  ingredients: "Ingredients",
  produce: "Produce",
  fridge: "Fridge",
  freezer: "Freezer",
};

/** Shelf chip colours: wood for dry shelves, cool tones for fridge/freezer. */
export const GROUP_CHIP: Record<ShelfGroup, { bg: string; fg: string }> = {
  snacks: { bg: "#F4E1CC", fg: "#5C3A1A" },
  ingredients: { bg: "#F4E1CC", fg: "#5C3A1A" },
  produce: { bg: "#E2EFD9", fg: "#2F5320" },
  fridge: { bg: "#E3EEF5", fg: "#284B63" },
  freezer: { bg: "#DDF1FA", fg: "#1D4E6B" },
};

export function allergenLabel(a: Allergen): string {
  const s = a.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Soft warm drop shadow that works on iOS, Android and web. */
export const softShadow = {
  shadowColor: pantry.shadow,
  shadowOpacity: 0.22,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 6 },
  elevation: 6,
} as const;
