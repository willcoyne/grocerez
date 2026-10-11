/**
 * Shared scene constants (foundation builder). Kept out of PantryCanvas.tsx so the web and native canvas files can
 * both import them at runtime without resolving to each other.
 */
import type { ReactNode } from "react";

/** Soft cream wall (SPEC "Look & feel"); also the canvas clear colour and fog colour. */
export const WALL_COLOR = "#F3E9DC";

/** Vertical field of view of the scene camera, degrees. */
export const CAMERA_FOV = 40;

/** Device-pixel-ratio cap (web; expo-gl always renders at the native ratio). */
export const MAX_DPR = 2;

/** Shadow map size of the single shadow-casting light. */
export const SHADOW_MAP_SIZE = 1024;

export type PantryCanvasProps = {
  children: ReactNode;
  /** false pauses the render loop (tab not focused). */
  active?: boolean;
  /** Web only: mouse-wheel delta in CSS pixels (positive = scroll down). */
  onWheel?: (deltaY: number) => void;
  testID?: string;
};
