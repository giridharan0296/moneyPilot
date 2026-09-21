// ----------------------------------------------------------------------------
// ThemeContext — controls light / dark / system theme + app font selection.
//
// Design notes:
//   - We ship THREE modes: 'light', 'dark', 'system' (default).
//   - Persist the user's *choice* (not the resolved theme) so switching the
//     OS theme still respects their explicit override.
//   - Font choice lives here too (Look & feel). Fonts load once via
//     expo-font; switching is instant after that.
//   - Components that need to REACT to theme changes should use
//     `useThemeColors()` / `useThemedStyles()` — the latter also injects
//     the active fontFamily into text styles.
// ----------------------------------------------------------------------------

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFonts, loadAsync as loadFontsAsync } from 'expo-font';
import { Appearance, StyleSheet } from 'react-native';

import { colors as lightColors, darkColors } from '../lib/theme';
import {
  FONT_OPTIONS,
  DEFAULT_FONT_ID,
  STARTUP_FONT_ASSETS,
  fontAssetsForId,
  getFontOption,
  isKnownFontId,
  applyFontToStyleMap,
  defaultFamilyFor,
} from '../lib/fonts';
import { STORAGE_KEYS } from '../constants';

export const THEME_MODES = ['light', 'dark', 'system'];
export { FONT_OPTIONS, DEFAULT_FONT_ID };

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState('system');
  const [fontId, setFontIdState] = useState(DEFAULT_FONT_ID);
  const [systemScheme, setSystemScheme] = useState(
    () => Appearance.getColorScheme() ?? 'light',
  );
  const [ready, setReady] = useState(false);
  const [activeFontReady, setActiveFontReady] = useState(false);

  const [startupFontsLoaded] = useFonts(STARTUP_FONT_ASSETS);

  // Hydrate the persisted choices on mount.
  useEffect(() => {
    (async () => {
      try {
        const [rawTheme, rawFont] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.theme),
          AsyncStorage.getItem(STORAGE_KEYS.font),
        ]);
        if (rawTheme && THEME_MODES.includes(rawTheme)) setMode(rawTheme);
        if (rawFont && isKnownFontId(rawFont)) setFontIdState(rawFont);
      } catch (e) {
        console.warn('Failed to load theme/font preference:', e);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // After storage hydrates, load the user's font if it isn't the startup default.
  useEffect(() => {
    if (!ready || !startupFontsLoaded) return undefined;
    const assets = fontAssetsForId(fontId);
    if (Object.keys(assets).length === 0) {
      setActiveFontReady(true);
      return undefined;
    }
    let cancelled = false;
    loadFontsAsync(assets)
      .then(() => {
        if (!cancelled) setActiveFontReady(true);
      })
      .catch((e) => {
        console.warn('Failed to load theme font:', e);
        if (!cancelled) setActiveFontReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, startupFontsLoaded, fontId]);

  // Persist the user's explicit mode choice (not the resolved scheme).
  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORAGE_KEYS.theme, mode).catch((e) =>
      console.warn('Save theme failed:', e),
    );
  }, [mode, ready]);

  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORAGE_KEYS.font, fontId).catch((e) =>
      console.warn('Save font failed:', e),
    );
  }, [fontId, ready]);

  // Listen to OS-level appearance changes so 'system' users flip when the OS
  // dark mode toggles. Users who explicitly picked light or dark are unaffected.
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme(colorScheme ?? 'light');
    });
    return () => sub.remove();
  }, []);

  const resolvedScheme = mode === 'system' ? systemScheme : mode;
  const colors = resolvedScheme === 'dark' ? darkColors : lightColors;
  // Until google fonts finish loading, fall back to System so we never
  // paint with a fontFamily that isn't registered yet (blank glyphs).
  const fontsLoaded = startupFontsLoaded && activeFontReady;
  const fontOption = getFontOption(
    fontsLoaded ? fontId : 'system',
  );

  const setThemeMode = useCallback((next) => {
    if (!THEME_MODES.includes(next)) return;
    setMode(next);
  }, []);

  const setFontId = useCallback((next) => {
    if (!isKnownFontId(next)) return;
    setActiveFontReady(false);
    setFontIdState(next);
    const assets = fontAssetsForId(next);
    if (Object.keys(assets).length === 0) {
      setActiveFontReady(true);
      return;
    }
    loadFontsAsync(assets)
      .then(() => setActiveFontReady(true))
      .catch((e) => {
        console.warn('Failed to load theme font:', e);
        setActiveFontReady(true);
      });
  }, []);

  const value = useMemo(
    () => ({
      ready,              // storage hydrated — do NOT wait on fonts
      mode,               // 'light' | 'dark' | 'system' — user's choice
      scheme: resolvedScheme, // 'light' | 'dark' — what's actually active
      colors,             // resolved palette (light or dark)
      isDark: resolvedScheme === 'dark',
      setThemeMode,
      // Font — `fontId` is the persisted choice; `fontOption` is what's
      // safe to apply right now (System until assets finish loading).
      fontId,
      fontOption,
      fontFamily: defaultFamilyFor(fontOption, '400'),
      fontFamilyBold: defaultFamilyFor(fontOption, '700'),
      fontsLoaded,
      setFontId,
      fontOptions: FONT_OPTIONS,
    }),
    [
      ready,
      fontsLoaded,
      mode,
      resolvedScheme,
      colors,
      setThemeMode,
      fontId,
      fontOption,
      setFontId,
    ],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>');
  return ctx;
}

// Convenience: get just the active colors object.
export function useThemeColors() {
  return useTheme().colors;
}

// ----------------------------------------------------------------------------
// useThemedStyles — the recommended hook for building StyleSheets that
// respond to theme + font changes.
//
// Usage:
//
//   const styles = useThemedStyles((c) => ({
//     container: { backgroundColor: c.bg.canvas },
//     title:     { color: c.text.primary },
//   }));
//
// `makeStyles` receives the ACTIVE `colors` object. The returned StyleSheet
// is memoized on `colors` + active font — as soon as either flips, the hook
// re-runs and returns a fresh StyleSheet.
// ----------------------------------------------------------------------------
export function useThemedStyles(makeStyles) {
  const { colors, fontOption } = useTheme();
  // Intentionally omit `makeStyles` from the dep list so that inline factory
  // functions (the common case: `useThemedStyles((c) => ({...}))`) don't
  // re-create the StyleSheet on every render. The factory should be pure
  // — same `colors` in ⇒ same styles out.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(
    () => StyleSheet.create(applyFontToStyleMap(makeStyles(colors), fontOption)),
    [colors, fontOption],
  );
}
