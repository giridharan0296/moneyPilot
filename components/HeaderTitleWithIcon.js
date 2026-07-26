// ----------------------------------------------------------------------------
// HeaderTitleWithIcon — small drop-in header renderer for React Navigation.
//
// Replaces the ad-hoc `title: '💰 Income'` emoji prefixes with a proper
// icon + label pair, styled to match the app's header typography and
// automatically dark-mode aware (icon+text tints follow the active
// ThemeContext).
//
// Usage inside a stack screen's `options` (or `setOptions`):
//
//   options={{
//     headerTitle: () => (
//       <HeaderTitleWithIcon icon="wallet" label="Income" tint="#059669" />
//     ),
//   }}
//
// Props:
//   icon  — AppIcon registry key (e.g. 'home', 'pie-chart').
//   label — the human-readable screen title.
//   tint  — optional accent colour for the icon. Falls back to the
//           current theme's text-secondary, which is what you want for
//           screens that don't have a signature colour of their own.
// ----------------------------------------------------------------------------

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import AppIcon from './AppIcon';
import { useTheme } from '../contexts/ThemeContext';

export default function HeaderTitleWithIcon({ icon, label, tint }) {
  const { colors, fontFamilyBold } = useTheme();
  // Icon colour defaults to the theme's muted-text token (never plain
  // grey), so a header on a screen without a signature accent still
  // reads coherently in both light and dark modes.
  const iconColor = tint ?? colors.text.secondary;
  return (
    <View style={styles.row}>
      {icon ? (
        <AppIcon
          name={icon}
          size={20}
          color={iconColor}
          strokeWidth={2.1}
        />
      ) : null}
      <Text
        // Match the app's `headerTitleStyle` (fontWeight 700 + primary
        // text colour) so switching one screen to headerTitle: () => ...
        // doesn't visually drift from screens that still use the plain
        // `title:` string form.
        style={[
          styles.label,
          {
            color: colors.text.primary,
            fontFamily: fontFamilyBold,
            fontWeight: fontFamilyBold ? undefined : '700',
          },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    // Slight negative left margin so the icon nudges toward the same
    // horizontal position the emoji glyph used to sit at — otherwise
    // headers appear to shift right by ~4 px when a screen switches
    // from `title:` to `headerTitle:`.
    marginLeft: -2,
  },
  label: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
});
