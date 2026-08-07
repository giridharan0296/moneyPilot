import { useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles } from '../contexts/ThemeContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { useTransfers } from '../contexts/TransfersContext';
import { formatMoney } from '../lib/currency';

function periodRange(period) {
  const now = new Date();
  if (period === 'all') return { start: null, label: 'All time' };
  const start = new Date(now.getFullYear(), now.getMonth() - (period === 'last' ? 1 : 0), 1);
  const end = period === 'last'
    ? new Date(now.getFullYear(), now.getMonth(), 1)
    : new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end, label: start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) };
}

export default function AccountActivityScreen() {
  const styles = useThemedStyles(makeStyles);
  const { accounts, baseCurrency } = useSettings();
  const { income, expenses, investments } = useTransactions();
  const { transfers } = useTransfers();
  // Default to all time so backdated income/expenses are visible. Month
  // / last-month chips still work for focused reviews.
  const [period, setPeriod] = useState('all');
  const [accountId, setAccountId] = useState(null);
  const activeAccount = accounts.find((account) => account.id === accountId) ?? accounts[0] ?? null;
  const range = periodRange(period);

  const activity = useMemo(() => {
    if (!activeAccount) return null;
    const movements = [];
    const add = (items, direction, label) => items.forEach((tx) => {
      if (tx.accountId === activeAccount.id) movements.push({ ...tx, delta: direction * (Number(tx.amount) || 0), label });
    });
    add(income, 1, 'Income');
    add(expenses, -1, 'Expense');
    add(investments, -1, 'Investment');
    transfers.forEach((tx) => {
      const amount = Number(tx.amount) || 0;
      if (tx.kind === 'internal_transfer') {
        if (tx.accountId === activeAccount.id) movements.push({ ...tx, delta: -amount, label: 'Transfer out' });
        if (tx.targetAccountId === activeAccount.id) movements.push({ ...tx, delta: amount, label: 'Transfer in' });
      } else if (tx.accountId === activeAccount.id) {
        movements.push({ ...tx, delta: ['borrow', 'repay_received'].includes(tx.kind) ? amount : -amount, label: 'Transfer' });
      }
    });
    // Every assigned movement counts — including dates before the account
    // was created — so backdated salary/income updates the ledger.
    const inPeriod = movements.filter((item) => {
      const date = new Date(item.createdAt);
      return (!range.start || date >= range.start) && (!range.end || date < range.end);
    });
    const balanceBefore = (Number(activeAccount.openingBalance) || 0)
      + movements.filter((item) => !range.start || new Date(item.createdAt) < range.start)
        .reduce((sum, item) => sum + item.delta, 0);
    const moneyIn = inPeriod.filter((item) => item.delta > 0).reduce((sum, item) => sum + item.delta, 0);
    const moneyOut = Math.abs(inPeriod.filter((item) => item.delta < 0).reduce((sum, item) => sum + item.delta, 0));
    return {
      opening: balanceBefore,
      moneyIn,
      moneyOut,
      closing: balanceBefore + moneyIn - moneyOut,
      rows: inPeriod.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 50),
    };
  }, [activeAccount, income, expenses, investments, transfers, range.start, range.end]);

  if (!activeAccount || !activity) {
    return <View style={styles.empty}><Text style={styles.emptyText}>Add an account to view its activity.</Text></View>;
  }

  const currency = activeAccount.currency ?? baseCurrency;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Account activity</Text>
      <Text style={styles.subheading}>Track money moving in and out of each account.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {accounts.map((account) => <TouchableOpacity key={account.id} onPress={() => setAccountId(account.id)}
          style={[styles.chip, account.id === activeAccount.id && styles.chipActive]}>
          <Text style={[styles.chipText, account.id === activeAccount.id && styles.chipTextActive]}>{account.emoji} {account.label}</Text>
        </TouchableOpacity>)}
      </ScrollView>
      <View style={styles.periodRow}>
        {[['month', 'This month'], ['last', 'Last month'], ['all', 'All time']].map(([id, label]) => (
          <TouchableOpacity key={id} onPress={() => setPeriod(id)} style={[styles.period, period === id && styles.periodActive]}>
            <Text style={[styles.periodText, period === id && styles.periodTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.periodLabel}>{range.label}</Text>
      <View style={styles.summary}>
        <Metric label="Opening" value={activity.opening} color={styles.opening.color} currency={currency} />
        <Metric label="Money in" value={activity.moneyIn} color={styles.income.color} currency={currency} />
        <Metric label="Money out" value={activity.moneyOut} color={styles.expense.color} currency={currency} />
        <Metric label="Closing" value={activity.closing} color={styles.closing.color} currency={currency} />
      </View>
      <Text style={styles.sectionTitle}>Activity</Text>
      {activity.rows.length === 0 ? <Text style={styles.emptyText}>No activity in this period.</Text> : activity.rows.map((row, index) => (
        <View key={`${row.id}_${row.delta}`} style={[styles.row, index < activity.rows.length - 1 && styles.rowDivider]}>
          <View style={styles.rowMain}><Text style={styles.rowTitle}>{row.note || row.label}</Text><Text style={styles.rowMeta}>{row.label} · {new Date(row.createdAt).toLocaleDateString()}</Text></View>
          <Text style={[styles.rowAmount, { color: row.delta >= 0 ? styles.income.color : styles.expense.color }]}>{row.delta >= 0 ? '+' : '−'}{formatMoney(Math.abs(row.delta), currency, { decimals: 0 })}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function Metric({ label, value, color, currency }) {
  const styles = useThemedStyles(makeStyles);
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={[styles.metricValue, { color }]}>{formatMoney(value, currency, { decimals: 0 })}</Text></View>;
}

const makeStyles = (c) => ({
  screen: { flex: 1, backgroundColor: c.bg.canvas }, container: { padding: 16, paddingBottom: 40 },
  heading: { fontSize: 25, fontWeight: '800', color: c.text.primary }, subheading: { color: c.text.secondary, fontSize: 13, marginTop: 4 },
  chips: { gap: 8, paddingVertical: 18 }, chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99, borderWidth: 1, borderColor: c.border.subtle }, chipActive: { backgroundColor: c.accent.primary, borderColor: c.accent.primary }, chipText: { color: c.text.secondary, fontWeight: '600', fontSize: 12 }, chipTextActive: { color: c.text.inverse },
  periodRow: { flexDirection: 'row', gap: 8 }, period: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 9, backgroundColor: c.bg.surfaceAlt }, periodActive: { backgroundColor: c.accent.primary }, periodText: { fontSize: 12, fontWeight: '700', color: c.text.secondary }, periodTextActive: { color: c.text.inverse }, periodLabel: { marginTop: 14, marginBottom: 8, color: c.text.secondary, fontWeight: '700', fontSize: 12 },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, metric: { flexBasis: '48%', flexGrow: 1, padding: 12, backgroundColor: c.bg.surface, borderWidth: 1, borderColor: c.border.subtle, borderRadius: 12 }, metricLabel: { color: c.text.secondary, fontWeight: '700', fontSize: 10, textTransform: 'uppercase' }, metricValue: { marginTop: 4, fontSize: 16, fontWeight: '800' },
  sectionTitle: { marginTop: 24, marginBottom: 8, fontSize: 15, fontWeight: '800', color: c.text.primary }, row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 }, rowDivider: { borderBottomWidth: 1, borderBottomColor: c.border.subtle }, rowMain: { flex: 1, paddingRight: 10 }, rowTitle: { color: c.text.primary, fontWeight: '600', fontSize: 13 }, rowMeta: { color: c.text.muted, fontSize: 11, marginTop: 3 }, rowAmount: { fontSize: 13, fontWeight: '800' },
  opening: { color: c.text.primary }, income: { color: c.accent.income }, expense: { color: c.accent.expense }, closing: { color: c.accent.primary },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: c.bg.canvas }, emptyText: { color: c.text.secondary, fontSize: 13 },
});
