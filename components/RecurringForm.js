// ----------------------------------------------------------------------------
// RecurringForm — add / edit a single recurring rule.
//
// Deliberately DOES NOT reuse TransactionForm: that form is coupled to
// voice-note recording, transcription, and Whisper — none of which apply
// to a scheduling rule. Instead we lean on the same styling and the same
// chip / grouped-account patterns to keep it visually consistent.
//
// Props:
//   initialValues                {type, amount, categoryId, subCategoryId,
//                                 accountId, note, frequency, startDate,
//                                 endDate, active}
//   submitLabel                  e.g. "Add rule" or "Save changes"
//   onSubmit(values)             called with valid values on Save
//   onCancel()                   optional cancel button (edit flow)
// ----------------------------------------------------------------------------

import { useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AmountCalculatorButton from './AmountCalculatorButton';
import DateTimePicker from './DatePicker';
import AppIcon from './AppIcon';
import QuickAddPickerItem from './QuickAddPickerItem';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles } from '../contexts/ThemeContext';
import {
  FREQUENCIES,
  MONTHLY_MODES,
  NTH_WEEK_CHOICES,
  WEEKDAYS,
  ruleStartDate,
  toLocalDayKey,
} from '../lib/recurring';
import { formatSubCategoryLabel } from '../lib/categoryDisplay';

const TYPES = [
  { id: 'expense',    label: 'Expense',    icon: 'credit-card',  color: '#dc2626' },
  { id: 'income',     label: 'Income',     icon: 'wallet',       color: '#059669' },
  { id: 'investment', label: 'Investment', icon: 'bar-chart-2',  color: '#6366f1' },
];

export default function RecurringForm({
  initialValues,
  submitLabel = 'Save rule',
  onSubmit,
  onCancel,
}) {
  const styles = useThemedStyles(makeStyles);
  const { categories, accounts, accountGroups } = useSettings();

  const [type, setType] = useState(initialValues?.type ?? 'expense');
  const [amount, setAmount] = useState(
    initialValues?.amount != null ? String(initialValues.amount) : '',
  );
  const [categoryId, setCategoryId] = useState(
    initialValues?.categoryId ?? (categories[type]?.[0]?.id ?? null),
  );
  const [subCategoryId, setSubCategoryId] = useState(
    initialValues?.subCategoryId ?? null,
  );
  const [accountId, setAccountId] = useState(
    initialValues?.accountId ?? accounts[0]?.id ?? null,
  );
  const [note, setNote] = useState(initialValues?.note ?? '');
  const [frequency, setFrequency] = useState(initialValues?.frequency ?? 'monthly');
  // Monthly-only sub-mode. Older rules omit these; we default to 'date' /
  // sensible weekday values so switching frequency on the fly Just Works.
  const [monthlyMode, setMonthlyMode] = useState(
    initialValues?.monthlyMode ?? 'date',
  );
  const [nthWeek, setNthWeek] = useState(
    initialValues?.nthWeek ?? 1,   // "1st"
  );
  const [weekday, setWeekday] = useState(
    initialValues?.weekday ?? 5,   // Friday — the most common payroll weekday
  );
  // Seed from the rule's stored calendar day, not its ISO instant: on a device
  // in another time zone the instant is a different day, and saving would
  // silently move the rule.
  const [startDate, setStartDate] = useState(
    initialValues?.startDate || initialValues?.startDateLocal
      ? (ruleStartDate(initialValues) ?? new Date())
      : new Date(),
  );
  const [endDate, setEndDate] = useState(
    initialValues?.endDate ? new Date(initialValues.endDate) : null,
  );
  const [active, setActive] = useState(initialValues?.active !== false);
  const [backfillPast, setBackfillPast] = useState(false);

  // Date-picker visibility. Separate flags because a form can host two
  // pickers (start / end) and we want them independently controllable.
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  // When type changes, current category/subCategory may no longer belong to
  // the new list — reset them to the first option so the form stays valid.
  const changeType = (nextType) => {
    setType(nextType);
    const firstCat = categories[nextType]?.[0];
    setCategoryId(firstCat?.id ?? null);
    setSubCategoryId(null);
  };

  const changeCategory = (nextId) => {
    setCategoryId(nextId);
    setSubCategoryId(null); // parent switch always clears the sub-selection
  };

  const typeCategories = categories[type] ?? [];
  const selectedCategory = typeCategories.find((c) => c.id === categoryId) ?? null;
  const subCategories = selectedCategory?.subCategories ?? [];
  const typeMeta = TYPES.find((t) => t.id === type);
  const accent = typeMeta?.color ?? '#2563eb';

  const handleStartChange = (event, selected) => {
    setShowStartPicker(Platform.OS === 'ios');
    if (event.type === 'dismissed') return;
    if (selected) setStartDate(selected);
  };
  const handleEndChange = (event, selected) => {
    setShowEndPicker(Platform.OS === 'ios');
    if (event.type === 'dismissed') return;
    if (selected) setEndDate(selected);
  };

  const handleSubmit = () => {
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0) {
      Alert.alert('Invalid amount', 'Please enter a positive number.');
      return;
    }
    if (!categoryId) {
      Alert.alert('No category', 'Add a category in Settings first.');
      return;
    }
    if (!accountId) {
      Alert.alert('No account', 'Add an account in Settings first.');
      return;
    }
    // Compare calendar days: the picker's end date has no time of day, the
    // start date may (new Date()), so a same-day end was rejected as "before".
    if (endDate && toLocalDayKey(endDate) < toLocalDayKey(startDate)) {
      Alert.alert('Invalid end date', 'End date must not be before the start date.');
      return;
    }
    onSubmit({
      type,
      amount: parsed,
      categoryId,
      subCategoryId,
      accountId,
      note: note.trim(),
      frequency,
      // Only monthly frequency uses these — but we send them regardless so
      // the stored rule is self-describing. Non-monthly rules simply ignore
      // them in lib/recurring.js.
      monthlyMode: frequency === 'monthly' ? monthlyMode : 'date',
      nthWeek: frequency === 'monthly' && monthlyMode === 'nthWeekday'
        ? nthWeek
        : null,
      weekday: frequency === 'monthly' && monthlyMode === 'nthWeekday'
        ? weekday
        : null,
      startDate,
      endDate,
      active,
      backfillPast: !initialValues && backfillPast,
    });
  };

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const startsInPast = startDate < todayStart;

  return (
    <View style={styles.root}>
      <Text style={styles.label}>Type</Text>
      <View style={styles.chipRow}>
        {TYPES.map((t) => {
          const selected = t.id === type;
          return (
            <TouchableOpacity
              key={t.id}
              onPress={() => changeType(t.id)}
              activeOpacity={0.7}
              style={[
                styles.chip,
                styles.chipWithIcon,
                selected && { backgroundColor: t.color, borderColor: t.color },
              ]}
            >
              <AppIcon
                name={t.icon}
                size={13}
                color={selected ? '#fff' : t.color}
                strokeWidth={2.2}
              />
              <Text
                style={[
                  styles.chipText,
                  selected && styles.chipTextSelected,
                ]}
              >
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.label}>Amount</Text>
      <AmountCalculatorButton value={amount} onChangeText={setAmount}>
        <TextInput
          style={styles.input}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor="#9aa0a6"
        />
      </AmountCalculatorButton>
      <Text style={styles.label}>Category</Text>
      {typeCategories.length === 0 ? (
        <Text style={styles.chipEmpty}>
          No {type} categories — add one in Settings.
        </Text>
      ) : (
        <View style={styles.chipRow}>
          {typeCategories.map((c) => {
            const selected = c.id === categoryId;
            return (
              <TouchableOpacity
                key={c.id}
                onPress={() => changeCategory(c.id)}
                activeOpacity={0.7}
                style={[
                  styles.chip,
                  selected && { backgroundColor: accent, borderColor: accent },
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    selected && styles.chipTextSelected,
                  ]}
                >
                  {c.emoji} {c.label}
                </Text>
              </TouchableOpacity>
            );
          })}
          <QuickAddPickerItem kind="category" type={type} accent={accent} onCreated={(item) => changeCategory(item.id)} />
        </View>
      )}
      {categories.length === 0 ? <QuickAddPickerItem
        kind="category"
        type={type}
        accent={accent}
        onCreated={(item) => changeCategory(item.id)}
      /> : null}

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
                  !subCategoryId && { backgroundColor: accent, borderColor: accent },
                ]}
              >
                <Text
                  style={[
                    styles.subChipText,
                    !subCategoryId && styles.chipTextSelected,
                  ]}
                >
                  None
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
                      selected && { backgroundColor: accent, borderColor: accent },
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
              <QuickAddPickerItem kind="subcategory" type={type} parentId={categoryId} accent={accent} onCreated={(item) => setSubCategoryId(item.id)} />
            </View>
          ) : null}
          {subCategories.length === 0 ? <QuickAddPickerItem
            kind="subcategory"
            type={type}
            parentId={categoryId}
            accent={accent}
            onCreated={(item) => setSubCategoryId(item.id)}
          /> : null}
        </>
      )}

      <Text style={styles.label}>Account</Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
      <View style={{ flex: 1 }}>
      <GroupedAccountPicker
        accounts={accounts}
        accountGroups={accountGroups}
        selectedId={accountId}
        onSelect={setAccountId}
        accent={accent}
      />
      </View>
      <QuickAddPickerItem kind="account" accent={accent} onCreated={(item) => setAccountId(item.id)} />
      </View>

      <Text style={styles.label}>Note (optional)</Text>
      <TextInput
        style={styles.input}
        value={note}
        onChangeText={setNote}
        placeholder="e.g. Netflix subscription"
        placeholderTextColor="#9aa0a6"
      />

      <Text style={styles.label}>Frequency</Text>
      <View style={styles.chipRow}>
        {FREQUENCIES.map((f) => {
          const selected = f.id === frequency;
          return (
            <TouchableOpacity
              key={f.id}
              onPress={() => setFrequency(f.id)}
              activeOpacity={0.7}
              style={[
                styles.chip,
                styles.chipWithIcon,
                selected && { backgroundColor: accent, borderColor: accent },
              ]}
            >
              <AppIcon
                name={f.icon}
                size={13}
                color={selected ? '#fff' : accent}
                strokeWidth={2.2}
              />
              <Text
                style={[
                  styles.chipText,
                  selected && styles.chipTextSelected,
                ]}
              >
                {f.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/*
        Monthly-only sub-selector. Lets the user pick between "specific date"
        (current behaviour), "last/first working day of month" (great for
        salary, SIPs, EMI auto-debits), and "Nth weekday" (e.g. 2nd Friday).
        Weekend-only: public holidays are not detected — the top of
        lib/recurring.js explains why.
      */}
      {frequency === 'monthly' && (
        <>
          <Text style={styles.label}>Monthly mode</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {MONTHLY_MODES.map((m) => {
              const selected = m.id === monthlyMode;
              return (
                <TouchableOpacity
                  key={m.id}
                  onPress={() => setMonthlyMode(m.id)}
                  activeOpacity={0.7}
                  style={[
                    styles.chip,
                    styles.chipWithIcon,
                    selected && { backgroundColor: accent, borderColor: accent },
                  ]}
                >
                  <AppIcon
                    name={m.icon}
                    size={13}
                    color={selected ? '#fff' : accent}
                    strokeWidth={2.2}
                  />
                  <Text
                    style={[
                      styles.chipText,
                      selected && styles.chipTextSelected,
                    ]}
                  >
                    {m.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {monthlyMode === 'lastWorkingDay' && (
            <>
              <Text style={styles.hint}>
                Fires on the last Mon–Fri of every month. Great for salary that
                lands on the last working day.
              </Text>
              {/* BK-L2: hoist the holiday caveat into its own line so it
                  can't get lost at the end of the descriptive hint. */}
              <View style={styles.hintWarnRow}>
                <AppIcon name="alert-triangle" size={13} color="#b45309" strokeWidth={2} />
                <Text style={styles.hintWarn}>
                  Public holidays are NOT skipped — the rule will still fire
                  on a Mon–Fri that happens to be a holiday.
                </Text>
              </View>
            </>
          )}
          {monthlyMode === 'firstWorkingDay' && (
            <>
              <Text style={styles.hint}>
                Fires on the first Mon–Fri of every month. Handy for rent, EMIs,
                or SIPs scheduled at month-start.
              </Text>
              <View style={styles.hintWarnRow}>
                <AppIcon name="alert-triangle" size={13} color="#b45309" strokeWidth={2} />
                <Text style={styles.hintWarn}>
                  Public holidays are NOT skipped — the rule will still fire
                  on a Mon–Fri that happens to be a holiday.
                </Text>
              </View>
            </>
          )}
          {monthlyMode === 'nthWeekday' && (
            <>
              <Text style={styles.subLabel}>Which week</Text>
              <View style={styles.chipRow}>
                {NTH_WEEK_CHOICES.map((n) => {
                  const selected = n.id === nthWeek;
                  return (
                    <TouchableOpacity
                      key={n.id}
                      onPress={() => setNthWeek(n.id)}
                      activeOpacity={0.7}
                      style={[
                        styles.chip,
                        selected && { backgroundColor: accent, borderColor: accent },
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          selected && styles.chipTextSelected,
                        ]}
                      >
                        {n.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.subLabel}>Which day</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}
              >
                {WEEKDAYS.map((w) => {
                  const selected = w.id === weekday;
                  return (
                    <TouchableOpacity
                      key={w.id}
                      onPress={() => setWeekday(w.id)}
                      activeOpacity={0.7}
                      style={[
                        styles.chip,
                        selected && { backgroundColor: accent, borderColor: accent },
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          selected && styles.chipTextSelected,
                        ]}
                      >
                        {w.short}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              <Text style={styles.hint}>
                Fires on the chosen weekday-of-month. If a given month has no
                5th occurrence of that weekday, the last one in the month is
                used instead.
              </Text>
            </>
          )}
        </>
      )}

      <Text style={styles.label}>Starts on</Text>
      <TouchableOpacity
        onPress={() => setShowStartPicker(true)}
        activeOpacity={0.7}
        style={styles.dateChip}
      >
        <View style={styles.dateChipInner}>
          <AppIcon name="calendar" size={16} color="#111" strokeWidth={2} />
          <Text style={styles.dateChipText}>{formatChipDate(startDate)}</Text>
        </View>
        <Text style={styles.dateChipHint}>Tap to change</Text>
      </TouchableOpacity>
      <Text style={styles.hint}>
        {frequency === 'monthly' && monthlyMode !== 'date'
          ? 'The rule kicks in from this month. The exact first firing date is computed automatically from the mode above.'
          : 'The first occurrence follows this date and the selected frequency.'}
      </Text>
      {showStartPicker && (
        <DateTimePicker
          value={startDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={handleStartChange}
        />
      )}

      {!initialValues && startsInPast && (
        <View style={styles.activeRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.activeLabel}>Create past transactions</Text>
            <Text style={styles.activeSub}>
              Add every due occurrence from the start date through today. Leave off to begin tracking from now.
            </Text>
          </View>
          <Switch
            value={backfillPast}
            onValueChange={setBackfillPast}
            trackColor={{ false: '#e5e7eb', true: accent }}
            thumbColor={'#fff'}
          />
        </View>
      )}

      <Text style={styles.label}>Ends on</Text>
      {endDate ? (
        <View style={styles.dateRow}>
          <TouchableOpacity
            onPress={() => setShowEndPicker(true)}
            activeOpacity={0.7}
            style={[styles.dateChip, { flex: 1 }]}
          >
            <View style={styles.dateChipInner}>
              <AppIcon name="octagon" size={16} color="#dc2626" strokeWidth={2} filled />
              <Text style={styles.dateChipText}>{formatChipDate(endDate)}</Text>
            </View>
            <Text style={styles.dateChipHint}>Tap to change</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setEndDate(null)}
            activeOpacity={0.7}
            style={styles.clearBtn}
          >
            <Text style={styles.clearBtnText}>Clear</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          onPress={() => {
            // Default to one year from start when the user first opens picker.
            const defaultEnd = new Date(startDate);
            defaultEnd.setFullYear(defaultEnd.getFullYear() + 1);
            setEndDate(defaultEnd);
            setShowEndPicker(true);
          }}
          activeOpacity={0.7}
          style={[styles.dateChip, styles.dateChipGhost]}
        >
          <View style={styles.dateChipInner}>
            <AppIcon name="infinity" size={16} color="#6b7280" strokeWidth={2} />
            <Text style={styles.dateChipTextGhost}>No end date · tap to set</Text>
          </View>
        </TouchableOpacity>
      )}
      {showEndPicker && (
        <DateTimePicker
          value={endDate ?? new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          minimumDate={startDate}
          onChange={handleEndChange}
        />
      )}

      <View style={styles.activeRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.activeLabel}>Active</Text>
          <Text style={styles.activeSub}>
            Paused rules stop generating transactions until you re-enable them.
          </Text>
        </View>
        <Switch
          value={active}
          onValueChange={setActive}
          trackColor={{ false: '#e5e7eb', true: accent }}
          thumbColor="#fff"
        />
      </View>

      <View style={styles.buttonRow}>
        {onCancel && (
          <TouchableOpacity
            onPress={onCancel}
            style={[styles.submitBtn, styles.cancelBtn]}
            activeOpacity={0.7}
          >
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={handleSubmit}
          style={[styles.submitBtn, { backgroundColor: accent }]}
          activeOpacity={0.8}
        >
          <Text style={styles.submitBtnText}>{submitLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Grouped account chips — same visual pattern as TransactionForm. Kept
// local so this file has no dependency on TransactionForm internals.
function GroupedAccountPicker({
  accounts,
  accountGroups,
  selectedId,
  onSelect,
  accent,
}) {
  const styles = useThemedStyles(makeStyles);
  if (accounts.length === 0) {
    return (
      <Text style={styles.chipEmpty}>No accounts — add one in Settings.</Text>
    );
  }
  const byGroup = {};
  for (const a of accounts) {
    (byGroup[a.groupId] ??= []).push(a);
  }
  const knownGroupIds = new Set(accountGroups.map((g) => g.id));
  const orphans = accounts.filter((a) => !knownGroupIds.has(a.groupId));

  return (
    <View style={{ gap: 6 }}>
      {accountGroups.map((g) => {
        const items = byGroup[g.id] ?? [];
        if (items.length === 0) return null;
        return (
          <View key={g.id}>
            <Text style={styles.groupHeader}>
              {g.emoji}  {g.label.toUpperCase()}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {items.map((a) => {
                const selected = a.id === selectedId;
                return (
                  <TouchableOpacity
                    key={a.id}
                    onPress={() => onSelect(a.id)}
                    activeOpacity={0.7}
                    style={[
                      styles.chip,
                      selected && { backgroundColor: accent, borderColor: accent },
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        selected && styles.chipTextSelected,
                      ]}
                    >
                      {a.emoji} {a.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        );
      })}
      {orphans.length > 0 && (
        <View>
          <Text style={styles.groupHeader}>UNGROUPED</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {orphans.map((a) => {
              const selected = a.id === selectedId;
              return (
                <TouchableOpacity
                  key={a.id}
                  onPress={() => onSelect(a.id)}
                  activeOpacity={0.7}
                  style={[
                    styles.chip,
                    selected && { backgroundColor: accent, borderColor: accent },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      selected && styles.chipTextSelected,
                    ]}
                  >
                    {a.emoji} {a.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

function formatChipDate(d) {
  const now = new Date();
  const same = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (same(d, now)) return 'Today';
  if (same(d, yesterday)) return 'Yesterday';
  if (same(d, tomorrow)) return 'Tomorrow';
  return d.toLocaleDateString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

const makeStyles = (c) => ({
  root: { paddingBottom: 16 },

  label: {
    fontSize: 12,
    fontWeight: '600',
    color: c.text.secondary,
    marginTop: 14,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  hint: { fontSize: 11, color: c.text.secondary, marginTop: 4, fontStyle: 'italic' },
  hintWarn: {
    fontSize: 11,
    color: '#b45309',
    marginTop: 6,
    fontWeight: '600',
    lineHeight: 15,
  },
  subLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: c.text.secondary,
    marginTop: 10,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  input: {
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: c.text.primary,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },

  chipRow: { paddingVertical: 4, gap: 8, flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: c.bg.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  chipWithIcon: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipText: { fontSize: 13, fontWeight: '600', color: c.text.secondary },
  chipTextSelected: { color: '#fff' },
  chipEmpty: {
    fontSize: 12,
    color: c.text.muted,
    fontStyle: 'italic',
    paddingVertical: 8,
  },

  subChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: c.bg.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border.subtle,
    alignSelf: 'flex-start',
    flexShrink: 0,
  },
  subChipText: { fontSize: 12, fontWeight: '600', color: c.text.secondary, flexShrink: 0 },

  groupHeader: {
    fontSize: 10,
    color: c.text.secondary,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: 6,
  },

  dateChipInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hintWarnRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 6 },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  dateChipText: { fontSize: 15, fontWeight: '600', color: c.text.primary },
  dateChipHint: { fontSize: 11, color: c.text.secondary },
  dateChipGhost: {
    borderStyle: 'dashed',
    backgroundColor: c.bg.surface,
    justifyContent: 'center',
  },
  dateChipTextGhost: { fontSize: 14, color: c.text.secondary, fontWeight: '600' },

  dateRow: { flexDirection: 'row', gap: 8, alignItems: 'stretch' },
  clearBtn: {
    paddingHorizontal: 12,
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: c.bg.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  clearBtnText: { fontSize: 12, fontWeight: '700', color: c.text.secondary },

  activeRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: c.border.subtle,
    gap: 12,
  },
  activeLabel: { fontSize: 14, fontWeight: '700', color: c.text.primary },
  activeSub: { fontSize: 11, color: c.text.secondary, marginTop: 2 },

  buttonRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  submitBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  cancelBtn: { backgroundColor: c.bg.surfaceAlt },
  cancelBtnText: { color: c.text.secondary, fontWeight: '700', fontSize: 15 },
});
