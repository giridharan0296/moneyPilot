import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Animated,
  DeviceEventEmitter,
  PanResponder,
  Platform,
  ScrollView,
  SectionList,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import CategoryPieChart, { PieLegendList } from './CategoryPieChart';
import DateFilterBar from './DateFilterBar';
import TransactionDayHeader from './TransactionDayHeader';
import EditTransactionModal from './EditTransactionModal';
import AddTransactionModal from './AddTransactionModal';
import VoicePlayer from './VoicePlayer';
import AppIcon from './AppIcon';
import PressableScale from './PressableScale';
import { useDateFilter } from '../contexts/DateFilterContext';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { usePortfolio } from '../contexts/PortfolioContext';
import { useNetWorth } from '../contexts/NetWorthContext';
import { useToast } from '../contexts/ToastContext';
import { useRecurring } from '../contexts/RecurringContext';
import { useConfirmSheet } from '../contexts/ConfirmSheetContext';
import { deleteVoiceNote } from '../lib/voiceNotes';
import { radii, spacing, elevation, moneyText } from '../lib/theme';
import {
  baseAmountOf,
  formatMoney as formatMoneyCurrency,
  formatMoneyDisplay,
  isForeign,
} from '../lib/currency';
import { formatSubCategoryLabel } from '../lib/categoryDisplay';
import { findItemInDaySections, groupItemsByDay } from '../lib/transactionDayGroups';
import { sortByCreatedAtDesc } from '../lib/transactionSort';
import { buildRecurringRuleInput } from '../lib/recurring';
import { formatChitGrams, GOLD_CHIT_SUB_ID, isClosedGoldChitTx } from '../lib/goldChit';
import {
  aggregateOpeningLots,
  buildOpeningPositionPayload,
  openingLotsFromSaved,
  removeSavedOpeningLots,
  syncOpeningLots,
} from '../lib/openingPositions';
import { holdingPortfolioSymbol } from '../lib/portfolioHoldings';

function investmentBrokerKey(tx) {
  return tx?.openingPosition?.broker ?? tx?.brokerId ?? 'logged';
}

function investmentSymbolKey(tx) {
  const raw = tx?.openingPosition?.symbol ?? tx?.instrumentSymbol;
  return raw ? holdingPortfolioSymbol({ symbol: raw }) : null;
}

function hasOtherInvestmentLogs(items, { excludeId, broker, symbolKey }) {
  if (!symbolKey) return false;
  return items.some((tx) => {
    if (excludeId && tx.id === excludeId) return false;
    if (!tx.instrumentSymbol) return false;
    if (holdingPortfolioSymbol({ symbol: tx.instrumentSymbol }) !== symbolKey) return false;
    return (tx.brokerId || 'logged') === broker;
  });
}

// ----------------------------------------------------------------------------
// TransactionsList — the reusable "list of transactions of one type" screen.
// Wraps: DateFilterBar, total card, chart, add form, and the actual list.
// Row tap opens the edit modal; swipe left reveals Delete (with confirm).
//
// Transaction data comes from TransactionsContext (single source of truth
// across Dashboard / Expenses / Income / Investments / Import). This screen
// no longer touches AsyncStorage directly — mutations go through the
// context's CRUD helpers, which handle voice-note cleanup and persistence.
//
// Props:
//   focusId — when set (e.g. via navigation params from the Search screen),
//     the row with this id is scrolled into view and briefly highlighted
//     after mount. Undefined means no focus.
// ----------------------------------------------------------------------------

// Synthetic "unknown" category displayed for transactions whose categoryId
// no longer exists in Settings (deleted / renamed / migrated away). Prior
// behaviour fell back to the LAST category in the settings list, which
// mislabelled rows (a coffee purchase showed up as "🎁 Gift" purely because
// Gift happened to be at the tail). This synthetic value is never mistaken
// for a real category — it has a reserved id prefix and neutral styling.
// Synthetic "unknown" category — color resolved at render from theme.
const UNKNOWN_CATEGORY_BASE = {
  id: '__unknown__',
  label: 'Unknown',
  emoji: '📌',
};

const SWIPE_ACTION_WIDTH = 80;
const SWIPE_THRESHOLD = 8;
const SWIPE_ANGLE_BIAS = 1.5;

export default function TransactionsList({
  type,
  amountPrefix = '-',
  amountColor,
  accentColor,
  copy = {},
  focusId = null,
  listHeaderPrefix = null,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const unknownCategory = useMemo(
    () => ({ ...UNKNOWN_CATEGORY_BASE, color: themeColors.text.muted }),
    [themeColors.text.muted],
  );
  const resolvedAmountColor = amountColor ?? (
    type === 'income'
      ? themeColors.accent.income
      : type === 'expense'
        ? themeColors.accent.expense
        : themeColors.accent.investment
  );
  const resolvedAccentColor = accentColor ?? resolvedAmountColor;
  const { addOpeningPosition, removeOpeningPosition, removeOpeningPositionsForInstrument } = usePortfolio();
  const { unhidePortfolioSymbol } = useNetWorth();
  const t = {
    totalLabel: 'TOTAL',
    chartTitle: 'By Category',
    addFormTitle: 'Add entry',
    submitLabel: 'Add entry',
    notePlaceholder: 'e.g. lunch with team',
    emptyIcon: 'edit-3',
    emptyTitle: 'Nothing here yet.',
    emptySub: 'Tap + to add your first entry.',
    ...copy,
  };

  const {
    categories: allCategories,
    accounts,
    accountGroups,
    baseCurrency,
    fxRates,
    setBrokerDefaultForSubCategory,
    brokers,
  } = useSettings();
  const categories = allCategories[type] ?? [];

  // Broker chip list for the investment-only filter row. Mirrors the
  // same exclusion (`generic`) used by TransactionForm so the filter is
  // a strict subset of what users can actually SET on a transaction.
  // Sourced from useSettings().brokers so user renames / additions in
  // the Brokers management screen show up here without a rebuild.
  const filterBrokers = useMemo(
    () => (Array.isArray(brokers) ? brokers.filter((b) => b.id !== 'generic') : []),
    [brokers],
  );

  // Broker filter (investment lists only). null = "all brokers".
  // Deliberately kept local — the filter is a per-screen viewing
  // choice, not persisted across app launches; that mirrors how
  // DateFilter behaves for month/week jumps.
  const [brokerFilter, setBrokerFilter] = useState(null);
  const [chartSelection, setChartSelection] = useState(null);

  // Reset the broker filter whenever the list TYPE changes. In
  // practice this component is mounted per type (Expenses, Income,
  // Investments) so this is defensive — but if Search ever navigates
  // between types while re-using the mount, we don't want a stale
  // "Zerodha only" filter carrying over onto Expenses.
  useEffect(() => {
    if (type !== 'investment' && brokerFilter !== null) {
      setBrokerFilter(null);
    }
  }, [type, brokerFilter]);

  const {
    ready,
    listFor,
    addTransaction,
    updateTransaction,
    deleteTransaction,
  } = useTransactions();
  const { showToast, showUndoableToast } = useToast();
  const { addRule } = useRecurring();
  const { confirm } = useConfirmSheet();

  const items = listFor(type);

  // ---- Add / Edit modal state ----
  // `showAdd`  → new-transaction modal opened by the header/FAB "+" button
  // `editing`  → existing transaction being edited (or null when closed)
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [addPrefill, setAddPrefill] = useState(null);

  // Tell the parent tab (Transactions / Invest) to hide its FAB while a
  // modal is open — otherwise the FAB can sit above the form on web and
  // steal taps.
  useEffect(() => {
    DeviceEventEmitter.emit(
      'transactions:modalOpen',
      showAdd || editing !== null,
    );
    return () => {
      DeviceEventEmitter.emit('transactions:modalOpen', false);
    };
  }, [showAdd, editing]);

  // ---- Focus-and-highlight (Search → row jump) ----
  //
  // When Search navigates here with `focusId`, we scroll the matching row
  // into view and paint it briefly so the user's eye can find it. If the
  // row isn't in the current date-filtered view, we widen to "All time"
  // via the toast affordance below (kept as a lightweight nudge — silent
  // widening would confuse users who chose a filter deliberately).
  const listRef = useRef(null);
  const focusedRef = useRef(false); // guard: only auto-scroll once per focusId
  useEffect(() => {
    focusedRef.current = false;
  }, [focusId]);

  // ---- FAB "+" shortcut (from the parent Transactions screen) ----
  //
  // The Transactions parent screen (screens/TransactionsScreen.js) renders
  // a floating "+" button whose tint follows the currently active top-tab
  // (green for income, red for expense). Tapping it emits
  // `transactions:openAdd` with `{ type }`. Every mounted TransactionsList
  // instance listens and, if the type matches its own, opens its own
  // AddTransactionModal.
  //
  // We use DeviceEventEmitter instead of a Context because the parent-child
  // relationship is opaque through React Navigation (Income and Expense
  // screens are rendered as siblings, only one is focused at a time). The
  // event bus is one line to subscribe, one line to emit, no plumbing.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      'transactions:openAdd',
      (payload) => {
        if (payload?.type !== type) return;
        setAddPrefill(payload?.prefill ?? null);
        setShowAdd(true);
      },
    );
    return () => sub.remove();
  }, [type]);

  // ---- Global date filter ----
  const {
    filterByRange,
    label: rangeLabel,
    isAllTime,
    isInCurrentRange,
    showMonthOf,
  } = useDateFilter();
  // Filter chain: date-window first, then broker (investment only).
  // Applied in this order so the "no results in this range" copy
  // still fires when it's the date filter that emptied the list,
  // and the broker chip counts (below) reflect the currently-
  // visible date window.
  //
  // Special sentinel: brokerFilter === '__none__' filters to rows
  // without a broker set (legacy or intentional). Anything else
  // matches by exact brokerId.
  //
  // Always sort by createdAt DESC so "Recent" is newest-timestamp-first
  // even when a row's time was edited, or demo/import data wasn't
  // prepended in chronological order.
  const dateFilteredItems = filterByRange(items);
  const filteredItems = useMemo(() => {
    let list = (type === 'investment' && brokerFilter)
      ? dateFilteredItems.filter((tx) =>
          brokerFilter === '__none__'
            ? !tx.brokerId
            : tx.brokerId === brokerFilter,
        )
      : dateFilteredItems;
    if (type === 'investment') {
      list = list.filter((tx) => !isClosedGoldChitTx(tx));
    }
    return sortByCreatedAtDesc(list);
  }, [dateFilteredItems, type, brokerFilter]);

  const daySections = useMemo(
    () => groupItemsByDay(filteredItems, {
      sumAmount: (item) => baseAmountOf(item, fxRates, baseCurrency, 'amount'),
    }),
    [filteredItems, fxRates, baseCurrency],
  );

  // ---- Derived ----
  // Sum in BASE CURRENCY. Foreign-currency rows contribute their frozen
  // `amountInBase` snapshot; pure INR (or same-as-base) rows keep their
  // raw `amount`. This means the headline TOTAL is always in the user's
  // base currency, even for multi-currency accounts.
  const total = useMemo(
    () => filteredItems.reduce(
      (sum, e) => sum + baseAmountOf(e, fxRates, baseCurrency, 'amount'),
      0,
    ),
    [filteredItems, fxRates, baseCurrency],
  );

  // Bucket every filtered transaction by its categoryId. Any tx pointing at
  // a categoryId that no longer exists in Settings is folded into a single
  // synthetic "Unknown / Deleted" slice — this way the pie segments always
  // sum to TOTAL (previously stale-category rows silently disappeared from
  // the chart while still counting in the headline number).
  const byCategory = useMemo(() => {
    const totals = {};
    for (const e of filteredItems) {
      const inBase = baseAmountOf(e, fxRates, baseCurrency, 'amount');
      totals[e.categoryId] = (totals[e.categoryId] ?? 0) + inBase;
    }
    const catById = new Map(categories.map((c) => [c.id, c]));
    let unknownTotal = 0;
    const slices = [];
    for (const [cid, amt] of Object.entries(totals)) {
      if (amt <= 0) continue;
      const cat = catById.get(cid);
      if (cat) {
        slices.push({
          id: cat.id,
          label: cat.label,
          emoji: cat.emoji,
          color: cat.color,
          value: amt,
          percent: total > 0 ? (amt / total) * 100 : 0,
        });
      } else {
        unknownTotal += amt;
      }
    }
    if (unknownTotal > 0) {
      slices.push({
        id: unknownCategory.id,
        label: unknownCategory.label,
        emoji: unknownCategory.emoji,
        color: unknownCategory.color,
        value: unknownTotal,
        percent: total > 0 ? (unknownTotal / total) * 100 : 0,
      });
    }
    return slices.sort((a, b) => b.value - a.value);
  }, [filteredItems, categories, fxRates, baseCurrency, total, unknownCategory]);

  useEffect(() => {
    setChartSelection(null);
  }, [rangeLabel, brokerFilter, filteredItems.length]);

  // ---- Handlers ----
  const handleAdd = (values) => {
    if (type === 'expense' && Array.isArray(values.splits) && values.splits.length > 0) {
      const splitGroupId = `split_${Date.now()}`;
      values.splits.forEach((split, index) => {
        addTransaction('expense', {
          id: `${splitGroupId}_${index}`,
          amount: split.amount,
          categoryId: split.categoryId,
          subCategoryId: null,
          accountId: values.accountId,
          note: values.note,
          tags: values.tags ?? [],
          voiceNote: index === 0 ? values.voiceNote ?? null : null,
          createdAt: values.date.toISOString(),
          currency: values.currency,
          fxRate: values.fxRate,
          amountInBase: split.amount * (Number(values.fxRate) || 1),
          splitGroupId,
        });
      });
      showToast(`Saved ${values.splits.length} expense splits`, { variant: 'success', duration: 1500 });
      return;
    }
    const newItem = {
      id: Date.now().toString(),
      amount: values.amount,
      categoryId: values.categoryId,
      subCategoryId: values.subCategoryId ?? null,
      accountId: values.accountId,
      note: values.note,
      tags: values.tags ?? [],
      voiceNote: values.voiceNote ?? null,
      createdAt: values.date.toISOString(),
      currency: values.currency,
      fxRate: values.fxRate,
      amountInBase: values.amountInBase,
      // Include brokerId ONLY for investment rows. Passing it through
      // on expense/income would clutter backups with meaningless
      // undefined fields; keeping this branch explicit also makes the
      // "this field only means something on investments" contract
      // visible at the call site.
      ...(type === 'investment' ? {
        brokerId: values.brokerId ?? null,
        instrumentSymbol: values.instrumentSymbol ?? null,
        instrumentName: values.instrumentName ?? null,
        instrumentType: values.instrumentType ?? null,
        investmentUnits: values.investmentUnits ?? null,
        historicalOnly: values.historicalOnly === true,
        ...(values.chitSchemeId ? {
          chitSchemeId: values.chitSchemeId,
          chitSchemeName: values.chitSchemeName,
          chitMetalPurity: values.chitMetalPurity,
          chitWeightGrams: values.chitWeightGrams,
          chitRatePerGram: values.chitRatePerGram,
          chitClosedAt: values.chitClosedAt ?? null,
          linkedChitAssetId: values.linkedChitAssetId ?? null,
        } : {}),
      } : {}),
      ...(type === 'income' ? {
        payslipBasic: values.payslipBasic ?? null,
        payslipHra: values.payslipHra ?? null,
        payslipSpecial: values.payslipSpecial ?? null,
        payslipOther: values.payslipOther ?? null,
        payslipTds: values.payslipTds ?? null,
        payslipPf: values.payslipPf ?? null,
        payslipGross: values.payslipGross ?? null,
        payslipNet: values.payslipNet ?? null,
        payslipSource: values.payslipSource ?? null,
        payslipAmountMode: values.payslipAmountMode ?? null,
      } : {}),
    };
    let openingResult = null;
    if (type === 'investment' && values.openingPosition) {
      const lots = openingLotsFromSaved(values.openingPosition);
      const broker = values.openingPosition.broker ?? values.brokerId;
      const symbol = values.openingPosition.symbol ?? values.instrumentSymbol;
      if (broker && symbol) {
        removeOpeningPositionsForInstrument(broker, symbol);
      }
      openingResult = syncOpeningLots({
        broker,
        symbol,
        name: values.openingPosition.name ?? values.instrumentName ?? values.instrumentSymbol,
        lots,
        previousLots: [],
        addOpeningPosition,
        removeOpeningPosition,
      });
      if (openingResult?.ok) {
        newItem.openingPosition = buildOpeningPositionPayload({
          broker: values.openingPosition.broker ?? values.brokerId,
          symbol: values.openingPosition.symbol ?? values.instrumentSymbol,
          name: values.openingPosition.name ?? values.instrumentName ?? values.instrumentSymbol,
          lots: openingResult.lots,
          trackingDate: values.openingPosition.openingDate,
        });
      } else {
        showToast('Investment saved, but opening lots failed — edit the entry to add them again.', {
          variant: 'warning',
          duration: 3500,
        });
      }
    }
    addTransaction(type, newItem);
    if (type === 'investment' && values.instrumentSymbol) {
      unhidePortfolioSymbol(values.instrumentSymbol);
    }

    let recurringCreated = false;
    if (values.makeRecurring) {
      const ruleInput = buildRecurringRuleInput(values, type);
      if (ruleInput) {
        const created = addRule(ruleInput);
        recurringCreated = Boolean(created);
        if (!created) {
          showToast('Entry saved, but the recurring rule could not be created.', {
            variant: 'warning',
            duration: 3500,
          });
        }
      }
    }

    const recurringSuffix = recurringCreated ? ' · recurring rule added' : '';

    if (openingResult?.ok) {
      const summary = aggregateOpeningLots(openingResult.lots);
      showToast(
        (values.historicalOnly
          ? `Historical holding saved — ${summary.quantity.toLocaleString('en-IN')} units in portfolio (bank balance unchanged).`
          : `Saved current purchase + ${summary.quantity} historical units across ${openingResult.lots.length} lot${openingResult.lots.length === 1 ? '' : 's'}.`) + recurringSuffix,
        { variant: 'success', duration: recurringCreated ? 2800 : 2500 },
      );
    }

    // Remember "user last used <broker> for <sub-category>". Only
    // record when BOTH are present — writing null would poison the
    // map and silently disable auto-suggest for that sub next time.
    if (
      type === 'investment'
      && values.subCategoryId
      && values.brokerId
      && setBrokerDefaultForSubCategory
    ) {
      setBrokerDefaultForSubCategory(values.subCategoryId, values.brokerId);
    }

    // If the new entry falls outside the current date filter, the row would
    // silently disappear from view — the user's most common cause of "did
    // it save?" confusion when entering past-dated transactions. Instead of
    // a blocking Alert, drop a snackbar with a one-tap "Show" so batch
    // entry isn't interrupted.
    //
    // Same story for the broker filter: entering a new Zerodha row while
    // the list is filtered to "Groww" would look like a silent failure.
    // Toast + "Show all" clears the filter and reveals the row.
    if (!isInCurrentRange(values.date)) {
      showToast(`Saved ${formatToastTimestamp(values.date)} — hidden by ${rangeLabel} filter.`, {
        variant: 'info',
        duration: 5000,
        actionLabel: 'Show',
        onAction: () => showMonthOf(values.date),
      });
    } else if (
      type === 'investment'
      && brokerFilter
      && (
        brokerFilter === '__none__'
          ? !!values.brokerId                     // "None" filter hides rows WITH a broker
          : values.brokerId !== brokerFilter       // named-broker filter hides everything else
      )
    ) {
      const activeLabel = brokerFilter === '__none__'
        ? '"No broker"'
        : filterBrokers.find((b) => b.id === brokerFilter)?.label ?? 'broker';
      showToast(
        `Saved — hidden by ${activeLabel} filter.`,
        {
          variant: 'info',
          duration: 5000,
          actionLabel: 'Show all',
          onAction: () => setBrokerFilter(null),
        },
      );
    } else if (!(type === 'investment' && openingResult?.ok)) {
      showToast(
        recurringCreated ? 'Saved · recurring rule added' : 'Saved',
        { variant: 'success', duration: recurringCreated ? 2200 : 1500 },
      );
    }
  };

  const handleSaveEdit = (updated) => {
    if (type === 'investment' && editing) {
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
          && !hasOtherInvestmentLogs(items, {
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
          && !hasOtherInvestmentLogs(items, {
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
    // Same "remember last broker" write on Edit. This is intentional:
    // if the user CORRECTS a wrong broker choice, that correction is
    // just as good a signal as an Add for what "usually" goes with
    // this sub-category. Also gated on both fields being present.
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

  const handleDeleteEdit = () => {
    if (!editing) return;
    // Edit-modal delete flows through the same undoable path as swipe
    // delete — captured before the modal closes so `editing` is stable.
    softDeleteWithUndo(editing);
  };

  // Shared delete-with-undo helper. Snapshots the item, deletes it without
  // touching the voice-note file yet, shows a toast with Undo, and schedules
  // the audio cleanup only when the undo window expires. If the user taps
  // Undo we re-insert the item and cancel the pending file delete.
  const cleanupOpeningForDeletedInvestment = useCallback((item) => {
    if (type !== 'investment') return;
    if (item.openingPosition) {
      removeSavedOpeningLots(item.openingPosition, removeOpeningPosition);
      return;
    }
    if (item.instrumentSymbol && item.brokerId) {
      const hasOtherLogs = items.some((tx) =>
        tx.id !== item.id
        && tx.instrumentSymbol
        && String(tx.instrumentSymbol).toUpperCase() === String(item.instrumentSymbol).toUpperCase()
        && tx.brokerId === item.brokerId,
      );
      if (!hasOtherLogs) {
        removeOpeningPositionsForInstrument(item.brokerId, item.instrumentSymbol);
      }
    }
  }, [type, items, removeOpeningPosition, removeOpeningPositionsForInstrument]);

  const softDeleteWithUndo = useCallback(
    (item) => {
      if (!item) return;
      cleanupOpeningForDeletedInvestment(item);
      deleteTransaction(type, item.id, { cleanupFiles: false });

      const UNDO_MS = 5000;
      let undone = false;
      const audioFile = item.voiceNote?.file;
      const cleanupTimer = setTimeout(() => {
        if (!undone && audioFile) deleteVoiceNote(audioFile);
      }, UNDO_MS + 500);

      const label = buildDeleteLabel(item, categories, unknownCategory);
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
    },
    [
      addTransaction,
      addOpeningPosition,
      categories,
      cleanupOpeningForDeletedInvestment,
      deleteTransaction,
      showUndoableToast,
      type,
      unknownCategory,
    ],
  );

  const handleQuickDelete = useCallback(
    async (item) => {
      if (!item) return;
      const label = buildDeleteLabel(item, categories, unknownCategory);
      const ok = await confirm({
        title: 'Delete this entry?',
        message: `${label}\n\nThis can be undone for a few seconds after deleting.`,
        confirmLabel: 'Delete',
        destructive: true,
      });
      if (ok) softDeleteWithUndo(item);
    },
    [categories, confirm, softDeleteWithUndo, unknownCategory],
  );

  // ---- Render helpers ----
  const renderRow = ({ item }) => {
    // Fall back to a SYNTHETIC "Unknown" category rather than an unrelated
    // real category (was: last-in-list). Sub-category is only ever resolved
    // against a REAL parent, so a stale sub reference automatically collapses
    // to null and doesn't get accidentally re-committed on Save.
    const realCat = categories.find((c) => c.id === item.categoryId) ?? null;
    const cat = realCat ?? unknownCategory;
    const sub = item.subCategoryId && realCat
      ? realCat.subCategories?.find((s) => s.id === item.subCategoryId) ?? null
      : null;
    const acc = accounts.find((a) => a.id === item.accountId) ?? null;
    const highlighted = focusId && item.id === focusId;
    // Multi-currency (F9): render the amount in the row's own currency
    // and, when foreign, append a small "≈ ₹XX" hint in base currency.
    const rowCurrency = item.currency ?? baseCurrency;
    const rowIsForeign = isForeign(rowCurrency, baseCurrency);
    const rowBaseAmount = baseAmountOf(item, fxRates, baseCurrency, 'amount');
    return (
      <SwipeableTransactionRow
        onPress={() => setEditing(item)}
        onDelete={() => handleQuickDelete(item)}
        deleteLabel={`Delete ${cat.label} ${formatMoneyCurrency(item.amount, rowCurrency)}`}
        highlighted={highlighted}
      >
          <Text style={styles.rowEmoji}>{cat.emoji}</Text>
          <View style={styles.rowMiddle}>
            <Text style={styles.rowCategory}>{cat.label}</Text>
            {sub && (
              <Text style={styles.rowSubCategory}>
                {sub.emoji} {formatSubCategoryLabel(sub.label)}
              </Text>
            )}
            {item.note ? (
              <Text style={styles.rowNote} numberOfLines={1}>
                {item.note}
              </Text>
            ) : type === 'investment' && item.instrumentName ? (
              <Text style={styles.rowNote} numberOfLines={1}>
                {item.instrumentName}
              </Text>
            ) : null}
            {item.tags && item.tags.length > 0 && (
              <View style={styles.rowTagsRow}>
                {item.tags.slice(0, 4).map((t) => (
                  <View key={t} style={styles.rowTag}>
                    <Text style={styles.rowTagText}>#{t}</Text>
                  </View>
                ))}
                {item.tags.length > 4 && (
                  <Text style={styles.rowTagOverflow}>+{item.tags.length - 4}</Text>
                )}
              </View>
            )}
            <View style={styles.rowMetaRow}>
              {acc && (
                <Text style={[styles.rowAccount, { color: acc.color }]}>
                  {acc.emoji} {acc.label}
                </Text>
              )}
              {/* Investment-only: show a small "→ Broker" badge when
                  a broker was picked. Keeps the row's mental model
                  consistent: "from ACCOUNT → to BROKER". Silently
                  omitted for legacy rows without a brokerId. */}
              {type === 'investment' && item.brokerId && (() => {
                const broker = brokers.find((b) => b.id === item.brokerId);
                if (!broker) return null;
                return (
                  <Text style={[styles.rowAccount, { color: broker.color }]}>
                    {' → '}{broker.emoji} {broker.label}
                  </Text>
                );
              })()}
              {Platform.OS !== 'web' && item.voiceNote?.file && (
                <View style={styles.rowVoiceWrap}>
                  {acc ? <Text style={styles.rowMetaDot}>·</Text> : null}
                  <VoicePlayer voiceNote={item.voiceNote} compact />
                </View>
              )}
            </View>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.rowAmount, { color: resolvedAmountColor }]}>
              {amountPrefix}
              {formatMoneyDisplay(item.amount, rowCurrency, { exact: true })}
            </Text>
            {rowIsForeign && (
              <Text style={styles.rowAmountSub}>
                ≈ {amountPrefix}{formatMoneyCurrency(rowBaseAmount, baseCurrency)}
              </Text>
            )}
            {item.subCategoryId === GOLD_CHIT_SUB_ID && item.chitWeightGrams > 0 && (
              <Text style={styles.rowChitGrams}>
                +{formatChitGrams(item.chitWeightGrams, 2)}
              </Text>
            )}
          </View>
      </SwipeableTransactionRow>
    );
  };

  // Modals must NOT sit inside KeyboardAvoidingView — nesting a RN Modal
  // under KAV commonly causes "keyboard opens but typing doesn't land"
  // on Android and web. Each modal owns its own KAV instead.
  return (
    <View style={styles.root}>
      <SectionList
        ref={listRef}
        sections={daySections}
        keyExtractor={(item) => item.id}
        renderItem={renderRow}
        renderSectionHeader={({ section }) => (
          <TransactionDayHeader
            title={section.title}
            subtitle={section.subtitle}
            total={section.total}
            baseCurrency={baseCurrency}
            totalColor={resolvedAmountColor}
          />
        )}
        stickySectionHeadersEnabled
        contentContainerStyle={styles.listContent}
        onScrollToLocationFailed={(info) => {
          setTimeout(() => {
            listRef.current?.scrollToLocation({
              sectionIndex: info.sectionIndex,
              itemIndex: Math.min(info.index, info.highestMeasuredFrameIndex),
              animated: true,
              viewPosition: 0.3,
            });
          }, 250);
        }}
        onContentSizeChange={() => {
          if (!focusId || focusedRef.current) return;
          const loc = findItemInDaySections(daySections, focusId);
          if (!loc) return;
          focusedRef.current = true;
          setTimeout(() => {
            listRef.current?.scrollToLocation({
              sectionIndex: loc.sectionIndex,
              itemIndex: loc.itemIndex,
              animated: true,
              viewPosition: 0.3,
            });
          }, 60);
        }}
        ListHeaderComponent={
          <>
            {listHeaderPrefix}

            <DateFilterBar />

            {type === 'investment' && (
              <BrokerFilterChipRow
                brokers={filterBrokers}
                items={dateFilteredItems}
                selectedId={brokerFilter}
                onSelect={setBrokerFilter}
                accentColor={resolvedAccentColor}
              />
            )}

            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>{t.totalLabel}</Text>
              <Text style={styles.totalAmount}>
                {formatMoneyDisplay(total, baseCurrency)}
              </Text>
              <Text style={styles.totalSub}>
                {filteredItems.length}{' '}
                {filteredItems.length === 1 ? 'entry' : 'entries'}
                {!isAllTime && ` · ${rangeLabel}`}
              </Text>
            </View>

            {byCategory.length > 0 && (
              <View style={styles.chartCard}>
                <Text style={styles.chartTitle}>{t.chartTitle}</Text>
                <CategoryPieChart
                  data={byCategory}
                  size={200}
                  selectedIndex={chartSelection}
                  onSelectedIndexChange={setChartSelection}
                />
                <PieLegendList
                  rows={byCategory}
                  total={total}
                  baseCurrency={baseCurrency}
                  selectedIndex={chartSelection}
                  onSelect={setChartSelection}
                  style={{ marginTop: spacing.lg, width: '100%' }}
                />
              </View>
            )}

            {/* Inline add form was removed as part of the FAB migration:
                a single Floating Action Button in the parent
                TransactionsScreen now opens AddTransactionModal (rendered
                below) so users have exactly one add-affordance. Removing
                the inline card also gives back a full screen height of
                vertical space for the chart + recent list — the two
                things users actually spend time reading. */}

            <View style={styles.listHeader}>
              <Text style={styles.listHeaderTitle}>Recent</Text>
            </View>
            {items.length > 0 && (
              <Text style={styles.tapHint}>Tap a row to edit · swipe left to delete</Text>
            )}
          </>
        }
        ListEmptyComponent={
          ready ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconWrap}>
                <AppIcon
                  name={t.emptyIcon}
                  size={44}
                  color={themeColors.text.muted}
                  strokeWidth={1.7}
                />
              </View>
              <Text style={styles.emptyText}>
                {items.length === 0
                  ? t.emptyTitle
                  : (type === 'investment' && brokerFilter && dateFilteredItems.length > 0)
                    ? `No entries for ${
                        brokerFilter === '__none__'
                          ? '"No broker"'
                          : filterBrokers.find((b) => b.id === brokerFilter)?.label
                              ?? 'this broker'
                      }.`
                    : `Nothing in ${rangeLabel}.`}
              </Text>
              <Text style={styles.emptySub}>
                {items.length === 0
                  ? t.emptySub
                  : (type === 'investment' && brokerFilter && dateFilteredItems.length > 0)
                    ? 'Tap "All" above to clear the broker filter.'
                    : 'Try a different range above.'}
              </Text>
            </View>
          ) : null
        }
      />

      {editing !== null && (
        <EditTransactionModal
          visible
          item={editing}
          onClose={() => setEditing(null)}
          categories={categories}
          accounts={accounts}
          accountGroups={accountGroups}
          accentColor={resolvedAccentColor}
          type={type}
          onSave={handleSaveEdit}
          onDelete={handleDeleteEdit}
        />
      )}

      {/* New-transaction modal, opened by the parent Transactions screen's
          FAB. Uses the same `handleAdd` pipeline as the old inline form
          so all the follow-through logic (broker-default persistence,
          "hidden by filter" toast, voice-note handling) still runs. */}
      {showAdd && (
        <AddTransactionModal
          visible
          onClose={() => {
            setShowAdd(false);
            setAddPrefill(null);
          }}
          categories={categories}
          accounts={accounts}
          accountGroups={accountGroups}
          accentColor={resolvedAccentColor}
          type={type}
          title={t.addFormTitle}
          submitLabel={t.submitLabel}
          notePlaceholder={t.notePlaceholder}
          initialValues={addPrefill || undefined}
          onAdd={handleAdd}
        />
      )}
    </View>
  );
}

// SwipeableTransactionRow — same PanResponder pattern as accounts /
// categories so we don't need react-native-gesture-handler. Swipe left
// reveals a delete pill; tap Delete (or confirm after) removes the row.
function SwipeableTransactionRow({ children, onPress, onDelete, deleteLabel, highlighted }) {
  const styles = useThemedStyles(makeStyles);
  const translateX = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);

  const snapClosed = () => {
    openRef.current = false;
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      speed: 20,
      bounciness: 6,
    }).start();
  };

  const snapOpen = () => {
    openRef.current = true;
    Animated.spring(translateX, {
      toValue: -SWIPE_ACTION_WIDTH,
      useNativeDriver: true,
      speed: 20,
      bounciness: 6,
    }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > SWIPE_THRESHOLD
        && Math.abs(g.dx) > Math.abs(g.dy) * SWIPE_ANGLE_BIAS,
      onMoveShouldSetPanResponderCapture: (_, g) =>
        Math.abs(g.dx) > SWIPE_THRESHOLD
        && Math.abs(g.dx) > Math.abs(g.dy) * SWIPE_ANGLE_BIAS,
      onPanResponderMove: (_, g) => {
        const base = openRef.current ? -SWIPE_ACTION_WIDTH : 0;
        const next = Math.max(
          -SWIPE_ACTION_WIDTH * 1.5,
          Math.min(0, base + g.dx),
        );
        translateX.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        const base = openRef.current ? -SWIPE_ACTION_WIDTH : 0;
        const final = base + g.dx;
        if (final < -SWIPE_ACTION_WIDTH * 0.4 || g.vx < -0.5) {
          snapOpen();
        } else {
          snapClosed();
        }
      },
      onPanResponderTerminate: snapClosed,
    }),
  ).current;

  return (
    <View style={styles.rowWrap}>
      <View style={styles.deleteBehind}>
        <TouchableOpacity
          style={styles.deleteBehindTap}
          onPress={() => {
            snapClosed();
            onDelete();
          }}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={deleteLabel}
        >
          <AppIcon name="trash-2" size={18} color="#fff" strokeWidth={2.2} />
          <Text style={styles.deleteBehindText}>Delete</Text>
        </TouchableOpacity>
      </View>
      <Animated.View
        style={[styles.rowSurface, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <PressableScale
          onPress={() => {
            if (openRef.current) {
              snapClosed();
              return;
            }
            onPress?.();
          }}
          haptic
          scaleTo={0.985}
          contentStyle={[styles.row, highlighted && styles.rowHighlighted]}
        >
          {children}
        </PressableScale>
      </Animated.View>
    </View>
  );
}

// Broker filter chip row (investment lists only). Only shows brokers
// that actually appear in the current date-filtered items — otherwise
// the row would list 11 brokers even for a user who's only ever used
// two. "All" resets the filter. Includes a synthetic "None" chip for
// investment rows without a broker set (legacy or user-skipped),
// otherwise those rows would be un-filterable.
function BrokerFilterChipRow({ brokers, items, selectedId, onSelect, accentColor }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  // Present brokers = union of {brokerId | brokerId in items} ∪ {null if any
  // item lacks a broker}. Preserve broker-list ordering (so chips stay in a
  // predictable layout across renders) instead of ordering by first
  // occurrence in the list.
  const seen = new Set();
  let hasUnassigned = false;
  for (const it of items) {
    if (it.brokerId) seen.add(it.brokerId);
    else hasUnassigned = true;
  }
  const orderedBrokers = brokers.filter((b) => seen.has(b.id));

  // Nothing to filter on. Suppress the row entirely rather than
  // rendering a lone "All" chip — that would just be noise.
  if (orderedBrokers.length === 0 && !hasUnassigned) return null;

  const isAll = !selectedId;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.brokerFilterRow}
    >
      <TouchableOpacity
        key="__all__"
        onPress={() => onSelect(null)}
        style={[
          styles.brokerChip,
          isAll && { backgroundColor: accentColor, borderColor: accentColor },
        ]}
        activeOpacity={0.7}
      >
        <Text
          style={[styles.brokerChipText, isAll && styles.brokerChipTextSelected]}
        >
          All
        </Text>
      </TouchableOpacity>
      {orderedBrokers.map((b) => {
        const selected = b.id === selectedId;
        return (
          <TouchableOpacity
            key={b.id}
            onPress={() => onSelect(selected ? null : b.id)}
            style={[
              styles.brokerChip,
              selected && { backgroundColor: accentColor, borderColor: accentColor },
            ]}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.brokerChipText,
                selected && styles.brokerChipTextSelected,
              ]}
            >
              {b.emoji} {b.label}
            </Text>
          </TouchableOpacity>
        );
      })}
      {hasUnassigned && (
        <TouchableOpacity
          key="__none__"
          onPress={() =>
            onSelect(selectedId === '__none__' ? null : '__none__')
          }
          style={[
            styles.brokerChip,
            selectedId === '__none__' && {
              backgroundColor: accentColor,
              borderColor: accentColor,
            },
          ]}
          activeOpacity={0.7}
        >
          <View style={styles.brokerChipInner}>
            <AppIcon
              name="pin"
              size={12}
              color={
                selectedId === '__none__'
                  ? themeColors.text.inverse
                  : themeColors.text.secondary
              }
              strokeWidth={2}
            />
            <Text
              style={[
                styles.brokerChipText,
                selectedId === '__none__' && styles.brokerChipTextSelected,
              ]}
            >
              No broker
            </Text>
          </View>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

function formatMoney(n) {
  if (!isFinite(n)) return '0.00';
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const time = d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (sameDay(d, now)) return `Today · ${time}`;
  if (sameDay(d, yesterday)) return `Yesterday · ${time}`;

  const day = d.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
  return `${day} · ${time}`;
}

function formatToastTimestamp(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return 'just now';
  return formatDate(d.toISOString());
}

// Human-readable label for the undo toast — "Coffee ₹120" beats "1 item".
// Falls back to the synthetic Unknown category (not an unrelated real one)
// when the category has been deleted, so the toast is truthful.
function buildDeleteLabel(item, categories, fallbackCategory) {
  const cat = categories.find((c) => c.id === item.categoryId) ?? fallbackCategory;
  return `${cat.emoji} ${cat.label} ₹${formatMoney(item.amount)}`;
}

const makeStyles = (c) => ({
  root: { flex: 1, backgroundColor: c.bg.canvas },
  listContent: { padding: spacing.xl, paddingBottom: 60 },

  totalCard: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: c.border.subtle,
    padding: spacing.lg + 2,
    marginBottom: spacing.lg,
  },

  brokerFilterRow: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  brokerChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.border.strong,
    backgroundColor: c.bg.surface,
  },
  brokerChipInner: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  brokerChipText: { fontSize: 12, color: c.text.secondary, fontWeight: '600' },
  brokerChipTextSelected: { color: c.text.inverse },
  totalLabel: { color: c.text.secondary, fontSize: 11, letterSpacing: 0.8, fontWeight: '600' },
  totalAmount: { ...moneyText.hero, color: c.text.primary, marginTop: spacing.xs },
  totalSub: { color: c.text.secondary, fontSize: 12, marginTop: spacing.xs },

  chartCard: {
    backgroundColor: c.bg.surface,
    borderRadius: radii['2xl'],
    padding: spacing.xl,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: c.border.subtle,
    alignItems: 'center',
    ...elevation.card,
  },
  chartTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: c.text.primary,
    alignSelf: 'flex-start',
    marginBottom: spacing.md,
  },

  // formCard / formTitle removed alongside the inline add form (see the
  // FAB migration in TransactionsScreen.js). AddTransactionModal renders
  // its own header, so no in-list card styles are needed anymore.

  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  listHeaderTitle: { fontSize: 14, fontWeight: '700', color: c.text.primary },
  tapHint: { fontSize: 11, color: c.text.muted, marginBottom: spacing.sm },

  rowWrap: {
    marginBottom: spacing.sm,
    borderRadius: radii.xl,
    overflow: 'hidden',
  },
  deleteBehind: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: SWIPE_ACTION_WIDTH,
    backgroundColor: '#dc2626',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteBehindTap: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 3,
  },
  deleteBehindText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  rowSurface: {
    backgroundColor: c.bg.surface,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: c.border.subtle,
    ...elevation.card,
  },
  // Applied when the row is the target of a Search-navigation focus.
  // Kept subtle — an accent-tinted border + fill is enough for the eye
  // to find the row without being disruptive.
  rowHighlighted: {
    backgroundColor: c.accent.primary + '10',
    borderColor: c.accent.primary,
  },
  rowEmoji: { fontSize: 24, marginRight: spacing.md },
  rowMiddle: { flex: 1, minWidth: 0 },
  rowCategory: { fontSize: 14, fontWeight: '600', color: c.text.primary },
  rowSubCategory: { fontSize: 12, color: c.text.secondary, marginTop: 2, lineHeight: 16 },
  rowNote: { fontSize: 12, color: c.text.secondary, marginTop: 2 },
  rowTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
    alignItems: 'center',
  },
  rowTag: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    backgroundColor: c.accent.primary + '15',
  },
  rowTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: c.accent.primary,
  },
  rowTagOverflow: {
    fontSize: 10,
    color: c.text.muted,
    fontWeight: '600',
  },
  rowMetaRow: { flexDirection: 'row', marginTop: 2, alignItems: 'center' },
  rowDate: { fontSize: 11, color: c.text.muted },
  rowAccount: { fontSize: 11, fontWeight: '600', marginLeft: spacing.xs },
  rowMetaDot: { fontSize: 11, color: c.text.muted, marginHorizontal: spacing.xs },
  rowVoiceWrap: { flexDirection: 'row', alignItems: 'center' },
  rowAmount:    { fontSize: 15, fontWeight: '700' },
  rowAmountSub: {
    fontSize: 11,
    color: c.text.secondary,
    fontStyle: 'italic',
    marginTop: 2,
  },
  rowChitGrams: {
    fontSize: 11,
    fontWeight: '800',
    color: c.accent.gold,
    marginTop: 2,
  },
  emptyState: { alignItems: 'center', marginTop: spacing['2xl'] },
  emptyIconWrap: { marginBottom: spacing.sm, opacity: 0.85 },
  emptyText: { fontSize: 15, fontWeight: '600', color: c.text.primary },
  emptySub: { fontSize: 13, color: c.text.secondary, marginTop: spacing.xs },
});
