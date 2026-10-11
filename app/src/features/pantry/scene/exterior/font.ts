// Typeface for 3D text (works on native: no DOM canvas needed). Follows the theme: helvetiker bold for cozy (vendored
// from three.js examples/fonts: Helvetiker, Copyright (c) Magenta ltd, 2004, MgOpen licence), the theme's own typeface
// otherwise (theme core `getThemeFont`). Every helper takes an optional theme and defaults to the active one, so
// builders that run at mount (room props, keyed on the theme id by the scene) pick up the current theme.
import type { BufferGeometry } from "three";
import type { Font } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";

import { drawableTextFor, getThemeFont, textAdvance } from "../../../theme/fonts";
import { getActiveTheme } from "../../../theme/store";
import type { SceneTheme } from "../../../theme/types";

export function getFont(theme: SceneTheme = getActiveTheme()): Font {
  return getThemeFont(theme);
}

/** Replace characters the typeface can't draw (emoji, accents...) so TextGeometry never logs/throws. */
export function drawableText(text: string, theme: SceneTheme = getActiveTheme()): string {
  return drawableTextFor(getFont(theme), text);
}

/** Horizontal advance of a string in world units at `size`. */
export function advanceOf(text: string, size: number, theme: SceneTheme = getActiveTheme()): number {
  return textAdvance(getFont(theme), text, size);
}

/** Bevels put seams between the pixel font's merged rectangles (themes/pixel/README.md): blocks stay crisp. */
export function themeAllowsBevel(theme: SceneTheme): boolean {
  return theme.font !== "pixel";
}

export type TextOpts = {
  size: number;
  depth: number;
  bevel?: number;
  bevelSegments?: number;
  curveSegments?: number;
};

export function textGeometry(text: string, o: TextOpts, theme: SceneTheme = getActiveTheme()): BufferGeometry {
  const bevel = themeAllowsBevel(theme) ? (o.bevel ?? 0) : 0;
  return new TextGeometry(drawableText(text, theme), {
    font: getFont(theme),
    size: o.size,
    depth: o.depth,
    curveSegments: o.curveSegments ?? 4,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.7,
    bevelOffset: 0,
    bevelSegments: o.bevelSegments ?? 3,
  });
}
