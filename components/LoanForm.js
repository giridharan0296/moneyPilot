// ----------------------------------------------------------------------------
// LoanForm — add / edit a single Loan.
//
// Deliberately compact — the loan schema has a lot of optional fields, but
// only kind + name + principal are required. Rate / tenure / EMI / EMI-day
// are recommended (they unlock EMI logging and payoff projection), but the
// form doesn't force them so users can create a "quick" loan record and
// fill in the details later.
//
// Visual style mirrors RecurringForm — same chip / input / date-picker
// patterns so the form feels native to the app.
//
// Props:
//   initialValues                { kind, name, lenderName, direction,
//                                  principal, ratePct, method, tenureMonths,
//                                  emiAmount, emiDayOfMonth,
//                                  disburseDate, disbursementAccountId, ... }
//   submitLabel                  e.g. "Add loan" / "Save changes"
//   onSubmit(values)             validated payload for addLoan/updateLoan
//   onCancel()                   optional
//   isEdit                       true when editing (locks structural fields)
// ----------------------------------------------------------------------------

import { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker from './DatePicker';
import AppIcon from './AppIcon';
import { useLoans } from '../contexts/LoansContext';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles } from '../contexts/ThemeContext';
import {
  LOAN_METHODS,
  computeEmiAmount,
  formatMoney,
} from '../lib/loans';

const DIRECTIONS = [
  { id: 'owed_by_me', label: 'I owe (borrower)',    icon: 'download' },
  { id: 'owed_to_me', label: 'Owed to me (lender)', icon: 'upload' },
];

export default function LoanForm({
  initialValues,
  submitLabel = 'Add loan',
  onSubmit,
  onCancel,
  isEdit = false,
}) {
  const styles = useThemedStyles(makeStyles);
  const { accounts, accountGroups } = useSettings();
  const { loanKinds, findLoanKind, addCustomLoanKind } = useLoans();

  const [kind, setKind] = useState(initialValues?.kind ?? 'personal');
  const [addingCustomKind, setAddingCustomKind] = useState(false);
  const [customKindLabel, setCustomKindLabel] = useState('');
  const kindMeta = findLoanKind(kind);
  const accent = kindMeta?.color ?? '#2563eb';

  const [name, setName]           = useState(initialValues?.name ?? '');
  const [lenderName, setLenderName] = useState(initialValues?.lenderName ?? '');
  const [direction, setDirection] = useState(
    initialValues?.direction ?? kindMeta?.defaultDirection ?? 'owed_by_me',
  );
  const [principal, setPrincipal] = useState(
    initialValues?.principal != null ? String(initialValues.principal) : '',
  );
  const [ratePct, setRatePct] = useState(
    initialValues?.ratePct != null ? String(initialValues.ratePct) : '',
  );
  const [method, setMethod] = useState(
    initialValues?.method ?? kindMeta?.defaultMethod ?? 'reducing',
  );
  const [tenureMonths, setTenureMonths] = useState(
    initialValues?.tenureMonths ? String(initialValues.tenureMonths) : '',
  );
  const [emiAmount, setEmiAmount] = useState(
    initialValues?.emiAmount ? String(initialValues.emiAmount) : '',
  );
  const [emiDayOfMonth, setEmiDayOfMonth] = useState(
    String(initialValues?.emiDayOfMonth ?? 1),
  );
  const [disburseDate, setDisburseDate] = useState(
    initialValues?.disburseDate ? new Date(initialValues.disburseDate) : new Date(),
  );
  const [disbursementAccountId, setDisbursementAccountId] = useState(
    initialValues?.disbursementAccountId ?? accounts[0]?.id ?? null,
  );

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [emiTouched, setEmiTouched] = useState(false); // once user edits, stop auto-recomputing
  // "Tap Save again to confirm" latch for absurdly-high rates (LO-H4).
  // Stores the exact rate value the user has already acknowledged, so
  // typing 850 → cancel → typing 850 warns again but typing 850 → save
  // twice in a row goes through. Cleared/updated inside handleSubmit.
  const highRateAcknowledgedRef = useRef(null);

  // Auto-compute the EMI when principal + rate + tenure are all filled in
  // and the user hasn't overridden the field. Shown as a helper below the
  // EMI input so the user sees the app's guess even when their number differs.
  const computedEmi = useMemo(() => {
    return computeEmiAmount({
      principal:    Number(principal) || 0,
      ratePct:      ratePct === '' ? null : Number(ratePct),
      method,
      tenureMonths: Number(tenureMonths) || 0,
    });
  }, [principal, ratePct, method, tenureMonths]);

  const changeKind = (nextKindId) => {
    setKind(nextKindId);
    const nextMeta = findLoanKind(nextKindId);
    if (nextMeta) {
      // Only auto-flip direction if the current one doesn't fit the new kind.
      // (E.g. switching from 'informal_lend' → 'personal' should switch to
      // owed_by_me; keeping the previous 'owed_to_me' would be misleading.)
      if (nextMeta.defaultDirection && direction !== nextMeta.defaultDirection) {
        setDirection(nextMeta.defaultDirection);
      }
      if (nextMeta.defaultMethod) setMethod(nextMeta.defaultMethod);
    }
  };

  const handleSubmit = () => {
    if (!name.trim()) {
      Alert.alert('Missing name', 'Give the loan a short name (e.g. "HDFC Home Loan").');
      return;
    }
    const P = Number(principal);
    if (!isFinite(P) || P <= 0) {
      Alert.alert('Invalid principal', 'Enter a positive amount.');
      return;
    }
    const day = Number(emiDayOfMonth);
    if (!(day >= 1 && day <= 31)) {
      Alert.alert('EMI day', 'Enter a day between 1 and 31.');
      return;
    }
    // LO-H4: validate ratePct at the form boundary. Empty is fine
    // (interest-free informal loans, or the user wants to add rate later
    // via "Update rate"). But if the user typed SOMETHING, it must parse
    // to a finite non-negative number — otherwise NaN / negative rates
    // flow into every downstream computation (computeEmiAmount,
    // splitPrincipalInterestAtDate, computeAdjustment) and silently
    // corrupt the ledger.
    let parsedRate = null;
    if (!isEdit && ratePct.trim() !== '') {
      const r = Number(ratePct);
      if (!isFinite(r) || r < 0) {
        Alert.alert(
          'Invalid rate',
          'Interest rate must be zero or a positive number (e.g. 8.5 for 8.5% p.a.). Leave blank if unknown.',
        );
        return;
      }
      // Sanity ceiling — 100% p.a. is already usurious; anything above is
      // almost certainly a typo (e.g. 850 instead of 8.5). Two-tap
      // confirmation so a genuine high-rate loan can still be saved.
      // Match against the exact acknowledged value: if the user edits
      // the rate between taps, we re-warn on the new value.
      if (r > 100 && highRateAcknowledgedRef.current !== r) {
        highRateAcknowledgedRef.current = r;
        Alert.alert(
          'Very high rate',
          `${r}% p.a. looks unusually high — is this correct? Tap Save again to confirm.`,
        );
        return;
      }
      parsedRate = r;
    }
    // On edit, DON'T send ratePct — updateLoan silently drops it anyway
    // (rate changes must go through updateRate), and omitting the field
    // makes intent clearer at the API boundary.
    const payload = {
      kind,
      name: name.trim(),
      lenderName: lenderName.trim(),
      direction,
      principal: P,
      method,
      tenureMonths: Number(tenureMonths) || 0,
      emiAmount: emiAmount === '' ? computedEmi : Number(emiAmount),
      emiDayOfMonth: day,
      disburseDate: disburseDate.toISOString(),
      disbursementAccountId,
    };
    if (!isEdit) {
      payload.ratePct = parsedRate;
    }
    onSubmit(payload);
  };

  const handleDateChange = (event, selected) => {
    if (Platform.OS !== 'ios') setShowDatePicker(false);
    if (event?.type === 'dismissed') return;
    if (selected) setDisburseDate(selected);
  };

  return (
    <View style={styles.root}>
      {/* Kind */}
      <Text style={styles.label}>Loan type</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {loanKinds.map((k) => {
          const selected = k.id === kind;
          return (
            <TouchableOpacity
              key={k.id}
              onPress={() => (isEdit ? null : changeKind(k.id))}
              activeOpacity={isEdit ? 1 : 0.7}
              style={[
                styles.chip,
                selected && { backgroundColor: k.color, borderColor: k.color },
                isEdit && !selected && { opacity: 0.4 },
              ]}
            >
              <View style={styles.chipInnerRow}>
                <AppIcon
                  name={k.icon}
                  size={13}
                  color={selected ? '#fff' : k.color}
                  strokeWidth={2.2}
                />
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                  {k.label}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
        {!isEdit && (
          <TouchableOpacity
            onPress={() => setAddingCustomKind((v) => !v)}
            activeOpacity={0.7}
            style={[styles.chip, styles.chipDashed]}
          >
            <View style={styles.chipInnerRow}>
              <AppIcon name="plus" size={13} color={accent} strokeWidth={2.2} />
              <Text style={[styles.chipText, { color: accent }]}>Custom</Text>
            </View>
          </TouchableOpacity>
        )}
      </ScrollView>
      {!isEdit && addingCustomKind && (
        <View style={styles.customKindRow}>
          <TextInput
            style={[styles.input, styles.customKindInput]}
            value={customKindLabel}
            onChangeText={setCustomKindLabel}
            placeholder="e.g. Bike Loan"
            placeholderTextColor="#9ca3af"
            autoFocus
          />
          <TouchableOpacity
            style={[styles.customKindAddBtn, { backgroundColor: accent }]}
            activeOpacity={0.8}
            onPress={() => {
              const res = addCustomLoanKind({ label: customKindLabel });
              if (!res.ok) {
                Alert.alert(
                  'Could not add type',
                  res.reason === 'duplicate_name'
                    ? 'A loan type with that name already exists.'
                    : 'Enter a short name for the loan type.',
                );
                return;
              }
              changeKind(res.kind.id);
              setCustomKindLabel('');
              setAddingCustomKind(false);
            }}
          >
            <Text style={styles.customKindAddText}>Add</Text>
          </TouchableOpacity>
        </View>
      )}
      {isEdit && (
        <Text style={styles.hint}>Type is locked on edit — delete and re-add to change it.</Text>
      )}

      {/* Direction — only show for informal kinds where either side is plausible */}
      {(kind === 'informal_borrow' || kind === 'informal_lend') && (
        <>
          <Text style={styles.label}>Direction</Text>
          <View style={styles.chipRow}>
            {DIRECTIONS.map((d) => {
              const selected = d.id === direction;
              return (
                <TouchableOpacity
                  key={d.id}
                  onPress={() => setDirection(d.id)}
                  activeOpacity={0.7}
                  style={[
                    styles.chip,
                    selected && { backgroundColor: accent, borderColor: accent },
                  ]}
                >
                  <View style={styles.chipInnerRow}>
                    <AppIcon
                      name={d.icon}
                      size={13}
                      color={selected ? '#fff' : accent}
                      strokeWidth={2.2}
                    />
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {d.label}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}

      <Text style={styles.label}>Loan name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder='e.g. HDFC Home Loan'
        placeholderTextColor="#9ca3af"
      />

      <Text style={styles.label}>Lender / borrower name (optional)</Text>
      <TextInput
        style={styles.input}
        value={lenderName}
        onChangeText={setLenderName}
        placeholder={direction === 'owed_by_me' ? 'e.g. HDFC Bank' : 'e.g. Rahul'}
        placeholderTextColor="#9ca3af"
      />

      <Text style={styles.label}>Principal amount</Text>
      <TextInput
        style={styles.input}
        value={principal}
        onChangeText={(v) => (isEdit ? null : setPrincipal(v))}
        keyboardType="numeric"
        placeholder='e.g. 2500000'
        placeholderTextColor="#9ca3af"
        editable={!isEdit}
      />
      {isEdit && (
        <Text style={styles.hint}>Principal is locked on edit — delete and re-add to change it.</Text>
      )}

      <View style={styles.row2}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Rate (% p.a.)</Text>
          <TextInput
            style={[styles.input, isEdit && styles.inputLocked]}
            value={ratePct}
            onChangeText={(v) => (isEdit ? null : setRatePct(v))}
            keyboardType="numeric"
            placeholder='e.g. 8.5'
            placeholderTextColor="#9ca3af"
            editable={!isEdit}
          />
          {isEdit && (
            <Text style={styles.hint}>
              Rate is ledger-managed. Use "Update rate" on the loan detail to record a change.
            </Text>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Tenure (months)</Text>
          <TextInput
            style={styles.input}
            value={tenureMonths}
            onChangeText={setTenureMonths}
            keyboardType="numeric"
            placeholder='e.g. 240'
            placeholderTextColor="#9ca3af"
          />
        </View>
      </View>

      <Text style={styles.label}>Interest method</Text>
      <View style={styles.chipRow}>
        {LOAN_METHODS.map((m) => {
          const selected = m.id === method;
          return (
            <TouchableOpacity
              key={m.id}
              onPress={() => setMethod(m.id)}
              activeOpacity={0.7}
              style={[
                styles.chip,
                selected && { backgroundColor: accent, borderColor: accent },
              ]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                {m.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.row2}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>EMI amount</Text>
          <TextInput
            style={styles.input}
            value={emiAmount}
            onChangeText={(v) => {
              setEmiTouched(true);
              setEmiAmount(v);
            }}
            keyboardType="numeric"
            placeholder={computedEmi > 0 ? String(Math.round(computedEmi)) : 'e.g. 21500'}
            placeholderTextColor="#9ca3af"
          />
          {computedEmi > 0 && (
            <Text style={styles.hint}>
              Calculated: {formatMoney(computedEmi)}
              {emiTouched && emiAmount !== String(Math.round(computedEmi)) &&
                ' — tap to accept.'}
            </Text>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>EMI date (day)</Text>
          <TextInput
            style={styles.input}
            value={emiDayOfMonth}
            onChangeText={setEmiDayOfMonth}
            keyboardType="numeric"
            placeholder="e.g. 5"
            placeholderTextColor="#9ca3af"
          />
        </View>
      </View>
      <Text style={styles.hint}>
        Day of every month your EMI is due (1–28 recommended). Example: 5 = 5th of each month.
      </Text>

      <Text style={styles.label}>Disbursement date</Text>
      <TouchableOpacity
        onPress={() => (isEdit ? null : setShowDatePicker(true))}
        activeOpacity={isEdit ? 1 : 0.7}
        style={[styles.dateChip, isEdit && { opacity: 0.6 }]}
      >
        <Text style={styles.dateChipText}>
          {formatChipDate(disburseDate)}
        </Text>
        <Text style={styles.dateChipHint}>{isEdit ? 'locked' : 'tap to change'}</Text>
      </TouchableOpacity>
      {!isEdit && (
        <Text style={styles.hint}>
          Past start date + EMI amount → after save you can record EMIs already paid.
        </Text>
      )}
      {showDatePicker && (
        <DateTimePicker
          value={disburseDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={handleDateChange}
        />
      )}

      <Text style={styles.label}>Cash account used</Text>
      <GroupedAccountPicker
        accounts={accounts}
        accountGroups={accountGroups}
        selectedId={disbursementAccountId}
        onSelect={setDisbursementAccountId}
        accent={accent}
      />
      <Text style={styles.hint}>
        Used as the default account for future EMI-paid events.
      </Text>

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

// Local copy of the grouped account chip picker used by RecurringForm.
// Duplicated (not extracted to a shared component) intentionally — extracting
// would require also unifying styles, which the codebase has punted on so far.
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
              {items.map((a) => (
                <AccountChip
                  key={a.id}
                  account={a}
                  selected={a.id === selectedId}
                  onPress={() => onSelect(a.id)}
                  accent={accent}
                />
              ))}
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
            {orphans.map((a) => (
              <AccountChip
                key={a.id}
                account={a}
                selected={a.id === selectedId}
                onPress={() => onSelect(a.id)}
                accent={accent}
              />
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

function AccountChip({ account, selected, onPress, accent }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        styles.chip,
        selected && { backgroundColor: accent, borderColor: accent },
      ]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {account.emoji} {account.label}
      </Text>
    </TouchableOpacity>
  );
}

function formatChipDate(d) {
  return d.toLocaleDateString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

const makeStyles = (c) => ({
  root: { paddingBottom: 16 },

  label: {
    fontSize: 12, fontWeight: '600', color: c.text.secondary,
    marginTop: 14, marginBottom: 6,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  hint: { fontSize: 11, color: c.text.secondary, marginTop: 4, fontStyle: 'italic' },

  input: {
    backgroundColor: c.bg.surfaceAlt, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, color: c.text.primary,
    borderWidth: 1, borderColor: c.border.subtle,
  },
  inputLocked: {
    backgroundColor: c.bg.surfaceAlt,
    color: c.text.secondary,
  },
  row2: { flexDirection: 'row', gap: 10 },

  chipRow: { paddingVertical: 4, gap: 8, flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: c.bg.surfaceAlt, borderWidth: 1, borderColor: c.border.subtle,
  },
  chipDashed: {
    borderStyle: Platform.OS === 'web' ? 'dashed' : 'solid',
  },
  chipText: { fontSize: 13, fontWeight: '600', color: c.text.secondary },
  chipInnerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipTextSelected: { color: '#fff' },
  chipEmpty: { fontSize: 12, color: c.text.muted, fontStyle: 'italic', paddingVertical: 8 },
  customKindRow: { flexDirection: 'row', gap: 8, marginTop: 8, alignItems: 'center' },
  customKindInput: { flex: 1, marginTop: 0 },
  customKindAddBtn: {
    paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10, alignItems: 'center',
  },
  customKindAddText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  groupHeader: {
    fontSize: 10, color: c.text.secondary, fontWeight: '700',
    letterSpacing: 0.5, marginTop: 6,
  },

  dateChip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: c.bg.surfaceAlt, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: c.border.subtle,
  },
  dateChipText: { fontSize: 15, fontWeight: '600', color: c.text.primary },
  dateChipHint: { fontSize: 11, color: c.text.secondary },

  buttonRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  submitBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center',
  },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  cancelBtn: { backgroundColor: c.bg.surfaceAlt },
  cancelBtnText: { color: c.text.secondary, fontWeight: '700', fontSize: 15 },
});
