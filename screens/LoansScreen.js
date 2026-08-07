// ----------------------------------------------------------------------------
// LoansScreen — the entry point for the Loans first-class subsystem.
//
// Layout:
//   ┌────────────────────────────────────────────┐
//   │  HERO  You owe ₹X   |   Owed to you ₹Y     │
//   │  (from Loans; distinct from NetWorth totals)│
//   └────────────────────────────────────────────┘
//
//   [ + New loan ]  (opens LoanDetail via 'new' path)
//
//   Row list grouped by DIRECTION so users see their obligations up top:
//     I OWE (n)                       total ₹...
//       row → name · lender · outstanding + progress · next EMI date
//     OWED TO ME (n)                  total ₹...
//       row → same shape (informal 'money lent' loans)
//
//   Closed loans are hidden by default; a footer toggle reveals them.
//
// Actions:
//   - Tap row  → LoanDetail
//   - + New    → LoanDetail with routeParams.mode='new'
//   - ✕ (row)  → confirm + deleteLoan (removes mirror liability too)
// ----------------------------------------------------------------------------

import { useLayoutEffect, useMemo, useState } from 'react';
import {
  Alert,
  SafeAreaView,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useLoans } from '../contexts/LoansContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import AppIcon from '../components/AppIcon';
import {
  computePayoffPercent,
  computePayoffProjection,
  formatDate,
  formatMoney,
} from '../lib/loans';
import { radii, spacing } from '../lib/theme';

const GROUPS = [
  { id: 'owed_by_me', title: 'I owe',       direction: 'owed_by_me',   emptyHint: 'Add a home / car / personal loan to track your EMIs.' },
  { id: 'owed_to_me', title: 'Owed to me',  direction: 'owed_to_me',   emptyHint: 'Log an informal loan you extended to a friend or family member.' },
];

export default function LoansScreen({ navigation }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const { loans, summary, deleteLoan } = useLoans();
  const { showToast } = useToast();
  const [showClosed, setShowClosed] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() => navigation.navigate('LoanDetail', { mode: 'new' })}
          hitSlop={12}
          style={{ paddingHorizontal: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Add loan"
        >
          <AppIcon
            name="plus"
            size={22}
            color={themeColors.text.primary}
            strokeWidth={2.4}
          />
        </TouchableOpacity>
      ),
    });
  }, [navigation, themeColors.text.primary]);

  const visibleLoans = useMemo(
    () => (showClosed ? loans : loans.filter((l) => l.status !== 'closed')),
    [loans, showClosed],
  );

  const grouped = useMemo(() => {
    const g = { owed_by_me: [], owed_to_me: [] };
    for (const l of visibleLoans) {
      (g[l.direction] ??= []).push(l);
    }
    for (const k of Object.keys(g)) {
      g[k].sort((a, b) => b.currentOutstanding - a.currentOutstanding);
    }
    return g;
  }, [visibleLoans]);

  const handleDelete = (loan) => {
    Alert.alert(
      `Delete "${loan.name}"?`,
      'This removes the loan, all its events, and the linked liability in Net Worth. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const res = deleteLoan(loan.id);
            if (res.ok) {
              showToast(`Deleted ${loan.name}`, { variant: 'success', duration: 1500 });
            }
          },
        },
      ],
    );
  };

  const closedCount = loans.filter((l) => l.status === 'closed').length;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroTitleRow}>
            <AppIcon name="landmark" size={22} color="#dc2626" strokeWidth={2.1} />
            <Text style={styles.heroTitle}>Loans</Text>
          </View>
          <View style={styles.heroRow}>
            <View style={[styles.heroPill, { borderColor: '#dc2626' }]}>
              <Text style={styles.heroPillLabel}>You owe</Text>
              <Text style={[styles.heroPillValue, { color: '#7f1d1d' }]}>
                {formatMoney(summary.owedByMe)}
              </Text>
            </View>
            <View style={[styles.heroPill, { borderColor: '#059669' }]}>
              <Text style={styles.heroPillLabel}>Owed to you</Text>
              <Text style={[styles.heroPillValue, { color: '#065f46' }]}>
                {formatMoney(summary.owedToMe)}
              </Text>
            </View>
          </View>
          <Text style={styles.heroFootnote}>
            {summary.active} active · {summary.closed} closed. Each loan mirrors into Net Worth automatically.
          </Text>
        </View>

        {loans.length === 0 && <EmptyState />}

        {GROUPS.map((group) => {
          const items = grouped[group.direction] ?? [];
          if (items.length === 0) return null;
          const total = items.reduce((s, l) => s + l.currentOutstanding, 0);
          return (
            <View key={group.id} style={styles.group}>
              <View style={styles.groupHeaderRow}>
                <Text style={styles.groupTitle}>
                  {group.title.toUpperCase()} ({items.length})
                </Text>
                <Text style={styles.groupTotal}>{formatMoney(total)}</Text>
              </View>
              {items.map((l) => (
                <LoanRow
                  key={l.id}
                  loan={l}
                  onPress={() => navigation.navigate('LoanDetail', { loanId: l.id })}
                  onDelete={() => handleDelete(l)}
                />
              ))}
            </View>
          );
        })}

        {closedCount > 0 && (
          <TouchableOpacity
            onPress={() => setShowClosed((v) => !v)}
            style={styles.toggleClosed}
            activeOpacity={0.7}
          >
            <Text style={styles.toggleClosedText}>
              {showClosed
                ? `Hide ${closedCount} closed loan${closedCount === 1 ? '' : 's'}`
                : `Show ${closedCount} closed loan${closedCount === 1 ? '' : 's'}`}
            </Text>
          </TouchableOpacity>
        )}

        <Text style={styles.footer}>
          Loans are formal obligations with a principal, rate, and tenure — separate
          from the freeform Transfers ledger. Every EMI you log auto-updates Net Worth.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function LoanRow({ loan, onPress, onDelete }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const { kindIcon, kindLabel } = useLoans();
  const pct = computePayoffPercent(loan);
  const { remainingMonths, projectedClosureDate } = computePayoffProjection(loan);

  const barColor = loan.status === 'closed' ? '#9ca3af' : '#059669';
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.row, loan.status === 'closed' && { opacity: 0.6 }]}
    >
      <View style={styles.rowEmoji}>
        <AppIcon
          name={kindIcon(loan.kind)}
          size={18}
          color="#dc2626"
          strokeWidth={2}
        />
      </View>
      <View style={styles.rowMiddle}>
        <View style={styles.rowTopLine}>
          <Text style={styles.rowName} numberOfLines={1}>{loan.name}</Text>
          {loan.status === 'closed' && (
            <Text style={styles.rowClosedTag}>CLOSED</Text>
          )}
        </View>
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {kindLabel(loan.kind, loan.kindLabel)}
          {loan.lenderName ? `  ·  ${loan.lenderName}` : ''}
        </Text>

        {/* Progress bar */}
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: barColor }]} />
        </View>
        <View style={styles.rowMetaRow}>
          <Text style={styles.rowMetaText}>
            {formatMoney(loan.currentOutstanding)} outstanding
          </Text>
          {loan.status !== 'closed' && remainingMonths != null && remainingMonths > 0 && (
            <Text style={styles.rowMetaText}>
              {' · '}
              {remainingMonths} mo{remainingMonths === 1 ? '' : 's'} left
              {projectedClosureDate ? ` (~${formatDate(projectedClosureDate.toISOString())})` : ''}
            </Text>
          )}
        </View>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.rowAmount}>{formatMoney(loan.principal)}</Text>
        <Text style={styles.rowAmountSub}>principal</Text>
      </View>
      <TouchableOpacity
        onPress={onDelete}
        style={styles.deleteBtn}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={`Delete ${loan.name}`}
      >
        <AppIcon name="x" size={14} color={themeColors.text.secondary} strokeWidth={2.4} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function EmptyState() {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIconWrap}>
        <AppIcon name="landmark" size={44} color={themeColors.text.muted} strokeWidth={1.7} />
      </View>
      <Text style={styles.emptyTitle}>No loans tracked yet.</Text>
      <Text style={styles.emptySub}>
        Add a home / car / personal loan and log EMIs as they get paid.
        Prepayments and closures are supported too. Tap + in the header to start.
      </Text>
    </View>
  );
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
  heroTitleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: spacing.md,
  },
  heroTitle: { fontSize: 20, fontWeight: '700', color: c.text.primary },
  heroRow: { flexDirection: 'row', gap: 10, marginBottom: spacing.sm },
  heroPill: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  heroPillLabel: { fontSize: 11, color: c.text.muted, fontWeight: '700', letterSpacing: 0.5 },
  heroPillValue: { fontSize: 20, fontWeight: '700', marginTop: 4 },
  heroFootnote: { fontSize: 12, color: c.text.secondary, textAlign: 'center', marginTop: spacing.sm },

  group: { marginBottom: spacing.xl },
  groupHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  groupTitle: { fontSize: 12, fontWeight: '700', color: c.text.muted, letterSpacing: 0.6 },
  groupTotal: { fontSize: 12, fontWeight: '700', color: c.text.secondary },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bg.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  rowEmoji: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: '#fee2e2',
    alignItems: 'center', justifyContent: 'center',
    marginRight: spacing.md,
  },
  rowMiddle: { flex: 1, marginRight: spacing.sm },
  rowTopLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowName: { fontSize: 14, fontWeight: '700', color: c.text.primary, flexShrink: 1 },
  rowClosedTag: {
    fontSize: 9, fontWeight: '700',
    color: c.text.secondary, backgroundColor: c.bg.surfaceAlt,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
    letterSpacing: 0.5,
  },
  rowSubtitle: { fontSize: 12, color: c.text.secondary, marginTop: 2 },
  progressTrack: {
    height: 6, backgroundColor: c.bg.surfaceAlt, borderRadius: 3,
    marginTop: 8, overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 3 },
  rowMetaRow: { flexDirection: 'row', marginTop: 4, flexWrap: 'wrap' },
  rowMetaText: { fontSize: 11, color: c.text.muted },
  rowAmount: { fontSize: 14, fontWeight: '700', color: c.text.primary },
  rowAmountSub: { fontSize: 10, color: c.text.muted, marginTop: 2 },

  deleteBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: c.palette.n100,
    alignItems: 'center', justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  deleteText: { color: c.text.secondary, fontSize: 13, fontWeight: '700' },

  toggleClosed: {
    marginTop: spacing.md,
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  toggleClosedText: { color: c.text.secondary, fontSize: 12, fontWeight: '600' },

  footer: {
    textAlign: 'center',
    color: c.text.muted,
    fontSize: 11,
    marginTop: spacing.xl,
    lineHeight: 16,
  },

  emptyState: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    padding: spacing['2xl'],
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.border.subtle,
    marginBottom: spacing.xl,
  },
  emptyIconWrap: { marginBottom: spacing.sm, opacity: 0.85 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: c.text.primary, marginTop: spacing.md },
  emptySub: { fontSize: 13, color: c.text.secondary, textAlign: 'center', marginTop: 4 },
});
