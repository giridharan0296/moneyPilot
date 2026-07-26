// ----------------------------------------------------------------------------
// DatePicker (web) — HTML <input type="date"> that mimics the native
// DateTimePicker API from @react-native-community/datetimepicker.
//
// Why a raw <input>? Every desktop browser (and mobile browser) has a
// well-styled, accessible native date picker built in via
// `<input type="date">`. Reinventing that in JS is a waste — the OS
// already knows how to render its own calendar. We just need a small
// adapter so the same JSX (`<DatePicker value=... onChange=...>`) works
// on both native and web.
//
// API COMPATIBILITY WITH RN DateTimePicker
//   props supported:  value, minimumDate, maximumDate, onChange
//   props ignored:    mode ("date" only), display, textColor, ...
//   onChange signature: (event, date) — event.type is 'set' or 'dismissed'
//                       to mirror the native picker exactly.
//
// The visual style is a compact chip that fits into the existing form
// layouts. On focus it triggers the browser's OS-level calendar UI. If
// `.showPicker()` is supported (Chromium, Firefox recent) we call it on
// mount so the calendar opens immediately when parents render the picker
// on demand (matching the "click chip → picker pops" flow of the app).
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';

import { radii, spacing } from '../lib/theme';
import { useThemeColors } from '../contexts/ThemeContext';

export default function DatePicker({
  value,
  minimumDate,
  maximumDate,
  onChange,
  disabled = false,
}) {
  const themeColors = useThemeColors();
  const inputRef = useRef(null);
  // Build the raw DOM <input> style against the live theme palette. Only
  // recomputes when theme changes; the object identity is stable inside
  // a theme so React doesn't get confused about "prop churn".
  const inputStyle = useMemo(
    () => ({
      fontSize: 15,
      fontFamily: 'inherit',
      padding: '10px 12px',
      borderRadius: radii.md,
      border: `1px solid ${themeColors.border.subtle}`,
      backgroundColor: themeColors.bg.surfaceAlt,
      color: themeColors.text.primary,
      width: '100%',
      maxWidth: 260,
      outline: 'none',
      cursor: 'pointer',
      boxSizing: 'border-box',
    }),
    [themeColors],
  );

  // Best-effort: open the OS calendar as soon as the picker mounts, so the
  // UX matches native (where mounting the picker immediately shows it).
  // Safari doesn't implement `showPicker` yet; the fallback is that the
  // user has to tap the input, which is still fine.
  useEffect(() => {
    const el = inputRef.current;
    if (!el || typeof el.showPicker !== 'function') return;
    try {
      el.showPicker();
    } catch {
      // Some browsers throw if not called from a user gesture — the input
      // is already visible so the user can still tap to open the calendar.
    }
  }, []);

  const isoValue = toISODate(value);
  const isoMin = minimumDate ? toISODate(minimumDate) : undefined;
  const isoMax = maximumDate ? toISODate(maximumDate) : undefined;

  const handleChange = (e) => {
    const next = e?.target?.value;
    if (!next) {
      onChange?.({ type: 'dismissed' }, null);
      return;
    }
    const [y, m, d] = next.split('-').map(Number);
    // Preserve the time-of-day of the existing value so callers that use
    // both date AND time (e.g. createdAt on transactions) don't lose the
    // clock component when only the date changes.
    const nd = new Date(value ?? Date.now());
    nd.setFullYear(y, m - 1, d);
    onChange?.({ type: 'set' }, nd);
  };

  return (
    <View style={styles.wrap}>
      {/* eslint-disable-next-line react/no-unknown-property */}
      <input
        ref={inputRef}
        type="date"
        value={isoValue}
        min={isoMin}
        max={isoMax}
        disabled={disabled}
        onChange={handleChange}
        style={inputStyle}
      />
    </View>
  );
}

// The wrap is theme-agnostic (spacing only), so it stays as a static
// plain object rather than a StyleSheet.create. The `inputStyle` above
// is theme-aware and built per-render via useMemo.
const styles = {
  wrap: {
    paddingVertical: spacing.xs,
  },
};

// Convert a JS Date to the "YYYY-MM-DD" format required by input[type=date].
// We use local components (not toISOString) to avoid a timezone shift where
// a date-only value like "July 5" becomes "July 4" in negative-UTC-offset
// zones.
function toISODate(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
