// ----------------------------------------------------------------------------
// CashFlowScreen — "given my current cash + all my recurring rules, how
// does my balance look over the next N days?"
//
// Layout:
//   1. Starting-balance card. Auto-filled from NetWorth "Cash & Bank"
//      assets, but the user can override.
//   2. Horizon chip row (30 / 60 / 90 / 180 days).
//   3. Balance projection chart (step-line, red overdraft zones).
//   4. Summary grid: expected income, expected expense, expected
//      investment outflow, net change.
//   5. Overdraft warning banner (only when balance dips negative).
//   6. Upcoming events timeline: every recurring hit, chronological,
//      with the projected balance after each.
//
// No writes to storage. Everything is a projection off the current
// recurring rules + starting balance. This is a "what-if" tool.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import {
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import CashFlowChart from '../components/CashFlowChart';
import AppIcon from '../components/AppIcon';
import HelpSheet from '../components/HelpSheet';
import { useLoans } from '../contexts/LoansContext';
import { useRecurring } from '../contexts/RecurringContext';
import { useSettings } from '../contexts/SettingsContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { useTransfers } from '../contexts/TransfersContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { estimateTypicalLifestyle, projectCashFlow } from '../lib/cashFlow';
import { computeAccountBalances } from '../lib/accountBalances';
import { lookupRateOrOne } from '../lib/currency';
import { radii, spacing } from '../lib/theme';
import { formatMoney as formatMoneyCurrency } from '../lib/currency';

const HORIZONS = [
  { id: 30,  label: '30 days'  },
  { id: 60,  label: '60 days'  },
  { id: 90,  label: '90 days'  },
  { id: 180, label: '180 days' },
];

export default function CashFlowScreen({ navigation }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const { rules } = useRecurring();
  const { loans } = useLoans();
  const { income, expenses, investments } = useTransactions();
  const { transfers } = useTransfers();
  const { categories, accounts, baseCurrency, fxRates } = useSettings();

  const autoStart = useMemo(() => {
    const balances = computeAccountBalances({
      accounts,
      income,
      expenses,
      investments,
      transfers,
      asOf: new Date().toISOString(),
    });
    return accounts.reduce((sum, account) => {
      const amount = Number(balances.get(account.id)) || 0;
      return sum + amount * lookupRateOrOne(fxRates, account.currency ?? baseCurrency, baseCurrency);
    }, 0);
  }, [accounts, income, expenses, investments, transfers, fxRates, baseCurrency]);
  const projectedRules = useMemo(() => rules.map((rule) => {
    const account = accounts.find((item) => item.id === rule.accountId);
    const currency = rule.currency ?? account?.currency ?? baseCurrency;
    const storedBase = Number(rule.amountInBase);
    const amount = Number.isFinite(storedBase) && storedBase > 0
      ? storedBase
      : (Number(rule.amount) || 0) * lookupRateOrOne(fxRates, currency, baseCurrency);
    return { ...rule, amount };
  }), [rules, accounts, fxRates, baseCurrency]);
  const [startBalanceText, setStartBalanceText] = useState('');
  const [horizonDays, setHorizonDays] = useState(90);
  const [includeTypical, setIncludeTypical] = useState(true);

  // Effective starting balance: user's override if valid, else the
  // auto-computed liquid-assets total.
  const effectiveStart = useMemo(() => {
    const parsed = Number(startBalanceText);
    if (Number.isFinite(parsed) && startBalanceText.trim() !== '') return parsed;
    return autoStart;
  }, [startBalanceText, autoStart]);

  // Build a Map<catId, {label, emoji}> across all category types so the
  // event list can show human labels next to the ruleType.
  const categoriesById = useMemo(() => {
    const map = new Map();
    for (const type of ['expense', 'income', 'investment']) {
      for (const c of categories[type] ?? []) {
        map.set(c.id, { label: c.label, emoji: c.emoji });
      }
    }
    return map;
  }, [categories]);

  const typical = useMemo(
    () => estimateTypicalLifestyle({
      expenses,
      investments,
      income,
      recurringRules: projectedRules,
      loans,
      horizonDays,
      fxRates,
      baseCurrency,
    }),
    [expenses, investments, income, projectedRules, loans, horizonDays, fxRates, baseCurrency],
  );

  const result = useMemo(
    () => projectCashFlow({
      startBalance:   effectiveStart,
      recurringRules: projectedRules,
      today:          new Date(),
      horizonDays,
      categoriesById,
      includeTypicalSpend: includeTypical && typical.hasSignal,
      typicalExpenseDaily: typical.expenseDaily,
      typicalInvestmentDaily: typical.investmentDaily,
      typicalIncomeDaily: typical.incomeDaily,
      loans,
    }),
    [effectiveStart, projectedRules, horizonDays, categoriesById, includeTypical, typical, loans],
  );

  const { events, series, summary } = result;

  const useAutoStart = () => setStartBalanceText('');

  const hasRules = rules.some((r) => r.active !== false);
  const hasIncomeRule = rules.some((r) => r.active !== false && r.type === 'income');

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      {/* -- Starting balance ------------------------------------------------ */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>Starting balance</Text>
            <HelpSheet
              title="Cash flow forecast"
              summary="Recurring rules and formal loan EMIs are the calendar. Typical flow is leftover income, expense, and investment from the last 6 months after those hits are removed."
              items={[
                'It is a planning view and does not create transactions.',
                'Active loans you owe add EMI dates unless a matching expense rule already covers them.',
                'Typical income is last-6-month pay (bonus months ignored), minus salary already on the calendar.',
                'Override the starting balance to test a different scenario.',
              ]}
            />
          </View>
          {startBalanceText.trim() !== '' && (
            <TouchableOpacity onPress={useAutoStart} style={styles.autoBtn}>
              <View style={styles.autoBtnInner}>
                <AppIcon name="zap" size={13} color="#2563eb" strokeWidth={2.2} filled />
                <Text style={styles.autoBtnText}>From my accounts</Text>
              </View>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.inputBox}>
          <Text style={styles.rupee}>₹</Text>
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            placeholder={String(Math.round(autoStart))}
            placeholderTextColor={themeColors.text.muted}
            value={startBalanceText}
            onChangeText={setStartBalanceText}
          />
        </View>
        <Text style={styles.inputHint}>
          {startBalanceText.trim() === ''
            ? `Auto-filled from Cash & Bank assets (₹${autoStart.toLocaleString('en-IN')})`
            : `Overriding auto-fill of ₹${autoStart.toLocaleString('en-IN')}`}
        </Text>
      </View>

      <Text style={styles.sectionLabel}>Forecast includes</Text>
      <View style={styles.chipRow}>
        <TouchableOpacity
          onPress={() => setIncludeTypical(false)}
          activeOpacity={0.7}
          style={[styles.modeChip, !includeTypical && styles.chipActive]}
        >
          <Text style={[styles.chipText, !includeTypical && styles.chipTextActive]}>Rules only</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setIncludeTypical(true)}
          activeOpacity={0.7}
          style={[styles.modeChip, includeTypical && styles.chipActive]}
        >
          <Text style={[styles.chipText, includeTypical && styles.chipTextActive]}>Rules + typical</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.typicalHint}>
        {typical.hasSignal
          ? `Last 6 months (after calendar hits): income ${formatMoneyCurrency(typical.incomeMonthly, baseCurrency)}/mo, expenses ${formatMoneyCurrency(typical.expenseMonthly, baseCurrency)}, investments ${formatMoneyCurrency(typical.investmentMonthly, baseCurrency)}. About +${formatMoneyCurrency(typical.incomeDaily, baseCurrency)} / −${formatMoneyCurrency(typical.dailyTotal, baseCurrency)} per day.`
          : 'Not enough leftover activity in the last 6 months to estimate a typical drip. Recurring rules and loan EMIs still apply.'}
      </Text>

      {/* -- Horizon chips --------------------------------------------------- */}
      <Text style={styles.sectionLabel}>Horizon</Text>
      <View style={styles.chipRow}>
        {HORIZONS.map((h) => {
          const active = h.id === horizonDays;
          return (
            <TouchableOpacity
              key={h.id}
              onPress={() => setHorizonDays(h.id)}
              activeOpacity={0.7}
              style={[styles.chip, active && styles.chipActive]}
              accessibilityRole="button"
              accessibilityLabel={h.label}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {h.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* -- Chart card ----------------------------------------------------- */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Projected balance</Text>
        <Text style={styles.chartCaption}>
          Starts at {formatMoneyCurrency(effectiveStart, baseCurrency)}, ends at{' '}
          <Text style={{
            color: summary.endBalance < 0 ? themeColors.accent.expense : themeColors.accent.income,
            fontWeight: '800',
          }}>
            {formatMoneyCurrency(summary.endBalance, baseCurrency)}
          </Text>
          {' '}after {horizonDays} days.
        </Text>
        <View style={{ alignItems: 'center', marginTop: spacing.sm }}>
          <CashFlowChart series={series} width={340} />
        </View>
      </View>

      {/* -- Overdraft warning ---------------------------------------------- */}
      {summary.isOverdrawn && (
        <View style={styles.warnBanner}>
          <View style={styles.warnTitleRow}>
            <AppIcon name="alert-triangle" size={16} color="#b45309" strokeWidth={2.2} />
            <Text style={styles.warnTitle}>Overdraft ahead</Text>
          </View>
          <Text style={styles.warnBody}>
            Your balance dips to{' '}
            <Text style={styles.warnStrong}>
              {formatMoneyCurrency(summary.minBalance, baseCurrency)}
            </Text>{' '}
            on {summary.minBalanceDate.toDateString()}. Consider deferring a
            SIP or topping up your accounts.
          </Text>
        </View>
      )}

      {/* -- Summary grid --------------------------------------------------- */}
      <View style={styles.gridRow}>
        <SummaryTile label="Income"     value={summary.income}     tint={themeColors.accent.income}     baseCurrency={baseCurrency} />
        <SummaryTile label="Expense"    value={summary.expense}    tint={themeColors.accent.expense}    baseCurrency={baseCurrency} />
      </View>
      {summary.income === 0 && !(includeTypical && typical.incomeDaily >= 1) && (
        <Text style={styles.typicalHint}>
          {hasIncomeRule
            ? 'No income rule hits this horizon. Check the next-run date on Recurring.'
            : 'Income stays ₹0 until you add a recurring income rule, or turn on typical if leftover last-6-month pay is enough to drip.'}
        </Text>
      )}
      <View style={styles.gridRow}>
        <SummaryTile label="Investment" value={summary.investment} tint={themeColors.accent.investment} baseCurrency={baseCurrency} />
        <SummaryTile
          label="Net change"
          value={summary.net}
          tint={summary.net >= 0 ? themeColors.accent.income : themeColors.accent.expense}
          signed
          baseCurrency={baseCurrency}
        />
      </View>

      {/* -- Empty state or event list -------------------------------------- */}
      {!hasRules && events.length === 0 && !(includeTypical && typical.hasSignal) ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No forecast spine yet</Text>
          <Text style={styles.emptyBody}>
            Add a rule for salary, rent, SIPs, or log a loan with an EMI —
            the forecast will then project your cash for the next few months.
          </Text>
          <TouchableOpacity
            style={styles.emptyCta}
            // v4 restructure: CashFlow and RecurringTransactions are
            // now siblings inside MoreStack, so this is a plain in-stack
            // push — no more parent-tab dance. Back button returns
            // straight to CashFlow.
            onPress={() =>
              navigation.navigate('RecurringTransactions')
            }
            activeOpacity={0.7}
          >
            <Text style={styles.emptyCtaText}>Add recurring rule →</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Upcoming events{' '}
            <Text style={styles.dim}>
              ({events.length
                + (includeTypical && typical.incomeDaily >= 1 ? 1 : 0)
                + (includeTypical && typical.dailyTotal >= 1 ? 1 : 0)})
            </Text>
          </Text>
          {includeTypical && typical.incomeDaily >= 1 && (
            <EventRow
              event={{
                ruleType: 'income',
                delta: typical.incomeDaily,
                categoryLabel: `Typical income · +${formatMoneyCurrency(typical.incomeDaily, baseCurrency)}/day`,
                note: 'Leftover last-6-month income after salary rules — dripped from tomorrow',
                date: null,
                balanceAfter: null,
              }}
              prevBalance={effectiveStart}
              baseCurrency={baseCurrency}
            />
          )}
          {includeTypical && typical.dailyTotal >= 1 && (
            <EventRow
              event={{
                ruleType: 'typical',
                delta: -typical.dailyTotal,
                categoryLabel: `Typical spend · −${formatMoneyCurrency(typical.dailyTotal, baseCurrency)}/day`,
                note: 'Leftover last-6-month expenses and investments — dripped from tomorrow',
                date: null,
                balanceAfter: null,
              }}
              prevBalance={effectiveStart}
              baseCurrency={baseCurrency}
            />
          )}
          {events.length === 0 && (
            <Text style={styles.emptyEvents}>
              No dated rules or EMIs fall inside this horizon.
            </Text>
          )}
          {events.map((e, i) => (
            <EventRow
              key={`${e.ruleId}-${i}`}
              event={e}
              prevBalance={i === 0 ? effectiveStart : events[i - 1].balanceAfter}
              baseCurrency={baseCurrency}
            />
          ))}
        </View>
      )}

      <Text style={styles.footer}>
        {includeTypical && typical.hasSignal
          ? 'Dated list is recurring rules and loan EMIs. Typical income and spend are leftover last-6-month cash after those rules. Large one-offs are ignored.'
          : 'Projection uses recurring rules and formal loan EMIs. Turn on typical to add leftover income, expenses, and investments from the last 6 months.'}
      </Text>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// SummaryTile — a compact "label / value" tile in the 2×2 grid.
// ---------------------------------------------------------------------------
function SummaryTile({ label, value, tint, baseCurrency, signed = false }) {
  const styles = useThemedStyles(makeStyles);
  const abs = Math.abs(value);
  const display = signed
    ? `${value >= 0 ? '+' : '−'}${formatMoneyCurrency(abs, baseCurrency)}`
    : formatMoneyCurrency(value, baseCurrency);
  return (
    <View style={[styles.tile, { borderLeftColor: tint }]}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={[styles.tileValue, { color: tint }]}>{display}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// EventRow — one line in the "Upcoming events" timeline.
// ---------------------------------------------------------------------------
function EventRow({ event, prevBalance, baseCurrency }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const isNeg = event.delta < 0;
  const tint =
      event.ruleType === 'income'     ? themeColors.accent.income
    : event.ruleType === 'typical'    ? themeColors.text.secondary
    : event.ruleType === 'expense' || event.ruleType === 'loan'
      ? themeColors.accent.expense
      : themeColors.accent.investment;

  const label =
    event.categoryLabel
    ?? event.note?.trim()
    ?? '(no note)';

  const dateLabel = event.date
    ? event.date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', weekday: 'short' })
    : '';
  const noteExtra = event.note && event.categoryLabel && event.note !== event.categoryLabel
    ? event.note
    : '';
  const meta = [dateLabel, noteExtra].filter(Boolean).join(' · ');

  return (
    <View style={styles.eventRow}>
      <View style={[styles.eventDot, { backgroundColor: tint }]} />
      <View style={styles.eventBody}>
        <Text style={styles.eventLabel} numberOfLines={1}>
          {event.categoryEmoji ? `${event.categoryEmoji} ` : ''}{label}
        </Text>
        {!!meta && <Text style={styles.eventMeta}>{meta}</Text>}
      </View>
      <View style={styles.eventRight}>
        {event.ruleType !== 'typical' && (
          <Text style={[styles.eventDelta, { color: tint }]}>
            {isNeg ? '−' : '+'}{formatMoneyCurrency(Math.abs(event.delta), baseCurrency)}
          </Text>
        )}
        {event.balanceAfter != null && (
          <Text style={[
            styles.eventBalance,
            { color: event.balanceAfter < 0 ? themeColors.accent.expense : themeColors.text.secondary },
          ]}>
            → {formatMoneyCurrency(event.balanceAfter, baseCurrency)}
          </Text>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const makeStyles = (c) => ({
  screen:    { flex: 1, backgroundColor: c.bg.canvas },
  container: {
    padding: spacing.lg,
    paddingBottom: 80,
    gap: spacing.md,
  },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: c.text.secondary,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginTop: spacing.xs,
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  modeChip: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: c.border.subtle,
    backgroundColor: c.bg.surface,
    alignItems: 'center',
  },
  typicalHint: {
    fontSize: 12,
    color: c.text.secondary,
    lineHeight: 17,
    marginTop: -4,
  },
  chip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: c.border.subtle,
    backgroundColor: c.bg.surface,
    alignItems: 'center',
  },
  chipActive: {
    borderColor: c.accent.primary,
    backgroundColor: c.accent.primary + '18',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
    color: c.text.secondary,
  },
  chipTextActive: {
    color: c.accent.primary,
  },

  card: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: c.border.subtle,
    gap: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center' },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: c.text.primary,
  },
  chartCaption: {
    fontSize: 12,
    color: c.text.secondary,
    lineHeight: 17,
  },
  dim: {
    fontWeight: '600',
    color: c.text.muted,
  },

  autoBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.md,
    backgroundColor: c.palette.n100,
  },
  autoBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  autoBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: c.accent.primary,
  },

  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: c.border.subtle,
    paddingHorizontal: 12,
  },
  rupee:  { fontSize: 16, color: c.text.secondary, marginRight: 6 },
  input:  { flex: 1, fontSize: 16, color: c.text.primary, paddingVertical: 10 },
  inputHint: { fontSize: 11, color: c.text.muted, marginTop: 4 },

  gridRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tile: {
    flex: 1,
    backgroundColor: c.bg.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderLeftWidth: 4,
  },
  tileLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: c.text.secondary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  tileValue: {
    fontSize: 18,
    fontWeight: '900',
    marginTop: 2,
  },

  warnBanner: {
    backgroundColor: '#fef3c7',
    borderColor: '#f59e0b',
    borderWidth: 1.5,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: 2,
  },
  warnTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  warnTitle: {
    fontWeight: '800',
    color: '#92400e',
    fontSize: 14,
  },
  warnBody: {
    fontSize: 12,
    color: '#78350f',
    lineHeight: 17,
  },
  warnStrong: {
    fontWeight: '900',
  },

  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: c.border.subtle,
    gap: spacing.sm,
  },
  eventDot: {
    width: 8, height: 8, borderRadius: 4,
  },
  eventBody: { flex: 1 },
  eventLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: c.text.primary,
  },
  eventMeta: {
    fontSize: 11,
    color: c.text.muted,
    marginTop: 1,
  },
  eventRight: { alignItems: 'flex-end' },
  eventDelta: {
    fontSize: 13,
    fontWeight: '800',
  },
  eventBalance: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },

  emptyCard: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderStyle: 'dashed',
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: c.text.primary,
  },
  emptyBody: {
    fontSize: 12,
    color: c.text.secondary,
    textAlign: 'center',
    lineHeight: 17,
    marginBottom: spacing.sm,
  },
  emptyCta: {
    backgroundColor: c.accent.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radii.md,
  },
  emptyCtaText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 13,
  },
  emptyEvents: {
    fontSize: 12,
    color: c.text.muted,
    fontStyle: 'italic',
    padding: spacing.md,
    textAlign: 'center',
  },

  footer: {
    fontSize: 11,
    color: c.text.muted,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 15,
  },
});
