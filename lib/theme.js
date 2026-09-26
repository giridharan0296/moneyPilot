// ----------------------------------------------------------------------------
// theme.js — the app's design tokens.
//
// Before this file existed, every screen inlined hex codes ("#2563eb"),
// paddings (12, 16, 20, 24, ...), and radii (8, 10, 12, 14, 16). Adding
// dark mode or rebranding meant find-and-replace across ~350 hex values.
// This file centralizes all of those into named tokens, so:
//
//   1. Screens import from one place — one source of truth.
//   2. A dark palette can be swapped in without touching component code
//      (see `theme.dark` — currently unused, wired up when we introduce
//      the ThemeProvider).
//   3. Palette / radius / spacing consistency is now enforced by naming
//      instead of memory.
//
// Migration approach: NEW code should use these tokens exclusively. Old
// code migrates opportunistically when touched — we don't do a big-bang
// refactor here because that produces enormous diffs with no runtime
// benefit. The examples in this PR (TransactionsList, TransactionForm)
// show the migration pattern.
//
// USE THE TOKENS. Naming is intentional so you can grep across the codebase:
//   colors.text.primary   → dominant text color
//   colors.text.secondary → captions, hints
//   colors.text.muted     → placeholder / disabled
//   colors.bg.canvas      → screen background
//   colors.bg.surface     → cards / raised elements
//   colors.bg.hero        → dark hero cards (Dashboard, Net Worth)
//   colors.accent.primary → main brand accent (buttons, chips)
//   colors.accent.income  → income green
//   colors.accent.expense → expense red
//   colors.accent.investment → investment purple
//   colors.border.subtle  → 1px hairlines between cards / rows
//   colors.state.success  → toast + banner success
//   colors.state.warning  → warnings / recurring banner
//   colors.state.error    → destructive
//   colors.state.info     → informational
// ----------------------------------------------------------------------------

const palette = {
  // Neutrals — the workhorse gray ramp. Named "n" for compactness.
  n0:   '#ffffff',
  n50:  '#f9fafb',
  n100: '#f3f4f6',
  n200: '#e5e7eb',
  n300: '#d1d5db',
  n400: '#9ca3af',
  n500: '#6b7280',
  n600: '#4b5563',
  n700: '#374151',
  n800: '#1f2937',
  n900: '#111827',

  // Brand + semantic accents. Values match the hex codes already used
  // throughout the codebase so migration keeps visual parity.
  blue500:   '#2563eb', // primary action / brand
  blue700:   '#1e3a8a',
  emerald500:'#059669', // income
  emerald700:'#065f46',
  emerald50: '#d1fae5',
  red500:    '#dc2626', // expense / destructive
  red700:    '#7f1d1d',
  red50:     '#fee2e2',
  purple500: '#6366f1', // investment
  purple700: '#4338ca',
  amber500:  '#f59e0b', // warning
  amber700:  '#78350f',
  amber50:   '#fef3c7',
};

// ----------------------------------------------------------------------------
// Light theme (the current visual design). This is what components consume
// by default. Dark theme lives below as a placeholder — same shape, ready
// for a future ThemeProvider.
// ----------------------------------------------------------------------------
export const colors = {
  text: {
    primary:   palette.n900,   // headings, primary body copy
    secondary: palette.n500,   // captions, hints
    muted:     palette.n400,   // placeholders, disabled
    inverse:   palette.n0,     // text on flipping-dark surfaces (e.g. accent.primary buttons)
    // Text on ALWAYS-dark surfaces (bg.hero / heroGreen / heroRed) — these
    // surfaces stay dark in both light AND dark theme, so their text has
    // to stay LIGHT in both modes too. Use `text.inverse` only for chips
    // whose background flips with the theme; use `text.onHero` for
    // anything sitting on the hero cards.
    onHero:      palette.n0,   // ~white  · primary text on dark hero cards
    onHeroMuted: palette.n400, // mid-grey · captions on dark hero cards
    onHeroSoft:  'rgba(255,255,255,0.75)', // pill labels on hero cards
    onHeroFaint: 'rgba(255,255,255,0.7)',  // hero eyebrow labels
    // Semantic (up/down) text on a hero card. The light theme's ordinary
    // accent.income/expense (emerald500/red500) are tuned for text on a
    // LIGHT surface and read as low-contrast, muddy green/red on the dark
    // hero card — these are the dark-theme-lightened equivalents, used on
    // hero cards in BOTH themes for the same "always dark" reason as
    // onHero above (see the note there).
    onHeroPositive: '#34d399',
    onHeroNegative: '#f87171',
    onDayLabel: palette.n0,    // date-group chip on transactions
  },
  bg: {
    canvas:  '#f2f4f8',        // screen background — refined cool neutral
    surface: palette.n0,       // cards / rows
    surfaceAlt: palette.n50,   // subtle secondary fill (input backgrounds)
    dayLabel: palette.red500,  // date-group chip (transactions list)
    hero:    palette.n900,     // Dashboard totalCard etc.
    heroGreen: palette.emerald700, // net-worth positive hero
    heroRed: palette.red700,       // net-worth negative hero
    heroOverlay: 'rgba(255,255,255,0.12)', // frosted pill on hero cards
  },
  accent: {
    primary:    palette.blue500,   // brand / neutral submit
    income:     palette.emerald500,
    expense:    palette.red500,
    investment: palette.purple500,
    investmentStrong: palette.purple700, // EPF / deep investment CTAs
    gold:       '#d97706',         // gold chit gram hints
    orange:     '#f97316',         // same orange as the Food category — menu accents
    teal:       '#14b8a6',         // More tab
    violet:     '#7c3aed',         // Appearance menu accent
    sky:        '#0ea5e9',         // Accounts & data menu accent
    cyan:       '#0891b2',         // AI menu accent
    lime:       '#65a30d',         // More menu accent
    pink:       '#db2777',         // More menu accent
    fuchsia:    '#c026d3',         // More menu accent
    slate:      '#475569',         // More menu accent
    yellow:     '#ca8a04',         // More menu accent
    chartFallback: '#94a3b8',      // uncategorised chart slices
  },
  border: {
    subtle: palette.n200,           // 1px hairline
    strong: palette.n300,           // more prominent borders
  },
  state: {
    successBg: palette.emerald700,
    successFg: palette.emerald50,
    warningBg: palette.amber700,
    warningFg: palette.amber50,
    warningSurface: '#fef3c7',
    warningSurfaceText: '#92400e',
    errorBg:   palette.red700,
    errorFg:   palette.red50,
    errorSurface: palette.red50,
    errorText: '#b91c1c',
    infoBg:    palette.blue700,
    infoFg:    '#dbeafe',
    infoSurface: '#dbeafe',
    infoSurfaceText: '#1d4ed8',
    successSurface: '#ecfdf5',
    successSurfaceText: '#047857',
  },
  banner: {
    recurringBg: palette.amber50,
    recurringBorder: '#fde68a',
    recurringTitle: palette.amber700,
    recurringSub: '#b45309',
    recurringIcon: '#0369a1',
    recurringCloseBg: '#fef3c7',
    recurringCloseIcon: palette.n700,
    backupBg: '#eff6ff',
    backupBorder: '#bfdbfe',
    backupTitle: palette.blue700,
    backupSub: '#1d4ed8',
    backupIcon: '#1d4ed8',
    backupCta: '#1d4ed8',
  },
  // Raw palette re-exported for the odd case where a component needs a
  // shade that hasn't earned a semantic name yet. Prefer the semantic
  // tokens above; reach for `palette.*` only as an escape hatch.
  palette,
};

// ----------------------------------------------------------------------------
// Spacing scale — multiples of 4pt, with a couple of common odd values.
// Naming convention: xs / sm / md / lg / xl / 2xl matches Tailwind, so
// muscle memory transfers. Numeric access for special cases.
// ----------------------------------------------------------------------------
export const spacing = {
  xxs: 2,
  xs:  4,
  sm:  8,
  md:  12,
  lg:  16,
  xl:  20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
};

// ----------------------------------------------------------------------------
// Border radii. Existing screens use 8/10/12/14/16 somewhat ad-hoc; these
// tokens consolidate to just five options plus `pill` (fully rounded).
// ----------------------------------------------------------------------------
export const radii = {
  xs: 4,
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  '2xl': 20,
  pill: 999,
};

// ----------------------------------------------------------------------------
// Type ramp. Grouped by hierarchy so components can reason about "this is a
// heading, this is body copy" instead of picking arbitrary sizes.
// ----------------------------------------------------------------------------
export const type = {
  // Hero numbers (totalCard on Dashboard, net-worth hero).
  heroValue:   { fontSize: 36, fontWeight: '700' },
  heroLabel:   { fontSize: 12, fontWeight: '600', letterSpacing: 1 },

  // Screen / section headings.
  h1: { fontSize: 22, fontWeight: '700' },
  h2: { fontSize: 18, fontWeight: '700' },
  h3: { fontSize: 16, fontWeight: '700' },

  // Body sizes.
  bodyLg: { fontSize: 16, fontWeight: '500' },
  body:   { fontSize: 14, fontWeight: '500' },
  bodySm: { fontSize: 13, fontWeight: '500' },
  caption:{ fontSize: 12, fontWeight: '500' },
  micro:  { fontSize: 11, fontWeight: '600' },

  // Emphasis flavors.
  strong: { fontWeight: '700' },
  medium: { fontWeight: '600' },
};

// ----------------------------------------------------------------------------
// Shadows / elevation. Only two levels — cards and floating (toast, FAB).
// `boxShadow` is the one style prop RN 0.86 (New Architecture) and web both
// understand; the old iOS-only shadowColor/Offset/Opacity/Radius quartet is
// deprecated and logs a console warning. Android's `elevation` is a separate,
// still-current prop, so it stays alongside `boxShadow`.
// ----------------------------------------------------------------------------
function shadow(offsetY, blurRadius, opacity) {
  return [{ offsetX: 0, offsetY, blurRadius, color: `rgba(15, 23, 42, ${opacity})` }];
}

export const elevation = {
  none: {
    boxShadow: shadow(0, 0, 0),
    elevation: 0,
  },
  card: {
    boxShadow: shadow(2, 8, 0.05),
    elevation: 2,
  },
  raised: {
    boxShadow: shadow(4, 12, 0.08),
    elevation: 4,
  },
  floating: {
    boxShadow: shadow(8, 16, 0.14),
    elevation: 8,
  },
  tabBar: {
    boxShadow: shadow(-4, 12, 0.07),
    elevation: 12,
  },
};

// ----------------------------------------------------------------------------
// Card + screen rhythm. One place for the numbers every card repeats, so
// screens stop hand-picking 12/14/16/18 padding. A card is a surface with a
// hairline border and NO shadow or coloured edge — colour is reserved for
// meaning (money direction, status), not decoration.
// ----------------------------------------------------------------------------
export const layout = {
  screenPadding: 16,
  cardPadding: 16,
  cardRadius: radii.xl,
  cardGap: 12,      // between cards inside a section
  sectionGap: 20,   // between sections
};

// Money figures: heavy enough to lead, tabular so digits don't jitter as
// values change. Weights stay inside the 600–700 band of the type ramp.
export const moneyText = {
  hero:  { fontSize: 34, fontWeight: '700', letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  tile:  { fontSize: 18, fontWeight: '700', letterSpacing: -0.3, fontVariant: ['tabular-nums'] },
  row:   { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  small: { fontSize: 13, fontWeight: '600' },
};

// Grab-bag re-export so callers can do `import { theme } from '../lib/theme'`
// and destructure as they like, e.g. `const { colors, spacing } = theme`.
export const theme = { colors, spacing, radii, type, elevation, layout, moneyText };

export default theme;

// ----------------------------------------------------------------------------
// Dark theme — same shape as `colors` (the light theme) so screens using
// `useThemedStyles((c) => ...)` can rely on identical token paths.
//
// Design notes:
//   - Canvas is a deep slate, NOT pure black. Pure black on OLED screens
//     causes text smearing on scroll and looks harsh under low light.
//   - Surfaces sit one shade lighter than canvas so cards read as raised
//     without needing shadow.
//   - Accent colours are *lightened* versions of the light-theme accents.
//     Vivid saturation on a dark background feels neon; slightly desaturated
//     mid-tones (e.g. #60a5fa vs #2563eb for blue) hit the right balance.
//   - State backgrounds keep the dark saturated fill from the light theme
//     — they're already designed to sit on top of any canvas.
// ----------------------------------------------------------------------------
export const darkColors = {
  text: {
    primary:   palette.n50,       // main body text — off-white for reduced glare
    secondary: '#9ca3af',         // captions, hints (n400)
    muted:     '#6b7280',         // placeholders, disabled (n500)
    inverse:   palette.n900,      // text on light chips inside dark theme (e.g. selected chip whose bg goes near-white)
    // See note in `colors.text` — hero surfaces stay dark in both themes,
    // so their text stays LIGHT in both themes. Identical values to the
    // light palette; the duplication is intentional so callers can reach
    // for one semantic token regardless of active theme.
    onHero:      palette.n0,      // ~white  · primary text on dark hero cards
    onHeroMuted: palette.n400,    // mid-grey · captions on dark hero cards
    onHeroSoft:  'rgba(255,255,255,0.75)',
    onHeroFaint: 'rgba(255,255,255,0.7)',
    // Identical to the light palette — see the note there.
    onHeroPositive: '#34d399',
    onHeroNegative: '#f87171',
    onDayLabel: '#fecaca',        // date-group chip text on deep red
  },
  bg: {
    canvas:    '#0b1220',         // screen background
    surface:   '#111827',         // cards / rows (n800)
    surfaceAlt:'#1f2937',         // input backgrounds / raised sub-blocks
    dayLabel:  '#7f1d1d',         // date-group chip — deep red, not neon #f87171
    hero:      '#000814',         // Dashboard totalCard etc. — nearly black
    heroGreen: '#064e3b',         // net-worth positive hero (deep emerald)
    heroRed:   '#7f1d1d',         // net-worth negative hero (deep red)
    heroOverlay: 'rgba(255,255,255,0.12)',
  },
  accent: {
    primary:    '#60a5fa',        // brand blue (lightened for dark contrast)
    income:     '#34d399',        // income green
    expense:    '#f87171',        // expense red
    investment: '#a78bfa',        // investment purple
    investmentStrong: '#818cf8',
    gold:       '#fbbf24',
    orange:     '#fb923c',        // lightened for dark contrast
    teal:       '#2dd4bf',        // lightened for dark contrast — More tab
    violet:     '#c4b5fd',        // Appearance menu accent — lightened, kept distinct from investment
    sky:        '#38bdf8',        // Accounts & data menu accent
    cyan:       '#22d3ee',        // AI menu accent
    lime:       '#a3e635',        // More menu accent
    pink:       '#f472b6',        // More menu accent
    fuchsia:    '#e879f9',        // More menu accent
    slate:      '#94a3b8',        // More menu accent
    yellow:     '#fde047',        // More menu accent
    chartFallback: '#64748b',
  },
  border: {
    subtle: '#1f2937',            // hairline (barely visible on dark canvas)
    strong: '#374151',            // more prominent borders
  },
  state: {
    successBg: '#064e3b',
    successFg: '#a7f3d0',
    warningBg: '#78350f',
    warningFg: '#fde68a',
    warningSurface: '#78350f',
    warningSurfaceText: '#fde68a',
    errorBg:   '#7f1d1d',
    errorFg:   '#fecaca',
    errorSurface: '#7f1d1d',
    errorText: '#fca5a5',
    infoBg:    '#1e3a8a',
    infoFg:    '#bfdbfe',
    infoSurface: '#1e3a8a',
    infoSurfaceText: '#93c5fd',
    successSurface: '#064e3b',
    successSurfaceText: '#a7f3d0',
  },
  banner: {
    recurringBg: '#78350f33',
    recurringBorder: '#92400e',
    recurringTitle: '#fde68a',
    recurringSub: '#fcd34d',
    recurringIcon: '#38bdf8',
    recurringCloseBg: '#78350f55',
    recurringCloseIcon: '#fde68a',
    backupBg: '#1e3a8a33',
    backupBorder: '#1e40af',
    backupTitle: '#bfdbfe',
    backupSub: '#93c5fd',
    backupIcon: '#60a5fa',
    backupCta: '#60a5fa',
  },
  palette,
};
