/**
 * Theme bridge for the station sheets. Every sheet reads theme state through this file only, so the sheets don't depend
 * on the theme core's file layout.
 *
 * The hooks come from the theme core (`src/features/theme`), which works without a provider (default theme).
 * While a theme in the registry is still a cozy placeholder (the theme designers are writing them), the picker shows
 * the local preview data below for it, so every card looks different. Once the real themes land this is inert.
 */
import { useMemo } from "react";

import { pantry } from "@/features/pantry/overlay/palette";
import { listThemes, THEMES } from "@/features/theme/registry";
import {
  useSetTheme as useCoreSetTheme,
  useThemeId as useCoreThemeId,
  useThemeUi as useCoreThemeUi,
} from "@/features/theme/ThemeProvider";
import type { SceneTheme, ThemeId, ThemeUi } from "@/features/theme/types";

/** What the Appearance picker needs from a theme (a subset of `SceneTheme`, so real registry entries fit as-is). */
export type ThemeChoice = Pick<
  SceneTheme,
  "id" | "name" | "description" | "swatches" | "palette" | "materialStyle" | "textureStyle" | "ui"
>;

/** Mirrors the cozy overlay palette (pantry/overlay/palette.ts); used for placeholder previews only. */
export const FALLBACK_UI: ThemeUi = {
  panel: pantry.cream,
  panelBorder: pantry.oak,
  text: pantry.oakInk,
  textMuted: pantry.muted,
  accent: pantry.green,
  buttonFace: pantry.cream,
  buttonRing: pantry.oak,
  buttonIcon: pantry.oakDark,
  radius: 24,
  borderWidth: 1,
  fontFamily: null,
  pixelBorders: false,
};

/** Preview data for the five themes, used only for registry entries that are still cozy placeholders. */
export const FALLBACK_THEMES: ThemeChoice[] = [
  {
    id: "cozy",
    name: "Cozy",
    description: "Honey oak, cream walls and warm lamp light.",
    swatches: ["#C68B59", "#8B5A2B", "#F3E9DC", "#FFF8EE", "#2E7D32"],
    materialStyle: "standard",
    textureStyle: "grain",
    palette: {
      wood: "#C68B59", woodDark: "#8B5A2B", woodLight: "#E0B07E", wall: "#F3E9DC", floor: "#B07A4C", floorAlt: "#9C6A40",
      trim: "#FFF8EE", metal: "#B9A58C", fridgeWall: "#EEF2F5", freezerWall: "#DDF1FA", glass: "#CFE6F0", paper: "#FFFBF2",
      ink: "#2B2118", accent: "#2E7D32", allergen: "#FF3B30", highlight: "#FFD54F", plant: "#4E8F3A", pot: "#C2603A",
    },
    ui: FALLBACK_UI,
  },
  {
    id: "pixel",
    name: "Pixel",
    description: "A chunky pixel-art farmhouse pantry.",
    swatches: ["#B5651D", "#6B3A16", "#F2D7A0", "#5FA046", "#3B7DD8"],
    materialStyle: "flat",
    textureStyle: "pixel",
    palette: {
      wood: "#B5651D", woodDark: "#6B3A16", woodLight: "#E09A4F", wall: "#F2D7A0", floor: "#8A5A2B", floorAlt: "#734A22",
      trim: "#FFF1C9", metal: "#9AA0A6", fridgeWall: "#E4F0F6", freezerWall: "#CDEBF7", glass: "#BFE3F2", paper: "#FFF6DA",
      ink: "#3A2414", accent: "#5FA046", allergen: "#E8402F", highlight: "#FFE066", plant: "#4C9A2A", pot: "#B4502D",
    },
    ui: {
      panel: "#F7E3B5", panelBorder: "#6B3A16", text: "#3A2414", textMuted: "#6B4A2E", accent: "#3E7B27",
      buttonFace: "#F2D7A0", buttonRing: "#6B3A16", buttonIcon: "#3A2414", radius: 0, borderWidth: 3, fontFamily: null,
      pixelBorders: true,
    },
  },
  {
    id: "sketch",
    name: "Sketch",
    description: "Hand-drawn ink on paper, like our first drawings.",
    swatches: ["#FBF8F1", "#22201C", "#8C8576", "#D9534F", "#5B8DB8"],
    materialStyle: "ink",
    textureStyle: "hatch",
    palette: {
      wood: "#F4EFE3", woodDark: "#22201C", woodLight: "#FBF8F1", wall: "#FBF8F1", floor: "#EAE3D2", floorAlt: "#DDD5C1",
      trim: "#FFFFFF", metal: "#8C8576", fridgeWall: "#F4F6F7", freezerWall: "#EAF2F6", glass: "#E3EDF2", paper: "#FFFFFF",
      ink: "#22201C", accent: "#2F6690", allergen: "#D9534F", highlight: "#F4D35E", plant: "#6A994E", pot: "#BC6C25",
    },
    ui: {
      panel: "#FBF8F1", panelBorder: "#22201C", text: "#22201C", textMuted: "#5A554C", accent: "#2F6690",
      buttonFace: "#FFFFFF", buttonRing: "#22201C", buttonIcon: "#22201C", radius: 10, borderWidth: 2, fontFamily: null,
    },
  },
  {
    id: "neon",
    name: "Neon",
    description: "Night-time synthwave glow in magenta and cyan.",
    swatches: ["#1A1033", "#FF2BD6", "#22E4FF", "#7B5CFF", "#FFE45C"],
    materialStyle: "toon",
    textureStyle: "grid",
    palette: {
      wood: "#2A1B4D", woodDark: "#1A1033", woodLight: "#FF2BD6", wall: "#130B26", floor: "#1F1440", floorAlt: "#2B1D57",
      trim: "#22E4FF", metal: "#7B5CFF", fridgeWall: "#16244A", freezerWall: "#0F2E4A", glass: "#22E4FF", paper: "#24183F",
      ink: "#F4EDFF", accent: "#22E4FF", allergen: "#FF3B6B", highlight: "#FFE45C", plant: "#39FF9F", pot: "#FF2BD6",
    },
    ui: {
      panel: "#1E1338", panelBorder: "#FF2BD6", text: "#F7F1FF", textMuted: "#C9BCE6", accent: "#22E4FF",
      buttonFace: "#2A1B4D", buttonRing: "#22E4FF", buttonIcon: "#F7F1FF", radius: 18, borderWidth: 2, fontFamily: null,
    },
  },
  {
    id: "diner",
    name: "Diner",
    description: "1950s diner: mint, cherry red, chrome and checker tiles.",
    swatches: ["#A8E6CF", "#D7263D", "#F4F4F4", "#C0C7CE", "#1B1B1B"],
    materialStyle: "standard",
    textureStyle: "checker",
    palette: {
      wood: "#D7263D", woodDark: "#9E1B2C", woodLight: "#F7F7F7", wall: "#CFF3E4", floor: "#F4F4F4", floorAlt: "#1B1B1B",
      trim: "#C0C7CE", metal: "#C0C7CE", fridgeWall: "#EEF4F7", freezerWall: "#DDF1FA", glass: "#D6EEF5", paper: "#FFFDF5",
      ink: "#1B1B1B", accent: "#D7263D", allergen: "#FF3B30", highlight: "#FFD23F", plant: "#3FA34D", pot: "#D7263D",
    },
    ui: {
      panel: "#F2FBF7", panelBorder: "#D7263D", text: "#1B1B1B", textMuted: "#4F5B57", accent: "#B71C31",
      buttonFace: "#FFFFFF", buttonRing: "#C0C7CE", buttonIcon: "#B71C31", radius: 22, borderWidth: 2, fontFamily: null,
    },
  },
];

/** Overlay colours of the active theme. */
export function useThemeUi(): ThemeUi {
  return useCoreThemeUi();
}

/** Id of the active theme. */
export function useActiveThemeId(): ThemeId {
  return useCoreThemeId();
}

/** Switches (and persists) the theme. Stable identity. */
export function useSetTheme(): (id: ThemeId) => void {
  return useCoreSetTheme();
}

/** A non-cozy registry entry that still carries cozy's description is a placeholder clone. */
function isPlaceholder(t: SceneTheme): boolean {
  return t.id !== "cozy" && t.description === THEMES.cozy.description;
}

/** Every theme the picker can show, in registry order. */
export function useThemeChoices(): ThemeChoice[] {
  return useMemo(
    () =>
      listThemes().map((t) => {
        const preview = isPlaceholder(t) ? FALLBACK_THEMES.find((f) => f.id === t.id) : undefined;
        return preview ? { ...preview, name: t.name } : t;
      }),
    [],
  );
}
