// ----------------------------------------------------------------------------
// CalculatorField
//
// A labeled numeric text input used by all calculator screens. Keeping this
// in one place gives us consistent styling and behavior:
//   - numeric-only keyboard
//   - optional prefix (like "₹") and suffix (like "%" or "yrs")
//   - clean look with focused/blurred border color
//
// It's a *controlled* input — the parent owns the string state and passes
// value + onChangeText. Calculators parse the string to a number when doing
// the math (never store numbers in state — strings preserve what the user
// literally typed, including "12." mid-typing).
// ----------------------------------------------------------------------------

import React, { useState } from 'react';
import { View, Text, TextInput } from 'react-native';

import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';

export default function CalculatorField({
  label,
  value,
  onChangeText,
  prefix,
  suffix,
  placeholder,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const [focused, setFocused] = useState(false);

  // Sanitize at the boundary so no downstream calculator ever sees a
  // negative principal / SIP / deduction / etc. `decimal-pad` doesn't
  // expose a minus key on iOS but some Android keyboards do, and a
  // paste can still slip a "-" in. Strip anything that isn't a digit
  // or a single leading decimal point.
  const handleChange = (raw) => {
    if (typeof onChangeText !== 'function') return;
    if (raw == null) { onChangeText(''); return; }
    let cleaned = String(raw).replace(/[^\d.]/g, '');
    const firstDot = cleaned.indexOf('.');
    if (firstDot >= 0) {
      cleaned = cleaned.slice(0, firstDot + 1)
        + cleaned.slice(firstDot + 1).replace(/\./g, '');
    }
    onChangeText(cleaned);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputRow, focused && styles.inputRowFocused]}>
        {prefix ? <Text style={styles.affix}>{prefix}</Text> : null}
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={handleChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardType="decimal-pad"
          placeholder={placeholder}
          placeholderTextColor={themeColors.text.muted}
        />
        {suffix ? <Text style={styles.affix}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

const makeStyles = (c) => ({
  wrap:  { marginBottom: 14 },
  label: { fontSize: 13, color: c.text.secondary, marginBottom: 6, fontWeight: '600' },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bg.surface,
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  // Focused-ring is a brand accent — reads clearly in both themes.
  inputRowFocused: { borderColor: '#3b82f6' },

  affix: { fontSize: 16, color: c.text.secondary, fontWeight: '600' },
  input: {
    flex: 1,
    fontSize: 18,
    color: c.text.primary,
    paddingVertical: 12,
    paddingHorizontal: 6,
  },
});
