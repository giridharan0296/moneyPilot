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
import { useRecurring } from '../contexts/RecurringContext';
import { useSettings } from '../contexts/SettingsContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { useTransfers } from '../contexts/TransfersContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { projectCashFlow } from '../lib/cashFlow';
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
  const { income, expenses, investments } = useTransactions();
  const { transfers } = useTransfers();
  const { categories, accounts, baseCurrency, fxRates } = useSettings();

  const autoStart = useMemo(() => {
    const balances = computeAccountBalances({ accounts, income, expenses, investments, transfers });
    return accounts.reduce((sum, account) => {
      const amount = Number(balances.get(account.id)) || 0;
      return sum + amount * lookupRateOrOne(fxRates, account.currency ?? baseCurrency, baseCurrency);
    }, 0);
  }, [accounts, income, expenses, investments, transfers, fxRates, baseCurrency]);
  const projectedRules = useMemo(() => rules.map((rule) => {
    const account = accounts.find((item) => item.id === rule.accountId);
    const currency = rule.currency ?? account?.currency ?? baseCurrency;
    const amount = rule.amountInBase != null
      ? Number(rule.amountInBase) || 0
      : (Number(rule.amount) || 0) * lookupRateOrOne(fxRates, currency, baseCurrency);
    return { ...rule, amount };
  }), [rules, accounts, fxRates, baseCurrency]);
  const [startBalanceText, setStartBalanceText] = useState('');
  const [horizonDays, setHorizonDays] = useState(90);

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

  const result = useMemo(
    () => projectCashFlow({
      startBalance:   effectiveStart,
      recurringRules: projectedRules,
      today:          new Date(),
      horizonDays,
      categoriesById,
    }),
    [effectiveStart, projectedRules, horizonDays, categoriesById],
  );

  const { events, series, summary } = result;

  const useAutoStart = () => setStartBalanceText('');

  const hasRules = rules.some((r) => r.active !== false);

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
              summary="This forecast projects your cash balance from the starting balance and active recurring rules."
              items={['It is a planning view and does not create transactions.', 'Override the starting balance to test a different scenario.']}
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
          Starts at {formatMoneyCurrency(effectiveStart, baseCurrency, { decimals: 0 })}, ends at{' '}
          <Text style={{
            color: summary.endBalance < 0 ? themeColors.accent.expense : themeColors.accent.income,
            fontWeight: '800',
          }}>
            {formatMoneyCurrency(summary.endBalance, baseCurrency, { decimals: 0 })}
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
              {formatMoneyCurrency(summary.minBalance, baseCurrency, { decimals: 0 })}
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
      {!hasRules ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No recurring rules yet</Text>
          <Text style={styles.emptyBody}>
            Add a rule for your salary, rent, SIPs, subscriptions, and other
            regular hits — the forecast will then project your cash for the
            next few months.
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
            <Text style={styles.dim}>({events.length})</Text>
          </Text>
          {events.length === 0 && (
            <Text style={styles.emptyEvents}>
              No recurring events fall inside this horizon.
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
        Projection uses your recurring rules only. One-off expenses and
        market moves aren't included.
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
    ? `${value >= 0 ? '+' : '−'}${formatMoneyCurrency(abs, baseCurrency, { decimals: 0 })}`
    : formatMoneyCurrency(value, baseCurrency, { decimals: 0 });
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
    : event.ruleType === 'expense'    ? themeColors.accent.expense
    : /* investment */                 themeColors.accent.investment;

  const label =
    event.categoryLabel
    ?? event.note?.trim()
    ?? '(no note)';

  return (
    <View style={styles.eventRow}>
      <View style={[styles.eventDot, { backgroundColor: tint }]} />
      <View style={styles.eventBody}>
        <Text style={styles.eventLabel} numberOfLines={1}>
          {event.categoryEmoji ? `${event.categoryEmoji} ` : ''}{label}
        </Text>
        <Text style={styles.eventMeta}>
          {event.date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', weekday: 'short' })}
          {event.note && event.categoryLabel && event.note !== event.categoryLabel
            ? ` · ${event.note}`
            : ''}
        </Text>
      </View>
      <View style={styles.eventRight}>
        <Text style={[styles.eventDelta, { color: tint }]}>
          {isNeg ? '−' : '+'}{formatMoneyCurrency(Math.abs(event.delta), baseCurrency, { decimals: 0 })}
        </Text>
        <Text style={[
          styles.eventBalance,
          { color: event.balanceAfter < 0 ? themeColors.accent.expense : themeColors.text.secondary },
        ]}>
          → {formatMoneyCurrency(event.balanceAfter, baseCurrency, { decimals: 0 })}
        </Text>
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
    padding: spacing.xl,
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
