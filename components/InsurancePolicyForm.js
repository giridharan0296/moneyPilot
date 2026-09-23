import { useMemo, useState } from 'react';
import {
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import AmountCalculatorButton from './AmountCalculatorButton';
import DateTimePicker from './DatePicker';
import TagInput from './TagInput';
import {
  POLICY_TYPES,
  PREMIUM_FREQUENCIES,
  defaultExpenseCategoriesForType,
  policyTypeMeta,
  premiumTransactionType,
} from '../lib/insurancePolicies';
import { radii, spacing } from '../lib/theme';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';

export default function InsurancePolicyForm({
  expenseCategories = [],
  investmentCategories = [],
  initialValues = null,
  submitLabel = 'Save policy',
  onSubmit,
  onCancel,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const isEdit = !!initialValues;

  const [name, setName] = useState(initialValues?.name ?? '');
  const [type, setType] = useState(initialValues?.type ?? 'health');
  const [insurer, setInsurer] = useState(initialValues?.insurer ?? '');
  const [policyNumber, setPolicyNumber] = useState(initialValues?.policyNumber ?? '');
  const [premiumAmount, setPremiumAmount] = useState(
    initialValues?.premiumAmount != null ? String(initialValues.premiumAmount) : '',
  );
  const [premiumFrequency, setPremiumFrequency] = useState(
    initialValues?.premiumFrequency ?? 'yearly',
  );
  const [renewalDate, setRenewalDate] = useState(
    initialValues?.renewalDate ? new Date(initialValues.renewalDate) : null,
  );
  const [showRenewalPicker, setShowRenewalPicker] = useState(false);
  const [coverAmount, setCoverAmount] = useState(
    initialValues?.coverAmount != null ? String(initialValues.coverAmount) : '',
  );
  const [expenseCategoryId, setExpenseCategoryId] = useState(
    initialValues?.expenseCategoryId
      ?? defaultExpenseCategoriesForType(type).expenseCategoryId,
  );
  const [expenseSubCategoryId, setExpenseSubCategoryId] = useState(
    initialValues?.expenseSubCategoryId
      ?? defaultExpenseCategoriesForType(type).expenseSubCategoryId,
  );
  const [tags, setTags] = useState(initialValues?.tags ?? []);
  const [notes, setNotes] = useState(initialValues?.notes ?? '');
  const [error, setError] = useState(null);

  const typeMeta = policyTypeMeta(type);
  const txType = premiumTransactionType(type);

  // ULIP premiums log as investments, so pick from investment categories.
  const pickerCategories = typeMeta.premiumAsInvestment ? investmentCategories : expenseCategories;
  const selectedCategory = useMemo(
    () => pickerCategories.find((c) => c.id === expenseCategoryId) ?? null,
    [pickerCategories, expenseCategoryId],
  );
  const subCategories = selectedCategory?.subCategories ?? [];

  const changeType = (nextType) => {
    setType(nextType);
    const defaults = defaultExpenseCategoriesForType(nextType);
    setExpenseCategoryId(defaults.expenseCategoryId);
    setExpenseSubCategoryId(defaults.expenseSubCategoryId);
  };

  const handleSubmit = () => {
    const trimmed = name.trim();
    const premium = Number(premiumAmount);
    if (!trimmed) {
      setError('Enter a policy name.');
      return;
    }
    if (!Number.isFinite(premium) || premium <= 0) {
      setError('Enter a positive premium amount.');
      return;
    }
    const cover = coverAmount.trim() ? Number(coverAmount) : null;
    if (cover != null && (!Number.isFinite(cover) || cover <= 0)) {
      setError('Sum assured must be a positive number, or leave it blank.');
      return;
    }
    setError(null);
    onSubmit({
      name: trimmed,
      type,
      insurer: insurer.trim(),
      policyNumber: policyNumber.trim(),
      premiumAmount: premium,
      premiumFrequency,
      renewalDate: renewalDate ? renewalDate.toISOString() : null,
      coverAmount: cover,
      expenseCategoryId,
      expenseSubCategoryId: subCategories.length ? expenseSubCategoryId : null,
      tags,
      notes: notes.trim(),
    });
  };

  return (
    <View style={styles.card}>
      <Text style={styles.label}>Policy name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="e.g. Star Health Family Floater"
        placeholderTextColor={themeColors.text.muted}
      />

      <Text style={styles.label}>Type</Text>
      <View style={styles.chipRow}>
        {POLICY_TYPES.map((t) => {
          const selected = type === t.id;
          return (
            <TouchableOpacity
              key={t.id}
              onPress={() => changeType(t.id)}
              activeOpacity={0.7}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                {t.emoji} {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {typeMeta.premiumAsInvestment ? (
        <Text style={styles.hint}>
          ULIP premiums are usually logged as investments. Policy value can sit in Net Worth separately.
        </Text>
      ) : (
        <Text style={styles.hint}>
          Premiums log as {txType === 'investment' ? 'investments' : 'expenses'} under the category below.
        </Text>
      )}

      <Text style={styles.label}>Insurer (optional)</Text>
      <TextInput
        style={styles.input}
        value={insurer}
        onChangeText={setInsurer}
        placeholder="e.g. HDFC ERGO"
        placeholderTextColor={themeColors.text.muted}
      />

      <Text style={styles.label}>Policy number (optional)</Text>
      <TextInput
        style={styles.input}
        value={policyNumber}
        onChangeText={setPolicyNumber}
        placeholder="Policy / certificate no."
        placeholderTextColor={themeColors.text.muted}
        autoCapitalize="characters"
      />

      <Text style={styles.label}>Premium amount</Text>
      {/* Wrapper form: the calculator button is absolutely positioned over the
          input. Used standalone it has no size and can't be tapped. */}
      <AmountCalculatorButton value={premiumAmount} onChangeText={setPremiumAmount}>
        <TextInput
          style={styles.input}
          value={premiumAmount}
          onChangeText={setPremiumAmount}
          keyboardType={Platform.OS === 'ios' ? 'decimal-pad' : 'numeric'}
          placeholder="0"
          placeholderTextColor={themeColors.text.muted}
        />
      </AmountCalculatorButton>

      <Text style={styles.label}>Premium frequency</Text>
      <View style={styles.chipRow}>
        {PREMIUM_FREQUENCIES.map((f) => {
          const selected = premiumFrequency === f.id;
          return (
            <TouchableOpacity
              key={f.id}
              onPress={() => setPremiumFrequency(f.id)}
              activeOpacity={0.7}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.label}>Next renewal date</Text>
      <TouchableOpacity
        onPress={() => setShowRenewalPicker(true)}
        style={styles.dateBtn}
        activeOpacity={0.7}
      >
        <Text style={styles.dateBtnText}>
          {renewalDate
            ? renewalDate.toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })
            : 'Pick renewal date'}
        </Text>
      </TouchableOpacity>
      {showRenewalPicker && (
        <DateTimePicker
          value={renewalDate ?? new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(event, d) => {
            setShowRenewalPicker(Platform.OS === 'ios');
            if (event.type !== 'dismissed' && d) setRenewalDate(d);
          }}
        />
      )}

      <Text style={styles.label}>Sum assured (optional)</Text>
      <TextInput
        style={styles.input}
        value={coverAmount}
        onChangeText={setCoverAmount}
        keyboardType={Platform.OS === 'ios' ? 'decimal-pad' : 'numeric'}
        placeholder="Cover amount"
        placeholderTextColor={themeColors.text.muted}
      />

      <Text style={styles.label}>Log premium under</Text>
      <View style={styles.chipRow}>
        {pickerCategories.map((cat) => {
          const selected = expenseCategoryId === cat.id;
          return (
            <TouchableOpacity
              key={cat.id}
              onPress={() => {
                setExpenseCategoryId(cat.id);
                setExpenseSubCategoryId(null);
              }}
              activeOpacity={0.7}
              style={[styles.chip, selected && styles.chipSelected]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={cat.label}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                {cat.emoji ? `${cat.emoji} ` : ''}{cat.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {subCategories.length > 0 && (
        <>
          <Text style={styles.label}>Sub-category</Text>
          <View style={styles.chipRow}>
            {subCategories.map((sub) => {
              const selected = expenseSubCategoryId === sub.id;
              return (
                <TouchableOpacity
                  key={sub.id}
                  onPress={() => setExpenseSubCategoryId(sub.id)}
                  activeOpacity={0.7}
                  style={[styles.chip, selected && styles.chipSelected]}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {sub.emoji ? `${sub.emoji} ` : ''}{sub.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}

      <Text style={styles.label}>Tags (optional)</Text>
      <TagInput
        tags={tags}
        onChangeTags={setTags}
        placeholder="e.g. family-floater"
      />

      <Text style={styles.label}>Notes (optional)</Text>
      <TextInput
        style={[styles.input, styles.notesInput]}
        value={notes}
        onChangeText={setNotes}
        placeholder="Nominee, agent contact, riders…"
        placeholderTextColor={themeColors.text.muted}
        multiline
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.actions}>
        {onCancel ? (
          <TouchableOpacity onPress={onCancel} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity onPress={handleSubmit} style={styles.submitBtn}>
          <Text style={styles.submitText}>{submitLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (c) => ({
  card: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: c.text.secondary,
    marginTop: spacing.xs,
  },
  hint: {
    fontSize: 12,
    color: c.text.muted,
    lineHeight: 17,
  },
  input: {
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    fontSize: 16,
    color: c.text.primary,
    backgroundColor: c.bg.surfaceAlt,
  },
  notesInput: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: c.border.subtle,
    backgroundColor: c.bg.surfaceAlt,
  },
  chipSelected: {
    backgroundColor: c.accent.teal,
    borderColor: c.accent.teal,
  },
  chipText: {
    fontSize: 13,
    color: c.text.primary,
  },
  chipTextSelected: {
    color: '#fff',
    fontWeight: '600',
  },
  dateBtn: {
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    backgroundColor: c.bg.surfaceAlt,
  },
  dateBtnText: {
    fontSize: 16,
    color: c.text.primary,
  },
  error: {
    color: c.accent.expense,
    fontSize: 13,
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  cancelBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  cancelText: {
    fontSize: 15,
    color: c.text.secondary,
  },
  submitBtn: {
    backgroundColor: '#0d9488',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
  },
  submitText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
