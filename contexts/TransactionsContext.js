// ----------------------------------------------------------------------------
// TransactionsContext — the single source of truth for expense / income /
// investment transactions.
//
// Before this context existed, each screen (Dashboard, Expenses, Income,
// Investments, ImportTransactions) independently loaded transactions from
// AsyncStorage. That worked but was wasteful (duplicate loads, three
// parallel copies of the same rows) and required a `useFocusEffect` reload
// dance on the Dashboard to see edits made elsewhere. This context fixes
// both: one canonical copy in memory, every screen subscribes to it,
// mutations propagate instantly.
//
// Data shape per transaction (unchanged from before):
//   {
//     id, amount, categoryId, subCategoryId?, accountId, note?,
//     voiceNote?: { file, duration }, createdAt (ISO string)
//   }
//
// Three lists live side-by-side because they're stored under three different
// keys and consumed by three different screens. Bundling them here means
// callers pass a `type` ('expense' | 'income' | 'investment') and get the
// right slice back.
// ----------------------------------------------------------------------------

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  blockWrites,
  readStoredJson,
  writeStored,
} from '../lib/safeStorage';
import { STORAGE_KEYS } from '../constants';
import { roundMoney } from '../lib/currency';
import { deleteVoiceNote } from '../lib/voiceNotes';
import { GOLD_CHIT_SUB_ID } from '../lib/goldChit';

const TransactionsContext = createContext(null);

const TYPES = ['expense', 'income', 'investment'];

// Normalize a raw stored transaction into the current schema. Handles
// backfill for fields introduced after v1 (subCategoryId, tags, …). Called
// on every load and on import/restore paths so downstream code can assume
// the full shape is present.
//
// F9 (multi-currency): every row now carries a `currency` code + an
// `amountInBase` snapshot. Legacy rows without either field are treated
// as the current base currency at aggregation time — no destructive
// backfill here because we don't want to freeze a wrong rate onto old
// rows retroactively. The amountInBase computation happens at add /
// edit time in components/TransactionForm (once the user picks a rate);
// for legacy rows, aggregates fall back to `amount` itself.
function normalizeTx(t) {
  const currency = (t?.currency && typeof t.currency === 'string')
    ? String(t.currency).toUpperCase()
    : null;
  const amount = Number(t?.amount);
  const fxRateVal = (t?.fxRate != null && isFinite(Number(t.fxRate)))
    ? Number(t.fxRate)
    : null;
  // Keep amountInBase in sync with amount whenever a rate is known.
  // Edits used to update `amount` but leave the old snapshot, so charts
  // and totals (which sum amountInBase) showed stale values.
  let amountInBase = null;
  if (isFinite(amount) && fxRateVal != null && fxRateVal > 0) {
    amountInBase = roundMoney(amount * fxRateVal);
  } else if (t?.amountInBase != null && isFinite(Number(t.amountInBase))) {
    amountInBase = Number(t.amountInBase);
  }
  // Investment-only: canonicalize brokerId as a string or null. Legacy
  // rows without this field stay undefined via the outer spread — we
  // only tighten the value when it's actually present so we don't add
  // stray `brokerId: null` fields to expense/income backups.
  const brokerId = (typeof t?.brokerId === 'string' && t.brokerId.length > 0)
    ? t.brokerId
    : (t && Object.prototype.hasOwnProperty.call(t, 'brokerId') ? null : undefined);
  const investmentUnits = t?.investmentUnits != null && isFinite(Number(t.investmentUnits))
    ? Number(t.investmentUnits)
    : null;
  const isGoldChit = t?.subCategoryId === GOLD_CHIT_SUB_ID;
  const chitWeightGrams = isGoldChit && t?.chitWeightGrams != null && isFinite(Number(t.chitWeightGrams))
    ? Number(t.chitWeightGrams)
    : null;
  const chitRatePerGram = isGoldChit && t?.chitRatePerGram != null && isFinite(Number(t.chitRatePerGram))
    ? Number(t.chitRatePerGram)
    : null;
  const payslipNum = (key) => {
    const n = Number(t?.[key]);
    return isFinite(n) && n >= 0 ? n : null;
  };
  const hasPayslip = t?.payslipTds != null || t?.payslipBasic != null || t?.payslipGross != null
    || t?.payslipSource != null;
  const normalized = {
    ...t,
    // Persisted backups/imports may contain numeric strings. Keep the
    // in-memory ledger numeric so reducers cannot concatenate values.
    // Invalid/non-finite amounts are neutralized instead of poisoning every
    // downstream total with NaN/Infinity.
    amount: isFinite(amount) ? amount : 0,
    tags: Array.isArray(t?.tags) ? sanitizeTags(t.tags) : [],
    subCategoryId: t?.subCategoryId ?? null,
    currency,
    amountInBase,
    fxRate: fxRateVal,
    ...(brokerId !== undefined ? { brokerId } : {}),
    ...(t?.instrumentSymbol ? {
      instrumentSymbol: String(t.instrumentSymbol).trim().toUpperCase(),
      instrumentName: String(t.instrumentName || t.instrumentSymbol).trim(),
      instrumentType: t.instrumentType ?? null,
      investmentUnits,
    } : {}),
    ...(t?.historicalOnly === true ? { historicalOnly: true } : {}),
  };
  if (isGoldChit) {
    normalized.chitSchemeId = typeof t?.chitSchemeId === 'string' ? t.chitSchemeId : null;
    normalized.chitSchemeName = typeof t?.chitSchemeName === 'string' ? t.chitSchemeName.trim() : null;
    normalized.chitMetalPurity = ['24k', '22k', '18k'].includes(t?.chitMetalPurity) ? t.chitMetalPurity : '22k';
    normalized.chitWeightGrams = chitWeightGrams;
    normalized.chitRatePerGram = chitRatePerGram;
    normalized.chitClosedAt = typeof t?.chitClosedAt === 'string' ? t.chitClosedAt : null;
    normalized.linkedChitAssetId = typeof t?.linkedChitAssetId === 'string' ? t.linkedChitAssetId : null;
  } else {
    delete normalized.chitSchemeId;
    delete normalized.chitSchemeName;
    delete normalized.chitMetalPurity;
    delete normalized.chitWeightGrams;
    delete normalized.chitRatePerGram;
    delete normalized.chitClosedAt;
    delete normalized.linkedChitAssetId;
  }
  if (hasPayslip) {
    normalized.payslipBasic = payslipNum('payslipBasic');
    normalized.payslipHra = payslipNum('payslipHra');
    normalized.payslipSpecial = payslipNum('payslipSpecial');
    normalized.payslipOther = payslipNum('payslipOther');
    normalized.payslipTds = payslipNum('payslipTds');
    normalized.payslipPf = payslipNum('payslipPf');
    normalized.payslipGross = payslipNum('payslipGross');
    normalized.payslipNet = payslipNum('payslipNet');
    normalized.payslipSource = typeof t?.payslipSource === 'string' ? t.payslipSource.trim() : null;
    normalized.payslipAmountMode = t?.payslipAmountMode === 'gross' ? 'gross' : 'net';
  } else {
    delete normalized.payslipBasic;
    delete normalized.payslipHra;
    delete normalized.payslipSpecial;
    delete normalized.payslipOther;
    delete normalized.payslipTds;
    delete normalized.payslipPf;
    delete normalized.payslipGross;
    delete normalized.payslipNet;
    delete normalized.payslipSource;
    delete normalized.payslipAmountMode;
  }
  return normalized;
}

// Trim, drop empties, drop duplicates (case-insensitive), cap at 8 to keep
// UI predictable. Preserves the original casing of the first occurrence.
function sanitizeTags(raw) {
  const seen = new Set();
  const out = [];
  for (const r of raw) {
    const s = String(r ?? '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= 8) break;
  }
  return out;
}

export function TransactionsProvider({ children }) {
  const [expenses,    setExpenses]    = useState([]);
  const [income,      setIncome]      = useState([]);
  const [investments, setInvestments] = useState([]);
  const [ready,       setReady]       = useState(false);

  // Setter dispatch — pick the correct useState setter for a given type.
  // These setState functions are stable across renders (React guarantees
  // that), so callers can capture them freely inside useCallback.
  const setterFor = (type) => ({
    expense:    setExpenses,
    income:     setIncome,
    investment: setInvestments,
  }[type]);

  // ---- Load persisted lists on mount ------------------------------------
  //
  // Each list loads on its own: one unreadable key must not stop the others
  // from loading (they would then be overwritten with [] by the persist
  // effects below). A key that can't be used is blocked from writes so its
  // stored data survives — see lib/safeStorage.js.
  useEffect(() => {
    const loadList = async (key, setList) => {
      try {
        const raw = await readStoredJson(key);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error('expected an array');
        setList(parsed.map(normalizeTx));
      } catch (e) {
        console.warn(`Failed to load ${key}:`, e);
        blockWrites(key);
      }
    };
    (async () => {
      await Promise.all([
        loadList(STORAGE_KEYS.expenses, setExpenses),
        loadList(STORAGE_KEYS.income, setIncome),
        loadList(STORAGE_KEYS.investments, setInvestments),
      ]);
      setReady(true);
    })();
  }, []);

  // ---- Auto-persist each list independently. Writing three separate keys
  //      keeps a per-type failure from clobbering the other two. ----------
  useEffect(() => {
    if (!ready) return;
    writeStored(STORAGE_KEYS.expenses, JSON.stringify(expenses))
      .catch((e) => console.warn('Save expenses failed:', e));
  }, [expenses, ready]);
  useEffect(() => {
    if (!ready) return;
    writeStored(STORAGE_KEYS.income, JSON.stringify(income))
      .catch((e) => console.warn('Save income failed:', e));
  }, [income, ready]);
  useEffect(() => {
    if (!ready) return;
    writeStored(STORAGE_KEYS.investments, JSON.stringify(investments))
      .catch((e) => console.warn('Save investments failed:', e));
  }, [investments, ready]);

  // ---- CRUD -------------------------------------------------------------
  //
  // Every mutator takes `type` first, then the payload. Voice-note file
  // cleanup lives inside here so screens don't have to remember it — it's
  // easy to forget on delete paths and end up leaking audio files.

  const addTransaction = useCallback((type, item) => {
    const set = setterFor(type);
    if (!set) return null;
    const normalized = normalizeTx(item);
    let created = normalized;
    set((prev) => {
      // Belt-and-braces dedupe: recurring rules mint deterministic ids
      // (`${rule.id}_${date.getTime()}`); if the sweep is ever re-invoked
      // for the same rule+date (dev fast-refresh remount, StrictMode double
      // invoke, or a manual "run recurring now" callback), we must NOT
      // append a second row with the same id or downstream find/update/delete
      // will only touch the first one. Skip silently — the row is already there.
      if (normalized.id && prev.some((it) => it.id === normalized.id)) {
        created = prev.find((it) => it.id === normalized.id) ?? normalized;
        return prev;
      }
      return [normalized, ...prev];
    });
    return created;
  }, []);

  const updateTransaction = useCallback((type, updated, opts = {}) => {
    const set = setterFor(type);
    if (!set) return;
    const normalized = normalizeTx(updated);
    set((prev) => {
      const previous = prev.find((it) => it.id === normalized.id);
      if (
        previous &&
        !opts.fromLoan &&
        !opts.fromTransfer &&
        (previous.linkedLoanId || previous.linkedTransferId)
      ) {
        return prev;
      }
      // If the edit swapped or removed a voice note, clean up the old file.
      if (
        previous?.voiceNote?.file &&
        previous.voiceNote.file !== normalized.voiceNote?.file
      ) {
        deleteVoiceNote(previous.voiceNote.file);
      }
      return prev.map((it) => (it.id === normalized.id ? normalized : it));
    });
  }, []);

  // `opts.cleanupFiles` controls whether we immediately unlink the voice-note
  // file. Screens that offer an Undo affordance pass `{ cleanupFiles: false }`
  // and are then responsible for deleting the file themselves after the
  // undo window expires (see TransactionsList.handleQuickDelete). Default
  // stays `true` for the many call sites that just want a plain delete.
  const deleteTransaction = useCallback((type, id, opts = {}) => {
    const { cleanupFiles = true, fromLoan = false, fromTransfer = false } = opts;
    const set = setterFor(type);
    if (!set) return;
    set((prev) => {
      const target = prev.find((it) => it.id === id);
      if (target && !fromLoan && !fromTransfer && (target.linkedLoanId || target.linkedTransferId)) {
        return prev;
      }
      if (cleanupFiles && target?.voiceNote?.file) {
        deleteVoiceNote(target.voiceNote.file);
      }
      return prev.filter((it) => it.id !== id);
    });
  }, []);

  const clearTransactions = useCallback((type) => {
    const set = setterFor(type);
    if (!set) return;
    set((prev) => {
      for (const it of prev) {
        if (it.voiceNote?.file) deleteVoiceNote(it.voiceNote.file);
      }
      return [];
    });
  }, []);

  // Bulk-prepend a batch of transactions. Used by the CSV importer so it
  // doesn't have to touch AsyncStorage directly.
  const importTransactions = useCallback((type, items) => {
    const set = setterFor(type);
    if (!set || !Array.isArray(items) || items.length === 0) return;
    const normalized = items.map(normalizeTx);
    set((prev) => [...normalized, ...prev]);
  }, []);

  const closeGoldChitScheme = useCallback((schemeId, assetId, closedAt = new Date().toISOString()) => {
    if (!schemeId || !assetId) return;
    setInvestments((prev) =>
      prev.map((tx) => {
        if (tx.subCategoryId !== GOLD_CHIT_SUB_ID) return tx;
        if (tx.chitSchemeId !== schemeId) return tx;
        if (tx.chitClosedAt) return tx;
        return {
          ...tx,
          chitClosedAt: closedAt,
          linkedChitAssetId: assetId,
        };
      }),
    );
  }, []);

  const linkGoldChitSchemeToAsset = useCallback((schemeId, assetId) => {
    if (!schemeId || !assetId) return;
    setInvestments((prev) => {
      let changed = false;
      const next = prev.map((tx) => {
        if (tx.subCategoryId !== GOLD_CHIT_SUB_ID) return tx;
        if (tx.chitSchemeId !== schemeId) return tx;
        if (tx.chitClosedAt) return tx;
        if (tx.linkedChitAssetId === assetId) return tx;
        changed = true;
        return { ...tx, linkedChitAssetId: assetId };
      });
      return changed ? next : prev;
    });
  }, []);

  // ---- Restore ----------------------------------------------------------
  //
  // Called by the Settings → Restore backup flow. Replaces all three lists
  // in one shot. Auto-persist writes them to storage in the next effect
  // cycle, so callers don't need to touch AsyncStorage.
  //
  // Clear-on-missing (see PortfolioContext.restoreState). Each list is
  // reset independently so a partial backup can't leak pre-restore
  // transactions into a "clean" restore.
  //
  // BK-M7 fix: sweep voice-note files that were referenced by the
  // pre-restore rows but are NOT referenced by any restored row. The
  // old code deliberately leaked them ("better safe than sorry") but
  // that turned every restore into an unbounded audio-file accumulator
  // — over many restores users' devices filled with dead audio. New
  // policy:
  //   * Union current referenced files across all three lists.
  //   * Union restored referenced files across all three lists.
  //   * Delete anything in the former but not the latter.
  // Files not referenced by either list (already-orphaned) are left
  // alone here — VoiceNotesSection's "Delete orphans" button handles
  // those explicitly so the user is always in control.
  const restoreState = useCallback((payload) => {
    if (!payload) return;

    const collectFiles = (lists) => {
      const out = new Set();
      for (const list of lists) {
        if (!Array.isArray(list)) continue;
        for (const row of list) {
          const f = row?.voiceNote?.file;
          if (f) out.add(f);
        }
      }
      return out;
    };

    const currentReferenced = collectFiles([expenses, income, investments]);
    const restoredReferenced = collectFiles([
      payload.expenses,
      payload.income,
      payload.investments,
    ]);
    for (const f of currentReferenced) {
      if (!restoredReferenced.has(f)) {
        deleteVoiceNote(f);
      }
    }

    setExpenses(Array.isArray(payload.expenses)       ? payload.expenses.map(normalizeTx)    : []);
    setIncome(Array.isArray(payload.income)           ? payload.income.map(normalizeTx)      : []);
    setInvestments(Array.isArray(payload.investments) ? payload.investments.map(normalizeTx) : []);
  }, [expenses, income, investments]);

  // ---- Convenience getters ---------------------------------------------
  const listFor = useCallback(
    (type) => ({
      expense: expenses, income, investment: investments,
    }[type] ?? []),
    [expenses, income, investments],
  );

  // Distinct tags across all three transaction lists, sorted by usage
  // frequency (most-used first). Used by TagInput for autocomplete and by
  // the Search screen for filter chips.
  const allTags = useMemo(() => {
    const counts = new Map();
    const bump = (t) => {
      const key = t.toLowerCase();
      const entry = counts.get(key) ?? { label: t, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    };
    for (const list of [expenses, income, investments]) {
      for (const item of list) {
        for (const tag of item.tags ?? []) bump(tag);
      }
    }
    return Array.from(counts.values())
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .map((e) => e.label);
  }, [expenses, income, investments]);

  const value = useMemo(
    () => ({
      ready,
      expenses,
      income,
      investments,
      listFor,
      addTransaction,
      updateTransaction,
      deleteTransaction,
      clearTransactions,
      importTransactions,
      restoreState,
      closeGoldChitScheme,
      linkGoldChitSchemeToAsset,
      allTags,
    }),
    [
      ready,
      expenses,
      income,
      investments,
      listFor,
      addTransaction,
      updateTransaction,
      deleteTransaction,
      clearTransactions,
      importTransactions,
      restoreState,
      closeGoldChitScheme,
      linkGoldChitSchemeToAsset,
      allTags,
    ],
  );

  return (
    <TransactionsContext.Provider value={value}>
      {children}
    </TransactionsContext.Provider>
  );
}

export function useTransactions() {
  const ctx = useContext(TransactionsContext);
  if (!ctx) {
    throw new Error('useTransactions must be used within <TransactionsProvider>');
  }
  return ctx;
}

// Exported for tests / anywhere else that needs the canonical type list.
export const TRANSACTION_TYPES = TYPES;
