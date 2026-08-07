// ----------------------------------------------------------------------------
// LoanDetailScreen — one loan, everything about it.
//
// Modes (from route params):
//   { mode: 'new' }             → create-mode. Shows LoanForm; on submit,
//                                 creates the loan and switches to view-mode.
//   { loanId: 'loan_xxx' }      → view-mode. Shows summary + timeline +
//                                 action buttons (Log EMI, Prepay, Close,
//                                 Edit, Delete).
//
// Layout (view mode):
//   ┌────────────────────────────────────────────┐
//   │ HERO  Outstanding ₹X                       │
//   │       ─────────  progress bar  ── 34%      │
//   │       Total paid ₹Y · Interest paid ₹Z     │
//   └────────────────────────────────────────────┘
//
//   ┌── DETAILS ──┐   principal · rate · tenure · EMI · method · date
//
//   ACTIONS: [Log EMI] [Prepay] [Edit] [Open in Calc] [Close] [Delete]
//
//   TIMELINE (reverse chronological event list — tap for details, hold for delete)
// ----------------------------------------------------------------------------

import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import DateTimePicker from '../components/DatePicker';
import LoanForm from '../components/LoanForm';
import AppIcon from '../components/AppIcon';
import HelpSheet from '../components/HelpSheet';
import { useLoans } from '../contexts/LoansContext';
import { useToast } from '../contexts/ToastContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import {
  LOAN_ADJUSTMENT_MODES,
  computePayoffPercent,
  computePayoffProjection,
  computeTotalInterestPaid,
  computeTotalPrincipalRepaid,
  formatDate,
  formatMoney,
  formatMoneyDetail,
  formatSchedule,
  kindIcon,
  kindLabel,
} from '../lib/loans';
import { radii, spacing } from '../lib/theme';

// Vector-icon meta for each ledger event kind. `icon` names refer to
// entries in components/AppIcon.js. `color` doubles as the event's
// left-bar tint and the icon fill on the timeline row.
const EVENT_META = {
  disburse:    { icon: 'download',         label: 'Disbursed',    color: '#0ea5e9' },
  emi:         { icon: 'upload',           label: 'EMI paid',     color: '#059669' },
  prepay:      { icon: 'zap',              label: 'Prepayment',   color: '#f59e0b' },
  rate_change: { icon: 'trending-up',      label: 'Rate changed', color: '#8b5cf6' },
  closure:     { icon: 'flag',             label: 'Closed',       color: '#6b7280' },
};

function buildPrepaymentPlan(loan) {
  const balance = Number(loan?.currentOutstanding) || 0;
  const emi = Number(loan?.emiAmount) || 0;
  const rate = Math.max(0, Number(loan?.ratePct) || 0) / 100 / 12;
  if (balance <= 0 || emi <= 0 || rate <= 0 || emi <= balance * rate) return null;

  const months = -Math.log(1 - (balance * rate) / emi) / Math.log(1 + rate);
  const targetAfterOneLessMonth = (emi * (1 - Math.pow(1 + rate, -(months - 1))) / rate);
  const oneMonthExtra = Math.max(0, balance - targetAfterOneLessMonth);

  let projectedBalance = balance;
  let projectedInterest = 0;
  let projectedExtra = 0;
  let projectedMonths = 0;
  const monthlyPlan = [];
  while (projectedBalance > 1 && projectedMonths < 600) {
    const interest = projectedBalance * rate;
    const principal = Math.min(emi - interest, projectedBalance);
    projectedBalance -= principal;
    projectedInterest += interest;
    const remaining = projectedBalance > 1
      ? -Math.log(1 - (projectedBalance * rate) / emi) / Math.log(1 + rate)
      : 0;
    const target = remaining > 1
      ? emi * (1 - Math.pow(1 + rate, -(remaining - 1))) / rate
      : 0;
    const extra = projectedBalance > 1
      ? Math.min(Math.max(0, projectedBalance - target), projectedBalance)
      : 0;
    monthlyPlan.push({ month: projectedMonths + 1, extra });
    projectedBalance -= extra;
    projectedExtra += extra;
    projectedMonths += 1;
  }
  const baselineInterest = Math.max(0, Math.ceil(months) * emi - balance);
  return {
    remainingMonths: Math.ceil(months),
    oneMonthExtra,
    projectedMonths,
    projectedExtra,
    interestSaved: Math.max(0, baselineInterest - projectedInterest),
    monthlyPlan,
  };
}

export default function LoanDetailScreen({ route, navigation }) {
  const styles = useThemedStyles(makeStyles);
  const {
    findLoan,
    addLoan,
    updateLoan,
    updateRate,
    fixLoanSetup,
    deleteLoan,
    logEmi,
    logPrepayment,
    closeLoan,
    deleteEvent,
  } = useLoans();
  const { showToast } = useToast();

  const initialMode = route?.params?.mode === 'new' ? 'new' : 'view';
  const [mode, setMode] = useState(initialMode);
  const [loanId, setLoanId] = useState(route?.params?.loanId ?? null);
  const loan = loanId ? findLoan(loanId) : null;

  const [emiModal, setEmiModal]           = useState(false);
  const [prepayModal, setPrepayModal]     = useState(false);
  const [plannedPrepayAmount, setPlannedPrepayAmount] = useState(null);
  const [rateModal, setRateModal]         = useState(false);
  const [editModal, setEditModal]         = useState(false);
  const [fixSetupModal, setFixSetupModal] = useState(false);

  // Sorted events computed HERE (before any early returns) so the number of
  // hooks called is stable across renders. Empty when the loan isn't found
  // or we're in create-mode; either way the view branches below just skip it.
  const sortedEvents = useMemo(
    () => (loan?.events ? [...loan.events].sort((a, b) => new Date(b.date) - new Date(a.date)) : []),
    [loan?.events],
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      title: mode === 'new' ? 'New loan' : (loan?.name ?? 'Loan'),
    });
  }, [navigation, mode, loan?.name]);

  const handleCreate = (values) => {
    const res = addLoan(values);
    if (!res.ok) {
      Alert.alert('Could not create loan', errorMessage(res.reason));
      return;
    }
    setLoanId(res.loan.id);
    setMode('view');
    showToast('Loan added', { variant: 'success', duration: 1500 });
  };

  const handleEditSubmit = (values) => {
    if (!loan) return;
    const res = updateLoan(loan.id, values);
    if (!res.ok) {
      Alert.alert('Could not update loan', errorMessage(res.reason));
      return;
    }
    setEditModal(false);
    showToast('Loan updated', { variant: 'success', duration: 1500 });
  };

  const handleFixSetupSubmit = ({ principal, ratePct, disburseDate }) => {
    if (!loan) return;
    const res = fixLoanSetup(loan.id, { principal, ratePct, disburseDate });
    if (!res.ok) {
      Alert.alert('Could not fix loan setup', errorMessage(res.reason));
      return;
    }
    setFixSetupModal(false);
    showToast('Loan setup corrected', { variant: 'success', duration: 1800 });
  };

  const handleDelete = () => {
    if (!loan) return;
    Alert.alert(
      `Delete "${loan.name}"?`,
      'Removes the loan, its ledger, and the linked liability. Cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteLoan(loan.id);
            navigation.goBack();
          },
        },
      ],
    );
  };

  const handleClose = () => {
    if (!loan) return;
    Alert.alert(
      `Close "${loan.name}"?`,
      'Marks the loan as closed and zeroes the linked liability. Use this if the loan was forgiven, refinanced, or fully paid off elsewhere.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close loan',
          style: 'destructive',
          onPress: () => {
            closeLoan(loan.id);
            showToast('Loan closed', { variant: 'success', duration: 1500 });
          },
        },
      ],
    );
  };

  // ---- CREATE MODE ----
  if (mode === 'new') {
    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <LoanForm
            submitLabel="Add loan"
            onSubmit={handleCreate}
            onCancel={() => navigation.goBack()}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ---- VIEW MODE — but loan not found (deleted from another surface) ----
  if (!loan) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.notFound}>
          <Text style={styles.notFoundTitle}>Loan not found</Text>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.notFoundBtn}>
            <Text style={styles.notFoundBtnText}>Back to loans</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ---- VIEW MODE ----
  const pct = computePayoffPercent(loan);
  const paid = computeTotalPrincipalRepaid(loan);
  const intPaid = computeTotalInterestPaid(loan);
  const barColor = loan.status === 'closed' ? '#9ca3af' : '#059669';
  const prepaymentPlan = loan.status !== 'closed' ? buildPrepaymentPlan(loan) : null;
  const estimatedEnd = loan.status !== 'closed' ? computePayoffProjection(loan) : null;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={styles.heroEmoji}>
              <AppIcon
                name={kindIcon(loan.kind)}
                size={24}
                color="#dc2626"
                strokeWidth={2}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroName}>{loan.name}</Text>
              <Text style={styles.heroSub}>
                {kindLabel(loan.kind)}
                {loan.lenderName ? `  ·  ${loan.lenderName}` : ''}
                {loan.status === 'closed' ? '  ·  CLOSED' : ''}
              </Text>
            </View>
          </View>
          <Text style={styles.heroOutstandingLabel}>OUTSTANDING</Text>
          <Text style={styles.heroOutstandingValue}>{formatMoney(loan.currentOutstanding)}</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: barColor }]} />
          </View>
          <View style={styles.heroStatRow}>
            <Text style={styles.heroStat}>
              {pct.toFixed(0)}% paid off
            </Text>
            <Text style={styles.heroStat}>
              Principal paid: {formatMoney(paid)}
            </Text>
            <Text style={styles.heroStat}>
              Interest paid: {formatMoney(intPaid)}
            </Text>
          </View>
        </View>

        {/* Details card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Details</Text>
          <DetailRow label="Principal" value={formatMoney(loan.principal)} />
          <DetailRow label="Current schedule" value={formatSchedule(loan) || '—'} />
          {estimatedEnd?.projectedClosureDate && estimatedEnd.remainingMonths != null && (
            <DetailRow
              label={estimatedEnd.includesPrepaymentPlan ? 'Estimated end with active monthly plan' : 'Estimated loan end'}
              value={`${estimatedEnd.projectedClosureDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })} · ~${estimatedEnd.remainingMonths} EMIs`}
            />
          )}
          <DetailRow label="Disbursed" value={formatDate(loan.disburseDate)} />
          <DetailRow label="EMI day" value={`${loan.emiDayOfMonth} of each month`} />
          {loan.direction && (
            <DetailRow
              label="Direction"
              value={loan.direction === 'owed_by_me' ? 'I owe (borrower)' : 'Owed to me (lender)'}
            />
          )}
          {loan.events?.some((e) => e.kind === 'rate_change') && (
            <Text style={styles.detailFootnote}>
              This loan has recorded rate changes. See the timeline below for the history.
            </Text>
          )}
        </View>

        {prepaymentPlan && (
          <View style={styles.card}>
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardTitle}>Prepayment planner</Text>
              <HelpSheet
                title="Monthly tenure plan"
                summary="This is a planning tool. It calculates the extra principal to pay after each EMI to reduce the remaining tenure by about one month."
                items={['Activate the plan to keep its forecast visible; it never makes a bank payment automatically.', 'After the EMI and top-up are actually paid, log them so the next month’s estimate reflects the new balance.', 'Choose “Keep EMI” with your lender so the payment reduces tenure.']}
              />
            </View>
            <DetailRow
              label="Extra principal to cut ~1 month now"
              value={formatMoney(prepaymentPlan.oneMonthExtra)}
            />
            <DetailRow
              label="Current estimated remaining tenure"
              value={`${prepaymentPlan.remainingMonths} months`}
            />
            <DetailRow
              label="If you recalculate after every EMI"
              value={`~${prepaymentPlan.projectedMonths} months remaining`}
            />
            <DetailRow
              label="Estimated interest saved with recurring plan"
              value={formatMoney(prepaymentPlan.interestSaved)}
            />
            <Text style={styles.plannerScheduleTitle}>NEXT MONTHLY TOP-UPS</Text>
            {prepaymentPlan.monthlyPlan.slice(0, 6).map((item) => (
              <View key={item.month} style={styles.plannerScheduleRow}>
                <Text style={styles.plannerScheduleLabel}>EMI {item.month}</Text>
                <Text style={styles.plannerScheduleValue}>+ {formatMoney(item.extra)}</Text>
              </View>
            ))}
            {!loan.prepaymentPlan?.enabled ? (
              <TouchableOpacity
                onPress={() => {
                  updateLoan(loan.id, {
                    prepaymentPlan: {
                      enabled: true,
                      targetMonthsPerEmi: 1,
                      startedAt: new Date().toISOString(),
                    },
                  });
                  showToast('Monthly tenure plan activated', { variant: 'success', duration: 1800 });
                }}
                style={styles.plannerBtn}
                activeOpacity={0.8}
              >
                <Text style={styles.plannerBtnText}>Activate monthly tenure plan</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.plannerActions}>
                <TouchableOpacity
                  onPress={() => {
                    setPlannedPrepayAmount(prepaymentPlan.oneMonthExtra);
                    setPrepayModal(true);
                  }}
                  style={styles.plannerBtn}
                  activeOpacity={0.8}
                >
                  <Text style={styles.plannerBtnText}>Log this month’s planned top-up</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    updateLoan(loan.id, { prepaymentPlan: { enabled: false } });
                    showToast('Monthly tenure plan paused', { variant: 'default', duration: 1800 });
                  }}
                  style={styles.plannerPauseBtn}
                  activeOpacity={0.8}
                >
                  <Text style={styles.plannerPauseText}>Pause plan</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* Actions */}
        {loan.status !== 'closed' && (
          <>
            <View style={styles.actionsRow}>
              <ActionBtn label="Log EMI"     icon="upload"       onPress={() => setEmiModal(true)} />
              <ActionBtn
                label="Prepay"
                icon="zap"
                onPress={() => {
                  setPlannedPrepayAmount(null);
                  setPrepayModal(true);
                }}
              />
              <ActionBtn label="Update rate" icon="trending-up"  onPress={() => setRateModal(true)} />
            </View>
            <View style={styles.actionsRow}>
              <ActionBtn label="Edit"        icon="edit-3"       onPress={() => setEditModal(true)} />
              <ActionBtn
                label="Open in Calc"
                icon="calculator"
                onPress={() =>
                  navigation.navigate('EMICalculator', {
                    loanSeed: buildCalcSeed(loan),
                  })
                }
              />
              <ActionBtn label="Close"    icon="flag" onPress={handleClose} />
            </View>
          </>
        )}
        <View style={styles.actionsRow}>
          {loan.status === 'closed' && (
            <ActionBtn
              label="Open in Calc"
              icon="calculator"
              onPress={() =>
                navigation.navigate('EMICalculator', {
                  loanSeed: buildCalcSeed(loan),
                })
              }
            />
          )}
          <ActionBtn label="Delete" icon="trash-2" onPress={handleDelete} danger />
        </View>

        {/* Timeline */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Timeline ({sortedEvents.length} events)</Text>
          {sortedEvents.map((evt) => (
            <EventRow
              key={evt.id}
              event={evt}
              onDelete={() => {
                Alert.alert(
                  'Delete this event?',
                  'This is only for correcting mistakes. Balances will be recomputed.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete event',
                      style: 'destructive',
                      onPress: () => {
                        const res = deleteEvent(loan.id, evt.id);
                        if (!res.ok) {
                          Alert.alert('Cannot delete', errorMessage(res.reason));
                        }
                      },
                    },
                  ],
                );
              }}
            />
          ))}
        </View>
      </ScrollView>

      {/* Log EMI modal */}
      <AmountModal
        visible={emiModal}
        title="Log EMI paid"
        submitLabel="Save EMI"
        accent="#059669"
        placeholder={loan.emiAmount ? String(Math.round(loan.emiAmount)) : ''}
        onClose={() => setEmiModal(false)}
        onSubmit={({ amount, date, note }) => {
          const res = logEmi(loan.id, { amount, date, note });
          if (!res.ok) {
            Alert.alert('Could not log EMI', errorMessage(res.reason));
            return;
          }
          setEmiModal(false);
          showToast('EMI recorded', { variant: 'success', duration: 1500 });
        }}
      />

      {/* Prepay modal — extra chip picks what the bank does with the freed
          balance (shorten tenure vs reduce EMI). Passed through to the
          ledger so the timeline + future EMIs reflect the choice. */}
      <PrepayModal
        visible={prepayModal}
        maxAmount={loan.currentOutstanding}
        defaultEmi={loan.emiAmount}
        initialAmount={plannedPrepayAmount}
        onClose={() => {
          setPlannedPrepayAmount(null);
          setPrepayModal(false);
        }}
        onSubmit={({ amount, date, note, adjustmentMode }) => {
          const res = logPrepayment(loan.id, { amount, date, note, adjustmentMode });
          if (!res.ok) {
            Alert.alert('Could not log prepayment', errorMessage(res.reason));
            return;
          }
          setPlannedPrepayAmount(null);
          setPrepayModal(false);
          showToast('Prepayment recorded', { variant: 'success', duration: 1500 });
        }}
      />

      {/* Rate change modal — records a rate_change event on the ledger and
          recomputes either EMI (keep_tenure) or tenure (keep_emi). */}
      <RateChangeModal
        visible={rateModal}
        currentRate={loan.ratePct}
        currentEmi={loan.emiAmount}
        currentTenure={loan.tenureMonths}
        onClose={() => setRateModal(false)}
        onSubmit={({ newRatePct, effectiveDate, adjustmentMode, note }) => {
          const res = updateRate(loan.id, {
            newRatePct, effectiveDate, adjustmentMode, note,
          });
          if (!res.ok) {
            Alert.alert('Could not update rate', errorMessage(res.reason));
            return;
          }
          setRateModal(false);
          showToast('Rate updated', { variant: 'success', duration: 1500 });
        }}
      />

      {/* Edit modal */}
      <Modal visible={editModal} transparent animationType="slide" onRequestClose={() => setEditModal(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setEditModal(false)} />
          <SafeAreaView style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit loan</Text>
              <TouchableOpacity onPress={() => setEditModal(false)}>
                <Text style={styles.modalClose}>Done</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: spacing.xl }} keyboardShouldPersistTaps="handled">
              {/* Escape hatch for setup typos. Deliberately styled as a
                  distinct warning card (not a normal button) so it's hard
                  to trigger by accident. Clicking closes Edit and opens
                  the dedicated FixSetupModal, which carries its own
                  confirmation flow. */}
              <TouchableOpacity
                onPress={() => { setEditModal(false); setFixSetupModal(true); }}
                activeOpacity={0.75}
                style={styles.fixSetupLink}
              >
                <View style={styles.fixSetupLinkTitleRow}>
                  <AppIcon name="wrench" size={14} color="#1e3a8a" strokeWidth={2.1} />
                  <Text style={styles.fixSetupLinkTitle}>Wrong principal, rate, or date?</Text>
                </View>
                <Text style={styles.fixSetupLinkSub}>
                  Fix a setup typo · rewrites the ledger anchor
                </Text>
              </TouchableOpacity>

              <LoanForm
                initialValues={loan}
                submitLabel="Save changes"
                onSubmit={handleEditSubmit}
                onCancel={() => setEditModal(false)}
                isEdit
              />
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>

      {/* Fix Setup modal — the "typo escape hatch" for the three ledger-
          anchor fields (principal, initial rate, disburse date). Separate
          from Edit because the semantics differ dramatically: this rewrites
          history rather than adding new events. Extra confirm step if the
          loan already has post-disburse activity. */}
      <FixSetupModal
        visible={fixSetupModal}
        loan={loan}
        onClose={() => setFixSetupModal(false)}
        onSubmit={handleFixSetupSubmit}
      />
    </SafeAreaView>
  );
}

// ---- small building blocks ----

function DetailRow({ label, value }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function ActionBtn({ label, icon, onPress, danger }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const tint = danger ? '#dc2626' : themeColors.text.primary;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.actionBtn, danger && styles.actionBtnDanger]}
    >
      <View style={styles.actionIconWrap}>
        <AppIcon name={icon} size={18} color={tint} strokeWidth={2.1} />
      </View>
      <Text style={[styles.actionLabel, danger && styles.actionLabelDanger]}>{label}</Text>
    </TouchableOpacity>
  );
}

function EventRow({ event, onDelete }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const meta = EVENT_META[event.kind] ?? EVENT_META.emi;
  return (
    <View style={styles.eventRow}>
      <View style={[styles.eventBar, { backgroundColor: meta.color }]} />
      <View style={{ flex: 1 }}>
        <View style={styles.eventLineRow}>
          <AppIcon name={meta.icon} size={14} color={meta.color} strokeWidth={2.2} />
          <Text style={styles.eventLine}>
            {meta.label} · {formatDate(event.date)}
          </Text>
        </View>
        {event.amount > 0 && (
          <Text style={styles.eventSub}>
            {formatMoneyDetail(event.amount)}
            {event.principal > 0 && event.interest > 0 && (
              <Text style={styles.eventSubMuted}>
                {'  ·  '}
                Principal {formatMoney(event.principal)}, Interest {formatMoney(event.interest)}
              </Text>
            )}
          </Text>
        )}

        {/* Rate change payload — old → new + adjustment summary */}
        {event.kind === 'rate_change' && (
          <>
            <Text style={styles.eventSub}>
              {Number(event.oldRatePct).toFixed(2)}% → {Number(event.newRatePct).toFixed(2)}%
              {'  ·  outstanding at change: '}
              {formatMoney(event.outstandingAtChange)}
            </Text>
            <Text style={styles.eventSubMuted}>
              {adjustmentSummary(event)}
              {event.approximated ? '  ·  approximated (flat rate)' : ''}
            </Text>
          </>
        )}

        {/* Adjusted-prepay payload — show the effect on EMI or tenure */}
        {event.kind === 'prepay' && event.adjustmentMode && (
          <Text style={styles.eventSubMuted}>
            {adjustmentSummary(event)}
          </Text>
        )}

        {event.note ? <Text style={styles.eventNote}>{event.note}</Text> : null}
      </View>
      {event.kind !== 'disburse' && (
        <TouchableOpacity onPress={onDelete} hitSlop={12} style={styles.eventDelete}>
          <AppIcon name="x" size={14} color={themeColors.text.secondary} strokeWidth={2.4} />
        </TouchableOpacity>
      )}
    </View>
  );
}

// Human sentence for the adjustment side-effect on a rate_change or
// adjusted-prepay event. E.g. "EMI unchanged — tenure 180 → 194 mos"
// or "Tenure unchanged — EMI ₹21,500 → ₹22,830".
function adjustmentSummary(event) {
  const mode = event.adjustmentMode;
  if (mode === 'keep_emi') {
    const oldT = Number(event.oldTenureRemaining) || 0;
    const newT = Number(event.newTenureRemaining) || 0;
    if (oldT === newT) return 'EMI unchanged';
    return `EMI unchanged  ·  tenure ${oldT} → ${newT} mos`;
  }
  if (mode === 'keep_tenure') {
    const oldE = Math.round(Number(event.oldEmi) || 0);
    const newE = Math.round(Number(event.newEmi) || 0);
    if (oldE === newE) return 'Tenure unchanged';
    return `Tenure unchanged  ·  EMI ${formatMoney(oldE)} → ${formatMoney(newE)}`;
  }
  return '';
}

// Reusable amount + date + note modal used for both Log EMI and Prepay.
function AmountModal({
  visible, title, submitLabel, accent, placeholder, maxAmount, onSubmit, onClose,
}) {
  const styles = useThemedStyles(makeStyles);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date());
  const [note, setNote] = useState('');
  const [showPicker, setShowPicker] = useState(false);

  // Reset the form when the modal opens so stale values don't leak between
  // invocations. useEffect (not useMemo) because these are side effects —
  // calling setState during render is illegal.
  useEffect(() => {
    if (visible) {
      setAmount('');
      setDate(new Date());
      setNote('');
    }
  }, [visible]);

  const handleSubmit = () => {
    const amt = Number(amount);
    if (!isFinite(amt) || amt <= 0) {
      Alert.alert('Invalid amount', 'Enter a positive amount.');
      return;
    }
    if (maxAmount != null && amt > maxAmount + 1e-6) {
      Alert.alert('Too much', `Amount can't exceed the current outstanding of ${formatMoney(maxAmount)}.`);
      return;
    }
    onSubmit({ amount: amt, date: date.toISOString(), note });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.modalClose}>Cancel</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.xl }} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalLabel}>Amount</Text>
            <TextInput
              style={styles.modalInput}
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
              placeholder={placeholder || 'e.g. 21500'}
              placeholderTextColor="#9ca3af"
              autoFocus
            />
            {maxAmount != null && (
              <Text style={styles.modalHint}>
                Max: {formatMoney(maxAmount)} (current outstanding)
              </Text>
            )}

            <Text style={styles.modalLabel}>Date</Text>
            <TouchableOpacity onPress={() => setShowPicker(true)} style={styles.modalDateBtn}>
              <Text style={styles.modalDateText}>{formatDate(date.toISOString())}</Text>
              <Text style={styles.modalHint}>tap to change</Text>
            </TouchableOpacity>
            {showPicker && (
              <DateTimePicker
                value={date}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(evt, selected) => {
                  if (Platform.OS !== 'ios') setShowPicker(false);
                  if (evt?.type === 'dismissed') return;
                  if (selected) setDate(selected);
                }}
              />
            )}

            <Text style={styles.modalLabel}>Note (optional)</Text>
            <TextInput
              style={styles.modalInput}
              value={note}
              onChangeText={setNote}
              placeholder='e.g. via NEFT'
              placeholderTextColor="#9ca3af"
            />

            <TouchableOpacity
              onPress={handleSubmit}
              activeOpacity={0.8}
              style={[styles.modalSubmit, { backgroundColor: accent }]}
            >
              <Text style={styles.modalSubmitText}>{submitLabel}</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

// Prepay modal — same body as AmountModal but with an adjustmentMode chip
// row so the user records whether the bank shortens tenure or reduces EMI.
function PrepayModal({ visible, maxAmount, defaultEmi, initialAmount, onSubmit, onClose }) {
  const styles = useThemedStyles(makeStyles);
  const [amount, setAmount] = useState('');
  const [date, setDate]     = useState(new Date());
  const [note, setNote]     = useState('');
  const [adjustmentMode, setAdjustmentMode] = useState('keep_emi');
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    if (visible) {
      setAmount(initialAmount ? String(Math.round(initialAmount)) : '');
      setDate(new Date());
      setNote(initialAmount ? 'Monthly tenure-reduction plan' : '');
      setAdjustmentMode('keep_emi'); // default matches most retail lender behaviour
    }
  }, [visible, initialAmount]);

  const handleSubmit = () => {
    const amt = Number(amount);
    if (!isFinite(amt) || amt <= 0) {
      Alert.alert('Invalid amount', 'Enter a positive amount.');
      return;
    }
    if (maxAmount != null && amt > maxAmount + 1e-6) {
      Alert.alert('Too much', `Amount can't exceed the current outstanding of ${formatMoney(maxAmount)}.`);
      return;
    }
    onSubmit({ amount: amt, date: date.toISOString(), note, adjustmentMode });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Log prepayment</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.modalClose}>Cancel</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.xl }} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalLabel}>Amount</Text>
            <TextInput
              style={styles.modalInput}
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
              placeholder='e.g. 100000'
              placeholderTextColor="#9ca3af"
              autoFocus
            />
            {maxAmount != null && (
              <Text style={styles.modalHint}>
                Max: {formatMoney(maxAmount)} (current outstanding)
              </Text>
            )}

            <Text style={styles.modalLabel}>What did the bank do with the freed balance?</Text>
            <View style={styles.chipRow}>
              {LOAN_ADJUSTMENT_MODES.map((m) => {
                const selected = m.id === adjustmentMode;
                return (
                  <TouchableOpacity
                    key={m.id}
                    onPress={() => setAdjustmentMode(m.id)}
                    activeOpacity={0.7}
                    style={[
                      styles.chip,
                      selected && { backgroundColor: '#f59e0b', borderColor: '#f59e0b' },
                    ]}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {m.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.modalHint}>
              {adjustmentMode === 'keep_emi'
                ? `EMI stays at ${formatMoney(defaultEmi)} — tenure shortens.`
                : 'Tenure stays the same — EMI reduces.'}
            </Text>

            <Text style={styles.modalLabel}>Date</Text>
            <TouchableOpacity onPress={() => setShowPicker(true)} style={styles.modalDateBtn}>
              <Text style={styles.modalDateText}>{formatDate(date.toISOString())}</Text>
              <Text style={styles.modalHint}>tap to change</Text>
            </TouchableOpacity>
            {showPicker && (
              <DateTimePicker
                value={date}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(evt, selected) => {
                  if (Platform.OS !== 'ios') setShowPicker(false);
                  if (evt?.type === 'dismissed') return;
                  if (selected) setDate(selected);
                }}
              />
            )}

            <Text style={styles.modalLabel}>Note (optional)</Text>
            <TextInput
              style={styles.modalInput}
              value={note}
              onChangeText={setNote}
              placeholder='e.g. bonus'
              placeholderTextColor="#9ca3af"
            />

            <TouchableOpacity
              onPress={handleSubmit}
              activeOpacity={0.8}
              style={[styles.modalSubmit, { backgroundColor: '#f59e0b' }]}
            >
              <Text style={styles.modalSubmitText}>Save prepayment</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

// RateChangeModal — new rate + effective date + adjustmentMode chip. Also
// shows a live preview of the resulting EMI / tenure so the user can see
// what they're committing before saving.
function RateChangeModal({
  visible, currentRate, currentEmi, currentTenure, onSubmit, onClose,
}) {
  const styles = useThemedStyles(makeStyles);
  const [newRateStr, setNewRateStr] = useState('');
  const [date, setDate]             = useState(new Date());
  const [note, setNote]             = useState('');
  const [adjustmentMode, setAdjustmentMode] = useState('keep_tenure');
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    if (visible) {
      setNewRateStr(currentRate != null ? String(currentRate) : '');
      setDate(new Date());
      setNote('');
      setAdjustmentMode('keep_tenure'); // banks usually change EMI, not tenure
    }
  }, [visible, currentRate]);

  const rateNumber = Number(newRateStr);
  const rateChanged = isFinite(rateNumber) && rateNumber !== Number(currentRate);
  const direction = rateChanged
    ? (rateNumber > Number(currentRate) ? 'up' : 'down')
    : null;

  const handleSubmit = () => {
    if (!isFinite(rateNumber) || rateNumber < 0) {
      Alert.alert('Invalid rate', 'Enter a non-negative percentage.');
      return;
    }
    if (!rateChanged) {
      Alert.alert('No change', 'The new rate matches the current rate.');
      return;
    }
    onSubmit({
      newRatePct: rateNumber,
      effectiveDate: date.toISOString(),
      adjustmentMode,
      note,
    });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Update interest rate</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.modalClose}>Cancel</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.xl }} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalHint}>
              Current rate: {currentRate != null ? `${Number(currentRate).toFixed(2)}% p.a.` : '—'}
              {'  ·  '}
              EMI {formatMoney(currentEmi)}
              {'  ·  '}
              {currentTenure} mos remaining
            </Text>

            <Text style={styles.modalLabel}>New rate (% p.a.)</Text>
            <TextInput
              style={styles.modalInput}
              value={newRateStr}
              onChangeText={setNewRateStr}
              keyboardType="numeric"
              placeholder='e.g. 9.25'
              placeholderTextColor="#9ca3af"
              autoFocus
            />
            {direction && (
              <Text style={styles.modalHint}>
                Rate {direction === 'up' ? '↑ increased' : '↓ decreased'} by{' '}
                {Math.abs(rateNumber - Number(currentRate)).toFixed(2)}%
              </Text>
            )}

            <Text style={styles.modalLabel}>What did the bank keep constant?</Text>
            <View style={styles.chipRow}>
              {LOAN_ADJUSTMENT_MODES.map((m) => {
                const selected = m.id === adjustmentMode;
                return (
                  <TouchableOpacity
                    key={m.id}
                    onPress={() => setAdjustmentMode(m.id)}
                    activeOpacity={0.7}
                    style={[
                      styles.chip,
                      selected && { backgroundColor: '#8b5cf6', borderColor: '#8b5cf6' },
                    ]}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {m.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.modalHint}>
              {adjustmentMode === 'keep_emi'
                ? `EMI stays at ${formatMoney(currentEmi)} — tenure will ${direction === 'up' ? 'extend' : (direction === 'down' ? 'shorten' : 'change')}.`
                : `Tenure stays at ${currentTenure} months — EMI will ${direction === 'up' ? 'increase' : (direction === 'down' ? 'decrease' : 'change')}.`}
            </Text>

            <Text style={styles.modalLabel}>Effective from</Text>
            <TouchableOpacity onPress={() => setShowPicker(true)} style={styles.modalDateBtn}>
              <Text style={styles.modalDateText}>{formatDate(date.toISOString())}</Text>
              <Text style={styles.modalHint}>tap to change</Text>
            </TouchableOpacity>
            {showPicker && (
              <DateTimePicker
                value={date}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(evt, selected) => {
                  if (Platform.OS !== 'ios') setShowPicker(false);
                  if (evt?.type === 'dismissed') return;
                  if (selected) setDate(selected);
                }}
              />
            )}

            <Text style={styles.modalLabel}>Note (optional)</Text>
            <TextInput
              style={styles.modalInput}
              value={note}
              onChangeText={setNote}
              placeholder='e.g. RBI repo rate hike'
              placeholderTextColor="#9ca3af"
            />

            <TouchableOpacity
              onPress={handleSubmit}
              activeOpacity={0.8}
              style={[styles.modalSubmit, { backgroundColor: '#8b5cf6' }]}
            >
              <Text style={styles.modalSubmitText}>Save rate change</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

// FixSetupModal — the "typo escape hatch". Lets the user overwrite the
// three ledger-anchor fields (principal, initial rate, disburse date) that
// are locked in normal Edit. Not a normal flow — reserved for correcting
// data-entry mistakes made when the loan was first created.
//
// UX beats:
//   * Always shows a warning banner explaining what this does.
//   * If the loan already has non-disburse events (EMIs, prepays, rate
//     changes), shows a stronger banner + event count, and warns that the
//     current outstanding will be recomputed from those events against the
//     corrected initial terms.
//   * Requires an extra confirm tap ("Yes, correct the setup") before we
//     actually dispatch — because the earlier "big red button" pattern gets
//     tapped-through too easily.
function FixSetupModal({ visible, loan, onClose, onSubmit }) {
  const styles = useThemedStyles(makeStyles);
  const [principal, setPrincipal] = useState('');
  const [ratePct, setRatePct]     = useState('');
  const [date, setDate]           = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);

  // Prime the inputs from the loan's current values every time the modal
  // opens. useEffect (not useMemo) — this is a side effect on `visible`.
  useEffect(() => {
    if (visible && loan) {
      // The INITIAL rate lives on the disburse event; if it's missing (very
      // old loans created before we started snapshotting) fall back to the
      // loan's top-level ratePct.
      const disbEvt = loan.events?.find((e) => e.kind === 'disburse');
      const initRate = disbEvt?.initialRatePct != null ? disbEvt.initialRatePct : loan.ratePct;
      setPrincipal(String(loan.principal ?? ''));
      setRatePct(String(initRate ?? ''));
      setDate(loan.disburseDate ? new Date(loan.disburseDate) : new Date());
    }
  }, [visible, loan]);

  if (!loan) return null;

  const nonDisburseEvents = (loan.events ?? []).filter((e) => e.kind !== 'disburse');
  const hasHistory        = nonDisburseEvents.length > 0;
  const hasRateChange     = nonDisburseEvents.some((e) => e.kind === 'rate_change');

  const handleSubmit = () => {
    const P = Number(principal);
    if (!isFinite(P) || P <= 0) {
      Alert.alert('Invalid principal', 'Enter a positive amount.');
      return;
    }
    const R = Number(ratePct);
    if (!isFinite(R) || R < 0) {
      Alert.alert('Invalid rate', 'Enter a non-negative percentage.');
      return;
    }
    const iso = date.toISOString();

    // Confirm step scales with blast radius: benign for a brand-new loan,
    // scary for one with a full ledger.
    const confirmTitle = 'Correct the loan setup?';
    const confirmBody = hasHistory
      ? `This loan has ${nonDisburseEvents.length} recorded event${nonDisburseEvents.length === 1 ? '' : 's'}. `
        + `The current outstanding will be recomputed from those events against the new initial terms. `
        + (hasRateChange
            ? 'The current rate (after your rate change) will be preserved. '
            : '')
        + 'Continue?'
      : 'The loan will be updated in place with no other side effects.';

    Alert.alert(confirmTitle, confirmBody, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: hasHistory ? 'Yes, correct the setup' : 'Correct',
        style: hasHistory ? 'destructive' : 'default',
        onPress: () => onSubmit({ principal: P, ratePct: R, disburseDate: iso }),
      },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Fix loan setup</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.modalClose}>Cancel</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.xl }} keyboardShouldPersistTaps="handled">
            {/* Always-on warning — makes the semantic difference from Edit
                explicit. Amber not red because this is legitimate for
                typo correction; the destructive step comes at confirm. */}
            <View style={styles.fixWarnBanner}>
              <Text style={styles.fixWarnTitle}>Correcting a data-entry mistake?</Text>
              <Text style={styles.fixWarnBody}>
                This rewrites the loan's original terms — principal, initial rate,
                and disburse date. Use it ONLY to correct typos from when the loan
                was created.{'\n\n'}
                For real events (rate hike, prepayment, EMI paid), use the buttons
                on the loan screen instead — those preserve the audit trail.
              </Text>
            </View>

            {hasHistory && (
              <View style={styles.fixWarnBannerStrong}>
                <View style={styles.fixWarnTitleRow}>
                  <AppIcon name="alert-triangle" size={14} color="#7f1d1d" strokeWidth={2.2} />
                  <Text style={styles.fixWarnTitleStrong}>
                    This loan has {nonDisburseEvents.length} recorded event
                    {nonDisburseEvents.length === 1 ? '' : 's'}
                  </Text>
                </View>
                <Text style={styles.fixWarnBody}>
                  {hasRateChange
                    ? 'The current rate (after your rate-change history) will be preserved. Only the initial rate on the disburse anchor is overwritten.'
                    : 'The current outstanding will be re-derived from every past EMI / prepayment against the new initial terms.'}
                </Text>
              </View>
            )}

            <Text style={styles.modalLabel}>Principal (as originally disbursed)</Text>
            <TextInput
              style={styles.modalInput}
              value={principal}
              onChangeText={setPrincipal}
              keyboardType="numeric"
              placeholder='e.g. 2500000'
              placeholderTextColor="#9ca3af"
            />

            <Text style={styles.modalLabel}>Initial interest rate (% p.a.)</Text>
            <TextInput
              style={styles.modalInput}
              value={ratePct}
              onChangeText={setRatePct}
              keyboardType="numeric"
              placeholder='e.g. 8.35'
              placeholderTextColor="#9ca3af"
            />
            {hasRateChange && (
              <Text style={styles.modalHint}>
                Your rate-change history is kept. This only fixes the STARTING rate.
              </Text>
            )}

            <Text style={styles.modalLabel}>Disburse date</Text>
            <TouchableOpacity onPress={() => setShowPicker(true)} style={styles.modalDateBtn}>
              <Text style={styles.modalDateText}>{formatDate(date.toISOString())}</Text>
              <Text style={styles.modalHint}>tap to change</Text>
            </TouchableOpacity>
            {showPicker && (
              <DateTimePicker
                value={date}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(evt, selected) => {
                  if (Platform.OS !== 'ios') setShowPicker(false);
                  if (evt?.type === 'dismissed') return;
                  if (selected) setDate(selected);
                }}
              />
            )}
            {hasHistory && (
              <Text style={styles.modalHint}>
                Must be on or before your earliest EMI / prepayment / rate change.
              </Text>
            )}

            <TouchableOpacity
              onPress={handleSubmit}
              activeOpacity={0.8}
              style={[styles.modalSubmit, { backgroundColor: '#dc2626' }]}
            >
              <Text style={styles.modalSubmitText}>Apply correction</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

// Shape the "Open in Calc" payload. We pass the loan's CURRENT outstanding
// (not the original principal) + current remaining tenure + current rate,
// so the calculator's forward-looking analyses (prepay, rate change what-if,
// balance transfer) start from where the loan actually is today. Loans that
// have had rate changes / prepayments are analyzed as a fresh loan-from-now
// with the current terms — reconstructing the full historical amortization
// inside the calc is out of scope for MVP.
function buildCalcSeed(loan) {
  const outstanding = Number(loan.currentOutstanding) || 0;
  // For closed loans, fall back to the original principal so the user can
  // still explore "what would this have looked like" scenarios.
  const amount = outstanding > 0 ? outstanding : Number(loan.principal) || 0;
  return {
    loanId:       loan.id,
    loanName:     loan.name,
    loanKind:     loan.kind,
    isFromClosed: outstanding <= 0,
    amount,
    ratePct:      loan.ratePct,
    tenureMonths: loan.tenureMonths,
    method:       loan.method,
    // Diagnostic-only extras (currently unused by the calc but preserved
    // in case a later "history" section wants them):
    originalPrincipal: loan.principal,
    disburseDate:      loan.disburseDate,
  };
}

function errorMessage(reason) {
  return {
    invalid_amount:      'Enter a positive amount.',
    invalid_principal:   'Principal must be positive.',
    invalid_name:        'Give the loan a name.',
    invalid_rate:        'Enter a valid non-negative rate.',
    invalid_date:        'The disburse date must be on or before every recorded EMI / prepayment / rate-change event.',
    loan_already_closed: 'This loan is already closed.',
    over_prepay:         'Prepayment exceeds the current outstanding.',
    not_found:           'Loan not found.',
    event_not_found:     'Event not found.',
    cannot_delete_disburse: 'You cannot delete the initial disbursement event.',
  }[reason] ?? 'Something went wrong.';
}

const makeStyles = (c) => ({
  screen: { flex: 1, backgroundColor: c.bg.canvas },
  container: { padding: spacing.xl, paddingBottom: 40 },

  hero: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    padding: spacing.xl,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  heroEmoji: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#fee2e2',
    alignItems: 'center', justifyContent: 'center',
    marginRight: spacing.md,
  },
  heroName: { fontSize: 18, fontWeight: '700', color: c.text.primary },
  heroSub: { fontSize: 12, color: c.text.secondary, marginTop: 2 },
  heroOutstandingLabel: { fontSize: 10, fontWeight: '700', color: c.text.muted, letterSpacing: 0.6 },
  heroOutstandingValue: { fontSize: 28, fontWeight: '800', color: c.text.primary, marginTop: 2 },
  progressTrack: {
    marginTop: spacing.md, height: 8, backgroundColor: c.bg.surfaceAlt,
    borderRadius: 4, overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 4 },
  heroStatRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md,
    marginTop: spacing.md,
  },
  heroStat: { fontSize: 12, color: c.text.secondary },

  card: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    padding: spacing.xl,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  cardTitle: {
    fontSize: 12, fontWeight: '700', color: c.text.muted,
    letterSpacing: 0.5, marginBottom: spacing.sm,
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center' },
  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start',   // long values wrap without pushing the label
    paddingVertical: 6,
    gap: spacing.md,            // guarantee breathing room between label + value
  },
  // Label sits on the left at its natural width — no shrinking or
  // wrapping, so short labels like "Principal" stay one line.
  detailLabel: {
    fontSize: 13,
    color: c.text.secondary,
    flexShrink: 0,
  },
  // Value takes whatever's left and right-aligns. Without flex + text-
  // align:right, a long value like the "Current schedule" string
  // ("₹34,713 / month · reducing · 8.00% p.a. · 240 months") overflows
  // its cell and misaligns with adjacent rows.
  detailValue: {
    fontSize: 13,
    color: c.text.primary,
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
  },
  detailFootnote: { fontSize: 11, color: c.text.muted, marginTop: 6, fontStyle: 'italic' },
  plannerBtn: {
    marginTop: 14,
    alignItems: 'center',
    paddingVertical: 11,
    borderRadius: radii.md,
    backgroundColor: '#f59e0b',
  },
  plannerBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  plannerActions: { marginTop: 14, gap: 10 },
  plannerPauseBtn: { alignItems: 'center', paddingVertical: 5 },
  plannerPauseText: { color: c.text.secondary, fontSize: 12, fontWeight: '700' },
  plannerScheduleTitle: {
    marginTop: 16,
    marginBottom: 2,
    color: c.text.muted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  plannerScheduleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border.subtle,
  },
  plannerScheduleLabel: { color: c.text.secondary, fontSize: 12, fontWeight: '600' },
  plannerScheduleValue: { color: '#d97706', fontSize: 13, fontWeight: '800' },

  actionsRow: {
    flexDirection: 'row', gap: 8, marginBottom: spacing.md,
    flexWrap: 'wrap',
  },
  actionBtn: {
    flex: 1, minWidth: 90,
    backgroundColor: c.bg.surface,
    borderRadius: radii.lg, borderWidth: 1, borderColor: c.border.subtle,
    paddingVertical: spacing.md, alignItems: 'center',
  },
  actionBtnDanger: { backgroundColor: '#fef2f2', borderColor: '#fecaca' },
  actionIconWrap: { marginBottom: 2 },
  actionLabel: { fontSize: 12, fontWeight: '700', color: c.text.primary, marginTop: 4 },
  actionLabelDanger: { color: '#dc2626' },

  eventRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingVertical: spacing.sm, gap: spacing.sm,
    borderTopWidth: 1, borderTopColor: c.border.subtle,
  },
  eventBar: { width: 3, alignSelf: 'stretch', borderRadius: 2, marginTop: 4 },
  eventLineRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  eventLine: { fontSize: 13, fontWeight: '600', color: c.text.primary, flexShrink: 1 },
  eventSub: { fontSize: 12, color: c.text.secondary, marginTop: 2 },
  eventSubMuted: { color: c.text.muted, fontWeight: '400' },
  eventNote: { fontSize: 11, color: c.text.muted, marginTop: 2, fontStyle: 'italic' },
  eventDelete: { paddingHorizontal: spacing.sm },

  notFound: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  notFoundTitle: { fontSize: 16, fontWeight: '700', color: c.text.primary },
  notFoundBtn: { marginTop: spacing.md, padding: spacing.md },
  notFoundBtnText: { color: '#2563eb', fontWeight: '700' },

  // Modal shell — mirrors TransfersScreen's edit modal for consistency.
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalSheet: {
    backgroundColor: c.bg.surface,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '92%', overflow: 'hidden',
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: c.border.strong, alignSelf: 'center', marginTop: 8,
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: c.border.subtle,
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: c.text.primary },
  modalClose: { color: '#2563eb', fontWeight: '700', fontSize: 14 },
  modalLabel: {
    fontSize: 12, fontWeight: '600', color: c.text.secondary,
    marginTop: 14, marginBottom: 6,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  modalInput: {
    backgroundColor: c.bg.surfaceAlt, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, color: c.text.primary,
    borderWidth: 1, borderColor: c.border.subtle,
  },
  modalHint: { fontSize: 11, color: c.text.secondary, marginTop: 4, fontStyle: 'italic' },
  modalDateBtn: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: c.bg.surfaceAlt, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: c.border.subtle,
  },
  modalDateText: { fontSize: 15, fontWeight: '600', color: c.text.primary },
  modalSubmit: {
    marginTop: spacing.xl, paddingVertical: 14, borderRadius: 12,
    alignItems: 'center',
  },
  modalSubmitText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // Chip row for the adjustmentMode picker on Prepay + RateChange modals.
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: c.bg.surfaceAlt, borderWidth: 1, borderColor: c.border.subtle,
  },
  chipText: { fontSize: 13, fontWeight: '600', color: c.text.secondary },
  chipTextSelected: { color: '#fff' },

  // "Fix setup" entry point inside the Edit modal — muted amber so it
  // looks like a warning, not a normal call-to-action.
  fixSetupLink: {
    backgroundColor: '#fef3c7',
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: '#fbbf24',
    padding: spacing.md,
    marginBottom: spacing.xl,
  },
  fixSetupLinkTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fixSetupLinkTitle: { fontSize: 14, fontWeight: '700', color: '#78350f' },
  fixSetupLinkSub:   { fontSize: 12, color: '#92400e', marginTop: 2 },

  // Warning banners inside FixSetupModal — the always-on amber one and
  // the stronger red-tinted one when the loan has post-disburse events.
  fixWarnBanner: {
    backgroundColor: '#fef3c7',
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: '#fbbf24',
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  fixWarnTitle: { fontSize: 14, fontWeight: '700', color: '#78350f', marginBottom: 4 },
  fixWarnBody:  { fontSize: 12, color: '#78350f', lineHeight: 17 },
  fixWarnBannerStrong: {
    backgroundColor: '#fee2e2',
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: '#f87171',
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  fixWarnTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  fixWarnTitleStrong: { fontSize: 14, fontWeight: '700', color: '#991b1b', flexShrink: 1 },
});
