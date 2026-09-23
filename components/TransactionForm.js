import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimeField from './DateTimeField';
import VoiceRecorder from './VoiceRecorder';
import VoicePlayer from './VoicePlayer';
import SpeakToFillButton from './SpeakToFillButton';
import TagInput from './TagInput';
import useNoteTagSuggestions, { noteForTransactionDate } from '../hooks/useNoteTagSuggestions';
import AppIcon from './AppIcon';
import AmountCalculatorButton from './AmountCalculatorButton';
import AppButton from './AppButton';
import QuickAddPickerItem from './QuickAddPickerItem';
import PayslipReviewDialog from './PayslipReviewDialog';
import { StatusBadge } from './UiPrimitives';
import { InfoCallout } from './UiPrimitives';
import { deleteVoiceNote } from '../lib/voiceNotes';
import { transcribeAudio } from '../lib/transcribe';
import { formatFieldTimestamp } from '../lib/formatTimestamp';
import parseVoiceTransaction from '../lib/parseVoiceTransaction';
import { useSettings } from '../contexts/SettingsContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { usePortfolio } from '../contexts/PortfolioContext';
import { useNetWorth } from '../contexts/NetWorthContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { useConfirmSheet } from '../contexts/ConfirmSheetContext';
import { useToast } from '../contexts/ToastContext';
import { searchSymbols } from '../lib/fundamentals';
import {
  buildKnownInstruments,
  mergeInstrumentSuggestions,
  searchKnownInstruments,
} from '../lib/instrumentMemory';
import {
  computeChitWeightGrams,
  formatChitGrams,
  GOLD_CHIT_SUB_ID,
  listOpenChitSchemeOptions,
  purityLabel,
  referenceChitRatePerGram,
  slugChitSchemeId,
} from '../lib/goldChit';
import { fetchIndicativeMetalRatesAsOf, formatChitMetalRateHint, METAL_PURITY } from '../lib/metalRates';
import {
  buildIncomeDraftFromPayslip,
  computePayslipGross,
  computePayslipNet,
  payslipAmountsFromSnapshot,
  payslipSnapshotToStrings,
  payslipStringsToPayload,
  resolvePayslipIncomeAmount,
} from '../lib/payslipIncome';
import { PAYSLIP_PDF_ALERTS, readPayslipPdf } from '../lib/readPayslipPdf';
import {
  CURRENCIES,
  currencyMeta,
  lookupRateOrOne,
} from '../lib/currency';
import { formatSubCategoryLabel } from '../lib/categoryDisplay';
import { isNewMarketInstrument } from '../lib/portfolioHoldings';
import { FREQUENCIES } from '../lib/recurring';
import {
  aggregateOpeningLots,
  openingLotsFromSaved,
  parseOpeningLotsFromForm,
  validateOpeningLotPrices,
  buildOpeningPositionPayload,
} from '../lib/openingPositions';

function newOpeningLotKey() {
  return `lot_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// Stop Android/iOS from treating repeated decimal fields as one autofill
// group — otherwise a clipboard tap can overwrite every "Units" input.
const ISOLATED_NUMERIC_INPUT = Platform.select({
  ios: {
    // "none" still lets iOS offer clipboard phone numbers on numeric keys;
    // "oneTimeCode" avoids phone/contact autofill heuristics.
    textContentType: 'oneTimeCode',
    autoComplete: 'off',
    autoCorrect: false,
    spellCheck: false,
    smartInsertDelete: false,
  },
  android: {
    autoComplete: 'off',
    importantForAutofill: 'no',
    autoCorrect: false,
  },
  default: {
    autoComplete: 'off',
    autoCorrect: false,
  },
});

/** Keep only a plain decimal — strips phone formatting (+91, spaces, dashes). */
function sanitizeDecimalInput(raw) {
  let value = String(raw ?? '').replace(/,/g, '').trim();
  value = value.replace(/[^\d.]/g, '');
  const dot = value.indexOf('.');
  if (dot >= 0) {
    value = `${value.slice(0, dot + 1)}${value.slice(dot + 1).replace(/\./g, '')}`;
  }
  return value;
}

function marketCountryFor(categoryId, subCategory) {
  const key = `${subCategory?.id || ''} ${subCategory?.label || ''}`.toLowerCase();
  if (/international|global|world|intl/.test(key)) return 'GLOBAL';
  if (/(^|[_\s-])us($|[_\s-])|united states|america/.test(key)) return 'US';
  if (/india|indian/.test(key)) return 'IN';
  if (categoryId === 'mutual_funds' || categoryId === 'etfs' || subCategory?.id === 'gold_etf') return 'IN';
  return null;
}

function belongsToMarket(item, marketCountry) {
  if (!marketCountry) return true;
  const symbol = String(item.symbol || '').toUpperCase();
  const exchange = `${item.exchangeCode || ''} ${item.exchange || ''}`.toUpperCase();
  const indian = /\.(NS|BO)$/.test(symbol) || /(^|\s)(NSI|NSE|BSE)(\s|$)/.test(exchange);
  if (marketCountry === 'IN') return indian;
  if (marketCountry === 'US') return !indian && /(^|\s)(NMS|NGM|NCM|NYQ|ASE|NASDAQ|NYSE|AMEX)(\s|$)/.test(exchange);
  return !indian;
}

function alertPayslipUser(title, message) {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}

const INCOME_ENTRY_MODES = [
  { id: 'manual', icon: 'edit-3', label: 'Manual entry', short: 'Manual' },
  { id: 'payslip', icon: 'file-text', label: 'From payslip PDF', short: 'Source doc' },
];

// ----------------------------------------------------------------------------
// TransactionForm — the shared amount+category+account+timestamp+note form.
// Used by both the "Add" flow (in TransactionsList) and the "Edit" flow
// (in EditTransactionModal). Same UI, same validation, one implementation.
//
// Props:
//   categories                       master data from context
//   accounts, accountGroups          master data (grouped account picker)
//   initialValues                    { amount, categoryId, accountId, date, note, brokerId? }
//   accentColor                      main color for selected chip + submit button
//   submitLabel                      e.g. "Add expense" or "Save changes"
//   notePlaceholder                  placeholder for the note field
//   type                             'expense' | 'income' | 'investment' | null
//                                    When 'investment' we render an extra
//                                    "Broker" picker so the user can record
//                                    WHICH broker/platform the money went
//                                    into (Zerodha, Groww, MF portal, …).
//                                    Kept optional — legacy investment rows
//                                    without a brokerId keep working.
//   onSubmit(values)                 called with valid, parsed form values
// ----------------------------------------------------------------------------

export default function TransactionForm({
  categories,
  accounts,
  accountGroups = [],
  initialValues,
  accentColor = '#2563eb',
  submitLabel = 'Save',
  notePlaceholder = 'e.g. lunch with team',
  type = null,
  onSubmit,
  allowSaveAndAddAnother = false,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const { confirm } = useConfirmSheet();
  const { showToast } = useToast();
  const [formError, setFormError] = useState(null);
  const [amount, setAmount] = useState(initialValues?.amount ?? '');
  const [categoryId, setCategoryId] = useState(
    initialValues?.categoryId ?? categories[0]?.id
  );
  // Guard against orphaned sub references on Edit. If the initial
  // subCategoryId doesn't belong to the initial parent (parent was deleted,
  // or the sub id points at a sibling parent's sub), drop it here — otherwise
  // Save would silently re-commit a bogus sub id. Chip UI already hides
  // unknown subs, so the user has no visible signal that this happens.
  const [subCategoryId, setSubCategoryId] = useState(() => {
    const initSub = initialValues?.subCategoryId ?? null;
    if (!initSub) return null;
    const initCatId = initialValues?.categoryId ?? categories[0]?.id;
    const initParent = categories.find((c) => c.id === initCatId);
    const isValidSub = initParent?.subCategories?.some((s) => s.id === initSub);
    return isValidSub ? initSub : null;
  });
  // Expense splits create separate linked expense rows on save. This keeps
  // budgets, reports, search, and account balances correct without adding a
  // special aggregate transaction type.
  const [splitRows, setSplitRows] = useState([]);
  const [accountId, setAccountId] = useState(
    initialValues?.accountId ?? accounts[0]?.id
  );
  const [date, setDate] = useState(initialValues?.date ?? new Date());
  const [note, setNote] = useState(initialValues?.note ?? '');
  const autoNoteRef = useRef(null);
  const [tags, setTags] = useState(
    Array.isArray(initialValues?.tags) ? initialValues.tags : [],
  );
  const tagInputRef = useRef(null);
  const [voiceNote, setVoiceNote] = useState(initialValues?.voiceNote ?? null);
  // Investment-only field. `null` means "not specified" — legacy rows
  // (created before this field existed) and non-investment rows both
  // stay at null so backup/restore, edit, and read paths are unaffected.
  const [brokerId, setBrokerId] = useState(initialValues?.brokerId ?? null);
  const [instrumentQuery, setInstrumentQuery] = useState(
    initialValues?.instrumentName ?? initialValues?.instrumentSymbol ?? '',
  );
  const [instrument, setInstrument] = useState(
    initialValues?.instrumentSymbol
      ? {
          symbol: initialValues.instrumentSymbol,
          name: initialValues.instrumentName ?? initialValues.instrumentSymbol,
          type: initialValues.instrumentType ?? 'Equity',
        }
      : null,
  );
  const [investmentUnits, setInvestmentUnits] = useState(
    initialValues?.investmentUnits != null ? String(initialValues.investmentUnits) : '',
  );
  const [instrumentSuggestions, setInstrumentSuggestions] = useState([]);
  const [instrumentSearching, setInstrumentSearching] = useState(false);
  const savedOpeningPosition = initialValues?.openingPosition ?? null;
  const [historicalOnly, setHistoricalOnly] = useState(Boolean(initialValues?.historicalOnly));
  const [makeRecurring, setMakeRecurring] = useState(false);
  const [recurringFrequency, setRecurringFrequency] = useState('monthly');
  const [recurringEndEnabled, setRecurringEndEnabled] = useState(false);
  const [recurringEndDate, setRecurringEndDate] = useState(null);
  const [includeOpeningPosition, setIncludeOpeningPosition] = useState(
    Boolean(savedOpeningPosition) || Boolean(initialValues?.historicalOnly),
  );
  const [openingTrackingDate, setOpeningTrackingDate] = useState(() => {
    const savedDate = savedOpeningPosition?.openingDate
      ? new Date(savedOpeningPosition.openingDate)
      : new Date();
    return Number.isNaN(savedDate.getTime()) ? new Date() : savedDate;
  });
  const createEmptyOpeningLot = () => ({
    clientKey: newOpeningLotKey(),
    id: null,
    quantity: '',
    avgCost: '',
    openingDate: openingTrackingDate,
  });
  const [openingLots, setOpeningLots] = useState(() => {
    const savedLots = openingLotsFromSaved(savedOpeningPosition);
    if (savedLots.length === 0) return [createEmptyOpeningLot()];
    return savedLots.map((lot) => ({
      clientKey: lot.id ? `lot-${lot.id}` : newOpeningLotKey(),
      id: lot.id ?? null,
      quantity: lot.quantity != null ? String(lot.quantity) : '',
      avgCost: lot.avgCost != null ? String(lot.avgCost) : '',
      openingDate: lot.openingDate ? new Date(lot.openingDate) : openingTrackingDate,
    }));
  });

  // Voice-note lifecycle bookkeeping.
  //
  // The old handleRecorded / handleDeleteVoice deleted the previous audio
  // file synchronously the moment a new recording replaced it. In Edit mode
  // that file is what the SAVED row still points at — so cancelling after
  // re-recording (or after deleting) left a broken reference. Same story
  // in Add mode: an on-disk recording became garbage if the user
  // cancelled the form.
  //
  // Fix: defer all cleanup to either commit-time or unmount-time.
  //
  //   baselineRef  — the file the parent's saved row currently points at
  //                  (initialValues.voiceNote.file, or null in Add mode).
  //                  This file is ONLY safe to delete after a successful
  //                  onSubmit — never on Cancel.
  //   seenFilesRef — every file that has been "current" during this
  //                  form's lifetime (baseline + newly recorded ones).
  //                  Any file in this set that isn't the final "kept"
  //                  file becomes an orphan and gets swept.
  //   committedRef — did onSubmit fire? Determines which file to keep
  //                  on unmount: on commit the row now points at the
  //                  current voiceNote.file, otherwise at baseline.
  const baselineRef  = useRef(initialValues?.voiceNote?.file ?? null);
  const seenFilesRef = useRef(new Set());
  const committedRef = useRef(false);
  if (baselineRef.current && seenFilesRef.current.size === 0) {
    seenFilesRef.current.add(baselineRef.current);
  }

  useEffect(() => {
    return () => {
      // Unmount cleanup. On commit, handleSubmit already swept orphans
      // and the row points at voiceNote.file — nothing more to do here.
      if (committedRef.current) return;
      // Otherwise the row (if any) still points at baseline; every other
      // file in seenFiles is a transient that never got saved.
      const keep = baselineRef.current;
      for (const f of seenFilesRef.current) {
        if (f && f !== keep) {
          deleteVoiceNote(f).catch((e) => console.warn('Voice-note cleanup failed:', e));
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [transcribing, setTranscribing] = useState(false);
  const [manualTranscript, setManualTranscript] = useState(null); // null | string  → also controls modal visibility
  const {
    whisperApiKey,
    baseCurrency,
    fxRates,
    brokerDefaultsBySubCategory,
    brokers,
  } = useSettings();
  const { allTags, expenses, income, investments } = useTransactions();
  const { holdings } = usePortfolio();
  const { isPortfolioSymbolHidden } = useNetWorth();
  const typeTransactions = useMemo(() => {
    if (type === 'income') return income;
    if (type === 'investment') return investments;
    return expenses;
  }, [expenses, income, investments, type]);
  const accountTouchedRef = useRef(!!initialValues?.accountId);
  const initialSuggestionsAppliedRef = useRef(false);

  // Keep an automatically remembered note aligned when the user changes the
  // transaction date after choosing its category. Manual edits break this
  // link immediately and are never overwritten.
  useEffect(() => {
    const remembered = autoNoteRef.current;
    if (!remembered) return;
    if (note !== remembered.lastApplied) {
      autoNoteRef.current = null;
      return;
    }
    const next = noteForTransactionDate(remembered.template, remembered.sourceDate, date);
    remembered.lastApplied = next;
    if (next !== note) setNote(next);
  }, [date, note]);

  // In add mode, use the most recently used valid account for this
  // transaction type. The transaction ledger is the memory, so this works
  // across restarts without introducing another preference to back up.
  useEffect(() => {
    if (initialValues || accountTouchedRef.current) return;
    const recentAccountId = typeTransactions.find((tx) =>
      accounts.some((account) => account.id === tx.accountId)
    )?.accountId;
    if (recentAccountId) {
      accountTouchedRef.current = true;
      setAccountId(recentAccountId);
    }
  }, [accounts, initialValues, typeTransactions]);

  const { matchingHistory, noteSuggestions, tagSuggestions } = useNoteTagSuggestions({
    transactions: typeTransactions,
    categoryId,
    subCategoryId,
    note,
    date,
    allTags,
  });

  const suggestedCategory = useMemo(() => {
    if (!note.trim() || matchingHistory.length === 0) return null;
    const scores = new Map();
    for (const tx of matchingHistory) {
      if (!tx.categoryId) continue;
      const current = scores.get(tx.categoryId) ?? { count: 0, tx };
      scores.set(tx.categoryId, { count: current.count + 1, tx: current.tx });
    }
    const winner = [...scores.values()].sort((a, b) => b.count - a.count)[0]?.tx;
    if (!winner || winner.categoryId === categoryId) return null;
    const category = categories.find((item) => item.id === winner.categoryId);
    return category ? { category, transaction: winner } : null;
  }, [categories, categoryId, matchingHistory, note]);

  // Brokers surfaced in this transaction form. We drop the CSV-only
  // 'generic' entry (whose "auto-detect" hint is meaningless outside of
  // the holdings importer) — the equivalent free-form option here is
  // simply leaving the picker on "None".
  //
  // Sourced from useSettings().brokers so any brokers the user adds,
  // renames, or removes via the Brokers management screen show up here
  // without a rebuild. Memoised on `brokers` identity so the chip row
  // doesn't rerender on unrelated settings changes.
  const transactionBrokers = useMemo(
    () => (Array.isArray(brokers) ? brokers.filter((b) => b.id !== 'generic') : []),
    [brokers],
  );

  // Currency for this specific transaction (F9 Tier 2). Defaults to the
  // account's own currency; the account defaults to app-wide base. User
  // can override per row (e.g. an INR account paying a USD bill).
  const initialAccountForCurrency = accounts.find((a) => a.id === (initialValues?.accountId ?? accounts[0]?.id));
  const [currency, setCurrency] = useState(
    initialValues?.currency
      ?? initialAccountForCurrency?.currency
      ?? baseCurrency,
  );

  // FX rate for this row. Initialized from the persisted rate table so
  // the user sees a sensible prefill; explicitly editable per row so
  // manual card fees / merchant markups can be captured. Stored on the
  // row itself (frozen at add time) so aggregate re-renders don't drift.
  const [fxRate, setFxRate] = useState(() => {
    if (initialValues?.fxRate != null && isFinite(Number(initialValues.fxRate))) {
      return String(initialValues.fxRate);
    }
    const startCurrency = initialValues?.currency
      ?? initialAccountForCurrency?.currency
      ?? baseCurrency;
    return String(lookupRateOrOne(fxRates, startCurrency, baseCurrency));
  });

  // When the account changes and the user hasn't touched the currency,
  // inherit the new account's currency. Ref guards against clobbering
  // an explicit choice.
  const currencyTouchedRef = useRef(!!initialValues?.currency);
  const handleCurrencyPick = (code) => {
    currencyTouchedRef.current = true;
    setCurrency(code);
    if (code === baseCurrency) {
      setFxRate('1');
    } else {
      setFxRate(String(lookupRateOrOne(fxRates, code, baseCurrency)));
    }
  };

  // Last voice-fill summary. Rendered as an inline banner below the
  // "Speak to fill" button so the user can see what the STT heard AND
  // which fields the parser touched. Previously we only alerted when
  // nothing matched — but that leaves the "nothing changed except the
  // amount" case invisible, which is exactly when users go "why didn't
  // my category update?". Showing it always makes debugging trivial.
  //   heard   — the raw transcript
  //   applied — array of "Amount ₹500", "Category: 🧾 Bills"...
  //   missed  — array of "Category", "Account"... for anything the parser
  //             couldn't identify. Empty when everything landed.
  const [lastVoiceFill, setLastVoiceFill] = useState(null);

  // Sub-categories are scoped to the currently-selected parent. Derived from
  // the categories list so we never keep a stale copy around.
  const selectedCategory = categories.find((c) => c.id === categoryId) ?? null;
  const subCategories = selectedCategory?.subCategories ?? [];
  const selectedSubCategory = subCategories.find((s) => s.id === subCategoryId) ?? null;
  const selectedAccount = accounts.find((account) => account.id === accountId) ?? null;
  const marketCountry = marketCountryFor(categoryId, selectedSubCategory);
  const tracksMarketInstrument = type === 'investment' && (
    categoryId === 'stocks' || categoryId === 'mutual_funds' || categoryId === 'etfs' || subCategoryId === 'gold_etf'
  );
  const instrumentIsNewInSystem = useMemo(() => isNewMarketInstrument(investments, holdings, {
    symbol: instrument?.symbol,
    broker: brokerId,
    excludeTxId: initialValues?.id,
    isSymbolHidden: isPortfolioSymbolHidden,
  }), [
    investments,
    holdings,
    brokerId,
    instrument?.symbol,
    initialValues?.id,
    isPortfolioSymbolHidden,
  ]);
  const canShowOpeningPosition = tracksMarketInstrument
    && Boolean(instrument?.symbol)
    && (instrumentIsNewInSystem || Boolean(savedOpeningPosition));

  // KNOWN_BUGS #1: "Historical only" is meant for units owned BEFORE
  // tracking started. If this instrument already has other logged
  // purchases, an opening lot on top of them silently double-counts units
  // in Portfolio/Net Worth — instrumentIsNewInSystem already excludes the
  // record currently being edited, so this only trips for a genuinely
  // separate, already-logged instrument.
  const historicalDuplicatesLogged = historicalOnly
    && tracksMarketInstrument
    && Boolean(instrument?.symbol)
    && !instrumentIsNewInSystem;

  const recurringFrequencyOptions = useMemo(
    () => FREQUENCIES.filter((f) => ['weekly', 'monthly', 'yearly'].includes(f.id)),
    [],
  );

  useEffect(() => {
    if (!canShowOpeningPosition) setIncludeOpeningPosition(false);
  }, [canShowOpeningPosition]);

  useEffect(() => {
    if (historicalOnly && tracksMarketInstrument) {
      setIncludeOpeningPosition(true);
    }
  }, [historicalOnly, tracksMarketInstrument]);

  const openingLotsSummary = useMemo(() => {
    const parsed = parseOpeningLotsFromForm(openingLots);
    if (!parsed.ok) return null;
    return aggregateOpeningLots(parsed.lots);
  }, [openingLots]);

  const updateOpeningLot = (clientKey, patch) => {
    setOpeningLots((rows) => rows.map((row) => (
      row.clientKey === clientKey ? { ...row, ...patch } : row
    )));
  };

  const addOpeningLotRow = () => {
    setOpeningLots((rows) => [...rows, {
      clientKey: newOpeningLotKey(),
      id: null,
      quantity: '',
      avgCost: '',
      openingDate: openingTrackingDate,
    }]);
  };

  const removeOpeningLotRow = (clientKey) => {
    setOpeningLots((rows) => (
      rows.length <= 1 ? rows : rows.filter((row) => row.clientKey !== clientKey)
    ));
  };

  useEffect(() => {
    if (!includeOpeningPosition) return;
    const hasLotData = openingLots.some(
      (lot) => String(lot.quantity ?? '').trim() || String(lot.avgCost ?? '').trim(),
    );
    if (hasLotData) return;
    const account = accounts.find((item) => item.id === accountId);
    if (account?.openingBalanceDate) {
      const dateValue = new Date(account.openingBalanceDate);
      if (!Number.isNaN(dateValue.getTime())) setOpeningTrackingDate(dateValue);
    }
  }, [includeOpeningPosition, openingLots, accounts, accountId]);

  // Settings hydrates asynchronously. Keep the picker selection aligned
  // with the latest category tree so a stale parent/sub id cannot make the
  // sub-category row disappear after stored settings finish loading.
  useEffect(() => {
    if (categories.length === 0) return;
    const liveParent = categories.find((category) => category.id === categoryId);
    if (!liveParent) {
      setCategoryId(categories[0].id);
      setSubCategoryId(null);
      return;
    }
    if (
      subCategoryId
      && !liveParent.subCategories?.some((subCategory) => subCategory.id === subCategoryId)
    ) {
      setSubCategoryId(null);
    }
  }, [categories, categoryId, subCategoryId]);
  const tracksGoldChit = type === 'investment' && subCategoryId === GOLD_CHIT_SUB_ID;
  const openChitSchemes = useMemo(
    () => (tracksGoldChit ? listOpenChitSchemeOptions(investments) : []),
    [tracksGoldChit, investments],
  );
  const [chitSchemeName, setChitSchemeName] = useState(initialValues?.chitSchemeName ?? '');
  const [chitSchemeId, setChitSchemeId] = useState(initialValues?.chitSchemeId ?? null);
  const [chitPurity, setChitPurity] = useState(initialValues?.chitMetalPurity ?? '22k');
  const [chitShopRate, setChitShopRate] = useState(
    initialValues?.chitRatePerGram != null ? String(initialValues.chitRatePerGram) : '',
  );
  const [chitMetalRates, setChitMetalRates] = useState(null);
  const [chitRatesLoading, setChitRatesLoading] = useState(false);
  const tracksIncomePayslip = type === 'income';
  const hasInitialPayslip = Boolean(
    initialValues?.payslipBasic || initialValues?.payslipTds || initialValues?.payslipGross,
  );
  const [incomeEntryMode, setIncomeEntryMode] = useState(
    () => (hasInitialPayslip ? 'payslip' : 'manual'),
  );
  const [payslipForm, setPayslipForm] = useState(() => {
    if (!initialValues?.payslipBasic && !initialValues?.payslipTds && !initialValues?.payslipGross) return null;
    return payslipSnapshotToStrings({
      basic: initialValues.payslipBasic,
      hra: initialValues.payslipHra,
      special: initialValues.payslipSpecial,
      other: initialValues.payslipOther,
      tds: initialValues.payslipTds,
      pf: initialValues.payslipPf,
      gross: initialValues.payslipGross,
      net: initialValues.payslipNet,
      source: initialValues.payslipSource,
      amountMode: initialValues.payslipAmountMode,
    });
  });
  const [pdfPhase, setPdfPhase] = useState('idle');
  const [pdfParseResult, setPdfParseResult] = useState(null);
  const [pdfFileName, setPdfFileName] = useState('');

  const canShowRecurring = !initialValues
    && !historicalOnly
    && !tracksGoldChit
    && splitRows.length === 0
    && !(type === 'income' && incomeEntryMode === 'payslip');

  useEffect(() => {
    if (!canShowRecurring && makeRecurring) setMakeRecurring(false);
  }, [canShowRecurring, makeRecurring]);

  const expectedInstrumentTypes = useMemo(
    () => {
      if (categoryId === 'mutual_funds') return ['MUTUALFUND'];
      if (marketCountry === 'IN') return ['EQUITY', 'ETF', 'MUTUALFUND'];
      return ['EQUITY', 'ETF'];
    },
    [categoryId, marketCountry],
  );

  const knownInstruments = useMemo(
    () => buildKnownInstruments(investments, holdings),
    [investments, holdings],
  );

  const filterInstrumentHits = (hits) => hits.filter((hit) =>
    expectedInstrumentTypes.includes(String(hit.quoteType || hit.type).toUpperCase().replace(/\s+/g, ''))
    && belongsToMarket(hit, marketCountry),
  );

  useEffect(() => {
    if (!tracksMarketInstrument || instrument?.symbol) {
      setInstrumentSuggestions([]);
      return undefined;
    }
    const query = instrumentQuery.trim();
    if (query.length < 2) {
      setInstrumentSuggestions([]);
      return undefined;
    }

    const localHits = filterInstrumentHits(searchKnownInstruments(knownInstruments, query));
    setInstrumentSuggestions(localHits);

    let cancelled = false;
    const timer = setTimeout(async () => {
      setInstrumentSearching(true);
      try {
        const region = marketCountry === 'IN' || marketCountry === 'US' ? marketCountry : undefined;
        const apiHits = filterInstrumentHits(await searchSymbols(query, { region }));
        if (!cancelled) {
          setInstrumentSuggestions(mergeInstrumentSuggestions(localHits, apiHits));
        }
      } catch {
        if (!cancelled) setInstrumentSuggestions(localHits);
      } finally {
        if (!cancelled) setInstrumentSearching(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [instrumentQuery, instrument?.symbol, tracksMarketInstrument, expectedInstrumentTypes, marketCountry, knownInstruments]);

  useEffect(() => {
    if (!tracksGoldChit) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      setChitRatesLoading(true);
      fetchIndicativeMetalRatesAsOf(date)
        .then((rates) => { if (!cancelled) setChitMetalRates(rates); })
        .catch(() => { if (!cancelled) setChitMetalRates(null); })
        .finally(() => { if (!cancelled) setChitRatesLoading(false); });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tracksGoldChit, date]);

  const chitWeightPreview = useMemo(() => {
    if (!tracksGoldChit) return null;
    const parsed = parseFloat(String(amount).trim());
    if (!isFinite(parsed) || parsed <= 0) return null;
    const shop = chitShopRate.trim() === '' ? null : parseFloat(chitShopRate);
    return computeChitWeightGrams({
      amount: parsed,
      purity: chitPurity,
      baseRatePerGram: chitMetalRates?.gold,
      shopRatePerGram: isFinite(shop) && shop > 0 ? shop : null,
    });
  }, [tracksGoldChit, amount, chitPurity, chitShopRate, chitMetalRates]);

  const chitReferenceRate = useMemo(() => (
    chitMetalRates?.gold
      ? referenceChitRatePerGram(chitMetalRates.gold, chitPurity)
      : null
  ), [chitMetalRates, chitPurity]);

  const chitRateHint = useMemo(() => formatChitMetalRateHint({
    rates: chitMetalRates,
    purity: chitPurity,
    loading: chitRatesLoading,
    asOfDate: date,
  }), [chitMetalRates, chitPurity, chitRatesLoading, date]);

  const chitWeightDisplay = chitWeightPreview?.grams != null
    ? Number(chitWeightPreview.grams).toFixed(4).replace(/\.?0+$/, '')
    : '';

  const autoFillFrequentDetails = (parentId, childId = null) => {
    if (initialValues) return;
    const matching = typeTransactions.filter((tx) => (
      tx.categoryId === parentId
      && (childId ? tx.subCategoryId === childId : !tx.subCategoryId)
    ));
    if (matching.length === 0) return;

    const noteCounts = new Map();
    const tagCounts = new Map();
    for (const tx of matching) {
      const savedNote = String(tx.note ?? '').trim();
      if (savedNote) {
        const current = noteCounts.get(savedNote) ?? { count: 0, transaction: tx };
        noteCounts.set(savedNote, { count: current.count + 1, transaction: current.transaction });
      }
      for (const tag of Array.isArray(tx.tags) ? tx.tags : []) {
        const savedTag = String(tag ?? '').trim();
        if (savedTag) tagCounts.set(savedTag, (tagCounts.get(savedTag) ?? 0) + 1);
      }
    }
    const frequentNote = [...noteCounts.entries()]
      .sort((a, b) => b[1].count - a[1].count)[0];
    const frequentTags = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([tag]) => tag);
    if (frequentNote) {
      const [template, detail] = frequentNote;
      const sourceDate = detail.transaction?.createdAt ?? detail.transaction?.date;
      const applied = noteForTransactionDate(template, sourceDate, date);
      autoNoteRef.current = { template, sourceDate, lastApplied: applied };
      setNote(applied);
    }
    if (frequentTags.length > 0) setTags(frequentTags);
  };

  // Apply remembered details for the initially selected category as soon as
  // history is available. Previously this only ran after a category chip was
  // tapped, making the default category behave differently from every other.
  useEffect(() => {
    if (initialValues || initialSuggestionsAppliedRef.current) return;
    if (typeTransactions.length === 0) return;
    initialSuggestionsAppliedRef.current = true;
    autoFillFrequentDetails(categoryId, subCategoryId);
    // Category changes have their own explicit auto-fill handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValues, typeTransactions.length]);

  // Change the parent → drop the sub selection unless it belongs to the new
  // parent. Wrapped so voice-fill can also set a sub-category atomically.
  const changeCategory = (newParentId, keepSubId) => {
    if (type === 'investment' && newParentId !== categoryId) {
      setInstrument(null);
      setInstrumentQuery('');
    }
    setCategoryId(newParentId);
    if (keepSubId) {
      setSubCategoryId(keepSubId);
      autoFillFrequentDetails(newParentId, keepSubId);
      // Voice-fill path also lands here — apply broker default too,
      // otherwise a purely-voice-driven investment entry never
      // benefits from remembered brokers.
      maybeAutoFillBrokerForSub(keepSubId);
      return;
    }
    const newParent = categories.find((c) => c.id === newParentId);
    const stillValid = newParent?.subCategories?.some(
      (s) => s.id === subCategoryId,
    );
    const nextSubId = stillValid ? subCategoryId : null;
    if (!stillValid) setSubCategoryId(null);
    autoFillFrequentDetails(newParentId, nextSubId);
  };

  // Apply the remembered "last-used broker for this sub-category" if
  // and only if the user hasn't already chosen one on this row.
  // Guarding on `!brokerId` is critical: otherwise picking a sub after
  // manually choosing a broker would silently override the user's
  // choice. Only applies to investment forms.
  const maybeAutoFillBrokerForSub = (subId) => {
    if (type !== 'investment') return;
    if (!subId) return;
    if (brokerId) return;
    const suggested = brokerDefaultsBySubCategory?.[subId];
    if (!suggested) return;
    if (!transactionBrokers.some((b) => b.id === suggested)) return;
    setBrokerId(suggested);
  };

  // Sub-category chip tap. Toggles the picked sub off/on. On a fresh
  // pick (prev !== id) we ALSO try to prefill the broker from the
  // per-sub-category memory — this is the "always Zerodha for Stocks"
  // convenience. Untoggling never touches the broker (unusual and
  // surprising).
  const handleSubCategoryPick = (id) => {
    setSubCategoryId((prev) => {
      const next = prev === id ? null : id;
      if (type === 'investment' && next === GOLD_CHIT_SUB_ID) {
        setCategoryId('gold');
      }
      if (type === 'investment' && next !== prev) {
        setInstrument(null);
        setInstrumentQuery('');
      }
      if (next && next !== prev) {
        maybeAutoFillBrokerForSub(next);
        autoFillFrequentDetails(categoryId, next);
      }
      return next;
    });
  };

  const pickOpenChitScheme = (scheme) => {
    setChitSchemeId(scheme.id);
    setChitSchemeName(scheme.name);
    setChitPurity(scheme.purity || '22k');
    if (scheme.lastRatePerGram != null && isFinite(Number(scheme.lastRatePerGram))) {
      setChitShopRate(String(Math.round(Number(scheme.lastRatePerGram))));
    }
  };

  const applyPayslipDraft = (draft) => {
    if (!draft?.amount) return;
    setAmount(String(draft.amount));
    changeCategory(draft.categoryId, draft.subCategoryId);
    if (draft.note) setNote(draft.note);
    setPayslipForm(payslipSnapshotToStrings({
      ...draft.payslip,
      amountMode: draft.amountMode,
    }));
    setPdfPhase('idle');
    setPdfParseResult(null);
    showToast('Payslip values filled — review and save.');
  };

  const handleUploadPayslip = async () => {
    setPdfPhase('reading');
    try {
      const result = await readPayslipPdf();
      if (result.cancelled) {
        setPdfPhase('idle');
        return;
      }
      if (result.error) {
        setPdfPhase('idle');
        const spec = PAYSLIP_PDF_ALERTS[result.error];
        if (spec) alertPayslipUser(spec.title, spec.message);
        else alertPayslipUser('Couldn\'t read the PDF', result.message ?? 'Unknown error.');
        return;
      }
      setPdfFileName(result.fileName);
      setPdfParseResult(result.parsed);
      setPdfPhase('review');
    } catch (e) {
      setPdfPhase('idle');
      alertPayslipUser('Couldn\'t read the PDF', e?.message ?? String(e));
    }
  };

  const handleApplyPayslipReview = ({ amountMode } = {}) => {
    if (!pdfParseResult) return;
    const draft = buildIncomeDraftFromPayslip(pdfParseResult, {
      amountMode: amountMode === 'gross' ? 'gross' : 'net',
      fileName: pdfFileName,
    });
    applyPayslipDraft(draft);
  };

  const closePayslipReview = () => {
    setPdfPhase('idle');
    setPdfParseResult(null);
  };

  const updatePayslipField = (key, value) => {
    setPayslipForm((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [key]: value };
      const amounts = payslipAmountsFromSnapshot(next);
      const gross = computePayslipGross(amounts);
      const net = computePayslipNet(amounts);
      next.gross = gross > 0 ? String(Math.round(gross)) : '';
      next.net = net > 0 ? String(Math.round(net)) : '';
      const incomeAmount = resolvePayslipIncomeAmount(amounts, next.amountMode);
      if (incomeAmount > 0) setAmount(String(Math.round(incomeAmount)));
      return next;
    });
  };

  const setPayslipAmountMode = (mode) => {
    setPayslipForm((prev) => {
      if (!prev) return prev;
      const next = { ...prev, amountMode: mode === 'gross' ? 'gross' : 'net' };
      const amounts = payslipAmountsFromSnapshot(next);
      const incomeAmount = resolvePayslipIncomeAmount(amounts, next.amountMode);
      if (incomeAmount > 0) setAmount(String(Math.round(incomeAmount)));
      return next;
    });
  };

  const switchIncomeEntryMode = (mode) => {
    if (mode === incomeEntryMode) return;
    if (mode === 'manual') {
      setPayslipForm(null);
      setPdfPhase('idle');
      setPdfParseResult(null);
      setPdfFileName('');
    }
    setIncomeEntryMode(mode);
    if (formError) setFormError(null);
  };

  const handleSubmit = (keepOpen = false) => {
    setFormError(null);
    const failValidation = (message) => {
      setFormError(message);
    };

    // Whole-token numeric guard: parseFloat('1e12') would accept scientific
    // notation and parseFloat('12abc') would silently return 12. Require a
    // clean decimal input, then clamp to a realistic ceiling so a
    // pasted-typo like "9999999999999999" doesn't blow up formatMoney or
    // the pie-chart scale.
    const MAX_AMOUNT = 1e12; // ₹1 trillion — arbitrary but very safe upper bound.
    const isHistoricalEntry = historicalOnly && tracksMarketInstrument;
    let parsed = 0;
    let units = null;
    let parsedOpeningLots = null;

    if (!categoryId) {
      failValidation('Add a category in Settings first.');
      return;
    }
    if (!accountId) {
      failValidation('Add an account in Settings first.');
      return;
    }

    if (isHistoricalEntry) {
      if (!brokerId) {
        failValidation('Select a broker for this historical holding.');
        return;
      }
      if (!instrument?.symbol) {
        failValidation('Search and select the stock, ETF, or mutual fund you already own.');
        return;
      }
      if (!instrumentIsNewInSystem) {
        failValidation('This instrument already has logged purchases — a historical entry would double-count your units. Switch to "New purchase" instead.');
        return;
      }
      const parsedLots = parseOpeningLotsFromForm(openingLots);
      if (!parsedLots.ok) {
        if (parsedLots.reason === 'invalid_quantity') {
          failValidation(`Enter units greater than zero for lot ${(parsedLots.index ?? 0) + 1}.`);
        } else if (parsedLots.reason === 'invalid_price') {
          failValidation(`Enter the average buy price per unit for lot ${(parsedLots.index ?? 0) + 1}.`);
        } else {
          failValidation('Add at least one lot with units and price per unit.');
        }
        return;
      }
      parsedOpeningLots = parsedLots.lots;
      const priceCheck = validateOpeningLotPrices(parsedOpeningLots);
      if (!priceCheck.ok) {
        if (priceCheck.reason === 'total_not_per_unit') {
          failValidation(
            `Lot ${(priceCheck.index ?? 0) + 1}: ₹${priceCheck.impliedTotal?.toLocaleString('en-IN')} looks like the total for ${priceCheck.quantity} units, not the price per unit. Try ₹${priceCheck.suggestedPerUnit?.toLocaleString('en-IN')} per unit instead.`,
          );
        } else {
          failValidation(`Check the price per unit for lot ${(priceCheck.index ?? 0) + 1}.`);
        }
        return;
      }
      const aggregated = aggregateOpeningLots(parsedOpeningLots);
      if (aggregated.quantity <= 0 || aggregated.investedValue <= 0) {
        failValidation('Enter units and price per unit for your historical holding.');
        return;
      }
      parsed = aggregated.investedValue;
      units = aggregated.quantity;
      if (parsed > MAX_AMOUNT) {
        failValidation(`Historical cost looks too large. Check price per unit (not total cost).`);
        return;
      }
    } else {
    const raw = String(amount ?? '').trim();
    const isCleanDecimal = /^\d+(\.\d+)?$/.test(raw);
    parsed = parseFloat(raw);
    if (!isCleanDecimal || !isFinite(parsed) || parsed <= 0) {
      failValidation('Enter a positive number without letters or symbols (e.g. 250 or 1499.50).');
      return;
    }
    if (parsed > MAX_AMOUNT) {
      failValidation(`Enter an amount below ₹${MAX_AMOUNT.toLocaleString('en-IN')}. Split very large entries if needed.`);
      return;
    }
    units = Number(investmentUnits);
    if (tracksMarketInstrument && !instrument?.symbol) {
      failValidation('Search and select the stock, ETF, or mutual fund you purchased.');
      return;
    }
    if (tracksMarketInstrument && (!isFinite(units) || units <= 0)) {
      failValidation('Enter the number of shares or mutual-fund units purchased.');
      return;
    }
    if (includeOpeningPosition && !brokerId) {
      failValidation('Select a broker to save the opening position.');
      return;
    }
    if (includeOpeningPosition) {
      const parsedLots = parseOpeningLotsFromForm(openingLots);
      if (!parsedLots.ok) {
        if (parsedLots.reason === 'invalid_quantity') {
          failValidation(`Enter opening units greater than zero for lot ${(parsedLots.index ?? 0) + 1}.`);
        } else if (parsedLots.reason === 'invalid_price') {
          failValidation(`Enter the purchase price for lot ${(parsedLots.index ?? 0) + 1}.`);
        } else {
          failValidation('Add at least one opening lot with units and price.');
        }
        return;
      }
      parsedOpeningLots = parsedLots.lots;
      const priceCheck = validateOpeningLotPrices(parsedOpeningLots);
      if (!priceCheck.ok) {
        if (priceCheck.reason === 'total_not_per_unit') {
          failValidation(
            `Lot ${(priceCheck.index ?? 0) + 1}: ₹${priceCheck.impliedTotal?.toLocaleString('en-IN')} looks like the total for ${priceCheck.quantity} units, not the price per unit. Try ₹${priceCheck.suggestedPerUnit?.toLocaleString('en-IN')} per unit instead.`,
          );
        } else {
          failValidation(`Check the price per unit for lot ${(priceCheck.index ?? 0) + 1}.`);
        }
        return;
      }
    }
    }
    const splitTotal = splitRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    if (splitRows.length > 0) {
      if (splitRows.some((row) => !row.categoryId || !Number.isFinite(Number(row.amount)) || Number(row.amount) <= 0)) {
        failValidation('Choose a category and enter a positive amount for each split.');
        return;
      }
      if (Math.abs(splitTotal - parsed) > 0.01) {
        failValidation(`Split lines total ₹${splitTotal.toLocaleString('en-IN')}; the receipt amount is ₹${parsed.toLocaleString('en-IN')}.`);
        return;
      }
    }
    // Freeze the currency + rate at add time so aggregates never drift
    // when the FX table changes later (see NetWorthContext.summary for
    // the aggregation contract).
    const currencyForSubmit = String(currency ?? baseCurrency).toUpperCase();
    const rateForSubmit     = currencyForSubmit === baseCurrency
      ? 1
      : (parseFloat(fxRate) > 0 ? parseFloat(fxRate) : lookupRateOrOne(fxRates, currencyForSubmit, baseCurrency));

    if (currencyForSubmit !== baseCurrency && (!isFinite(rateForSubmit) || rateForSubmit <= 0)) {
      failValidation(`Set an FX rate for ${currencyForSubmit} → ${baseCurrency} (here or in Settings → Accounts & data).`);
      return;
    }

    let chitPayload = {};
    if (tracksGoldChit) {
      const schemeName = chitSchemeName.trim();
      if (!schemeName) {
        failValidation('Enter a chit name (e.g. Tanishq 20g gold chit).');
        return;
      }
      const weightResult = computeChitWeightGrams({
        amount: parsed,
        purity: chitPurity,
        baseRatePerGram: chitMetalRates?.gold,
        shopRatePerGram: chitShopRate.trim() === '' ? null : parseFloat(chitShopRate),
      });
      if (!weightResult?.grams) {
        failValidation(chitRatesLoading
          ? 'Loading gold reference for the selected date — try again in a moment, or enter shop ₹/g.'
          : 'Enter shop ₹/g for your jeweller, or wait for the reference rate for this date.');
        return;
      }
      chitPayload = {
        chitSchemeId: chitSchemeId || slugChitSchemeId(schemeName),
        chitSchemeName: schemeName,
        chitMetalPurity: chitPurity,
        chitWeightGrams: weightResult.grams,
        chitRatePerGram: weightResult.ratePerGram,
        chitClosedAt: initialValues?.chitClosedAt ?? null,
        linkedChitAssetId: initialValues?.linkedChitAssetId ?? null,
      };
    }

    if (makeRecurring && canShowRecurring) {
      if (type === 'investment' && tracksMarketInstrument && !instrument?.symbol) {
        failValidation('Select an instrument before saving a recurring investment.');
        return;
      }
      if (type === 'investment' && tracksMarketInstrument && (!isFinite(units) || units <= 0)) {
        failValidation('Enter shares/units for a recurring investment rule.');
        return;
      }
    }

    onSubmit({
      amount: parsed,
      categoryId,
      subCategoryId: subCategoryId ?? null,
      accountId,
      date,
      note: (isHistoricalEntry && !note.trim())
        ? `Opening position · ${instrument?.symbol ?? 'holding'}`
        : note.trim(),
      tags: tagInputRef.current?.getValue?.() ?? tags,
      voiceNote,
      // F9 (multi-currency). Frozen at add time.
      currency:     currencyForSubmit,
      fxRate:       rateForSubmit,
      amountInBase: parsed * rateForSubmit,
      // Investment-only. Included unconditionally so the parent's spread
      // doesn't need to know about `type`; non-investment paths ignore
      // brokerId and it stays null (its initial value).
      brokerId,
      instrumentSymbol: tracksMarketInstrument ? instrument.symbol : null,
      instrumentName: tracksMarketInstrument ? instrument.name : null,
      instrumentType: tracksMarketInstrument ? (instrument.quoteType || instrument.type) : null,
      investmentUnits: tracksMarketInstrument && !isHistoricalEntry ? units : null,
      historicalOnly: isHistoricalEntry,
      openingPosition: (isHistoricalEntry || includeOpeningPosition) && parsedOpeningLots
        ? buildOpeningPositionPayload({
          broker: brokerId,
          symbol: instrument.symbol,
          name: instrument.name || instrument.symbol,
          lots: parsedOpeningLots,
          trackingDate: openingTrackingDate,
        })
        : null,
      splits: splitRows.length > 0
        ? splitRows.map((row) => ({ categoryId: row.categoryId, amount: Number(row.amount) }))
        : null,
      ...chitPayload,
      ...(type === 'income' && incomeEntryMode === 'payslip'
        ? payslipStringsToPayload(payslipForm, payslipForm?.amountMode)
        : {}),
      makeRecurring: canShowRecurring && makeRecurring,
      recurringFrequency: makeRecurring ? recurringFrequency : null,
      recurringEndDate: makeRecurring && recurringEndEnabled ? recurringEndDate : null,
    }, { keepOpen });

    // Commit-time voice-note sweep. The saved row now points at
    // voiceNote.file (or null). Every other file that was current at
    // some point during this form's life is orphaned and safe to delete.
    committedRef.current = true;
    const keep = voiceNote?.file ?? null;
    for (const f of seenFilesRef.current) {
      if (f && f !== keep) {
        deleteVoiceNote(f).catch((e) => console.warn('Voice-note cleanup failed:', e));
      }
    }
    // Add-mode continues editing: reset baseline/seen so a follow-up
    // recording in the same session is judged against the just-saved row
    // rather than the mount-time baseline. Edit-mode tears down after
    // this so the reset is harmless there.
    baselineRef.current  = keep;
    seenFilesRef.current = new Set(keep ? [keep] : []);
    committedRef.current = false;
    // Add mode (no initialValues): clear the entry-specific fields so the
    // next transaction starts from a clean slate. We deliberately KEEP
    // category / sub-category / account / date because batch entry is the
    // common pattern (adding several lunches, or backfilling a whole day
    // of past-dated expenses). Reset only what changes every time.
    //
    // Edit mode: the parent tears the component down anyway, so this
    // branch would be a no-op — still guard on !initialValues for clarity.
    if (!initialValues) {
      setAmount('');
      setNote('');
      setTags([]);
      setVoiceNote(null);
      setLastVoiceFill(null);
      setPayslipForm(null);
      setIncomeEntryMode('manual');
      setIncludeOpeningPosition(false);
      setHistoricalOnly(false);
      setMakeRecurring(false);
      setRecurringFrequency('monthly');
      setRecurringEndEnabled(false);
      setRecurringEndDate(null);
      setOpeningLots([{
        clientKey: newOpeningLotKey(),
        id: null,
        quantity: '',
        avgCost: '',
        openingDate: openingTrackingDate,
      }]);
    }
  };

  // Replacing a recording: DO NOT delete the old file yet — the saved row
  // (in Edit mode) still references it. Cleanup happens at commit or
  // unmount via the seenFilesRef / baselineRef bookkeeping above.
  const handleRecorded = (next) => {
    if (next?.file) seenFilesRef.current.add(next.file);
    setVoiceNote(next);
  };

  // "Delete voice note" only clears the form-level reference. The actual
  // file is removed at commit time (row now points at null). If the user
  // cancels, baseline is preserved on disk so the saved row keeps working.
  const handleDeleteVoice = async () => {
    const ok = await confirm({
      title: 'Delete voice note?',
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) setVoiceNote(null);
  };

  // Push a transcript through the parser and update form state. Shared
  // between the automatic (Whisper) path and the manual-typing fallback.
  //
  // We build BOTH an `applied` list (fields we filled) and a `missed` list
  // (fields the parser couldn't infer). The inline banner below the
  // Speak-to-Fill button surfaces both so the user always sees what the
  // STT heard, what got auto-filled, and what they still need to correct
  // manually.
  const applyTranscript = (text) => {
    const trimmed = (text || '').trim();
    if (!trimmed) return;
    const parsed = parseVoiceTransaction(trimmed, { categories, accounts });

    const applied = [];
    const missed  = [];

    if (parsed.amount != null) {
      setAmount(String(parsed.amount));
      applied.push(`Amount ₹${parsed.amount}`);
    } else {
      missed.push('Amount');
    }

    if (parsed.categoryId) {
      changeCategory(parsed.categoryId, parsed.subCategoryId ?? null);
      const cat = categories.find((c) => c.id === parsed.categoryId);
      if (cat) applied.push(`Category ${cat.emoji} ${cat.label}`);
      if (parsed.subCategoryId) {
        const sub = cat?.subCategories?.find((s) => s.id === parsed.subCategoryId);
        if (sub) applied.push(`Sub ${sub.emoji} ${sub.label}`);
      }
    } else {
      missed.push('Category');
    }

    if (parsed.accountId) {
      setAccountId(parsed.accountId);
      const acc = accounts.find((a) => a.id === parsed.accountId);
      if (acc) applied.push(`Account ${acc.emoji} ${acc.label}`);
    } else if (accounts.length > 0) {
      // Only flag Account as missed if any exist — otherwise nothing to match.
      missed.push('Account');
    }

    if (parsed.date) {
      setDate(parsed.date);
      applied.push(`Time ${formatFieldTimestamp(parsed.date)}`);
    } else {
      missed.push('Date');
    }

    // Note always gets the raw transcript so full context is preserved,
    // even when amount + category parse perfectly.
    setNote(trimmed);

    setLastVoiceFill({ heard: trimmed, applied, missed });
  };

  const handleTranscribe = async () => {
    if (!voiceNote?.file) return;

    // No API key → fall back to manual typing. The parser doesn't care
    // where the text came from; it only sees text either way.
    if (!whisperApiKey) {
      setManualTranscript('');
      return;
    }

    try {
      setTranscribing(true);
      const text = await transcribeAudio({
        relPath: voiceNote.file,
        apiKey: whisperApiKey,
      });
      if (!text) {
        showToast('No speech detected in the recording.', { variant: 'warning' });
        return;
      }
      applyTranscript(text);
    } catch (e) {
      showToast(String(e?.message ?? e), { variant: 'error' });
    } finally {
      setTranscribing(false);
    }
  };

  const submitManualTranscript = () => {
    const text = (manualTranscript || '').trim();
    setManualTranscript(null);
    if (text) applyTranscript(text);
  };

  return (
    <View style={styles.formRoot}>
      <ScrollView
        style={styles.formScroll}
        contentContainerStyle={styles.formScrollBody}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
      >
      {lastVoiceFill && (
        <VoiceFillSummary
          summary={lastVoiceFill}
          accentColor={accentColor}
          onDismiss={() => setLastVoiceFill(null)}
        />
      )}

      {formError ? (
        <View style={styles.formErrorBanner} accessibilityRole="alert">
          <AppIcon name="alert-triangle" size={16} color={styles.formErrorText.color} strokeWidth={2.2} />
          <Text style={styles.formErrorText}>{formError}</Text>
        </View>
      ) : null}

      {tracksIncomePayslip && (
        <>
          <Text style={styles.incomeModeLabel}>How are you adding this?</Text>
          <View style={styles.incomeModeRow}>
            {INCOME_ENTRY_MODES.map((m) => {
              const active = incomeEntryMode === m.id;
              return (
                <TouchableOpacity
                  key={m.id}
                  onPress={() => switchIncomeEntryMode(m.id)}
                  activeOpacity={0.7}
                  style={[
                    styles.incomeModeChip,
                    active && { borderColor: accentColor, backgroundColor: accentColor + '18' },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={m.label}
                >
                  <AppIcon
                    name={m.icon}
                    size={14}
                    color={active ? accentColor : '#6b7280'}
                    strokeWidth={2.1}
                  />
                  <Text style={[
                    styles.incomeModeChipText,
                    active && { color: accentColor },
                  ]}>
                    {m.short}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <InfoCallout
            icon={incomeEntryMode === 'manual' ? 'info' : 'upload'}
            title={incomeEntryMode === 'manual' ? 'Manual entry' : 'Payslip-assisted entry'}
            body={incomeEntryMode === 'manual'
              ? 'Enter the amount and details yourself.'
              : 'Upload a payslip PDF to auto-fill salary, TDS, and PF.'}
            compact
          />
        </>
      )}

      {(!tracksIncomePayslip || incomeEntryMode === 'manual')
        && !(historicalOnly && tracksMarketInstrument) && (
        <>
          <Text style={styles.label}>Amount</Text>
          <AmountCalculatorButton value={amount} onChangeText={setAmount}>
            <TextInput
              style={styles.input}
              value={amount}
              onChangeText={(value) => {
                setAmount(value);
                if (formError) setFormError(null);
              }}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor="#9aa0a6"
            />
          </AmountCalculatorButton>
        </>
      )}

      {tracksIncomePayslip && incomeEntryMode === 'payslip' && (
        <>
          <TouchableOpacity
            style={[styles.uploadPdfBtn, pdfPhase === 'reading' && styles.uploadPdfBtnBusy]}
            onPress={handleUploadPayslip}
            disabled={pdfPhase === 'reading'}
            activeOpacity={0.7}
          >
            {pdfPhase === 'reading' ? (
              <>
                <ActivityIndicator size="small" color={accentColor} />
                <Text style={[styles.uploadPdfBtnText, { color: accentColor }]}>Reading payslip PDF…</Text>
              </>
            ) : (
              <>
                <View style={styles.uploadPdfBtnEmoji}>
                  <AppIcon name="file-text" size={22} color="#0369a1" strokeWidth={1.8} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.uploadPdfBtnText, { color: accentColor }]}>Upload payslip PDF</Text>
                  <Text style={styles.uploadPdfBtnSub}>
                    Auto-fill salary, TDS, and PF from a text-based payslip
                  </Text>
                </View>
              </>
            )}
          </TouchableOpacity>

          {payslipForm ? (
            <View style={styles.payslipPanel}>
              <View style={styles.payslipPanelHeader}>
                <Text style={styles.payslipPanelTitle}>Payslip details (for FY tax)</Text>
                <TouchableOpacity onPress={() => setPayslipForm(null)} hitSlop={8}>
                  <Text style={styles.payslipClearText}>Clear</Text>
                </TouchableOpacity>
              </View>
              {payslipForm.source ? (
                <Text style={styles.helperSmallDim} numberOfLines={1}>From {payslipForm.source}</Text>
              ) : null}
              <View style={styles.chipRow}>
                {[['net', 'Net credit'], ['gross', 'Gross salary']].map(([id, label]) => {
                  const active = payslipForm.amountMode === id;
                  return (
                    <TouchableOpacity
                      key={id}
                      onPress={() => setPayslipAmountMode(id)}
                      style={[styles.chip, active && { backgroundColor: accentColor, borderColor: accentColor }]}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextSelected]}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {[
                ['basic', 'Basic'],
                ['hra', 'HRA'],
                ['special', 'Special'],
                ['other', 'Other'],
                ['tds', 'TDS'],
                ['pf', 'PF'],
              ].map(([key, label]) => (
                <View key={key}>
                  <Text style={styles.label}>{label}</Text>
                  <TextInput
                    style={styles.panelInput}
                    value={payslipForm[key] ?? ''}
                    onChangeText={(value) => updatePayslipField(key, value)}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={themeColors.text.muted}
                  />
                </View>
              ))}
              {(payslipForm.gross || payslipForm.net || payslipForm.tds) ? (
                <Text style={styles.payslipSummary}>
                  {payslipForm.gross ? `Gross ₹${Number(payslipForm.gross).toLocaleString('en-IN')}` : ''}
                  {payslipForm.tds ? ` · TDS ₹${Number(payslipForm.tds).toLocaleString('en-IN')}` : ''}
                  {payslipForm.net ? ` · Net ₹${Number(payslipForm.net).toLocaleString('en-IN')}` : ''}
                </Text>
              ) : null}
            </View>
          ) : (
            <Text style={styles.payslipUploadHint}>
              Upload a payslip to fill in salary breakdown and income amount.
            </Text>
          )}

          <Text style={styles.label}>Income amount</Text>
          <AmountCalculatorButton value={amount} onChangeText={setAmount}>
            <TextInput
              style={styles.input}
              value={amount}
              onChangeText={(value) => {
                setAmount(value);
                if (formError) setFormError(null);
              }}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor="#9aa0a6"
            />
          </AmountCalculatorButton>
        </>
      )}

      <Text style={styles.label}>Category</Text>
      <ChipRow
        items={categories}
        selectedId={categoryId}
        onSelect={(id) => changeCategory(id)}
        accentColor={accentColor}
        emptyText="No categories — add one in Settings"
        trailingItem={<QuickAddPickerItem kind="category" type={type} accent={accentColor} onCreated={(item) => changeCategory(item.id)} />}
      />

      {selectedCategory && (
        <>
          <Text style={styles.label}>Sub-category (optional)</Text>
          {subCategories.length > 0 ? (
            <SubCategoryChipRow
              items={subCategories}
              selectedId={subCategoryId}
              onSelect={handleSubCategoryPick}
              accentColor={accentColor}
              trailingItem={<QuickAddPickerItem kind="subcategory" type={type} parentId={categoryId} accent={accentColor} onCreated={(item) => setSubCategoryId(item.id)} />}
            />
          ) : null}
          {subCategories.length === 0 ? <QuickAddPickerItem
            kind="subcategory"
            type={type}
            parentId={categoryId}
            accent={accentColor}
            onCreated={(item) => setSubCategoryId(item.id)}
          /> : null}
        </>
      )}

      {type === 'expense' && (
        <View style={styles.splitSection}>
          <TouchableOpacity
            onPress={() => setSplitRows((rows) => rows.length ? [] : [{ id: Date.now().toString(), categoryId, amount: '' }])}
            style={styles.splitToggle}
            activeOpacity={0.7}
          >
            <Text style={styles.splitToggleText}>
              {splitRows.length ? 'Remove expense split' : 'Split this expense'}
            </Text>
          </TouchableOpacity>
          {splitRows.length > 0 && (
            <>
              <Text style={styles.splitHint}>Assign the full receipt amount across categories.</Text>
              {splitRows.map((row, index) => (
                <View key={row.id} style={styles.splitRow}>
                  <View style={styles.splitCategory}>
                    <ChipRow
                      items={categories}
                      selectedId={row.categoryId}
                      onSelect={(id) => setSplitRows((rows) => rows.map((item) => item.id === row.id ? { ...item, categoryId: id } : item))}
                      accentColor={accentColor}
                      emptyText="No categories"
                    />
                  </View>
                  <TextInput
                    style={styles.splitAmount}
                    value={row.amount}
                    onChangeText={(value) => setSplitRows((rows) => rows.map((item) => item.id === row.id ? { ...item, amount: value } : item))}
                    keyboardType="decimal-pad"
                    placeholder="Amount"
                    placeholderTextColor="#9aa0a6"
                  />
                  {splitRows.length > 1 && (
                    <TouchableOpacity onPress={() => setSplitRows((rows) => rows.filter((item) => item.id !== row.id))} style={styles.splitRemove}>
                      <Text style={styles.splitRemoveText}>×</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              <TouchableOpacity
                onPress={() => setSplitRows((rows) => [...rows, { id: `${Date.now()}_${rows.length}`, categoryId: categories[0]?.id ?? null, amount: '' }])}
                style={styles.splitAdd}
              >
                <Text style={[styles.splitAddText, { color: accentColor }]}>+ Add category</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      <Text style={styles.label}>
        {type === 'investment' ? 'From account (source)' : 'Account'}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
      <View style={{ flex: 1 }}>
      <GroupedAccountPicker
        accounts={accounts}
        accountGroups={accountGroups}
        selectedId={accountId}
        onSelect={(id) => {
          accountTouchedRef.current = true;
          setAccountId(id);
          // Inherit the new account's currency unless the user has
          // explicitly picked a currency for this row (e.g. INR card
          // paying a USD bill — they'll want to keep USD selected).
          if (!currencyTouchedRef.current) {
            const nextAcc = accounts.find((a) => a.id === id);
            const nextCur = nextAcc?.currency ?? baseCurrency;
            setCurrency(nextCur);
            setFxRate(String(nextCur === baseCurrency ? 1 : lookupRateOrOne(fxRates, nextCur, baseCurrency)));
          }
        }}
        accentColor={accentColor}
      />
      </View>
      <QuickAddPickerItem
        kind="account"
        accent={accentColor}
        onCreated={(item) => {
          accountTouchedRef.current = true;
          setAccountId(item.id);
          if (!currencyTouchedRef.current) {
            const nextCur = item.currency ?? baseCurrency;
            setCurrency(nextCur);
            setFxRate(String(nextCur === baseCurrency ? 1 : lookupRateOrOne(fxRates, nextCur, baseCurrency)));
          }
        }}
      />
      </View>

      {/* Broker / destination picker — investment mode only.
          Rationale: an investment transaction is really a transfer
          from a bank account (already captured above) into a
          brokerage/MF platform. Storing which broker helps the user
          later reconcile against imported holdings and see where each
          rupee actually went. Optional — "None" is the default. */}
      {type === 'investment' && (
        <>
          <Text style={styles.label}>Broker / platform (destination)</Text>
          <BrokerChipRow
            brokers={transactionBrokers}
            selectedId={brokerId}
            onSelect={(id) => setBrokerId((prev) => (prev === id ? null : id))}
            accentColor={accentColor}
          />
        </>
      )}

      {tracksGoldChit && (
        <View style={styles.chitPanel}>
          <Text style={styles.label}>Chit name</Text>
          <TextInput
            style={styles.panelInput}
            value={chitSchemeName}
            onChangeText={(value) => {
              // Typing the exact name of an existing open chit should behave
              // like tapping its chip below — auto-fill purity and the last
              // rate you actually paid there, instead of silently falling
              // back to today's live market rate (which drifts from what
              // the shop charges and made repeat entries for the same
              // scheme price inconsistently against each other).
              const typed = value.trim().toLocaleLowerCase();
              const match = typed
                ? openChitSchemes.find((s) => s.name.trim().toLocaleLowerCase() === typed)
                : null;
              if (match) {
                pickOpenChitScheme(match);
              } else {
                setChitSchemeName(value);
                setChitSchemeId(null);
              }
            }}
            placeholder="e.g. Tanishq 20g gold chit"
            placeholderTextColor={themeColors.text.muted}
          />
          {openChitSchemes.length > 0 && (
            <>
              <Text style={styles.helperSmallDim}>Continue an open chit</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {openChitSchemes.map((scheme) => {
                  const selected = chitSchemeId === scheme.id;
                  return (
                    <TouchableOpacity
                      key={scheme.id}
                      onPress={() => pickOpenChitScheme(scheme)}
                      style={[styles.chip, styles.chipOnPanel, selected && { backgroundColor: accentColor, borderColor: accentColor }]}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                        {scheme.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </>
          )}

          <Text style={styles.label}>Gold purity</Text>
          <View style={styles.chipRow}>
            {METAL_PURITY.gold.map((item) => {
              const selected = chitPurity === item.id;
              return (
                <TouchableOpacity
                  key={item.id}
                  onPress={() => setChitPurity(item.id)}
                  style={[styles.chip, styles.chipOnPanel, selected && { backgroundColor: accentColor, borderColor: accentColor }]}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>Shop rate (optional ₹/g for {purityLabel(chitPurity)})</Text>
          <TextInput
            style={styles.panelInput}
            value={chitShopRate}
            onChangeText={setChitShopRate}
            keyboardType="decimal-pad"
            placeholder={chitReferenceRate
              ? chitRateHint
              : 'e.g. 7050'}
            placeholderTextColor={themeColors.text.muted}
          />
          {chitReferenceRate && chitShopRate.trim() === '' && (
            <TouchableOpacity
              onPress={() => setChitShopRate(String(Math.round(chitReferenceRate)))}
              style={styles.chitUseRefBtn}
              activeOpacity={0.7}
            >
              <Text style={styles.chitUseRefText}>
                Use reference ₹{Math.round(chitReferenceRate).toLocaleString('en-IN')}/g
              </Text>
            </TouchableOpacity>
          )}

          <Text style={styles.label}>Accrued weight (grams)</Text>
          <TextInput
            style={[styles.panelInput, styles.chitWeightInput]}
            value={chitWeightDisplay}
            editable={false}
            placeholder={chitRatesLoading ? 'Loading rate…' : 'Auto from amount + rate'}
            placeholderTextColor={themeColors.text.muted}
          />
          {chitWeightPreview ? (
            <Text style={styles.chitPreview}>
              ≈ {formatChitGrams(chitWeightPreview.grams, 3)}
              {' · '}
              ₹{Math.round(chitWeightPreview.ratePerGram).toLocaleString('en-IN')}/g
              {chitWeightPreview.usedShopRate ? ' (shop)' : (chitMetalRates?.historical ? ' (historical ref)' : ' (reference)')}
            </Text>
          ) : (
            <Text style={styles.helperSmallDim}>
              {chitRateHint}
            </Text>
          )}
        </View>
      )}

      {/* Currency (only shown when the app has ≥1 non-base currency
          configured, otherwise this is dead weight for INR-only users). */}
      {tracksMarketInstrument && (
        <>
          <Text style={styles.label}>Entry type</Text>
          <View style={styles.chipRow}>
            <TouchableOpacity
              onPress={() => setHistoricalOnly(false)}
              style={[
                styles.chip,
                !historicalOnly && { backgroundColor: accentColor, borderColor: accentColor },
              ]}
              activeOpacity={0.7}
            >
              <Text style={[styles.chipText, !historicalOnly && styles.chipTextSelected]}>
                New purchase
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setHistoricalOnly(true);
                setIncludeOpeningPosition(true);
              }}
              style={[
                styles.chip,
                historicalOnly && { backgroundColor: accentColor, borderColor: accentColor },
              ]}
              activeOpacity={0.7}
            >
              <Text style={[styles.chipText, historicalOnly && styles.chipTextSelected]}>
                Historical only
              </Text>
            </TouchableOpacity>
          </View>
          {historicalOnly ? (
            <InfoCallout
              icon="rotate-ccw"
              title="Historical holding"
              body="Record units you already owned before tracking. Portfolio and Net Worth update; your bank balance does not change."
              compact
            />
          ) : null}
          <InstrumentPicker
            categoryId={categoryId}
            marketCountry={marketCountry}
            query={instrumentQuery}
            onQueryChange={(value) => {
              setInstrumentQuery(value);
              if (value !== instrument?.name && value !== instrument?.symbol) setInstrument(null);
            }}
            selected={instrument}
            onSelect={(item) => {
              setInstrument(item);
              setInstrumentQuery(item.name);
              setInstrumentSuggestions([]);
            }}
            suggestions={instrumentSuggestions}
            searching={instrumentSearching}
            units={investmentUnits}
            onUnitsChange={setInvestmentUnits}
            hideUnits={historicalOnly}
            accentColor={accentColor}
          />
          {historicalDuplicatesLogged ? (
            <InfoCallout
              icon="alert-triangle"
              tone="warning"
              title="Already logged"
              body="This instrument already has other logged purchases. A historical entry on top of those would double-count your units. Switch to “New purchase” instead, or edit the existing entry from Portfolio."
              compact
            />
          ) : null}
          {(canShowOpeningPosition || (historicalOnly && !historicalDuplicatesLogged)) ? (
            <View style={styles.openingPositionCard}>
              {!brokerId ? (
                <View style={styles.openingPositionToggle}>
                  <View style={[styles.openingPositionIcon, { backgroundColor: accentColor + '18' }]}>
                    <AppIcon name="rotate-ccw" size={17} color={accentColor} strokeWidth={2.2} />
                  </View>
                  <View style={styles.openingPositionCopy}>
                    <Text style={styles.openingPositionTitle}>
                      {historicalOnly ? 'Historical units' : 'Already owned before tracking?'}
                    </Text>
                    <Text style={styles.openingPositionHint}>
                      Select a broker above, then enter units and average buy price per unit.
                    </Text>
                  </View>
                </View>
              ) : (
              <>
              {!historicalOnly ? (
              <TouchableOpacity
                style={styles.openingPositionToggle}
                onPress={() => setIncludeOpeningPosition((value) => !value)}
                accessibilityRole="button"
                accessibilityState={{ expanded: includeOpeningPosition }}
              >
                <View style={[styles.openingPositionIcon, { backgroundColor: accentColor + '18' }]}>
                  <AppIcon name="rotate-ccw" size={17} color={accentColor} strokeWidth={2.2} />
                </View>
                <View style={styles.openingPositionCopy}>
                  <Text style={styles.openingPositionTitle}>Already owned before tracking?</Text>
                  <Text style={styles.openingPositionHint}>Add opening units without changing your bank balance.</Text>
                </View>
                <AppIcon name={includeOpeningPosition ? 'chevron-up' : 'chevron-down'} size={18} color={themeColors.text.secondary} />
              </TouchableOpacity>
              ) : null}
              {(historicalOnly || includeOpeningPosition) ? (
                <View
                  style={styles.openingPositionFields}
                  {...(Platform.OS === 'android'
                    ? { importantForAutofill: 'noExcludeDescendants' }
                    : {})}
                >
                  <Text style={styles.openingLotsIntro}>
                    Add each historical purchase separately — we combine units and average cost for you.
                  </Text>
                  <Text style={styles.openingLotsClipboardHint}>
                    Numbers above the keyboard are your phone's clipboard or autofill suggestions — not from this app. Type units manually if those are phone numbers.
                  </Text>
                  {openingLots.map((lot, index) => (
                    <View key={lot.clientKey} style={styles.openingLotBlock}>
                      <View style={styles.openingLotHeader}>
                        <Text style={styles.openingLotTitle}>Lot {index + 1}</Text>
                        {openingLots.length > 1 ? (
                          <TouchableOpacity
                            onPress={() => removeOpeningLotRow(lot.clientKey)}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel={`Remove lot ${index + 1}`}
                          >
                            <AppIcon name="x" size={16} color={themeColors.text.secondary} strokeWidth={2.2} />
                          </TouchableOpacity>
                        ) : null}
                      </View>
                      <View style={styles.openingLotFields}>
                        <View>
                          <Text style={styles.openingLotFieldLabel}>Units</Text>
                          <TextInput
                            {...ISOLATED_NUMERIC_INPUT}
                            nativeID={`opening-lot-${lot.clientKey}-units`}
                            style={styles.input}
                            value={lot.quantity}
                            onChangeText={(value) => updateOpeningLot(
                              lot.clientKey,
                              { quantity: sanitizeDecimalInput(value) },
                            )}
                            keyboardType="decimal-pad"
                            placeholder="e.g. 25"
                            placeholderTextColor={themeColors.text.muted}
                          />
                        </View>
                        <View>
                          <Text style={styles.openingLotFieldLabel}>Price per unit (₹)</Text>
                          <Text style={styles.openingLotFieldHint}>Not the total — enter one unit's cost.</Text>
                          <TextInput
                            {...ISOLATED_NUMERIC_INPUT}
                            nativeID={`opening-lot-${lot.clientKey}-price`}
                            style={styles.input}
                            value={lot.avgCost}
                            onChangeText={(value) => updateOpeningLot(
                              lot.clientKey,
                              { avgCost: sanitizeDecimalInput(value) },
                            )}
                            keyboardType="decimal-pad"
                            placeholder="e.g. 1400"
                            placeholderTextColor={themeColors.text.muted}
                          />
                        </View>
                      </View>
                      {(() => {
                        const qty = Number(lot.quantity);
                        const price = Number(lot.avgCost);
                        if (!isFinite(qty) || !isFinite(price) || qty <= 0 || price <= 0) return null;
                        const lotTotal = qty * price;
                        const perUnitIfTotal = price / qty;
                        const looksLikeTotal = qty >= 2 && price >= 500 && price >= perUnitIfTotal * qty * 0.9;
                        return (
                          <Text style={[styles.openingLotLineTotal, looksLikeTotal && styles.openingLotLineTotalWarn]}>
                            {looksLikeTotal
                              ? `This reads as ₹${Math.round(lotTotal).toLocaleString('en-IN')} total — did you mean ₹${Math.round(perUnitIfTotal).toLocaleString('en-IN')} per unit?`
                              : `Lot total: ₹${Math.round(lotTotal).toLocaleString('en-IN')} (${qty} × ₹${price.toLocaleString('en-IN')})`}
                          </Text>
                        );
                      })()}
                    </View>
                  ))}
                  <TouchableOpacity
                    onPress={addOpeningLotRow}
                    style={styles.openingLotAddBtn}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Add another opening lot"
                  >
                    <AppIcon name="plus" size={16} color={accentColor} strokeWidth={2.4} />
                    <Text style={[styles.openingLotAddText, { color: accentColor }]}>Add another lot</Text>
                  </TouchableOpacity>
                  {openingLotsSummary ? (
                    <View style={styles.openingLotsSummary}>
                      <Text style={styles.openingLotsSummaryLabel}>Combined opening position</Text>
                      <Text style={styles.openingLotsSummaryValue}>
                        {openingLotsSummary.quantity.toLocaleString('en-IN')} units
                        {' · '}avg ₹{openingLotsSummary.avgCost.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                        {' · '}₹{Math.round(openingLotsSummary.investedValue).toLocaleString('en-IN')} invested
                      </Text>
                    </View>
                  ) : null}
                  <DateTimeField
                    label="Tracking starts on"
                    value={openingTrackingDate}
                    onChange={setOpeningTrackingDate}
                    mode="date"
                    maximumDate={new Date()}
                    hint="Defaults to the selected account's opening date"
                  />
                  <InfoCallout
                    icon="info"
                    title="Historical holding"
                    body={historicalOnly
                      ? 'Saved as a historical record only — portfolio and Net Worth update; your bank balance stays unchanged.'
                      : 'These opening lots affect portfolio and Net Worth only. The purchase being entered above remains the only account transaction.'}
                    compact
                  />
                </View>
              ) : null}
              </>
              )}
            </View>
          ) : null}
        </>
      )}

      {(CURRENCIES.some((c) => c.code !== baseCurrency && ((accounts.some((a) => a.currency === c.code)) || (fxRates && fxRates[c.code])))
        || currency !== baseCurrency
      ) && (
        <>
          <Text style={styles.label}>
            Currency
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.currencyPickerRow}
          >
            {CURRENCIES.map((c) => {
              const selected = currency === c.code;
              return (
                <TouchableOpacity
                  key={c.code}
                  onPress={() => handleCurrencyPick(c.code)}
                  style={[styles.txCurrencyChip, selected && { borderColor: accentColor, backgroundColor: accentColor + '15' }]}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.txCurrencyCode, selected && { color: accentColor }]}>{c.code}</Text>
                  <Text style={styles.txCurrencySym}>{c.symbol}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {currency !== baseCurrency && (
            <>
              <Text style={styles.label}>FX rate (1 {currency} → {baseCurrency})</Text>
              <TextInput
                style={styles.input}
                value={fxRate}
                onChangeText={setFxRate}
                keyboardType="decimal-pad"
                placeholder="e.g. 88.40"
                placeholderTextColor="#9ca3af"
              />
              {(!isFinite(parseFloat(fxRate)) || parseFloat(fxRate) <= 0) ? (
                <StatusBadge status="missing_fx_rate" />
              ) : null}
              {/* Live preview of the base equivalent so the user knows
                  exactly what will be persisted. */}
              {(() => {
                const amt = parseFloat(amount);
                const rate = parseFloat(fxRate);
                if (!isFinite(amt) || amt <= 0 || !isFinite(rate) || rate <= 0) {
                  return (
                    <Text style={styles.helperSmallDim}>
                      Enter a positive amount and rate to see the {baseCurrency} equivalent.
                    </Text>
                  );
                }
                const base = amt * rate;
                return (
                  <Text style={styles.helperSmallDim}>
                    ≈ {currencyMeta(baseCurrency).symbol} {base.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} in {baseCurrency}
                  </Text>
                );
              })()}
            </>
          )}
        </>
      )}

      <DateTimeField
        label="Timestamp"
        value={date}
        onChange={setDate}
        maximumDate={new Date()}
      />

      <Text style={styles.label}>Note (optional)</Text>
      <TextInput
        style={styles.input}
        value={note}
        onChangeText={(value) => {
          autoNoteRef.current = null;
          setNote(value);
        }}
        placeholder={notePlaceholder}
        placeholderTextColor="#9aa0a6"
        multiline
      />

      {noteSuggestions.length > 0 ? (
        <View style={styles.suggestionBlock}>
          <Text style={styles.suggestionLabel}>Previous notes</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.suggestionRow}>
            {noteSuggestions.map(({ label, template, transaction }) => (
              <TouchableOpacity
                key={label.toLocaleLowerCase()}
                onPress={() => {
                  const sourceDate = transaction.createdAt ?? transaction.date;
                  const applied = noteForTransactionDate(template, sourceDate, date);
                  autoNoteRef.current = { template, sourceDate, lastApplied: applied };
                  setNote(applied);
                  const priorCategory = categories.find((item) => item.id === transaction.categoryId);
                  if (priorCategory) {
                    setCategoryId(priorCategory.id);
                    const validSub = priorCategory.subCategories?.some(
                      (item) => item.id === transaction.subCategoryId,
                    );
                    setSubCategoryId(validSub ? transaction.subCategoryId : null);
                  }
                }}
                style={styles.suggestionChip}
                activeOpacity={0.7}
              >
                <AppIcon name="repeat" size={12} color={accentColor} strokeWidth={2.1} />
                <Text style={[styles.suggestionChipText, { color: accentColor }]} numberOfLines={1}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {suggestedCategory ? (
        <TouchableOpacity
          onPress={() => {
            setCategoryId(suggestedCategory.transaction.categoryId);
            setSubCategoryId(suggestedCategory.transaction.subCategoryId ?? null);
          }}
          style={styles.categorySuggestion}
          activeOpacity={0.72}
          accessibilityRole="button"
          accessibilityLabel={`Use suggested category ${suggestedCategory.category.label}`}
        >
          <AppIcon name="sparkles" size={15} color={accentColor} strokeWidth={2.1} />
          <Text style={styles.categorySuggestionText}>Suggested</Text>
          <Text style={[styles.categorySuggestionValue, { color: accentColor }]}>
            {suggestedCategory.category.emoji} {suggestedCategory.category.label}
          </Text>
          <AppIcon name="chevron-right" size={14} color={accentColor} strokeWidth={2} />
        </TouchableOpacity>
      ) : null}

      <Text style={styles.label}>Tags</Text>
      <TagInput
        ref={tagInputRef}
        value={tags}
        onChange={setTags}
        suggestions={tagSuggestions}
        placeholder="e.g. vacation, work, reimbursable"
      />

      {Platform.OS !== 'web' && (
        <>
          <Text style={styles.label}>Voice note attachment (optional)</Text>
          {voiceNote ? (
            <VoicePlayer
              voiceNote={voiceNote}
              onDelete={handleDeleteVoice}
              onTranscribe={whisperApiKey ? handleTranscribe : null}
              transcribing={transcribing}
            />
          ) : (
            <VoiceRecorder onRecorded={handleRecorded} accentColor={accentColor} />
          )}
        </>
      )}

      <ManualTranscriptModal
        visible={manualTranscript !== null}
        value={manualTranscript ?? ''}
        onChange={setManualTranscript}
        onCancel={() => setManualTranscript(null)}
        onSubmit={submitManualTranscript}
        accentColor={accentColor}
      />

      <PayslipReviewDialog
        visible={pdfPhase === 'review'}
        fileName={pdfFileName}
        result={pdfParseResult}
        mode="income"
        onClose={closePayslipReview}
        onApply={handleApplyPayslipReview}
      />

      {Number(amount) > 0 && selectedCategory && selectedAccount ? (
        <View style={styles.savePreview}>
          <View style={[styles.savePreviewIcon, { backgroundColor: accentColor + '18' }]}>
            <AppIcon name="check" size={16} color={accentColor} strokeWidth={2.3} />
          </View>
          <View style={styles.savePreviewCopy}>
            <Text style={styles.savePreviewLabel}>Ready to save</Text>
            <Text style={styles.savePreviewValue} numberOfLines={2}>
              {currencyMeta(currency).symbol}{Number(amount).toLocaleString('en-IN')}
              {' · '}{selectedCategory.emoji} {selectedCategory.label}
              {' · '}{selectedAccount.emoji} {selectedAccount.label}
            </Text>
          </View>
        </View>
      ) : null}

      {canShowRecurring ? (
        <View style={styles.recurringCard}>
          <View style={styles.recurringToggleRow}>
            <View style={styles.recurringToggleCopy}>
              <Text style={styles.recurringToggleTitle}>Make this recurring</Text>
              <Text style={styles.recurringToggleHint}>
                Also create a rule — future entries auto-add when you open the app.
              </Text>
            </View>
            <Switch
              value={makeRecurring}
              onValueChange={setMakeRecurring}
              trackColor={{ false: themeColors.bg.surfaceAlt, true: accentColor + '88' }}
              thumbColor={makeRecurring ? accentColor : themeColors.bg.surface}
            />
          </View>
          {makeRecurring ? (
            <View style={styles.recurringFields}>
              <Text style={styles.label}>Repeat</Text>
              <View style={styles.chipRow}>
                {recurringFrequencyOptions.map((freq) => {
                  const selected = recurringFrequency === freq.id;
                  return (
                    <TouchableOpacity
                      key={freq.id}
                      onPress={() => setRecurringFrequency(freq.id)}
                      style={[styles.chip, selected && { backgroundColor: accentColor, borderColor: accentColor }]}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                        {freq.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={styles.recurringEndRow}>
                <Text style={styles.recurringEndLabel}>End date (optional)</Text>
                <Switch
                  value={recurringEndEnabled}
                  onValueChange={(on) => {
                    setRecurringEndEnabled(on);
                    if (!on) setRecurringEndDate(null);
                    else if (!recurringEndDate) setRecurringEndDate(date);
                  }}
                  trackColor={{ false: themeColors.bg.surfaceAlt, true: accentColor + '88' }}
                  thumbColor={recurringEndEnabled ? accentColor : themeColors.bg.surface}
                />
              </View>
              {recurringEndEnabled ? (
                <DateTimeField
                  label="Ends on"
                  value={recurringEndDate ?? date}
                  onChange={setRecurringEndDate}
                  maximumDate={null}
                />
              ) : null}
              {type === 'investment' && tracksMarketInstrument && instrument?.symbol ? (
                <Text style={styles.recurringInvestHint}>
                  SIP rule includes {instrument.name || instrument.symbol}
                  {investmentUnits.trim() ? ` · ${investmentUnits.trim()} units` : ''}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {allowSaveAndAddAnother ? (
        <View style={styles.submitActions}>
          <AppButton
            label="Save + another"
            variant="secondary"
            onPress={() => handleSubmit(true)}
            fullWidth={false}
            style={styles.submitSecondary}
          />
          <AppButton
            label={submitLabel}
            onPress={() => handleSubmit(false)}
            color={accentColor}
            fullWidth={false}
            style={styles.submitPrimary}
          />
        </View>
      ) : (
        <AppButton
          label={submitLabel}
          onPress={() => handleSubmit(false)}
          color={accentColor}
          style={styles.submitBtnWrap}
        />
      )}
      </ScrollView>
      <View style={[styles.micRail, { pointerEvents: 'box-none' }]}>
        <SpeakToFillButton
          onTranscript={applyTranscript}
          onNeedsManualInput={() => setManualTranscript('')}
          whisperApiKey={whisperApiKey}
          audioUriGetter={() => voiceNote?.file}
          accentColor={accentColor}
        />
      </View>
    </View>
  );
}

// ----------------------------------------------------------------------------
// VoiceFillSummary — the "here's what I heard and what I filled" banner
// that appears below the Speak-to-Fill button after every voice interaction.
//
// Existed as an Alert only when nothing matched. Now always visible so users
// can see:
//   - what the STT transcribed (crucial when voice recognition mishears)
//   - which fields were auto-filled ("Amount ₹500", "Category 🧾 Bills")
//   - which fields the parser couldn't figure out (they need to fill those
//     manually)
// The ✕ dismisses it; recording again replaces it.
// ----------------------------------------------------------------------------
function VoiceFillSummary({ summary, accentColor, onDismiss }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const { heard, applied, missed } = summary;
  const allMissed = applied.length === 0;
  return (
    <View
      style={[
        styles.summaryCard,
        { borderColor: allMissed ? themeColors.state.errorText : accentColor + '55' },
        allMissed && { backgroundColor: themeColors.state.errorSurface },
      ]}
    >
      <View style={styles.summaryHeader}>
        <Text style={styles.summaryHeaderLabel}>HEARD</Text>
        <TouchableOpacity
          onPress={onDismiss}
          hitSlop={8}
          style={styles.summaryClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss voice-fill summary"
        >
          <AppIcon name="x" size={14} color={styles.summaryCloseText.color} strokeWidth={2.4} />
        </TouchableOpacity>
      </View>
      <Text style={styles.summaryQuote}>"{heard}"</Text>

      {applied.length > 0 && (
        <>
          <Text style={styles.summaryHeaderLabel}>FILLED</Text>
          <View style={styles.summaryPills}>
            {applied.map((line, i) => (
              <View
                key={i}
                style={[styles.summaryPill, { borderColor: accentColor }]}
              >
                <Text style={[styles.summaryPillText, { color: accentColor }]}>
                  {line}
                </Text>
              </View>
            ))}
          </View>
        </>
      )}

      {missed.length > 0 && (
        <>
          <Text style={[styles.summaryHeaderLabel, { marginTop: 8 }]}>
            {allMissed ? 'NOTHING RECOGNIZED' : 'NOT DETECTED — SET MANUALLY'}
          </Text>
          <View style={styles.summaryPills}>
            {missed.map((f) => (
              <View key={f} style={styles.summaryMissedPill}>
                <Text style={styles.summaryMissedText}>{f}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

// ----------------------------------------------------------------------------
// ManualTranscriptModal — the no-API-key fallback. User types what they
// said (they just recorded it, so they know), and the same parser that
// would consume Whisper's output consumes their text. Same downstream
// pipeline, different source.
// ----------------------------------------------------------------------------
function ManualTranscriptModal({
  visible,
  value,
  onChange,
  onCancel,
  onSubmit,
  accentColor,
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Modal
      visible={visible}
      onRequestClose={onCancel}
      animationType="fade"
      transparent
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Type what you said</Text>
          <Text style={styles.modalSubtitle}>
            The parser will pull out the amount and category, e.g.{'\n'}
            <Text style={{ fontWeight: '600' }}>"500 rupees on lunch"</Text> →
            amount 500, category Food.
          </Text>
          <TextInput
            value={value}
            onChangeText={onChange}
            placeholder="e.g. 500 rupees on lunch"
            placeholderTextColor="#9aa0a6"
            style={styles.modalInput}
            multiline
            autoFocus
          />
          <View style={styles.modalButtons}>
            <TouchableOpacity
              onPress={onCancel}
              style={[styles.modalBtn, styles.modalBtnGhost]}
              activeOpacity={0.7}
            >
              <Text style={styles.modalBtnGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onSubmit}
              style={[styles.modalBtn, { backgroundColor: accentColor }]}
              activeOpacity={0.8}
              disabled={!value.trim()}
            >
              <Text style={styles.modalBtnPrimaryText}>Extract</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Same shape as ChipRow but styled a bit smaller & with a "None" pill so
// the user can clear their selection without changing the parent category.
function SubCategoryChipRow({ items, selectedId, onSelect, accentColor, trailingItem = null }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.chipRow}>
      <TouchableOpacity
        onPress={() => onSelect(null)}
        style={[
          styles.subChip,
          !selectedId && {
            backgroundColor: accentColor,
            borderColor: accentColor,
          },
        ]}
        activeOpacity={0.7}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityState={{ selected: !selectedId }}
        accessibilityLabel="No sub-category"
      >
        <Text
          style={[
            styles.subChipText,
            !selectedId && styles.chipTextSelected,
          ]}
        >
          None
        </Text>
      </TouchableOpacity>
      {items.map((s) => {
        const selected = s.id === selectedId;
        return (
          <TouchableOpacity
            key={s.id}
            onPress={() => onSelect(s.id)}
            style={[
              styles.subChip,
              selected && {
                backgroundColor: accentColor,
                borderColor: accentColor,
              },
            ]}
            activeOpacity={0.7}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={s.label}
          >
            <Text
              style={[
                styles.subChipText,
                selected && styles.chipTextSelected,
              ]}
            >
              {s.emoji} {formatSubCategoryLabel(s.label)}
            </Text>
          </TouchableOpacity>
        );
      })}
      {trailingItem}
    </View>
  );
}

function ChipRow({ items, selectedId, onSelect, accentColor, emptyText, trailingItem = null }) {
  const styles = useThemedStyles(makeStyles);
  if (items.length === 0) return trailingItem ?? (emptyText ? <InfoCallout icon="info" title="Nothing to select" body={emptyText} compact /> : null);
  return (
    <View style={styles.chipRow}>
      {items.map((c) => {
        const selected = c.id === selectedId;
        return (
          <TouchableOpacity
            key={c.id}
            onPress={() => onSelect(c.id)}
            style={[
              styles.chip,
              selected && {
                backgroundColor: accentColor,
                borderColor: accentColor,
              },
            ]}
            activeOpacity={0.7}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={c.label}
          >
            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
              {c.emoji} {c.label}
            </Text>
          </TouchableOpacity>
        );
      })}
      {trailingItem}
    </View>
  );
}

function InstrumentPicker(props) {
  const styles = useThemedStyles(makeStyles);
  const {
    categoryId,
    marketCountry,
    query,
    onQueryChange,
    selected,
    suggestions,
    searching,
    onSelect,
    units,
    onUnitsChange,
    hideUnits = false,
    accentColor,
  } = props;
  const countryLabel = marketCountry === 'IN' ? 'Indian ' : marketCountry === 'US' ? 'US ' : marketCountry === 'GLOBAL' ? 'international ' : '';
  const kind = marketCountry === 'IN'
    ? 'Indian stock, ETF, or mutual fund'
    : categoryId === 'mutual_funds'
    ? `${countryLabel}mutual fund`
    : `${countryLabel}stock or ETF`;
  return (
    <View style={styles.instrumentSection}>
      <Text style={styles.label}>Investment name</Text>
      <View style={[styles.instrumentSearch, selected && { borderColor: accentColor }]}>
        {searching ? <ActivityIndicator size={'small'} color={accentColor} /> : <AppIcon name={'search'} size={18} color={selected ? accentColor : '#6b7280'} />}
        <TextInput
          style={styles.instrumentSearchInput}
          value={query}
          onChangeText={onQueryChange}
          placeholder={`Search ${kind} by name or symbol`}
          placeholderTextColor={'#8b94a3'}
          autoCapitalize={'words'}
          autoCorrect={false}
        />
      </View>
      {selected ? (
        <Text style={[styles.instrumentSelected, { color: accentColor }]}>
          Selected: {selected.name || selected.symbol}
          {selected.name && selected.symbol && selected.name.toUpperCase() !== selected.symbol.toUpperCase()
            ? ` (${selected.symbol})`
            : ''}
        </Text>
      ) : null}
      {suggestions.length > 0 ? (
        <View style={styles.instrumentResults}>
          {suggestions.map((item, index) => (
            <TouchableOpacity
              key={`${item.symbol}-${item.exchange}-${item.source || 'api'}`}
              style={[styles.instrumentResult, index > 0 && styles.instrumentResultBorder]}
              onPress={() => onSelect(item)}
              activeOpacity={0.7}
            >
              <View style={styles.instrumentResultText}>
                <Text style={styles.instrumentName} numberOfLines={1}>{item.name || item.symbol}</Text>
                <Text style={styles.instrumentMeta}>
                  {item.source === 'local' ? 'Previously used · ' : ''}
                  {item.symbol} · {item.exchange || 'Global'} · {item.type || item.quoteType || '—'}
                </Text>
              </View>
              <AppIcon name={'chevron-right'} size={16} color={'#8b94a3'} />
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
      {!selected && query.trim().length >= 2 && !searching && suggestions.length === 0 ? (
        <Text style={styles.instrumentEmpty}>No matching {kind}s found. Try the trading symbol.</Text>
      ) : null}
      {!hideUnits ? (
        <>
          <Text style={styles.label}>Shares / units purchased</Text>
          <TextInput
            {...ISOLATED_NUMERIC_INPUT}
            nativeID="investment-units-purchased"
            style={styles.input}
            value={units}
            onChangeText={(value) => onUnitsChange(sanitizeDecimalInput(value))}
            keyboardType="decimal-pad"
            placeholder="e.g. 10 or 2.5"
            placeholderTextColor="#8b94a3"
          />
        </>
      ) : null}
    </View>
  );
}

// Broker chip picker for investment mode. Mirrors ChipRow styling but
// takes its broker list from the parent (sourced from
// useSettings().brokers so user edits to the Broker management screen
// show up here without a rebuild) and prepends a "None" option so the
// user can clear the selection with a single tap. Tapping the
// currently-selected chip also clears it (handled by the parent's
// onSelect, not here).
//
// We deliberately show the broker chips inline (not in a modal picker)
// because ~11 brokers fit comfortably in one horizontal scroll row and
// stay next to the source-account picker for context — the two together
// make the "from X to Y" mental model explicit.
function BrokerChipRow({ brokers, selectedId, onSelect, accentColor }) {
  const styles = useThemedStyles(makeStyles);
  const noneSelected = !selectedId;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRow}
    >
      <TouchableOpacity
        key="none"
        onPress={() => onSelect(null)}
        style={[
          styles.chip,
          noneSelected && {
            backgroundColor: accentColor,
            borderColor: accentColor,
          },
        ]}
        activeOpacity={0.7}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityState={{ selected: noneSelected }}
        accessibilityLabel="No broker"
      >
        <Text style={[styles.chipText, noneSelected && styles.chipTextSelected]}>
          — None
        </Text>
      </TouchableOpacity>
      {brokers.map((b) => {
        const selected = b.id === selectedId;
        return (
          <TouchableOpacity
            key={b.id}
            onPress={() => onSelect(b.id)}
            style={[
              styles.chip,
              selected && {
                backgroundColor: accentColor,
                borderColor: accentColor,
              },
            ]}
            activeOpacity={0.7}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={b.label}
          >
            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
              {b.emoji} {b.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

// Renders each account group as its own chip row with a small header. Groups
// with zero accounts are skipped (they'd render nothing useful anyway).
function GroupedAccountPicker({
  accounts,
  accountGroups,
  selectedId,
  onSelect,
  accentColor,
}) {
  const styles = useThemedStyles(makeStyles);
  if (accounts.length === 0) {
    return (
      <InfoCallout
        icon="wallet"
        title="No financial accounts"
        body="Add an account in Settings → Accounts & data."
        tone="warning"
        compact
      />
    );
  }

  // Bucket accounts by group id. Preserves account insertion order within a
  // group and group insertion order across groups.
  const byGroup = {};
  for (const a of accounts) {
    (byGroup[a.groupId] ??= []).push(a);
  }

  // Accounts whose groupId points to a deleted group ("orphans"). Rare —
  // shouldn't normally happen — but showing them means the user can still
  // pick or reassign them from the transaction form.
  const knownGroupIds = new Set(accountGroups.map((g) => g.id));
  const orphans = accounts.filter((a) => !knownGroupIds.has(a.groupId));

  return (
    <View style={styles.groupList}>
      {accountGroups.map((g) => {
        const items = byGroup[g.id] ?? [];
        if (items.length === 0) return null;
        return (
          <View key={g.id} style={styles.groupBlock}>
            <Text style={styles.groupHeader}>
              {g.emoji}  {g.label.toUpperCase()}
            </Text>
            <ChipRow
              items={items}
              selectedId={selectedId}
              onSelect={onSelect}
              accentColor={accentColor}
              emptyText=""
            />
          </View>
        );
      })}
      {orphans.length > 0 && (
        <View style={styles.groupBlock}>
          <Text style={styles.groupHeader}>UNGROUPED</Text>
          <ChipRow
            items={orphans}
            selectedId={selectedId}
            onSelect={onSelect}
            accentColor={accentColor}
            emptyText=""
          />
        </View>
      )}
    </View>
  );
}

const makeStyles = (c) => ({
  formErrorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: c.state.errorBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.accent.expense + '44',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 10,
  },
  formErrorText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: c.state.errorFg,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: c.text.secondary,
    marginTop: 14,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  formRoot: { flex: 1 },
  micRail: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'flex-end',
    zIndex: 20,
  },
  formScroll: { flex: 1 },
  formScrollBody: { padding: 20, paddingBottom: 60 },
  input: {
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: c.text.primary,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  panelInput: {
    backgroundColor: c.bg.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: c.text.primary,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  instrumentSection: { marginTop: 2 },
  instrumentSearch: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    backgroundColor: c.bg.surfaceAlt, borderRadius: 10,
    paddingHorizontal: 12, borderWidth: 1, borderColor: c.border.subtle,
  },
  instrumentSearchInput: { flex: 1, paddingVertical: 12, fontSize: 16, color: c.text.primary },
  instrumentSelected: { marginTop: 6, fontSize: 12, fontWeight: '700' },
  instrumentResults: {
    marginTop: 6, borderWidth: 1, borderColor: c.border.subtle,
    borderRadius: 10, backgroundColor: c.bg.surface, overflow: 'hidden',
  },
  instrumentResult: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8 },
  instrumentResultBorder: { borderTopWidth: 1, borderTopColor: c.border.subtle },
  instrumentResultText: { flex: 1 },
  instrumentName: { color: c.text.primary, fontSize: 14, fontWeight: '700' },
  instrumentMeta: { color: c.text.secondary, fontSize: 11, marginTop: 3 },
  instrumentEmpty: { color: c.text.secondary, fontSize: 12, marginTop: 7 },
  openingPositionCard: { marginTop: 12, borderRadius: 12, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.bg.surface, overflow: 'hidden' },
  openingPositionToggle: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  openingPositionIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  openingPositionCopy: { flex: 1, minWidth: 0 },
  openingPositionTitle: { color: c.text.primary, fontSize: 13, fontWeight: '800' },
  openingPositionHint: { color: c.text.secondary, fontSize: 11, lineHeight: 16, marginTop: 2 },
  openingPositionFields: { padding: 12, paddingTop: 0, borderTopWidth: 1, borderTopColor: c.border.subtle },
  openingLotFields: { gap: 10 },
  openingLotFieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: c.text.secondary,
    marginBottom: 6,
  },
  openingLotsIntro: {
    color: c.text.secondary,
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 6,
  },
  openingLotsClipboardHint: {
    color: c.text.muted,
    fontSize: 10,
    lineHeight: 14,
    fontStyle: 'italic',
    marginBottom: 10,
  },
  openingLotBlock: {
    marginBottom: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.border.subtle,
    backgroundColor: c.bg.surfaceAlt,
  },
  openingLotHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  openingLotTitle: {
    color: c.text.primary,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  openingLotFieldHint: {
    color: c.text.muted,
    fontSize: 10,
    lineHeight: 14,
    marginBottom: 4,
  },
  openingLotLineTotal: {
    color: c.text.secondary,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 6,
  },
  openingLotLineTotalWarn: {
    color: c.accent.expense,
    fontWeight: '700',
  },
  openingLotAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 2,
    marginBottom: 10,
  },
  openingLotAddText: {
    fontSize: 12,
    fontWeight: '800',
  },
  openingLotsSummary: {
    marginBottom: 10,
    padding: 10,
    borderRadius: 10,
    backgroundColor: c.accent.primary + '10',
    borderWidth: 1,
    borderColor: c.accent.primary + '25',
  },
  openingLotsSummaryLabel: {
    color: c.text.secondary,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  openingLotsSummaryValue: {
    color: c.text.primary,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  groupList: { gap: 6 },
  groupBlock: { gap: 2 },
  groupHeader: {
    fontSize: 10,
    color: c.text.secondary,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: 6,
  },
  chipRow: { paddingVertical: 4, gap: 8, flexDirection: 'row', flexWrap: 'wrap' },
  chitPanel: {
    marginTop: 4,
    marginBottom: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: c.bg.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border.subtle,
    gap: 6,
  },
  chitWeightInput: {
    fontWeight: '700',
    color: c.accent.gold,
  },
  chitUseRefBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  chitUseRefText: {
    fontSize: 12,
    fontWeight: '700',
    color: c.accent.gold,
  },
  chitPreview: {
    fontSize: 13,
    fontWeight: '800',
    color: c.accent.gold,
    marginTop: 4,
  },
  incomeModeLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: c.text.secondary,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  incomeModeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  incomeModeChip: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: c.border.subtle,
    backgroundColor: c.bg.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  incomeModeChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: c.text.secondary,
    textAlign: 'center',
  },
  payslipUploadHint: {
    fontSize: 12,
    color: c.text.secondary,
    fontStyle: 'italic',
    marginBottom: 10,
    lineHeight: 17,
  },
  uploadPdfBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#2563eb',
    backgroundColor: '#2563eb0d',
  },
  uploadPdfBtnBusy: {
    borderStyle: 'solid',
    opacity: 0.7,
  },
  uploadPdfBtnEmoji: { width: 26, alignItems: 'center' },
  uploadPdfBtnText: {
    fontSize: 13,
    fontWeight: '800',
  },
  uploadPdfBtnSub: {
    fontSize: 11,
    color: c.text.secondary,
    marginTop: 2,
    lineHeight: 15,
  },
  payslipPanel: {
    marginBottom: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: c.bg.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border.subtle,
    gap: 6,
  },
  payslipPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  payslipPanelTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: c.text.primary,
  },
  payslipClearText: {
    fontSize: 12,
    fontWeight: '700',
    color: c.text.secondary,
  },
  payslipSummary: {
    fontSize: 12,
    fontWeight: '700',
    color: '#059669',
    marginTop: 4,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: c.bg.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  chipOnPanel: {
    backgroundColor: c.bg.surface,
  },
  chipText: { fontSize: 13, fontWeight: '600', color: c.text.secondary },
  chipTextSelected: { color: '#fff' },
  subChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: c.bg.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border.subtle,
    alignSelf: 'flex-start',
    flexShrink: 0,
  },
  subChipText: { fontSize: 12, fontWeight: '600', color: c.text.secondary, flexShrink: 0 },
  splitSection: { marginTop: 14, padding: 12, borderRadius: 10, backgroundColor: c.bg.surfaceAlt },
  splitToggle: { alignSelf: 'flex-start' },
  splitToggleText: { color: c.accent.primary, fontSize: 13, fontWeight: '700' },
  splitHint: { color: c.text.secondary, fontSize: 11, marginTop: 6, marginBottom: 4 },
  splitRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  splitCategory: { flex: 1 },
  splitAmount: { width: 92, backgroundColor: c.bg.surface, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 9, color: c.text.primary, borderWidth: 1, borderColor: c.border.subtle },
  splitRemove: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  splitRemoveText: { color: c.accent.expense, fontSize: 22, fontWeight: '600' },
  splitAdd: { marginTop: 8, alignSelf: 'flex-start' },
  splitAddText: { fontSize: 12, fontWeight: '700' },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  dateChipInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dateChipText: { fontSize: 15, fontWeight: '600', color: c.text.primary },
  dateChipHint: { fontSize: 11, color: c.text.secondary },

  // Currency picker (F9 Tier 2) --------------------------------------------
  currencyPickerRow: {
    gap: 6,
    paddingVertical: 4,
    paddingRight: 8,
  },
  txCurrencyChip: {
    minWidth: 64,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.border.subtle,
    backgroundColor: c.bg.surfaceAlt,
    alignItems: 'center',
  },
  txCurrencyCode: {
    fontSize: 12,
    fontWeight: '700',
    color: c.text.secondary,
    letterSpacing: 0.4,
  },
  txCurrencySym: {
    fontSize: 12,
    color: c.text.secondary,
    marginTop: 2,
  },
  helperSmallDim: {
    marginTop: 6,
    fontSize: 12,
    color: c.text.secondary,
    fontStyle: 'italic',
  },
  suggestionBlock: { marginTop: 8, gap: 5 },
  suggestionLabel: { color: c.text.muted, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.45 },
  suggestionRow: { gap: 7, paddingRight: 8 },
  suggestionChip: { maxWidth: 210, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 16, backgroundColor: c.bg.surface, borderWidth: 1, borderColor: c.border.subtle },
  suggestionChipText: { maxWidth: 170, fontSize: 12, fontWeight: '700' },
  categorySuggestion: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 8, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 10, backgroundColor: c.bg.surface, borderWidth: 1, borderColor: c.border.subtle },
  categorySuggestionText: { color: c.text.secondary, fontSize: 11, fontWeight: '700' },
  categorySuggestionValue: { flex: 1, fontSize: 12, fontWeight: '800' },
  moreDetailsToggle: { marginTop: 16, minHeight: 46, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 10, backgroundColor: c.bg.surface, borderWidth: 1, borderColor: c.border.subtle },
  moreDetailsTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  moreDetailsTitle: { color: c.text.primary, fontSize: 13, fontWeight: '800' },
  moreDetailsCount: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  moreDetailsBody: { paddingHorizontal: 4, paddingBottom: 4 },
  savePreview: { marginTop: 18, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 11, backgroundColor: c.bg.surface, borderWidth: 1, borderColor: c.border.subtle },
  savePreviewIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  savePreviewCopy: { flex: 1, minWidth: 0 },
  savePreviewLabel: { color: c.text.muted, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  savePreviewValue: { color: c.text.primary, fontSize: 12, fontWeight: '700', lineHeight: 17, marginTop: 2 },
  recurringCard: {
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    backgroundColor: c.bg.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border.subtle,
    gap: 10,
  },
  recurringToggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  recurringToggleCopy: { flex: 1, minWidth: 0 },
  recurringToggleTitle: { color: c.text.primary, fontSize: 14, fontWeight: '800' },
  recurringToggleHint: { color: c.text.secondary, fontSize: 11, lineHeight: 16, marginTop: 3 },
  recurringFields: { gap: 8, paddingTop: 4 },
  recurringEndRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  recurringEndLabel: { color: c.text.secondary, fontSize: 12, fontWeight: '600' },
  recurringInvestHint: { color: c.text.muted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  submitActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  submitSecondary: { flex: 1 },
  submitPrimary: { flex: 1 },
  submitBtnWrap: {
    marginTop: 20,
  },

  summaryCard: {
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: c.bg.surfaceAlt,
    borderWidth: 1,
    gap: 6,
  },
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryHeaderLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: c.text.secondary,
    letterSpacing: 0.8,
  },
  summaryClose: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: c.border.subtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryCloseText: { color: c.text.secondary, fontSize: 11, fontWeight: '800' },
  summaryQuote: {
    fontSize: 13,
    color: c.text.primary,
    fontStyle: 'italic',
    marginBottom: 4,
    lineHeight: 18,
  },
  summaryPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 2,
  },
  summaryPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: c.bg.surface,
  },
  summaryPillText: { fontSize: 11, fontWeight: '700' },
  summaryMissedPill: {
    borderWidth: 1,
    borderColor: '#fca5a5',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#fef2f2',
  },
  summaryMissedText: { fontSize: 11, fontWeight: '700', color: '#b91c1c' },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: c.bg.surface,
    borderRadius: 16,
    padding: 20,
    gap: 12,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: c.text.primary },
  modalSubtitle: { fontSize: 13, color: c.text.secondary, lineHeight: 19 },
  modalInput: {
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: c.text.primary,
    borderWidth: 1,
    borderColor: c.border.subtle,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
  },
  modalBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnGhost: {
    backgroundColor: c.bg.surfaceAlt,
  },
  modalBtnGhostText: { color: c.text.secondary, fontWeight: '600', fontSize: 14 },
  modalBtnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
