/** Shared store-canvas constants (kept apart so StoreCanvas.tsx and StoreCanvas.native.tsx can both import them). */
import type { ReactNode } from "react";

import { CAMERA_FOV } from "./layout";
import { STORE } from "./materials";

export { CAMERA_FOV };
export const STORE_SKY = STORE.sky;
export const MAX_DPR = 2;
export const SHADOW_MAP_SIZE = 1024;

export type StoreCanvasProps = {
  children: ReactNode;
  active?: boolean;
  /** Web only: wheel delta in CSS pixels (vertical and horizontal wheel both scroll the aisle). */
  onWheel?: (delta: number) => void;
  testID?: string;
};
