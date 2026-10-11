import type { Allergen } from "@contracts/dietary";

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
