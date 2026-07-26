// ----------------------------------------------------------------------------
// TagInput — chip-style input for free-form tags on a transaction.
//
// Features:
//   - Existing tags render as removable chips.
//   - A text input accepts new tags, submitted via Enter, comma, or space
//     (comma/space are natural separators; users can type multiple tags
//     without lifting a finger).
//   - Autocomplete: when the user types, we show a horizontal chip strip
//     of suggestions from `suggestions` that (a) start with the typed
//     prefix, (b) are not already selected.
//   - Capped at 8 tags per transaction to keep the UI predictable.
//
// Casing:
//   - Preserves the case the user typed the FIRST time. If they later type
//     the same tag with different casing, we treat it as a duplicate and
//     silently drop it (comparison is case-insensitive).
//
// Deliberately dependency-free — no react-native-tag-input libs. The
// primitive here is small enough to own.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import {
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { radii, spacing } from '../lib/theme';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';

const MAX_TAGS = 8;

export default function TagInput({
  value = [],
  onChange,
  suggestions = [],
  placeholder = 'Add a tag',
  disabled = false,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const [draft, setDraft] = useState('');

  const addTag = (rawArg) => {
    const raw = rawArg ?? draft;
    const trimmed = raw.trim().replace(/,+$/, '');
    if (!trimmed) {
      setDraft('');
      return;
    }
    const lower = trimmed.toLowerCase();
    if (value.some((t) => t.toLowerCase() === lower)) {
      setDraft('');
      return;
    }
    if (value.length >= MAX_TAGS) return;
    onChange([...value, trimmed]);
    setDraft('');
  };

  const removeTag = (tag) => {
    onChange(value.filter((t) => t !== tag));
  };

  // Autocomplete matches: suggestions that start with the draft (case-
  // insensitive) and aren't already selected. Only shown while typing.
  const matches = useMemo(() => {
    const q = draft.trim().toLowerCase();
    if (!q) return [];
    const selected = new Set(value.map((v) => v.toLowerCase()));
    return suggestions
      .filter((s) => {
        const l = s.toLowerCase();
        return l.startsWith(q) && !selected.has(l);
      })
      .slice(0, 6);
  }, [draft, suggestions, value]);

  const onChangeText = (text) => {
    // If the user types a comma, commit the tag before the comma and keep
    // the text after it as the new draft (rare, but supports paste-style
    // input like "vacation, work, reimbursable").
    if (text.includes(',')) {
      const parts = text.split(',');
      for (let i = 0; i < parts.length - 1; i++) {
        addTag(parts[i]);
      }
      setDraft(parts[parts.length - 1] ?? '');
      return;
    }
    setDraft(text);
  };

  const atLimit = value.length >= MAX_TAGS;

  return (
    <View>
      {/* Selected chips + input, in a single wrap row */}
      <View style={styles.chipWrap}>
        {value.map((tag) => (
          <View key={tag} style={styles.selectedChip}>
            <Text style={styles.selectedChipText}>#{tag}</Text>
            {!disabled && (
              <TouchableOpacity
                onPress={() => removeTag(tag)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Remove tag ${tag}`}
              >
                <Text style={styles.selectedChipRemove}>×</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
        {!atLimit && !disabled && (
          <TextInput
            value={draft}
            onChangeText={onChangeText}
            onSubmitEditing={() => addTag()}
            onBlur={() => draft.trim() && addTag()}
            placeholder={value.length === 0 ? placeholder : '+ tag'}
            placeholderTextColor={themeColors.text.muted}
            style={styles.input}
            returnKeyType="done"
            blurOnSubmit={false}
            autoCapitalize="none"
          />
        )}
      </View>

      {/* Autocomplete suggestions — appears only while the user is typing */}
      {matches.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.suggestionRow}
        >
          {matches.map((s) => (
            <TouchableOpacity
              key={s}
              onPress={() => addTag(s)}
              style={styles.suggestion}
              activeOpacity={0.7}
            >
              <Text style={styles.suggestionText}>#{s}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {atLimit && (
        <Text style={styles.limitHint}>
          Max {MAX_TAGS} tags per transaction.
        </Text>
      )}
    </View>
  );
}

const makeStyles = (c) => ({
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    minHeight: 40,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: c.border.subtle,
    alignItems: 'center',
  },
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: c.accent.primary + '22',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
  },
  selectedChipText: {
    color: c.accent.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  selectedChipRemove: {
    color: c.accent.primary,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 16,
    paddingHorizontal: 2,
  },
  input: {
    minWidth: 100,
    paddingVertical: 4,
    paddingHorizontal: 6,
    fontSize: 13,
    color: c.text.primary,
    flexGrow: 1,
  },
  suggestionRow: {
    paddingTop: spacing.xs,
    gap: 6,
  },
  suggestion: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: c.bg.surface,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  suggestionText: {
    fontSize: 12,
    color: c.text.secondary,
    fontWeight: '600',
  },
  limitHint: {
    fontSize: 11,
    color: c.text.muted,
    marginTop: spacing.xs,
  },
});
