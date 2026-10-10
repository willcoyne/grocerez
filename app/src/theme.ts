import { useColorScheme } from 'react-native';

// Placeholder tokens. The visual design is not decided yet (pending a design session);
// screens should only read from here so the real palette and type scale can be swapped in one place.

const palette = {
  light: {
    background: '#FFFFFF',
    surface: '#F2F3F5',
    text: '#111316',
    textMuted: '#5F646D',
    border: '#DFE1E5',
    primary: '#1F7A4D',
    onPrimary: '#FFFFFF',
    // Status colors from plan/frontend/01 step 9.
    allergen: '#C62828',
    expiring: '#B26A00',
    inStock: '#2E7D32',
  },
  dark: {
    background: '#0E0F11',
    surface: '#1B1D21',
    text: '#F2F3F5',
    textMuted: '#A3A8B0',
    border: '#2C2F35',
    primary: '#4CC48A',
    onPrimary: '#0E0F11',
    allergen: '#EF5350',
    expiring: '#FFB74D',
    inStock: '#66BB6A',
  },
} as const;

export type Colors = { [K in keyof typeof palette.light]: string };

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

export const fontSize = { caption: 12, body: 16, title: 20, heading: 28 } as const;

export const radius = { sm: 6, md: 12, pill: 999 } as const;

/** Minimum tap target (plan accessibility rule). */
export const minTapTarget = 44;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? palette.dark : palette.light;
}
