/**
 * Scan UI colours: the active scene theme's overlay tokens (useThemeUi) plus a few fixed, theme-independent colours
 * (allergen red, the black-on-white Nutrition Facts label, Nutri-Score) that must stay recognisable in every theme.
 */
import { useThemeUi } from "@/features/theme/ThemeProvider";
import type { ThemeUi } from "@/features/theme/types";

export { useThemeUi };
export type { ThemeUi };

export const fixed = {
  /** Solid "you're allergic" chip / banner. White text on it ≈ 6.5:1. */
  danger: "#B3261E",
  onDanger: "#FFFFFF",
  /** Someone else in the household is allergic: tint + dark red text ≈ 7:1. */
  dangerTint: "#FDE3E0",
  dangerInk: "#8C1D15",
  neutralChip: "#ECE7DD",
  neutralInk: "#3E3A33",
  labelPaper: "#FFFFFF",
  labelInk: "#111111",
  scrim: "rgba(10,10,10,0.55)",
  cameraBg: "#111111",
  frame: "#FFFFFF",
  onCamera: "#FFFFFF",
  okBg: "#E3F0E8",
  okInk: "#1F5138",
} as const;

/** Official Nutri-Score colours; `fg` is the readable text colour on the fill. */
export const NUTRI_SCORE: readonly { letter: string; bg: string; fg: string }[] = [
  { letter: "A", bg: "#038141", fg: "#FFFFFF" },
  { letter: "B", bg: "#85BB2F", fg: "#1C1B19" },
  { letter: "C", bg: "#FECB02", fg: "#1C1B19" },
  { letter: "D", bg: "#EE8100", fg: "#1C1B19" },
  { letter: "E", bg: "#E63E11", fg: "#FFFFFF" },
];
