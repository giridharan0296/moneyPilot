import { useMemo, useState } from 'react';
import {
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { formatSubCategoryLabel } from '../lib/categoryDisplay';
import { radii, spacing } from '../lib/theme';
import { currencyMeta } from '../lib/currency';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import AmountCalculatorButton from './AmountCalculatorButton';
import QuickAddPickerItem from './QuickAddPickerItem';

// ----------------------------------------------------------------------------
// BudgetForm — add / edit a budget rule.
//
// Props:
//   categories     expense categories (from SettingsContext)
//   initialValues  optional; when present, edit mode
//   submitLabel    e.g. 'Add budget' / 'Save changes'
//   onSubmit(values)
//   onCancel()     optional; renders a Cancel button when provided
//
// Fields:
//   - Category (chip row; a special "Overall" chip = all expenses)
//   - Sub-category (optional chip row when the category has subs)
//   - Amount (currency input)
//   - Period (chip row: Monthly / Weekly / Yearly)
//
// Deliberately does NOT surface `active` — that lives on the row toggle
// so the add flow stays simple.
// ----------------------------------------------------------------------------

const PERIODS = [
  { id: 'monthly', label: 'Monthly' },
  { id: 'weekly',  label: 'Weekly'  },
  { id: 'yearly',  label: 'Yearly'  },
];

export default function BudgetForm({
  categories,
  initialValues,
  submitLabel = 'Save',
  accentColor = '#2563eb',
  onSubmit,
  onCancel,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const { baseCurrency } = useSettings();
  // categoryId === null means "Overall". React state uses a sentinel
  // '__overall' so we can compare to `null` unambiguously.
  const [categoryId, setCategoryId] = useState(
    initialValues?.categoryId === undefined
      ? (categories[0]?.id ?? null)
      : initialValues.categoryId,
  );
  const [subCategoryId, setSubCategoryId] = useState(
    initialValues?.subCategoryId ?? null,
  );
  const [amount, setAmount] = useState(
    initialValues?.amount != null ? String(initialValues.amount) : '',
  );
  const [period, setPeriod] = useState(initialValues?.period ?? 'monthly');
  const [error, setError] = useState(null);

  const handleSubmit = () => {
    const amt = Number(amount);
    if (!isFinite(amt) || amt <= 0) {
      setError('Enter a positive amount.');
      return;
    }
    setError(null);
    onSubmit({
      categoryId: categoryId === '__overall' ? null : categoryId,
      subCategoryId:
        categoryId === '__overall' || categoryId == null || !subCategoryId
          ? null
          : subCategoryId,
      amount: amt,
      period,
    });
  };

  const selectedIsOverall =
    categoryId === null || categoryId === '__overall';

  const selectedCategory = useMemo(() => {
    if (selectedIsOverall) return null;
    return categories.find((c) => c.id === categoryId) ?? null;
  }, [categories, categoryId, selectedIsOverall]);

  const subCategories = selectedCategory?.subCategories ?? [];

  return (
    <View style={styles.card}>
      <Text style={styles.label}>Category</Text>
      <View style={styles.chipRow}>
        {/* Overall (all expenses) chip — kept as the first option so the
            most restrictive-but-useful pattern (a total-spend cap) is
            immediately reachable without scrolling. */}
        <TouchableOpacity
          key="__overall"
          onPress={() => {
            setCategoryId('__overall');
            setSubCategoryId(null);
          }}
          activeOpacity={0.7}
          style={[
            styles.chip,
            selectedIsOverall && {
              backgroundColor: accentColor,
              borderColor: accentColor,
            },
          ]}
        >
          <Text
            style={[
              styles.chipText,
              selectedIsOverall && styles.chipTextSelected,
            ]}
          >
            Overall
          </Text>
        </TouchableOpacity>
        {categories.map((c) => {
          const selected = c.id === categoryId;
          return (
            <TouchableOpacity
              key={c.id}
              onPress={() => {
                setCategoryId(c.id);
                setSubCategoryId(null);
              }}
              activeOpacity={0.7}
              style={[
                styles.chip,
                selected && {
                  backgroundColor: accentColor,
                  borderColor: accentColor,
                },
              ]}
            >
              <Text
                style={[styles.chipText, selected && styles.chipTextSelected]}
              >
                {c.emoji} {c.label}
              </Text>
            </TouchableOpacity>
          );
        })}
        <QuickAddPickerItem
          kind="category"
          type="expense"
          accent={accentColor}
          onCreated={(item) => {
            setCategoryId(item.id);
            setSubCategoryId(null);
          }}
        />
      </View>

      {selectedCategory && (
        <>
          <Text style={styles.label}>Sub-category (optional)</Text>
          {subCategories.length > 0 ? (
            <View style={styles.chipRow}>
              <TouchableOpacity
                onPress={() => setSubCategoryId(null)}
                activeOpacity={0.7}
                style={[
                  styles.subChip,
                  !subCategoryId && {
                    backgroundColor: accentColor,
                    borderColor: accentColor,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.subChipText,
                    !subCategoryId && styles.chipTextSelected,
                  ]}
                >
                  All {selectedCategory?.label ?? 'category'}
                </Text>
              </TouchableOpacity>
              {subCategories.map((s) => {
                const selected = s.id === subCategoryId;
                return (
                  <TouchableOpacity
                    key={s.id}
                    onPress={() =>
                      setSubCategoryId((prev) => (prev === s.id ? null : s.id))
                    }
                    activeOpacity={0.7}
                    style={[
                      styles.subChip,
                      selected && {
                        backgroundColor: accentColor,
                        borderColor: accentColor,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.subChipText,
                        selected && styles.chipTextSelected,
                      ]}
                    >
                      {s.emoji} {formatSubCategoryLabel(s.label)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              <QuickAddPickerItem kind="subcategory" type="expense" parentId={categoryId} accent={accentColor} onCreated={(item) => setSubCategoryId(item.id)} />
            </View>
          ) : null}
          {subCategories.length === 0 ? <QuickAddPickerItem
            kind="subcategory"
            type="expense"
            parentId={categoryId}
            accent={accentColor}
            onCreated={(item) => setSubCategoryId(item.id)}
          /> : null}
        </>
      )}

      <Text style={styles.label}>Amount ({currencyMeta(baseCurrency).symbol})</Text>
      <AmountCalculatorButton value={amount} onChangeText={setAmount}>
        <TextInput
          style={styles.input}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="e.g. 5000"
          placeholderTextColor={themeColors.text.muted}
        />
      </AmountCalculatorButton>
      <Text style={styles.label}>Period</Text>
      <View style={styles.periodRow}>
        {PERIODS.map((p) => {
          const selected = p.id === period;
          return (
            <TouchableOpacity
              key={p.id}
              onPress={() => setPeriod(p.id)}
              activeOpacity={0.7}
              style={[
                styles.periodChip,
                selected && {
                  backgroundColor: accentColor,
                  borderColor: accentColor,
                },
              ]}
            >
              <Text
                style={[
                  styles.periodChipText,
                  selected && styles.chipTextSelected,
                ]}
              >
                {p.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.actionRow}>
        {onCancel && (
          <TouchableOpacity
            onPress={onCancel}
            style={[styles.btn, styles.btnGhost]}
            activeOpacity={0.7}
          >
            <Text style={styles.btnGhostText}>Cancel</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={handleSubmit}
          style={[styles.btn, { backgroundColor: accentColor }]}
          activeOpacity={0.8}
        >
          <Text style={styles.btnPrimaryText}>{submitLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (c) => ({
  card: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: c.border.subtle,
    gap: spacing.xs,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: c.text.secondary,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chipRow: { paddingVertical: spacing.xs, gap: spacing.sm, flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii['2xl'],
    backgroundColor: c.bg.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  chipText: { fontSize: 13, fontWeight: '600', color: c.palette.n700 },
  chipTextSelected: { color: c.text.inverse },
  subChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radii.xl,
    backgroundColor: c.bg.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border.subtle,
    alignSelf: 'flex-start',
    flexShrink: 0,
  },
  subChipText: { fontSize: 12, fontWeight: '600', color: c.text.secondary, flexShrink: 0 },
  input: {
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: c.text.primary,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  periodRow: { flexDirection: 'row', gap: spacing.sm },
  periodChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radii.md,
    backgroundColor: c.bg.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border.subtle,
    alignItems: 'center',
  },
  periodChipText: { fontSize: 13, fontWeight: '600', color: c.palette.n700 },
  error: {
    color: c.accent.expense,
    fontSize: 12,
    marginTop: spacing.sm,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
    justifyContent: 'flex-end',
  },
  btn: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhost: { backgroundColor: c.palette.n100 },
  btnGhostText: { color: c.palette.n700, fontWeight: '600', fontSize: 14 },
  btnPrimaryText: { color: c.text.inverse, fontWeight: '700', fontSize: 14 },
});
