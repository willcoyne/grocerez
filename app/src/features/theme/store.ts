/**
 * Module-level active-theme store (no React). The single source of truth for "which theme is active":
 * ThemeProvider hydrates it from storage and the hooks read it through useSyncExternalStore, so module-level
 * code (material caches, builders) and React (including R3F canvases, which are separate React roots) always agree.
 * Owner: theme core.
 */
import { DEFAULT_THEME_ID, THEMES, isThemeId } from "./registry";
import type { SceneTheme, ThemeId } from "./types";

let activeId: ThemeId = DEFAULT_THEME_ID;
const listeners = new Set<() => void>();

export function getActiveThemeId(): ThemeId {
  return activeId;
}

/** The active SceneTheme, for module-level (non-React) code. */
export function getActiveTheme(): SceneTheme {
  return THEMES[activeId];
}

/** Switch the active theme (not persisted; use `useSetTheme()` from React to also persist). */
export function setActiveThemeId(id: ThemeId): void {
  if (!isThemeId(id) || id === activeId) return;
  activeId = id;
  for (const l of Array.from(listeners)) l();
}

/** Called after every theme change. Returns an unsubscribe function. */
export function subscribeActiveTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
