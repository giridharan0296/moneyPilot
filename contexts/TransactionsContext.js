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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../constants';
import { deleteVoiceNote } from '../lib/voiceNotes';

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
  const amountInBase = (t?.amountInBase != null && isFinite(Number(t.amountInBase)))
    ? Number(t.amountInBase)
    : null;
  // Investment-only: canonicalize brokerId as a string or null. Legacy
  // rows without this field stay undefined via the outer spread — we
  // only tighten the value when it's actually present so we don't add
  // stray `brokerId: null` fields to expense/income backups.
  const brokerId = (typeof t?.brokerId === 'string' && t.brokerId.length > 0)
    ? t.brokerId
    : (t && Object.prototype.hasOwnProperty.call(t, 'brokerId') ? null : undefined);
  return {
    ...t,
    tags: Array.isArray(t?.tags) ? sanitizeTags(t.tags) : [],
    subCategoryId: t?.subCategoryId ?? null,
    currency,
    amountInBase,
    fxRate: (t?.fxRate != null && isFinite(Number(t.fxRate))) ? Number(t.fxRate) : null,
    ...(brokerId !== undefined ? { brokerId } : {}),
  };
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
  useEffect(() => {
    (async () => {
      try {
        const [expRaw, incRaw, invRaw] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.expenses),
          AsyncStorage.getItem(STORAGE_KEYS.income),
          AsyncStorage.getItem(STORAGE_KEYS.investments),
        ]);
        if (expRaw) setExpenses(JSON.parse(expRaw).map(normalizeTx));
        if (incRaw) setIncome(JSON.parse(incRaw).map(normalizeTx));
        if (invRaw) setInvestments(JSON.parse(invRaw).map(normalizeTx));
      } catch (e) {
        console.warn('Failed to load transactions:', e);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // ---- Auto-persist each list independently. Writing three separate keys
  //      keeps a per-type failure from clobbering the other two. ----------
  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORAGE_KEYS.expenses, JSON.stringify(expenses))
      .catch((e) => console.warn('Save expenses failed:', e));
  }, [expenses, ready]);
  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORAGE_KEYS.income, JSON.stringify(income))
      .catch((e) => console.warn('Save income failed:', e));
  }, [income, ready]);
  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORAGE_KEYS.investments, JSON.stringify(investments))
      .catch((e) => console.warn('Save investments failed:', e));
  }, [investments, ready]);

  // ---- CRUD -------------------------------------------------------------
  //
  // Every mutator takes `type` first, then the payload. Voice-note file
  // cleanup lives inside here so screens don't have to remember it — it's
  // easy to forget on delete paths and end up leaking audio files.

  const addTransaction = useCallback((type, item) => {
    const set = setterFor(type);
    if (!set) return;
    const normalized = normalizeTx(item);
    set((prev) => {
      // Belt-and-braces dedupe: recurring rules mint deterministic ids
      // (`${rule.id}_${date.getTime()}`); if the sweep is ever re-invoked
      // for the same rule+date (dev fast-refresh remount, StrictMode double
      // invoke, or a manual "run recurring now" callback), we must NOT
      // append a second row with the same id or downstream find/update/delete
      // will only touch the first one. Skip silently — the row is already there.
      if (normalized.id && prev.some((it) => it.id === normalized.id)) {
        return prev;
      }
      return [normalized, ...prev];
    });
  }, []);

  const updateTransaction = useCallback((type, updated) => {
    const set = setterFor(type);
    if (!set) return;
    const normalized = normalizeTx(updated);
    set((prev) => {
      const previous = prev.find((it) => it.id === normalized.id);
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
    const { cleanupFiles = true } = opts;
    const set = setterFor(type);
    if (!set) return;
    set((prev) => {
      const target = prev.find((it) => it.id === id);
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
