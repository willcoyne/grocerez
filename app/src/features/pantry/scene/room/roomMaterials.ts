// THE one place the room props create materials. Every prop asks for a material by *role* (+ optional colour
// overrides) through `useRoomMaterial()`; geometry never carries theme colours (vertex colours are only near-white
// multipliers for a hand-made jitter, so a theme material that ignores them loses nothing).
//
// Theming: `useRoomMaterial()` reads the active theme; materials are cached per theme and the previous theme's are
// disposed the first time a new theme asks (one swap, `disposeRoomMaterials`). Cozy keeps the original hand-tuned
// materials below exactly; other themes go through the theme material factory (createThemedMaterial) with the
// role -> palette mapping in `themedRoom` (wood->wood, trim->trim, wall/floor->wall/floor, cork->wood+woodLight,
// chalkboard->slate, chalk->unlit-ish chalk, paper/bookPage->paper, ink->ink, cloth->accent / per-item colours (washed
// for sketch), metal->metal, plastic->paper+metal, pin->allergen, glow->allergen additive, hit->never themed).
// Geometry and placement never change per theme (SPEC Round 3): only materials do.
// UV conventions: wood pieces use exterior/geometry.ts world-scale wood UVs (1.7 tiles/m); cork 2 tiles/m; cloth and
// paper ~1 tile per 0.2 m; floor/wall 1 UV unit = 1 m; chalkboard slate 0..1 across the board.
import { useCallback } from "react";
import { AdditiveBlending, type Material, type Texture, Color, DoubleSide, MeshBasicMaterial, MeshStandardMaterial } from "three";

import { mixHex } from "../../../theme/color";
import { createThemedMaterial, defaultTextureFor, type MaterialOverrides, type MaterialRole } from "../../../theme/materials";
import { getActiveTheme } from "../../../theme/store";
import { themedTexture } from "../../../theme/textures";
import { useSceneTheme } from "../../../theme/ThemeProvider";
import type { SceneTheme } from "../../../theme/types";
import { PALETTE } from "../exterior/materials";
import { glowOverrides, washColor } from "../sceneTheme";
import { chalkTexture, clothTexture, corkTexture, disposeRoomTextures, paperTexture, slateTexture } from "./roomTextures";

export type RoomMaterialRole =
  | "wood"
  | "woodDark"
  | "cork"
  | "chalkboard"
  | "chalk"
  | "paper"
  | "cloth"
  | "metal"
  | "plastic"
  | "pin"
  | "ink"
  | "accent"
  | "glow"
  | "bookCloth"
  | "bookPage"
  | "wall"
  | "floor"
  | "trim"
  | "hit";

export const ROOM_MATERIAL_ROLES: readonly RoomMaterialRole[] = [
  "wood",
  "woodDark",
  "cork",
  "chalkboard",
  "chalk",
  "paper",
  "cloth",
  "metal",
  "plastic",
  "pin",
  "ink",
  "accent",
  "glow",
  "bookCloth",
  "bookPage",
  "wall",
  "floor",
  "trim",
  "hit",
];

export type RoomMaterialOverrides = {
  color?: string;
  emissive?: string;
  emissiveIntensity?: number;
  opacity?: number;
};

/** Cozy (default theme) base colours per role. */
export const ROOM_COLORS = {
  wood: PALETTE.wood,
  woodDark: PALETTE.woodDark,
  cork: "#C99A63",
  chalkboard: "#FFFFFF",
  chalk: "#F4F1EA",
  paper: PALETTE.cream,
  cloth: "#5E8F5E",
  metal: "#B8B2A8",
  plastic: "#F3EEE4",
  pin: "#E2483D",
  ink: PALETTE.ink,
  accent: "#2E7D32",
  glow: "#FF3B30",
  bookCloth: "#8E3B2F",
  bookPage: "#F7EEDC",
  wall: PALETTE.wall,
  floor: "#FFFFFF",
  trim: PALETTE.cream,
  hit: "#000000",
} as const satisfies Record<RoomMaterialRole, string>;

/** Cozy: the original room materials (exactly as before theming). */
function create(role: RoomMaterialRole, o: RoomMaterialOverrides, theme: SceneTheme): Material {
  const color = new Color(o.color ?? ROOM_COLORS[role]);
  const std = (p: ConstructorParameters<typeof MeshStandardMaterial>[0]) =>
    new MeshStandardMaterial({
      color,
      vertexColors: true,
      ...(o.emissive ? { emissive: new Color(o.emissive), emissiveIntensity: o.emissiveIntensity ?? 1 } : {}),
      ...p,
    });
  switch (role) {
    case "wood":
    case "woodDark":
      // the exterior's grain (theme core port), so props and pantry share one texture
      return std({ map: themedTexture(theme, "wood"), roughness: 0.68, metalness: 0 });
    case "cork":
      return std({ map: corkTexture(), roughness: 0.95 });
    case "chalkboard":
      return std({ map: slateTexture(), roughness: 0.92 });
    case "chalk":
      // a touch of self-light so chalk reads on the dark slate even in shadow
      return std({ map: chalkTexture(), roughness: 1, emissive: o.emissive ? new Color(o.emissive) : color, emissiveIntensity: o.emissiveIntensity ?? 0.18 });
    case "paper":
    case "bookPage":
      return std({ map: paperTexture(), roughness: 0.9 });
    case "cloth":
    case "bookCloth":
      return std({ map: clothTexture(), roughness: 0.95, side: DoubleSide });
    case "metal":
      return std({ roughness: 0.32, metalness: 0.75 });
    case "plastic":
      return std({ roughness: 0.42, metalness: 0 });
    case "pin":
      return std({ roughness: 0.3, metalness: 0.05 });
    case "ink":
      return std({ roughness: 0.75 });
    case "accent":
      return std({ roughness: 0.6 });
    case "glow":
      return glowMaterial(color, o);
    case "wall":
      return std({ roughness: 0.95 });
    case "floor":
      // the exterior's plank floor (theme core port); RoomShell's floor UVs are already in metres (repeat 1)
      return new MeshStandardMaterial({ color, map: themedTexture(theme, "floor"), roughness: 0.72 });
    case "trim":
      return std({ roughness: 0.78 });
    case "hit":
      return hitMaterial();
  }
}

function glowMaterial(color: Color | string, o: RoomMaterialOverrides): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: o.opacity ?? 0.6,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    side: DoubleSide,
  });
}

let hitMat: MeshBasicMaterial | null = null;
/** Invisible but raycastable tap target (never themed, never disposed). */
function hitMaterial(): MeshBasicMaterial {
  hitMat ??= new MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 });
  return hitMat;
}

// ---------------------------------------------------------------------------------------------------------------
// other themes

/** Room colour per role from the theme palette (overrides = per-item colours, adapted to the theme). */
function themedColor(theme: SceneTheme, role: RoomMaterialRole, override: string | undefined): string {
  const p = theme.palette;
  const ink = theme.materialStyle === "ink";
  switch (role) {
    case "paper":
    case "bookPage":
      return override ? mixHex(p.paper, override, ink ? 0.15 : 0.3) : p.paper;
    case "ink":
      return override ? mixHex(p.ink, override, ink ? 0.2 : 0.35) : p.ink;
    case "cork":
      return ink ? washColor(theme, ROOM_COLORS.cork) : mixHex(p.wood, p.woodLight, 0.35);
    case "chalk":
      return override ?? ROOM_COLORS.chalk;
    case "cloth":
    case "bookCloth":
      return washColor(theme, override ?? p.accent);
    case "metal":
      return override ? washColor(theme, mixHex(override, p.metal, 0.4)) : p.metal;
    case "plastic":
      return mixHex(p.paper, p.metal, 0.3);
    case "pin":
      return override ? washColor(theme, override) : p.allergen;
    case "accent":
      return override ?? p.accent;
    case "glow":
      return override ?? p.allergen;
    case "wood":
      return override ?? p.wood;
    case "woodDark":
      return override ?? p.woodDark;
    case "wall":
      return p.wall;
    case "floor":
      return p.floor;
    case "trim":
      return p.trim;
    case "chalkboard":
      return "#FFFFFF";
    case "hit":
      return "#000000";
  }
}

const THEME_ROLE: Record<Exclude<RoomMaterialRole, "glow" | "hit">, MaterialRole> = {
  wood: "wood",
  woodDark: "woodDark",
  cork: "generic",
  chalkboard: "generic",
  chalk: "generic",
  paper: "paper",
  bookPage: "paper",
  cloth: "generic",
  bookCloth: "generic",
  metal: "metal",
  plastic: "generic",
  pin: "generic",
  ink: "ink",
  accent: "accent",
  wall: "wall",
  floor: "floor",
  trim: "trim",
};

/** Room textures (theme independent multipliers / slate colour) for roles the theme has no texture for. */
const ROOM_MAP: Partial<Record<RoomMaterialRole, () => Texture>> = {
  cork: corkTexture,
  chalkboard: slateTexture,
  chalk: chalkTexture,
  cloth: clothTexture,
  bookCloth: clothTexture,
};

function themedRoom(theme: SceneTheme, role: RoomMaterialRole, o: RoomMaterialOverrides): Material {
  if (role === "hit") return hitMaterial();
  const color = themedColor(theme, role, o.color);
  if (role === "glow") return glowMaterial(color, o);
  const ov: MaterialOverrides = { vertexColors: true, color };
  if (o.emissive) {
    ov.emissive = o.emissive;
    ov.emissiveIntensity = o.emissiveIntensity ?? 1;
  }
  if (o.opacity !== undefined) ov.opacity = o.opacity;
  switch (role) {
    case "wood":
    case "woodDark":
      ov.texture = { uvPerUnit: 1.7 };
      break;
    case "wall":
    case "floor": {
      // UVs in metres; baked textures (pixel wallpaper, every floor) carry their own colour: material colour stays white
      ov.texture = { uvPerUnit: 1 };
      const kind = defaultTextureFor(theme, role);
      if (kind && themedTexture(theme, kind, ov.texture).userData.baked) delete ov.color;
      if (role === "floor") ov.vertexColors = false;
      break;
    }
    case "chalk":
      // a little self-light so chalk reads on the slate in shadow, in every shading style
      ov.emissive = o.emissive ?? color;
      ov.emissiveIntensity = o.emissiveIntensity ?? 0.18;
      break;
    case "cloth":
    case "bookCloth":
      ov.side = "double";
      break;
    case "ink":
      ov.hatch = false;
      break;
    case "trim":
      // baseboard: an edge strip in themes that light their edges (neon)
      Object.assign(ov, glowOverrides(theme, "edge"));
      break;
    default:
      break;
  }
  const m = createThemedMaterial(theme, THEME_ROLE[role], ov);
  const custom = ROOM_MAP[role];
  if (custom && !m.map) {
    m.map = custom();
    m.needsUpdate = true;
  }
  return m;
}

// ---------------------------------------------------------------------------------------------------------------

const cache = new Map<string, Material>();
let cacheTheme: string | null = null;

/**
 * Shared material for a role (+ overrides) in a theme (default: the active one). Cached per (theme, role, overrides):
 * never dispose the result yourself. The first request for a new theme frees the previous theme's materials.
 */
export function roomMaterial(role: RoomMaterialRole, overrides?: RoomMaterialOverrides, theme: SceneTheme = getActiveTheme()): Material {
  if (role === "hit") return hitMaterial();
  if (cacheTheme !== theme.id) {
    if (cacheTheme !== null) disposeRoomMaterials();
    cacheTheme = theme.id;
  }
  const o = overrides ?? {};
  const key = `${role}|${o.color ?? ""}|${o.emissive ?? ""}|${o.emissiveIntensity ?? ""}|${o.opacity ?? ""}`;
  let m = cache.get(key);
  if (!m) {
    m = theme.id === "cozy" ? create(role, o, theme) : themedRoom(theme, role, o);
    m.name = `room:${role}`;
    cache.set(key, m);
  }
  return m;
}

export type RoomMaterialGetter = (role: RoomMaterialRole, overrides?: RoomMaterialOverrides) => Material;

/** Hook every room prop uses to get materials (follows the active theme; props re-render on a theme change). */
export function useRoomMaterial(): RoomMaterialGetter {
  const theme = useSceneTheme();
  return useCallback((role: RoomMaterialRole, overrides?: RoomMaterialOverrides) => roomMaterial(role, overrides, theme), [theme]);
}

/** Drop every cached room material/texture (theme change). Mounted props must re-render to pick up new ones. */
export function disposeRoomMaterials() {
  for (const m of cache.values()) m.dispose();
  cache.clear();
  cacheTheme = null;
  disposeRoomTextures();
}
