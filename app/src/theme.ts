/** Design tokens. Keep this small: colors, spacing, type scale, radii. */
export const colors = {
  primary: "#2E7D32",
  primaryDark: "#1B5E20",
  primaryLight: "#E8F5E9",
  background: "#FAFAF7",
  surface: "#FFFFFF",
  border: "#E0E0DA",
  text: "#1C1C1A",
  textMuted: "#5F6360",
  onPrimary: "#FFFFFF",
  /** Allergen badges. */
  danger: "#C62828",
  dangerLight: "#FDECEA",
  /** Expiring soon / running low. */
  warning: "#B26A00",
  warningLight: "#FFF4E0",
  /** In stock / fresh. */
  success: "#2E7D32",
  successLight: "#E8F5E9",
  /** AI-generated content. */
  ai: "#6A3FB5",
  aiLight: "#F1EBFA",
  overlay: "rgba(0,0,0,0.55)",
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const fontSize = { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, xxl: 28 } as const;

export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

/** Minimum tap target (Apple HIG 44pt). */
export const TAP_TARGET = 44;
