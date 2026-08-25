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
//                                  firstInterestPeriod, firstInterestBasis,
//                                  disburseDate, disbursementAccountId, ... }
//   submitLabel                  e.g. "Add loan" / "Save changes"
//   onSubmit(values)             validated payload for addLoan/updateLoan
//   onCancel()                   optional
//   isEdit                       true when editing (locks structural fields)
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
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
import AmountCalculatorButton from './AmountCalculatorButton';
import { useLoans } from '../contexts/LoansContext';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles } from '../contexts/ThemeContext';
import {
  LOAN_METHODS,
  computeEmiAmount,
  computeFirstEmiSplit,
  enumerateEmiDueDates,
  firstScheduledEmiDate,
  formatMoney,
  interestProfileDescription,
  resolveInterestProfile,
  splitPrincipalInterestAtDate,
} from '../lib/loans';
import { isOnOrAfterAccountOpeningDate } from '../lib/accountBalances';
import { StatusBadge } from './UiPrimitives';
import QuickAddPickerItem from './QuickAddPickerItem';

const DIRECTIONS = [
  { id: 'owed_by_me', label: 'I owe (borrower)',    icon: 'download' },
  { id: 'owed_to_me', label: 'Owed to me (lender)', icon: 'upload' },
];

const FIRST_INTEREST_PERIODS = [
  { id: 'monthly', label: 'Standard monthly' },
  { id: 'month_end', label: 'Until month-end' },
  { id: 'emi_date', label: 'Until first EMI date' },
];

const FIRST_INTEREST_BASES = [360, 365];
const FIRST_INTEREST_ROUNDING = [
  { id: 'nearest', label: 'Nearest rupee' },
  { id: 'up', label: 'Round up' },
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
  const [firstEmiAmount, setFirstEmiAmount] = useState(
    initialValues?.firstEmiAmount ? String(initialValues.firstEmiAmount) : '',
  );
  const [firstInterestPeriod, setFirstInterestPeriod] = useState(
    initialValues?.firstInterestPeriod ?? 'month_end',
  );
  const [firstInterestBasis, setFirstInterestBasis] = useState(
    Number(initialValues?.firstInterestBasis) === 360 ? 360 : 365,
  );
  const [firstInterestRounding, setFirstInterestRounding] = useState(
    initialValues?.firstInterestRounding === 'up' ? 'up' : 'nearest',
  );
  const [emiDayOfMonth, setEmiDayOfMonth] = useState(
    String(initialValues?.emiDayOfMonth ?? 1),
  );
  const [disburseDate, setDisburseDate] = useState(
    initialValues?.disburseDate ? new Date(initialValues.disburseDate) : new Date(),
  );
  const [firstEmiDate, setFirstEmiDate] = useState(() => (
    initialValues?.firstEmiDate
      ? new Date(initialValues.firstEmiDate)
      : firstScheduledEmiDate(
        initialValues?.disburseDate ? new Date(initialValues.disburseDate) : new Date(),
        initialValues?.emiDayOfMonth ?? 1,
      )
  ));
  const [disbursementAccountId, setDisbursementAccountId] = useState(
    initialValues?.disbursementAccountId ?? accounts[0]?.id ?? null,
  );
  const [creditPrincipalToAccount, setCreditPrincipalToAccount] = useState(
    initialValues?.creditPrincipalToAccount ?? true,
  );

  useEffect(() => {
    if (isEdit) return;

    const fallbackAccountId = initialValues?.disbursementAccountId ?? accounts[0]?.id ?? null;
    const hasValidSelection =
      !!disbursementAccountId && accounts.some((account) => account.id === disbursementAccountId);

    if (!hasValidSelection && fallbackAccountId) {
      setDisbursementAccountId(fallbackAccountId);
    }
  }, [accounts, disbursementAccountId, initialValues?.disbursementAccountId, isEdit]);

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showFirstEmiDatePicker, setShowFirstEmiDatePicker] = useState(false);
  const [firstEmiDateTouched, setFirstEmiDateTouched] = useState(Boolean(initialValues?.firstEmiDate));
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

  const usesSbiInterest = useMemo(
    () => resolveInterestProfile({ lenderName, interestProfile: null }) === 'sbi',
    [lenderName],
  );

  const computedFirstEmiSplit = useMemo(() => {
    const regularEmi = Number(emiAmount) || computedEmi;
    const firstDate = firstEmiDate;
    if (!firstDate || regularEmi <= 0) return null;
    return computeFirstEmiSplit({
      principal: Number(principal) || 0,
      ratePct: ratePct === '' ? null : Number(ratePct),
      method,
      emiAmount: regularEmi,
      firstEmiAmount: Number(firstEmiAmount) > 0 ? Number(firstEmiAmount) : null,
      disburseDate: disburseDate.toISOString(),
      firstInterestPeriod,
      firstInterestBasis,
      firstInterestRounding,
      lenderName: lenderName.trim(),
    }, firstDate);
  }, [
    computedEmi,
    disburseDate,
    emiAmount,
    firstEmiAmount,
    emiDayOfMonth,
    firstInterestBasis,
    firstInterestPeriod,
    firstInterestRounding,
    lenderName,
    method,
    principal,
    ratePct,
    firstEmiDate,
  ]);

  useEffect(() => {
    if (isEdit || firstEmiDateTouched) return;
    const next = firstScheduledEmiDate(disburseDate, emiDayOfMonth);
    if (next) setFirstEmiDate(next);
  }, [disburseDate, emiDayOfMonth, firstEmiDateTouched, isEdit]);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === disbursementAccountId) ?? null,
    [accounts, disbursementAccountId],
  );
  const principalCreditBlocked = direction === 'owed_by_me'
    && creditPrincipalToAccount
    && selectedAccount
    && !isOnOrAfterAccountOpeningDate(selectedAccount, disburseDate);

  const trackingPreview = useMemo(() => {
    if (isEdit || !firstEmiDate) return null;
    const regularEmi = Number(emiAmount) || computedEmi;
    const P = Number(principal) || 0;
    if (P <= 0 || regularEmi <= 0) return null;
    const dates = enumerateEmiDueDates({
      disburseDate,
      firstEmiDate,
      emiDayOfMonth,
      throughDate: new Date(),
      tenureMonths: Number(tenureMonths) > 0 ? Number(tenureMonths) : 600,
    });
    const provisional = {
      principal: P,
      currentOutstanding: P,
      ratePct: ratePct === '' ? null : Number(ratePct),
      method,
      emiAmount: regularEmi,
      firstEmiAmount: Number(firstEmiAmount) > 0 ? Number(firstEmiAmount) : null,
      disburseDate: disburseDate.toISOString(),
      firstEmiDate: firstEmiDate.toISOString(),
      firstInterestPeriod,
      firstInterestBasis,
      firstInterestRounding,
      events: [{
        kind: 'disburse',
        date: disburseDate.toISOString(),
        amount: P,
        principal: P,
        initialRatePct: ratePct === '' ? null : Number(ratePct),
      }],
    };
    let outstanding = P;
    const processedDates = [];
    for (let index = 0; index < dates.length; index += 1) {
      const date = dates[index];
      const paymentAmount = index === 0 && Number(firstEmiAmount) > 0
        ? Number(firstEmiAmount)
        : regularEmi;
      const split = splitPrincipalInterestAtDate(provisional, date, paymentAmount);
      const paidPrincipal = Math.min(Math.max(0, Number(split.principal) || 0), outstanding);
      provisional.events.push({ kind: 'emi', date, amount: paymentAmount, principal: paidPrincipal, interest: Math.max(0, paymentAmount - paidPrincipal) });
      outstanding = Math.max(0, outstanding - paidPrincipal);
      provisional.currentOutstanding = outstanding;
      processedDates.push(date);
      if (outstanding <= 0) break;
    }
    const historical = processedDates.filter((date) => !isOnOrAfterAccountOpeningDate(selectedAccount, date)).length;
    return {
      total: processedDates.length,
      historical,
      affectingAccount: processedDates.length - historical,
      outstanding,
    };
  }, [
    computedEmi, disburseDate, emiAmount, emiDayOfMonth, firstEmiAmount, firstEmiDate,
    firstInterestBasis, firstInterestPeriod, firstInterestRounding, isEdit, method, principal,
    ratePct, selectedAccount, tenureMonths,
  ]);

  const changeKind = (nextKindId) => {
    setKind(nextKindId);
    // Selecting an existing type cancels the in-progress custom type editor.
    setAddingCustomKind(false);
    setCustomKindLabel('');
    const nextMeta = findLoanKind(nextKindId);
    if (nextMeta) {
      // Only auto-flip direction if the current one doesn't fit the new kind.
      // (E.g. switching from 'informal_lend' → 'personal' should switch to
      // owed_by_me; keeping the previous 'owed_to_me' would be misleading.)
      if (nextMeta.defaultDirection && direction !== nextMeta.defaultDirection) {
        setDirection(nextMeta.defaultDirection);
      }
      if (nextMeta.defaultMethod) setMethod(nextMeta.defaultMethod);
      if (nextKindId === 'home' && nextMeta.defaultMethod !== 'flat') {
        setFirstInterestPeriod('month_end');
      }
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
    const disburseDay = new Date(disburseDate.getFullYear(), disburseDate.getMonth(), disburseDate.getDate());
    const firstEmiDay = firstEmiDate
      ? new Date(firstEmiDate.getFullYear(), firstEmiDate.getMonth(), firstEmiDate.getDate())
      : null;
    if (!firstEmiDay || !isFinite(firstEmiDay.getTime()) || firstEmiDay < disburseDay) {
      Alert.alert('First EMI date', 'Choose the actual first EMI date on or after the disbursement date.');
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
    const resolvedDisbursementAccountId =
      disbursementAccountId ?? accounts[0]?.id ?? null;

    // The custom-kind editor used to require its small `Add` button to be
    // pressed before the main form submit. If the user typed a custom label
    // and tapped `Add loan` directly, `kind` was still the default
    // `personal`, so the loan was silently saved as a Personal Loan. Treat a
    // populated, open custom editor as the user's final selection and create
    // that kind as part of this submit.
    let resolvedKind = kind;
    let resolvedKindMeta = findLoanKind(kind);
    if (!isEdit && addingCustomKind) {
      if (!customKindLabel.trim()) {
        Alert.alert('Missing loan type', 'Enter a name for the custom loan type.');
        return;
      }
      const customResult = addCustomLoanKind({ label: customKindLabel });
      if (!customResult.ok) {
        Alert.alert(
          'Could not add type',
          customResult.reason === 'duplicate_name'
            ? 'A loan type with that name already exists. Select it from the list.'
            : 'Enter a short name for the loan type.',
        );
        return;
      }
      resolvedKind = customResult.kind.id;
      resolvedKindMeta = customResult.kind;
    }

    const payload = {
      kind: resolvedKind,
      // Keep a denormalized label on the loan as well. This makes the loan
      // display correctly even during the render in which the new custom-kind
      // row is still being committed, and after partial/legacy restores.
      kindLabel: resolvedKindMeta?.label ?? null,
      name: name.trim(),
      lenderName: lenderName.trim(),
      direction,
      principal: P,
      method,
      tenureMonths: Number(tenureMonths) || 0,
      emiAmount: emiAmount === '' ? computedEmi : Number(emiAmount),
      firstEmiAmount: Number(firstEmiAmount) > 0 ? Number(firstEmiAmount) : null,
      firstInterestPeriod,
      firstInterestBasis,
      firstInterestRounding,
      emiDayOfMonth: day,
      disburseDate: disburseDate.toISOString(),
      firstEmiDate: firstEmiDate?.toISOString() ?? null,
      disbursementAccountId: resolvedDisbursementAccountId,
      creditPrincipalToAccount: creditPrincipalToAccount && !!resolvedDisbursementAccountId,
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

  const handleFirstEmiDateChange = (event, selected) => {
    if (Platform.OS !== 'ios') setShowFirstEmiDatePicker(false);
    if (event?.type === 'dismissed') return;
    if (selected) {
      setFirstEmiDate(selected);
      setFirstEmiDateTouched(true);
      setEmiDayOfMonth(String(selected.getDate()));
    }
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
      {usesSbiInterest && method !== 'flat' && (
        <Text style={styles.hint}>
          {interestProfileDescription({ lenderName, interestProfile: 'sbi' })}
          {' '}Use the date SBI credited prepayments (especially if paid on a weekend/holiday). For penny-perfect EMI interest, enter the interest amount from your YONO/statement when logging the EMI.
        </Text>
      )}

      <Text style={styles.label}>Principal amount</Text>
      {!isEdit ? (
        <AmountCalculatorButton value={principal} onChangeText={setPrincipal}>
          <TextInput
            style={styles.input}
            value={principal}
            onChangeText={setPrincipal}
            keyboardType="numeric"
            placeholder="e.g. 2500000"
            placeholderTextColor="#9ca3af"
          />
        </AmountCalculatorButton>
      ) : (
        <TextInput
          style={styles.input}
          value={principal}
          keyboardType="numeric"
          placeholder="e.g. 2500000"
          placeholderTextColor="#9ca3af"
          editable={false}
        />
      )}
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
          <AmountCalculatorButton value={emiAmount} onChangeText={setEmiAmount}>
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
          </AmountCalculatorButton>
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

      <Text style={styles.label}>Actual first EMI amount (optional)</Text>
      <AmountCalculatorButton value={firstEmiAmount} onChangeText={setFirstEmiAmount}>
        <TextInput
          style={styles.input}
          value={firstEmiAmount}
          onChangeText={setFirstEmiAmount}
          keyboardType="numeric"
          placeholder="Use the amount debited by the lender"
          placeholderTextColor="#9ca3af"
        />
      </AmountCalculatorButton>
      <Text style={styles.hint}>
        Use this when the first debit differs due to a short or broken period. Later EMIs use the regular amount above.
      </Text>

      {method !== 'flat' && (
        <>
          <Text style={styles.label}>First interest calculation</Text>
          <View style={styles.chipRow}>
            {FIRST_INTEREST_PERIODS.map((option) => {
              const selected = firstInterestPeriod === option.id;
              return (
                <TouchableOpacity
                  key={option.id}
                  onPress={() => setFirstInterestPeriod(option.id)}
                  style={[
                    styles.chip,
                    selected && { backgroundColor: accent, borderColor: accent },
                  ]}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {firstInterestPeriod !== 'monthly' && (
            <>
              <Text style={styles.label}>Day-count basis</Text>
              <View style={styles.chipRow}>
                {FIRST_INTEREST_BASES.map((basis) => {
                  const selected = firstInterestBasis === basis;
                  return (
                    <TouchableOpacity
                      key={basis}
                      onPress={() => setFirstInterestBasis(basis)}
                      style={[
                        styles.chip,
                        selected && { backgroundColor: accent, borderColor: accent },
                      ]}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                        Actual/{basis}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.label}>Interest rounding</Text>
              <View style={styles.chipRow}>
                {FIRST_INTEREST_ROUNDING.map((option) => {
                  const selected = firstInterestRounding === option.id;
                  return (
                    <TouchableOpacity
                      key={option.id}
                      onPress={() => setFirstInterestRounding(option.id)}
                      style={[
                        styles.chip,
                        selected && { backgroundColor: accent, borderColor: accent },
                      ]}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          {computedFirstEmiSplit && computedFirstEmiSplit.emi > 0 && (
            <Text style={styles.hint}>
              First EMI: {formatMoney(computedFirstEmiSplit.emi)}
              {computedFirstEmiSplit.days != null && computedFirstEmiSplit.days > 0
                ? ` · interest ${formatMoney(computedFirstEmiSplit.interest)} for ${computedFirstEmiSplit.days} day${computedFirstEmiSplit.days === 1 ? '' : 's'}`
                : ''}
              {computedFirstEmiSplit.days != null && computedFirstEmiSplit.days > 0
                ? ` · principal ${formatMoney(computedFirstEmiSplit.principal)}`
                : '. Later EMIs use the regular amount above.'}
            </Text>
          )}
        </>
      )}

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
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
      <View style={{ flex: 1 }}>
      <GroupedAccountPicker
        accounts={accounts}
        accountGroups={accountGroups}
        selectedId={disbursementAccountId}
        onSelect={setDisbursementAccountId}
        accent={accent}
      />
      </View>
      <QuickAddPickerItem kind="account" accent={accent} onCreated={(item) => setDisbursementAccountId(item.id)} />
      </View>

      {!isEdit && (
        <View style={styles.trackingCard}>
          <View style={styles.trackingTitleRow}>
            <View style={[styles.trackingIcon, { backgroundColor: accent + '18' }]}>
              <AppIcon name="calendar" size={18} color={accent} strokeWidth={2.2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.trackingTitle}>Loan tracking start</Text>
              <Text style={styles.trackingSubtitle}>Preview before the loan and past EMIs are recorded</Text>
            </View>
          </View>

          <View style={styles.trackingRow}>
            <Text style={styles.trackingLabel}>Account opening date</Text>
            <Text style={styles.trackingValue}>
              {selectedAccount?.openingBalanceDate
                ? formatChipDate(new Date(selectedAccount.openingBalanceDate))
                : 'Not set · all EMIs affect account'}
            </Text>
          </View>

          <Text style={styles.trackingFieldLabel}>Actual first EMI date</Text>
          <TouchableOpacity
            onPress={() => setShowFirstEmiDatePicker(true)}
            activeOpacity={0.7}
            style={styles.dateChip}
          >
            <Text style={styles.dateChipText}>{firstEmiDate ? formatChipDate(firstEmiDate) : 'Select date'}</Text>
            <Text style={styles.dateChipHint}>tap to change</Text>
          </TouchableOpacity>
          {showFirstEmiDatePicker && (
            <DateTimePicker
              value={firstEmiDate ?? disburseDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              minimumDate={disburseDate}
              onChange={handleFirstEmiDateChange}
            />
          )}

          {trackingPreview ? (
            <View style={styles.trackingSummary}>
              <View style={styles.trackingMetric}>
                <StatusBadge status="historical" />
                <Text style={styles.trackingMetricValue}>{trackingPreview.historical} EMI{trackingPreview.historical === 1 ? '' : 's'}</Text>
                <Text style={styles.trackingMetricHint}>Loan balance only</Text>
              </View>
              <View style={styles.trackingDivider} />
              <View style={styles.trackingMetric}>
                <Text style={styles.accountImpactLabel}>Affects account</Text>
                <Text style={styles.trackingMetricValue}>{trackingPreview.affectingAccount} EMI{trackingPreview.affectingAccount === 1 ? '' : 's'}</Text>
                <Text style={styles.trackingMetricHint}>Account and reports</Text>
              </View>
              <View style={styles.outstandingPreview}>
                <Text style={styles.outstandingLabel}>Estimated outstanding after {trackingPreview.total} paid EMI{trackingPreview.total === 1 ? '' : 's'}</Text>
                <Text style={[styles.outstandingValue, { color: accent }]}>{formatMoney(trackingPreview.outstanding)}</Text>
              </View>
            </View>
          ) : (
            <Text style={styles.trackingEmpty}>Enter principal and EMI details to calculate the tracking preview.</Text>
          )}
        </View>
      )}
      {direction === 'owed_by_me' && (
        <>
          <Text style={styles.label}>Send principal to this account?</Text>
          <View style={styles.chipRow}>
            <TouchableOpacity
              onPress={() => setCreditPrincipalToAccount(true)}
              activeOpacity={0.7}
              style={[
                styles.chip,
                creditPrincipalToAccount && { backgroundColor: accent, borderColor: accent },
              ]}
            >
              <Text style={[styles.chipText, creditPrincipalToAccount && styles.chipTextSelected]}>
                Yes, credit the principal
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setCreditPrincipalToAccount(false)}
              activeOpacity={0.7}
              style={[
                styles.chip,
                !creditPrincipalToAccount && { backgroundColor: accent, borderColor: accent },
              ]}
            >
              <Text style={[styles.chipText, !creditPrincipalToAccount && styles.chipTextSelected]}>
                No, keep it as loan-only
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>
            Turn this on only if the loan amount actually landed in this account. Leave it off for loans that were already spent, like some older gold loans.
          </Text>
          {principalCreditBlocked ? (
            <Text style={styles.creditWarning}>
              This loan date is before the account opening-balance date, so crediting it would count the money twice. Change the date/account or select loan-only.
            </Text>
          ) : null}
        </>
      )}
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
  creditWarning: { fontSize: 11, lineHeight: 16, color: c.accent.expense, marginTop: 7, fontWeight: '700' },

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

  trackingCard: {
    marginTop: 16, padding: 14, borderRadius: 14,
    backgroundColor: c.bg.surface, borderWidth: 1, borderColor: c.border.subtle,
  },
  trackingTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  trackingIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  trackingTitle: { color: c.text.primary, fontSize: 15, fontWeight: '800' },
  trackingSubtitle: { color: c.text.secondary, fontSize: 11, lineHeight: 15, marginTop: 2 },
  trackingRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.border.subtle },
  trackingLabel: { color: c.text.secondary, fontSize: 12, fontWeight: '600' },
  trackingValue: { color: c.text.primary, fontSize: 12, fontWeight: '800', textAlign: 'right' },
  trackingFieldLabel: { color: c.text.secondary, fontSize: 11, fontWeight: '800', marginTop: 4, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  trackingSummary: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: 1, borderTopColor: c.border.subtle, paddingTop: 12 },
  trackingMetric: { flex: 1, minWidth: 120, gap: 4 },
  trackingDivider: { width: 1, backgroundColor: c.border.subtle, marginHorizontal: 10 },
  trackingMetricValue: { color: c.text.primary, fontSize: 16, fontWeight: '900' },
  trackingMetricHint: { color: c.text.muted, fontSize: 10 },
  accountImpactLabel: { alignSelf: 'flex-start', color: c.accent.primary, backgroundColor: c.accent.primary + '18', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, fontSize: 11, fontWeight: '800' },
  outstandingPreview: { width: '100%', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.border.subtle, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  outstandingLabel: { flex: 1, color: c.text.secondary, fontSize: 11, lineHeight: 15 },
  outstandingValue: { fontSize: 19, fontWeight: '900' },
  trackingEmpty: { color: c.text.muted, fontSize: 11, lineHeight: 16, marginTop: 8 },

  buttonRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  submitBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center',
  },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  cancelBtn: { backgroundColor: c.bg.surfaceAlt },
  cancelBtnText: { color: c.text.secondary, fontWeight: '700', fontSize: 15 },
});
