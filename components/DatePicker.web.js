// ----------------------------------------------------------------------------
// DatePicker (web) — HTML date / datetime input that mimics the native
// DateTimePicker API from @react-native-community/datetimepicker.
//
// Why a raw <input>? Every desktop browser (and mobile browser) has a
// well-styled, accessible native picker built in via `<input type="date">`
// / `datetime-local`. We just need a small adapter so the same JSX
// (`<DatePicker value=... mode=... onChange=...>`) works on native + web.
//
// API COMPATIBILITY WITH RN DateTimePicker
//   props supported:  value, minimumDate, maximumDate, onChange, mode
//   mode:             "date" (default) | "datetime" | "time"
//   props ignored:    display, textColor, ...
//   onChange signature: (event, date) — event.type is 'set' or 'dismissed'
//                       to mirror the native picker exactly.
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
  mode = 'date',
  // Native-only prop accepted so call sites can share one JSX shape.
  display: _display,
}) {
  const themeColors = useThemeColors();
  const inputRef = useRef(null);
  const isDateTime = mode === 'datetime' || mode === 'time';

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
      maxWidth: isDateTime ? 320 : 260,
      outline: 'none',
      cursor: 'pointer',
      boxSizing: 'border-box',
    }),
    [themeColors, isDateTime],
  );

  useEffect(() => {
    const el = inputRef.current;
    if (!el || typeof el.showPicker !== 'function') return;
    try {
      el.showPicker();
    } catch {
      // Some browsers throw if not called from a user gesture.
    }
  }, []);

  const isoValue = isDateTime ? toISODateTime(value) : toISODate(value);
  const isoMin = minimumDate
    ? (isDateTime ? toISODateTime(minimumDate) : toISODate(minimumDate))
    : undefined;
  const isoMax = maximumDate
    ? (isDateTime ? toISODateTime(maximumDate) : toISODate(maximumDate))
    : undefined;

  const handleChange = (e) => {
    const next = e?.target?.value;
    if (!next) {
      onChange?.({ type: 'dismissed' }, null);
      return;
    }
    if (isDateTime) {
      // datetime-local: "YYYY-MM-DDTHH:mm" (seconds optional)
      const [datePart, timePart = '00:00'] = next.split('T');
      const [y, m, d] = datePart.split('-').map(Number);
      const [hh, mm] = timePart.split(':').map(Number);
      const nd = new Date(value ?? Date.now());
      nd.setFullYear(y, m - 1, d);
      nd.setHours(hh || 0, mm || 0, 0, 0);
      onChange?.({ type: 'set' }, nd);
      return;
    }
    const [y, m, d] = next.split('-').map(Number);
    // Preserve time-of-day so callers that store createdAt don't lose
    // the clock when only the calendar day changes.
    const nd = new Date(value ?? Date.now());
    nd.setFullYear(y, m - 1, d);
    onChange?.({ type: 'set' }, nd);
  };

  return (
    <View style={styles.wrap}>
      {/* eslint-disable-next-line react/no-unknown-property */}
      <input
        ref={inputRef}
        type={isDateTime ? 'datetime-local' : 'date'}
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

const styles = {
  wrap: {
    paddingVertical: spacing.xs,
  },
};

function toISODate(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toISODateTime(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const date = toISODate(d);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${date}T${hh}:${mm}`;
}
