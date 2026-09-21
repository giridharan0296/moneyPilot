// ----------------------------------------------------------------------------
// fonts.js — app font catalog + weight → family resolution.
//
// Users pick a font in Settings → Appearance. ThemeContext persists the
// choice and `useThemedStyles` injects the matching `fontFamily` into every
// text-ish style so the whole app follows along without per-screen edits.
//
// Expo Google Fonts ship ONE file per weight. React Native does not fake
// bold from a Regular file the way browsers do, so we map fontWeight
// (400/600/700/800) onto the concrete loaded family name.
// ----------------------------------------------------------------------------

import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';
import {
  Nunito_400Regular,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
} from '@expo-google-fonts/nunito';
import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import {
  SourceSerif4_400Regular,
  SourceSerif4_600SemiBold,
  SourceSerif4_700Bold,
} from '@expo-google-fonts/source-serif-4';
import {
  IBMPlexSans_400Regular,
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
  IBMPlexSans_700Bold,
} from '@expo-google-fonts/ibm-plex-sans';
import {
  Lora_400Regular,
  Lora_500Medium,
  Lora_600SemiBold,
  Lora_700Bold,
} from '@expo-google-fonts/lora';
import { CascadiaCode_400Regular } from '@expo-google-fonts/cascadia-code/400Regular';
import { CascadiaCode_500Medium } from '@expo-google-fonts/cascadia-code/500Medium';
import { CascadiaCode_600SemiBold } from '@expo-google-fonts/cascadia-code/600SemiBold';
import { CascadiaCode_700Bold } from '@expo-google-fonts/cascadia-code/700Bold';

/** All font files ThemeProvider should load up-front (so switching is instant). */
export const FONT_ASSETS = {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
  Nunito_400Regular,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
  SourceSerif4_400Regular,
  SourceSerif4_600SemiBold,
  SourceSerif4_700Bold,
  IBMPlexSans_400Regular,
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
  IBMPlexSans_700Bold,
  Lora_400Regular,
  Lora_500Medium,
  Lora_600SemiBold,
  Lora_700Bold,
  CascadiaCode_400Regular,
  CascadiaCode_500Medium,
  CascadiaCode_600SemiBold,
  CascadiaCode_700Bold,
};

/** Font files needed for one theme font choice (deduped weight families). */
export function fontAssetsForId(id) {
  const option = getFontOption(id);
  if (!option.weights) return {};
  const assets = {};
  for (const family of new Set(Object.values(option.weights))) {
    if (FONT_ASSETS[family]) assets[family] = FONT_ASSETS[family];
  }
  return assets;
}

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   description: string,
 *   sample: string,
 *   weights: Record<string, string> | null,
 * }} FontOption
 */

/** @type {FontOption[]} */
export const FONT_OPTIONS = [
  {
    id: 'lora',
    label: 'Lora Serif',
    description: 'Warm editorial serif',
    sample: 'Aa',
    weights: {
      '400': 'Lora_400Regular',
      '500': 'Lora_500Medium',
      '600': 'Lora_600SemiBold',
      '700': 'Lora_700Bold',
      '800': 'Lora_700Bold',
    },
  },
  {
    id: 'system',
    label: 'System',
    description: 'Default device font',
    sample: 'Aa',
    weights: null, // leave fontFamily unset — OS default + fontWeight work natively
  },
  {
    id: 'dm-sans',
    label: 'DM Sans',
    description: 'Clean modern sans',
    sample: 'Aa',
    weights: {
      '400': 'DMSans_400Regular',
      '500': 'DMSans_500Medium',
      '600': 'DMSans_600SemiBold',
      '700': 'DMSans_700Bold',
      '800': 'DMSans_700Bold',
    },
  },
  {
    id: 'cascadia-code',
    label: 'Cascadia Code',
    description: 'Crisp modern monospace',
    sample: 'Aa',
    weights: {
      '400': 'CascadiaCode_400Regular',
      '500': 'CascadiaCode_500Medium',
      '600': 'CascadiaCode_600SemiBold',
      '700': 'CascadiaCode_700Bold',
      '800': 'CascadiaCode_700Bold',
    },
  },
  {
    id: 'nunito',
    label: 'Nunito',
    description: 'Soft rounded sans',
    sample: 'Aa',
    weights: {
      '400': 'Nunito_400Regular',
      '500': 'Nunito_400Regular',
      '600': 'Nunito_600SemiBold',
      '700': 'Nunito_700Bold',
      '800': 'Nunito_800ExtraBold',
    },
  },
  {
    id: 'space-grotesk',
    label: 'Space Grotesk',
    description: 'Geometric display sans',
    sample: 'Aa',
    weights: {
      '400': 'SpaceGrotesk_400Regular',
      '500': 'SpaceGrotesk_500Medium',
      '600': 'SpaceGrotesk_600SemiBold',
      '700': 'SpaceGrotesk_700Bold',
      '800': 'SpaceGrotesk_700Bold',
    },
  },
  {
    id: 'source-serif',
    label: 'Source Serif',
    description: 'Classic serif body',
    sample: 'Aa',
    weights: {
      '400': 'SourceSerif4_400Regular',
      '500': 'SourceSerif4_400Regular',
      '600': 'SourceSerif4_600SemiBold',
      '700': 'SourceSerif4_700Bold',
      '800': 'SourceSerif4_700Bold',
    },
  },
  {
    id: 'ibm-plex',
    label: 'IBM Plex',
    description: 'Clear finance-friendly sans',
    sample: 'Aa',
    weights: {
      '400': 'IBMPlexSans_400Regular',
      '500': 'IBMPlexSans_500Medium',
      '600': 'IBMPlexSans_600SemiBold',
      '700': 'IBMPlexSans_700Bold',
      '800': 'IBMPlexSans_700Bold',
    },
  },
];

export const DEFAULT_FONT_ID = 'lora';

/** Load only the default body font at cold start — not every picker option. */
export const STARTUP_FONT_ASSETS = fontAssetsForId(DEFAULT_FONT_ID);

export function getFontOption(id) {
  return FONT_OPTIONS.find((f) => f.id === id) || FONT_OPTIONS[0];
}

export function isKnownFontId(id) {
  return FONT_OPTIONS.some((f) => f.id === id);
}

/** Normalize RN fontWeight (number | string | 'bold') → '400'..'800'. */
export function normalizeWeight(fontWeight) {
  if (fontWeight == null) return '400';
  if (fontWeight === 'normal') return '400';
  if (fontWeight === 'bold') return '700';
  const n = parseInt(String(fontWeight), 10);
  if (!isFinite(n)) return '400';
  if (n <= 450) return '400';
  if (n <= 550) return '500';
  if (n <= 650) return '600';
  if (n <= 750) return '700';
  return '800';
}

/**
 * Resolve the concrete fontFamily (+ whether to strip fontWeight) for a
 * text style under the active font option.
 */
export function resolveTextFont(fontOption, style = {}) {
  if (!fontOption || !fontOption.weights) {
    return { fontFamily: undefined, stripWeight: false };
  }
  // Respect an explicit monospace / custom override on the style itself.
  if (style.fontFamily) {
    return { fontFamily: undefined, stripWeight: false };
  }
  const w = normalizeWeight(style.fontWeight);
  const family =
    fontOption.weights[w]
    || fontOption.weights['400']
    || Object.values(fontOption.weights)[0];
  return { fontFamily: family, stripWeight: true };
}

/**
 * Inject the active font into a raw style map (before StyleSheet.create).
 * Only touches text-ish entries; leaves View-only styles alone. Styles that
 * already set `fontFamily` (e.g. monospace API-key hints) win.
 *
 * Editable fields (`*input*`) keep the system UI font — custom fontFamily
 * on TextInput is unreliable on web and can make typing appear broken.
 */
export function applyFontToStyleMap(rawStyles, fontOption) {
  if (!rawStyles || !fontOption || !fontOption.weights) return rawStyles;
  const out = {};
  for (const [key, style] of Object.entries(rawStyles)) {
    if (!style || typeof style !== 'object' || Array.isArray(style)) {
      out[key] = style;
      continue;
    }
    // Skip TextInput-oriented styles (and their chrome). Matching is by
    // style key name so callers don't need a special opt-out flag.
    if (/input/i.test(key)) {
      out[key] = style;
      continue;
    }
    const textish =
      style.fontSize != null
      || style.fontWeight != null
      || style.fontStyle != null
      || style.letterSpacing != null
      || style.lineHeight != null
      || style.textAlign != null
      || style.textTransform != null;
    if (!textish) {
      out[key] = style;
      continue;
    }
    const { fontFamily, stripWeight } = resolveTextFont(fontOption, style);
    if (!fontFamily) {
      out[key] = style;
      continue;
    }
    if (stripWeight) {
      const { fontWeight: _fw, ...rest } = style;
      out[key] = { ...rest, fontFamily };
    } else {
      out[key] = { ...style, fontFamily };
    }
  }
  return out;
}

/** Default family name for navigation headers / one-off Text styles. */
export function defaultFamilyFor(fontOption, weight = '700') {
  if (!fontOption?.weights) return undefined;
  const w = normalizeWeight(weight);
  return fontOption.weights[w] || fontOption.weights['700'] || fontOption.weights['400'];
}
