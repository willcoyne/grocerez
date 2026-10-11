// Design tokens from plan/frontend/DESIGN.md §2. Screens never use raw hex; they import from here.

export const color = {
  bg: '#F7F5F0', // app background
  surface: '#FFFFFF', // cards, inputs, tab bar
  surfaceMuted: '#F1EEE7', // checked list row
  segment: '#ECE7DD', // segmented-control track, neutral chip bg
  ink: '#1C1B19', // primary text, dark buttons, toast
  ink2: '#4A453C', // secondary text, labels
  muted: '#6B655A', // captions, meta (≥4.5:1 on bg and surface)
  border: '#E7E2D8', // card borders, dividers
  borderStrong: '#D9D4C8', // inputs, secondary buttons, unselected chips
  borderDashed: '#CFC8BA', // empty-state boxes
  checkboxIdle: '#A39B8C',
  primary: '#24563F', // primary buttons, active tab, checked box, selected chips
  onPrimary: '#FFFFFF',
  disabledBg: '#DDD7CB',
  disabledFg: '#4A453C',
  okBg: '#E3F0E8',
  okFg: '#1F5138', // "In stock", "In cabinet"
  warnBg: '#FFF0D1',
  warnFg: '#7A4D00', // "Running low", "On the list"
  dangerBg: '#FBE4E1',
  dangerFg: '#9B2318', // allergen flags, "Ran out" text, errors
  suggestBg: '#FFF5DC',
  suggestBorder: '#EBD39A', // "Did you mean" and ran-out prompt
  overlay: 'rgba(28,27,25,0.45)', // modal backdrop (household switcher, sheets)
  avatar: ['#F7D58A', '#F2C4A0', '#C9DFC6', '#D7CCEB'], // pick by stable hash of userId
} as const;

export type ColorName = Exclude<keyof typeof color, 'avatar'>;

export const font = {
  display: 'BricolageGrotesque_800ExtraBold', // @expo-google-fonts/bricolage-grotesque
  bodyMedium: 'Manrope_500Medium', // @expo-google-fonts/manrope
  bodySemi: 'Manrope_600SemiBold',
  bodyBold: 'Manrope_700Bold',
  bodyHeavy: 'Manrope_800ExtraBold',
} as const;

export const type = {
  // [fontSize, lineHeight]
  hero: [46, 46], // SignIn wordmark, display, letterSpacing -0.9
  h1: [32, 34], // onboarding screen titles, display, letterSpacing -0.6
  tabTitle: [30, 32], // tab screen titles, display, letterSpacing -0.6
  lead: [17, 26], // SignIn tagline
  bodyL: [16, 22], // item names (heavy), big buttons (bold)
  body: [15, 22], // paragraphs, inputs, buttons
  bodyS: [14, 20], // summaries, small buttons, chips you tap
  caption: [13, 19], // meta lines, field labels (bold)
  micro: [12, 16], // status chips, tab labels, section labels (bold, uppercase, letterSpacing 1)
} as const;

/** Alias for `type`, which is awkward to import by name. */
export const typeScale = type;
export type TypeVariant = keyof typeof type;

export const space = { xs: 4, sm: 8, md: 12, lg: 14, xl: 18, xxl: 20, screenX: 20 } as const;
export const radius = { control: 12, card: 14, cardLg: 16, pill: 999, checkbox: 8 } as const;
export const size = {
  btn: 48,
  btnLg: 52,
  btnSm: 44,
  input: 48,
  hit: 44, // minimum touch target, always
  checkbox: 26,
  chip: 24,
  statusChip: 26,
  avatar: 40,
  avatarLg: 44,
  tabBar: 62,
} as const;

/** Letter spacing per variant (spec §2 comments). */
export const letterSpacing: Partial<Record<TypeVariant, number>> = {
  hero: -0.9,
  h1: -0.6,
  tabTitle: -0.6,
  micro: 1,
};

/** Dynamic Type cap (spec §7): text scales up to 1.3× and layouts must not clip. */
export const maxFontScale = 1.3;

export const pressedOpacity = 0.85;
