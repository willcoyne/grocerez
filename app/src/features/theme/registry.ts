/**
 * Theme registry: every ThemeId -> its SceneTheme (each theme lives in ./themes/<id>/index.ts, default export).
 * Owner: theme core.
 */
import type { SceneTheme, ThemeId } from "./types";

import cozy from "./themes/cozy";
import diner from "./themes/diner";
import neon from "./themes/neon";
import pixel from "./themes/pixel";
import sketch from "./themes/sketch";

/** Picker order. */
export const THEME_IDS: readonly ThemeId[] = ["cozy", "pixel", "sketch", "neon", "diner"];

export const DEFAULT_THEME_ID: ThemeId = "cozy";

export const THEMES: Record<ThemeId, SceneTheme> = { cozy, pixel, sketch, neon, diner };

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (THEME_IDS as readonly string[]).includes(value);
}

/** Theme by id; unknown ids (old persisted values, typos) fall back to the default theme. */
export function getTheme(id: string | null | undefined): SceneTheme {
  return isThemeId(id) ? THEMES[id] : THEMES[DEFAULT_THEME_ID];
}

/** All themes in picker order (for the Appearance sheet). */
export function listThemes(): SceneTheme[] {
  return THEME_IDS.map((id) => THEMES[id]);
}
