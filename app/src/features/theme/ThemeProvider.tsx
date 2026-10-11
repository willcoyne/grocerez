/**
 * ThemeProvider + hooks. The provider hydrates the persisted theme (storage key `theme`) once at startup; the hooks
 * read the module-level store (./store.ts) so they also work inside R3F canvases and without a provider (tests,
 * previews), where they return the default theme.
 * Owner: theme core.
 */
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import { storage, storageKeys } from "@/state/storage";

import { THEMES, isThemeId } from "./registry";
import { getActiveThemeId, setActiveThemeId, subscribeActiveTheme } from "./store";
import type { SceneTheme, ThemeId, ThemeUi } from "./types";

export { getActiveTheme, getActiveThemeId, subscribeActiveTheme } from "./store";

/** True once the persisted choice has been read (or failed to read). Without a provider: true. */
const HydratedContext = createContext<boolean>(true);

let changedThisSession = false;

/** Change + persist the theme (shared by useSetTheme and tests). */
export function applyTheme(id: ThemeId): void {
  if (!isThemeId(id)) return;
  changedThisSession = true;
  setActiveThemeId(id);
  void storage.set(storageKeys.theme, id).catch(() => {});
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    let alive = true;
    storage
      .get(storageKeys.theme)
      .then((saved) => {
        // A choice made while storage was loading wins over the stale saved value.
        if (alive && !changedThisSession && isThemeId(saved)) setActiveThemeId(saved);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setHydrated(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  return <HydratedContext.Provider value={hydrated}>{children}</HydratedContext.Provider>;
}

export function useThemeId(): ThemeId {
  return useSyncExternalStore(subscribeActiveTheme, getActiveThemeId, getActiveThemeId);
}

export function useSceneTheme(): SceneTheme {
  return THEMES[useThemeId()];
}

/** `(id) => void`: switches the theme immediately and persists it. Stable identity. */
export function useSetTheme(): (id: ThemeId) => void {
  return useCallback((id: ThemeId) => applyTheme(id), []);
}

/** False until the saved theme has been loaded (mount the 3D canvas after this to avoid building cozy first). */
export function useThemeHydrated(): boolean {
  return useContext(HydratedContext);
}

/** RN overlay colours / radius / borders of the active theme. */
export function useThemeUi(): ThemeUi {
  return useSceneTheme().ui;
}

/** Test helper: forget the "changed this session" flag. */
export function __resetThemeSessionForTests(): void {
  changedThisSession = false;
}
