import { useEffect, useMemo, useState } from 'react';
import { ScrollView, SectionList, Text, TextInput, TouchableOpacity, View } from 'react-native';

import ActivitySearchPane from '../components/ActivitySearchPane';
import AppIcon from '../components/AppIcon';
import EditTransactionModal from '../components/EditTransactionModal';
import { EmptyState, StatusBadge } from '../components/UiPrimitives';
import { useLoans } from '../contexts/LoansContext';
import { useNetWorth } from '../contexts/NetWorthContext';
import { usePortfolio } from '../contexts/PortfolioContext';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { useTransfers } from '../contexts/TransfersContext';
import { buildActivityTimeline, groupTimelineByDate } from '../lib/activityTimeline';
import { formatMoney } from '../lib/currency';
import {
  buildOpeningPositionPayload,
  openingLotsFromSaved,
  removeSavedOpeningLots,
  syncOpeningLots,
} from '../lib/openingPositions';
import {
  hasOtherInvestmentLogs,
  investmentBrokerKey,
  investmentSymbolKey,
} from '../lib/portfolioHoldings';
import { deleteVoiceNote } from '../lib/voiceNotes';
import { radii, spacing } from '../lib/theme';
import { openTransactionsTab } from '../lib/navigationTabReset';

const VIEW_MODES = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'search', label: 'Find' },
];

const FILTERS = [
  ['all', 'All'], ['income', 'Income'], ['expense', 'Expenses'],
  ['transfer', 'Transfers'], ['investment', 'Investments'], ['loan', 'Loans'],
];

export default function ActivityTimelineScreen({ navigation, route }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const {
    expenses, income, investments,
    addTransaction, updateTransaction, deleteTransaction,
  } = useTransactions();
  const { transfers } = useTransfers();
  const { loans } = useLoans();
  const { accounts, accountGroups, categories, baseCurrency, setBrokerDefaultForSubCategory } = useSettings();
  const { addOpeningPosition, removeOpeningPosition, removeOpeningPositionsForInstrument } = usePortfolio();
  const { unhidePortfolioSymbol } = useNetWorth();
  const { showToast, showUndoableToast } = useToast();
  const [viewMode, setViewMode] = useState(route?.params?.mode === 'search' ? 'search' : 'timeline');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  // The transaction (income/expense/investment) currently open for editing,
  // opened directly from a Timeline/Find tap instead of navigating to the
  // Transactions tab and leaving the user stranded there after closing —
  // see the note above `openItem` for why transfers/loans still navigate.
  const [editingTx, setEditingTx] = useState(null); // { item, type } | null

  useEffect(() => {
    if (route?.params?.mode === 'search' || route?.params?.mode === 'timeline') {
      setViewMode(route.params.mode);
    }
  }, [route?.params?.mode]);

  const items = useMemo(() => buildActivityTimeline({
    expenses, income, investments, transfers, loans, accounts, categories, baseCurrency,
  }), [expenses, income, investments, transfers, loans, accounts, categories, baseCurrency]);

  const sections = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const visible = items.filter((item) =>
      (filter === 'all' || item.type === filter)
      && (!needle || `${item.title} ${item.subtitle} ${item.searchText} ${item.amount}`.toLowerCase().includes(needle)),
    );
    return groupTimelineByDate(visible);
  }, [items, filter, query]);

  const typeList = (type) => (type === 'income' ? income : type === 'investment' ? investments : expenses);

  // Tapping a result used to navigate to the Transactions tab and just
  // scroll-to + highlight the matching row, requiring a second tap to
  // actually open it — and closing that editor left you stranded on the
  // Transactions tab instead of back here. income/expense/investment now
  // open inline via EditTransactionModal below, no navigation at all.
  // Loans and transfers keep navigating — loans open their own detail/
  // timeline screen (never was an edit-modal case), and transfers carry
  // enough linked-NetWorth/loan-repayment edge cases (see TransfersScreen's
  // handleSaveEdit/handleDelete) that duplicating them here isn't worth
  // the risk for what the report was actually about.
  const openItem = (item) => {
    if (item.source === 'loan') {
      navigation.navigate('LoanDetail', { loanId: item.sourceId });
      return;
    }
    if (item.source === 'transaction') {
      const raw = typeList(item.type).find((tx) => tx.id === item.sourceId);
      if (raw) setEditingTx({ item: raw, type: item.type });
      return;
    }
    openTransactionsTab(navigation.getParent() ?? navigation, {
      initialTab: 'transfer',
      focusId: item.sourceId,
    });
  };

  // Mirrors TransactionsList.js's handleSaveEdit — investment edits that
  // change instrument/broker or touch an opening position need the same
  // lot-sync bookkeeping, so this follows that logic exactly rather than a
  // simplified re-guess (see lib/portfolioHoldings.js for the shared
  // investmentBrokerKey/investmentSymbolKey/hasOtherInvestmentLogs helpers).
  const handleSaveTx = (updated) => {
    const { item: editing, type } = editingTx;
    if (type === 'investment') {
      const prevBroker = investmentBrokerKey(editing);
      const prevSymbol = investmentSymbolKey(editing);
      const nextBroker = investmentBrokerKey(updated);
      const nextSymbol = investmentSymbolKey(updated);
      const instrumentChanged = Boolean(
        prevSymbol && nextSymbol && (prevSymbol !== nextSymbol || prevBroker !== nextBroker),
      );

      if (instrumentChanged) {
        if (editing.openingPosition) {
          removeSavedOpeningLots(editing.openingPosition, removeOpeningPosition);
        }
        if (
          prevSymbol
          && !hasOtherInvestmentLogs(investments, {
            excludeId: editing.id,
            broker: prevBroker,
            symbolKey: prevSymbol,
          })
        ) {
          removeOpeningPositionsForInstrument(prevBroker, prevSymbol);
        }
      }

      if (updated.openingPosition) {
        const lots = openingLotsFromSaved(updated.openingPosition);
        const broker = updated.openingPosition.broker ?? updated.brokerId;
        const symbol = updated.openingPosition.symbol ?? updated.instrumentSymbol;
        if (broker && symbol) {
          removeOpeningPositionsForInstrument(broker, symbol);
        }
        const openingResult = syncOpeningLots({
          broker,
          symbol,
          name: updated.openingPosition.name ?? updated.instrumentName ?? updated.instrumentSymbol,
          lots,
          previousLots: instrumentChanged ? [] : openingLotsFromSaved(editing.openingPosition),
          addOpeningPosition,
          removeOpeningPosition,
        });
        if (openingResult?.ok) {
          updated.openingPosition = buildOpeningPositionPayload({
            broker: updated.openingPosition.broker ?? updated.brokerId,
            symbol: updated.openingPosition.symbol ?? updated.instrumentSymbol,
            name: updated.openingPosition.name ?? updated.instrumentName ?? updated.instrumentSymbol,
            lots: openingResult.lots,
            trackingDate: updated.openingPosition.openingDate,
          });
        }
      } else if (editing.openingPosition) {
        removeSavedOpeningLots(editing.openingPosition, removeOpeningPosition);
        if (
          prevSymbol
          && !hasOtherInvestmentLogs(investments, {
            excludeId: editing.id,
            broker: prevBroker,
            symbolKey: prevSymbol,
          })
        ) {
          removeOpeningPositionsForInstrument(prevBroker, prevSymbol);
        }
      }
    }
    updateTransaction(type, updated);
    if (type === 'investment' && updated.instrumentSymbol) {
      unhidePortfolioSymbol(updated.instrumentSymbol);
    }
    if (
      type === 'investment'
      && updated.subCategoryId
      && updated.brokerId
      && setBrokerDefaultForSubCategory
    ) {
      setBrokerDefaultForSubCategory(updated.subCategoryId, updated.brokerId);
    }
    showToast('Updated', { variant: 'success', duration: 1500 });
  };

  // Mirrors TransactionsList.js's softDeleteWithUndo — delete immediately,
  // offer a 5s undo toast, only actually clean up the voice-note file (and,
  // for investments, only re-derive opening-position lots) once undone.
  const handleDeleteTx = () => {
    if (!editingTx) return;
    const { item, type } = editingTx;

    if (type === 'investment') {
      if (item.openingPosition) {
        removeSavedOpeningLots(item.openingPosition, removeOpeningPosition);
      } else if (item.instrumentSymbol && item.brokerId) {
        const hasOtherLogs = investments.some((tx) =>
          tx.id !== item.id
          && tx.instrumentSymbol
          && String(tx.instrumentSymbol).toUpperCase() === String(item.instrumentSymbol).toUpperCase()
          && tx.brokerId === item.brokerId,
        );
        if (!hasOtherLogs) {
          removeOpeningPositionsForInstrument(item.brokerId, item.instrumentSymbol);
        }
      }
    }
    deleteTransaction(type, item.id, { cleanupFiles: false });

    const UNDO_MS = 5000;
    let undone = false;
    const audioFile = item.voiceNote?.file;
    const cleanupTimer = setTimeout(() => {
      if (!undone && audioFile) deleteVoiceNote(audioFile);
    }, UNDO_MS + 500);

    const cat = (categories[type] ?? []).find((c) => c.id === item.categoryId);
    const label = cat
      ? `${cat.emoji} ${cat.label} ₹${formatMoney(item.amount)}`
      : `₹${formatMoney(item.amount)}`;

    showUndoableToast({
      message: `Deleted ${label}`,
      duration: UNDO_MS,
      onUndo: () => {
        undone = true;
        clearTimeout(cleanupTimer);
        if (type === 'investment' && item.openingPosition) {
          const lots = openingLotsFromSaved(item.openingPosition);
          const openingResult = syncOpeningLots({
            broker: item.openingPosition.broker ?? item.brokerId,
            symbol: item.openingPosition.symbol ?? item.instrumentSymbol,
            name: item.openingPosition.name ?? item.instrumentName ?? item.instrumentSymbol,
            lots,
            previousLots: [],
            addOpeningPosition,
            removeOpeningPosition,
          });
          const restored = openingResult?.ok
            ? {
              ...item,
              openingPosition: buildOpeningPositionPayload({
                broker: item.openingPosition.broker ?? item.brokerId,
                symbol: item.openingPosition.symbol ?? item.instrumentSymbol,
                name: item.openingPosition.name ?? item.instrumentName ?? item.instrumentSymbol,
                lots: openingResult.lots,
                trackingDate: item.openingPosition.openingDate,
              }),
            }
            : item;
          addTransaction(type, restored);
        } else {
          addTransaction(type, item);
        }
      },
    });
  };

  return (
    <View style={styles.screen}>
      <View style={styles.modeSwitchWrap}>
        <View style={styles.modeSwitch}>
          {VIEW_MODES.map(({ id, label }) => {
            const active = viewMode === id;
            return (
              <TouchableOpacity
                key={id}
                onPress={() => setViewMode(id)}
                style={[styles.modeSegment, active && styles.modeSegmentActive]}
                activeOpacity={0.75}
              >
                <Text style={[styles.modeSegmentText, active && styles.modeSegmentTextActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {viewMode === 'search' ? (
        <ActivitySearchPane
          navigation={navigation}
          onOpenItem={(tx, type) => setEditingTx({ item: tx, type })}
        />
      ) : (
        <>
          <View style={styles.controls}>
            <View style={styles.searchBar}>
              <AppIcon name="search" size={17} color={colors.text.secondary} strokeWidth={2} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Filter timeline by note, account, loan…"
                placeholderTextColor={colors.text.muted}
                style={styles.searchInput}
                autoCapitalize="none"
              />
              {query ? (
                <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
                  <AppIcon name="x" size={16} color={colors.text.secondary} strokeWidth={2} />
                </TouchableOpacity>
              ) : null}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
              {FILTERS.map(([id, label]) => (
                <TouchableOpacity
                  key={id}
                  onPress={() => setFilter(id)}
                  style={[styles.filter, filter === id && styles.filterActive]}
                >
                  <Text style={[styles.filterText, filter === id && styles.filterTextActive]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            contentContainerStyle={[styles.list, sections.length === 0 && styles.emptyList]}
            stickySectionHeadersEnabled={false}
            renderSectionHeader={({ section }) => <Text style={styles.dayTitle}>{section.title}</Text>}
            renderItem={({ item }) => <ActivityRow item={item} onPress={() => openItem(item)} />}
            ListEmptyComponent={(
              <EmptyState
                icon="activity"
                title="No matching activity"
                body="Try another type or clear the filter."
                tint={colors.accent.primary}
              />
            )}
          />
        </>
      )}

      {editingTx && (
        <EditTransactionModal
          visible
          item={editingTx.item}
          type={editingTx.type}
          categories={categories[editingTx.type] ?? []}
          accounts={accounts}
          accountGroups={accountGroups}
          accentColor={
            editingTx.type === 'income' ? colors.accent.income
              : editingTx.type === 'investment' ? colors.accent.investment
              : colors.accent.expense
          }
          onClose={() => setEditingTx(null)}
          onSave={handleSaveTx}
          onDelete={handleDeleteTx}
        />
      )}
    </View>
  );
}

function ActivityRow({ item, onPress }) {
  const styles = useThemedStyles(makeStyles);
  const sign = item.direction > 0 ? '+' : item.direction < 0 ? '−' : '';
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.72}>
      <View style={[styles.rowIcon, { backgroundColor: `${item.color}18` }]}>
        <AppIcon name={item.icon} size={19} color={item.color} strokeWidth={2.1} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.rowSub} numberOfLines={1}>{item.subtitle}</Text>
        <View style={styles.rowMeta}>
          <StatusBadge label={item.type === 'loan' ? 'Loan' : item.type.charAt(0).toUpperCase() + item.type.slice(1)} />
          <Text style={styles.time}>{new Date(item.date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</Text>
        </View>
      </View>
      {item.amount > 0 ? (
        <Text style={[styles.amount, { color: item.direction === 0 ? item.color : item.direction > 0 ? '#059669' : '#dc2626' }]}>
          {sign}{formatMoney(item.amount, item.currency)}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

const makeStyles = (c) => ({
  screen: { flex: 1, backgroundColor: c.bg.canvas },
  modeSwitchWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  modeSwitch: {
    flexDirection: 'row',
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: radii.pill,
    padding: 3,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  modeSegment: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: radii.pill,
    alignItems: 'center',
  },
  modeSegmentActive: {
    backgroundColor: c.bg.surface,
    boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 4, color: 'rgba(0, 0, 0, 0.06)' }],
    elevation: 1,
  },
  modeSegmentText: {
    fontSize: 13,
    fontWeight: '700',
    color: c.text.secondary,
  },
  modeSegmentTextActive: {
    color: c.text.primary,
  },
  controls: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, backgroundColor: c.bg.canvas },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 46, paddingHorizontal: spacing.md, backgroundColor: c.bg.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: c.border.subtle },
  searchInput: { flex: 1, color: c.text.primary, fontSize: 14 },
  filters: { gap: spacing.sm, paddingVertical: spacing.md },
  filter: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: c.bg.surface, borderWidth: 1, borderColor: c.border.subtle },
  filterActive: { backgroundColor: c.accent.primary, borderColor: c.accent.primary },
  filterText: { color: c.text.secondary, fontSize: 12, fontWeight: '700' },
  filterTextActive: { color: c.text.inverse },
  list: { paddingHorizontal: spacing.lg, paddingBottom: 48 },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  dayTitle: { color: c.text.secondary, fontSize: 12, fontWeight: '900', marginTop: spacing.md, marginBottom: spacing.xs, textTransform: 'uppercase', letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: c.border.subtle },
  rowIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { color: c.text.primary, fontSize: 14, fontWeight: '800' },
  rowSub: { color: c.text.secondary, fontSize: 11, marginTop: 3 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 6 },
  time: { color: c.text.muted, fontSize: 10 },
  amount: { fontSize: 13, fontWeight: '900', maxWidth: 130, textAlign: 'right' },
});
