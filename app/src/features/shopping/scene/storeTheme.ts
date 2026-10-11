/**
 * Store canvas look per theme: cozy keeps the bright, cool supermarket clear colour / fog / exposure; other themes use
 * the theme's background and fog (pushed back a little: the aisle is longer than the pantry room).
 * Owner: theme integrator.
 */
import type { SceneTheme } from "../../theme/types";
import { STORE } from "./materials";

export type StoreCanvasLook = {
  background: string;
  fog: { color: string; near: number; far: number } | null;
  exposure: number;
};

export function storeCanvasLook(theme: SceneTheme): StoreCanvasLook {
  if (theme.id === "cozy") return { background: STORE.sky, fog: { color: STORE.sky, near: 16, far: 40 }, exposure: 1.1 };
  return {
    background: theme.background,
    fog: theme.fog ? { color: theme.fog.color, near: theme.fog.near + 4, far: theme.fog.far + 12 } : null,
    exposure: 1.05,
  };
}
