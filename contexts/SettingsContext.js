import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  STORAGE_KEYS,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_INVESTMENT_CATEGORIES,
  DEFAULT_ACCOUNT_GROUPS,
  DEFAULT_ACCOUNTS,
  DEFAULT_AI_CONFIG,
  AI_PROVIDER_PRESETS,
  BROKERS,
} from '../constants';
import { prefixedId, shortId } from '../lib/ids';
import {
  DEFAULT_BASE_CURRENCY,
  isKnownCurrency,
  sanitizeRateTable,
} from '../lib/currency';
import {
  getSecret,
  setSecret,
  deleteSecret,
  isBackingEncrypted,
} from '../lib/secureKeyStore';

// ----------------------------------------------------------------------------
// SettingsContext owns the user-editable "master data" of the app:
//   - categories per transaction type
//   - account GROUPS (Bank Accounts, Wallets, Cash, Credit Cards, ...)
//   - accounts, each linked to a group via groupId
//
// Data flows: DEFAULTS -> AsyncStorage -> React state -> UI.
// User edits update React state and are auto-persisted back to AsyncStorage.
//
// Schema migration: earlier versions of the app stored accounts as a flat
// list with no groupId. On first load after upgrading, if we see the old
// shape, we generate a group per account (preserving old ids so existing
// transactions still resolve). See migrateFlatAccounts() below.
// ----------------------------------------------------------------------------

const SettingsContext = createContext(null);

// Bundle the three category type keys for terse looping.
const CATEGORY_TYPES = ['expense', 'income', 'investment'];

function storageKeyForCategoryType(type) {
  return {
    expense:    STORAGE_KEYS.settings_categories_expense,
    income:     STORAGE_KEYS.settings_categories_income,
    investment: STORAGE_KEYS.settings_categories_investment,
  }[type];
}

function defaultsForCategoryType(type) {
  return {
    expense:    DEFAULT_EXPENSE_CATEGORIES,
    income:     DEFAULT_INCOME_CATEGORIES,
    investment: DEFAULT_INVESTMENT_CATEGORIES,
  }[type];
}

// ---- Brokers seeding + normalisation --------------------------------------
//
// Brokers are user-editable via SettingsContext.brokers. The `BROKERS`
// constant is only:
//   1. the SEED for a fresh install (first launch),
//   2. the source of truth for "reset to defaults", and
//   3. the reference list used to STAMP the `builtIn` flag on brokers
//      whose id matches one of the built-in seeds — even if the persisted
//      copy from a previous app version didn't have the flag.
//
// `builtIn: true` brokers cannot be deleted from the UI (protects existing
// transactions + holdings that reference them by id). They CAN be renamed
// / recoloured / re-emojied — the flag only guards deletion.
//
// Custom brokers (added by the user) are just objects without `builtIn`.
// They can be freely renamed and deleted.
const BUILTIN_BROKER_IDS = new Set(BROKERS.map((b) => b.id));

function seedBrokers() {
  // Freshly seed from the current build's BROKERS constant. Every entry
  // gets a stable `builtIn: true` marker so we never rely on identity.
  return BROKERS.map((b) => ({ ...b, builtIn: true }));
}

function normalizeBrokers(list) {
  if (!Array.isArray(list) || list.length === 0) return seedBrokers();
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const id = typeof raw.id === 'string' && raw.id ? raw.id : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      label: typeof raw.label === 'string' && raw.label ? raw.label : id,
      emoji: typeof raw.emoji === 'string' && raw.emoji ? raw.emoji : '🏦',
      color: typeof raw.color === 'string' && raw.color ? raw.color : '#6b7280',
      // Preserve any per-broker CSV import hint the seed shipped with,
      // so ImportHoldingsScreen can still show "where in the broker UI
      // does the CSV live" copy after we round-trip through storage.
      hint: typeof raw.hint === 'string' ? raw.hint : undefined,
      // Stamp builtIn from the current app's known list — this is what
      // lets an OLD persisted broker (saved before the flag existed) be
      // recognised as built-in on the NEW app.
      builtIn: BUILTIN_BROKER_IDS.has(id) ? true : Boolean(raw.builtIn),
    });
  }
  return out;
}

// ---- Migration: categories missing `subCategories` -----------------------
//
// Sub-categories were introduced later. Any category loaded from storage
// that predates them is missing the `subCategories` key entirely. Rather
// than force users to reset, we backfill an empty array on load — new
// installs use whatever the DEFAULT_*_CATEGORIES seeds now provide.
function migrateCategoriesWithSubs(list) {
  if (!Array.isArray(list)) return list;
  return list.map((c) => ({
    ...c,
    subCategories: Array.isArray(c.subCategories) ? c.subCategories : [],
  }));
}

// ---- Migration: merge basic default sub-categories for known defaults ---
//
// Older versions of the app shipped several categories (Bills, Food, Gift,
// Refund, Gold, FD, Real Estate, ...) with partial or empty subCategories
// arrays. Later on the DEFAULT_* seeds gained "basic" sub-categories for
// these. Existing installs would keep the partial arrays forever unless
// the user tapped "Reset categories to defaults" — nuking any custom
// categories in the process.
//
// This migration bridges the gap: for each seeded category that we can
// identify by id, we ADD any default sub-categories that aren't already
// present (by sub id). Stored subs win on id collision so any user edits
// to a default sub (renamed label / emoji / color) are preserved.
// Custom subs the user added (unknown id) are also preserved.
//
// Runs only ONCE per install, tracked via STORAGE_KEYS.settings_migrations.
// A user who deliberately deleted a default sub will see it come back
// once — after which they can delete again and the change sticks.
function mergeMissingDefaultSubcats(stored, defaults) {
  if (!Array.isArray(stored)) return stored;
  const defaultById = new Map(defaults.map((d) => [d.id, d]));
  return stored.map((cat) => {
    const def = defaultById.get(cat.id);
    if (!def) return cat; // user-created category → hands off
    const defSubs = Array.isArray(def.subCategories) ? def.subCategories : [];
    if (defSubs.length === 0) return cat; // nothing to merge from
    const storedSubs = Array.isArray(cat.subCategories) ? cat.subCategories : [];
    const storedIds = new Set(storedSubs.map((s) => s.id));
    const missing = defSubs.filter((s) => !storedIds.has(s.id));
    if (missing.length === 0) return cat; // already has all defaults
    return { ...cat, subCategories: [...storedSubs, ...missing] };
  });
}

// The complete set of migration keys the CURRENT app expects to be
// applied. Kept in one place so the load effect + restore path agree.
// When a new merge migration ships, bump the top key (e.g. `_v4`) here
// AND wire the load effect to run its logic behind that key.
const CATEGORY_MIGRATION_KEYS = [
  'backfill_default_subcats_v1',
  'merge_default_subcats_v2',
  'merge_default_subcats_v3',
  'merge_default_subcats_v4',
];
const CURRENT_CATEGORY_MIGRATION = 'merge_default_subcats_v4';

// Persist categories THEN the migration flag, IN THAT ORDER. Ordering
// matters because of the crash-window (BK-M3):
//   * Categories persist first — if we crash before the flag write,
//     next launch reloads the merged categories from storage and the
//     merge just re-runs (idempotent), so no data loss.
//   * Flag persists second — if we crash after both, next launch skips
//     the merge safely.
// The old code fired both writes concurrently without ordering, so a
// crash between the two could leave us with the flag set but the
// merged categories never written to storage (data loss on next boot).
async function persistCategoriesThenMigrationFlag(catsByType, migApplied) {
  try {
    for (const type of CATEGORY_TYPES) {
      const key = storageKeyForCategoryType(type);
      const list = catsByType[type];
      if (!key || !Array.isArray(list)) continue;
      await AsyncStorage.setItem(key, JSON.stringify(list));
    }
    await AsyncStorage.setItem(
      STORAGE_KEYS.settings_migrations,
      JSON.stringify([...migApplied]),
    );
  } catch (e) {
    console.warn('Persist merged categories + migration flag failed:', e);
  }
}

// ---- Normalize: give every account a `currency` field ---------------------
//
// F9-Tier2 introduces per-account currency. Legacy accounts stored before
// this feature don't have the field. Backfill with the app-wide base
// currency (INR by default) so all existing rows continue to behave as
// they did before — new INR-only users see zero change.
function normalizeAccounts(list, defaultCurrency = DEFAULT_BASE_CURRENCY) {
  if (!Array.isArray(list)) return [];
  return list.map((a) => ({
    ...a,
    currency: isKnownCurrency(a?.currency) ? String(a.currency).toUpperCase() : defaultCurrency,
  }));
}

function normalizeAccountGroups(list) {
  if (!Array.isArray(list)) return [];
  return list.map((group) => {
    if (group?.id !== 'grp_wallet') return group;
    return {
      ...group,
      label: group.label === 'Wallets' ? 'Digital Accounts' : group.label,
      emoji: group.emoji === '📱' ? '📲' : group.emoji,
    };
  });
}

// ---- Migration: pre-groups shape (flat accounts) → grouped shape ----------
//
// Pre-migration:  accounts = [{ id, label, emoji, color }]
// Post-migration: accountGroups = [{ id: 'grp_<oldId>', ... }]
//                 accounts      = [{ id (unchanged), groupId, label, emoji, color }]
//
// Old account ids are preserved so transactions' accountId keeps resolving.
function migrateFlatAccounts(oldAccounts) {
  const groups = [];
  const accounts = [];
  for (const a of oldAccounts) {
    const groupId = `grp_${a.id}`;
    groups.push({
      id: groupId,
      label: a.label,
      emoji: a.emoji,
      color: a.color,
    });
    accounts.push({ ...a, groupId });
  }
  return { groups, accounts };
}

export function SettingsProvider({ children }) {
  const [categories, setCategories] = useState({
    expense:    DEFAULT_EXPENSE_CATEGORIES,
    income:     DEFAULT_INCOME_CATEGORIES,
    investment: DEFAULT_INVESTMENT_CATEGORIES,
  });
  const [accountGroups, setAccountGroups] = useState(DEFAULT_ACCOUNT_GROUPS);
  const [accounts, setAccounts] = useState(() => normalizeAccounts(DEFAULT_ACCOUNTS));
  const [whisperApiKey, setWhisperApiKeyState] = useState('');

  // AI Insights configuration blob. Held as ONE object rather than five
  // separate useState hooks so persistence is atomic (see setter below)
  // and provider switches don't cause a torn intermediate state where
  // (e.g.) baseUrl says OpenAI but model says a Groq-only Llama.
  //
  // IMPORTANT: `aiConfig` deliberately does NOT contain the API key —
  // the key lives in SecureStore (iOS Keychain / Android Keystore) and
  // is tracked separately as `aiApiKey` below. Keeping the two apart
  // means the plaintext key never touches the JSON blob that gets
  // serialised to AsyncStorage.
  const [aiConfig, setAiConfigState] = useState(DEFAULT_AI_CONFIG);
  const [aiApiKey, setAiApiKeyState] = useState('');

  // F9 (multi-currency): app-wide base currency + manual FX table.
  // Base is the currency every aggregate reports totals in. FX rates are
  // "1 unit foreign in base" (e.g. USD → INR = 88.4). Both are managed
  // from Settings → Currency. Snapshot semantics: per-row *InBase values
  // are frozen at add time and NOT recomputed when the rate table
  // changes, matching real bank-statement behaviour.
  const [baseCurrency, setBaseCurrencyState] = useState(DEFAULT_BASE_CURRENCY);
  const [fxRates,      setFxRatesState]      = useState({});

  // Broker auto-suggestion memory. Keyed by sub-category id; value is a
  // BROKERS[i].id. Populated when the user adds/edits an investment
  // transaction that specifies BOTH a sub-category and a broker.
  // Consumed by TransactionForm to pre-fill the broker picker the next
  // time that sub-category is selected on a fresh row.
  const [brokerDefaultsBySubCategory, setBrokerDefaultsBySubCategoryState] = useState({});

  // User-managed broker list (Zerodha / Groww / ... + any custom brokers
  // the user adds themselves). Seeded from the BROKERS constant on first
  // launch; edits persist to STORAGE_KEYS.brokers. See seedBrokers() and
  // normalizeBrokers() at the top of this file for shape / migration.
  const [brokers, setBrokersState] = useState(() => seedBrokers());

  const [ready, setReady] = useState(false);

  // ---- Load persisted settings on mount, running migration if needed ----
  useEffect(() => {
    (async () => {
      try {
        const [expRaw, incRaw, invRaw, accRaw, grpRaw, whisperRaw, migRaw, baseRaw, ratesRaw, brokerDefRaw, aiRaw, brokersRaw] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.settings_categories_expense),
          AsyncStorage.getItem(STORAGE_KEYS.settings_categories_income),
          AsyncStorage.getItem(STORAGE_KEYS.settings_categories_investment),
          AsyncStorage.getItem(STORAGE_KEYS.settings_accounts),
          AsyncStorage.getItem(STORAGE_KEYS.settings_account_groups),
          AsyncStorage.getItem(STORAGE_KEYS.settings_whisper_api_key),
          AsyncStorage.getItem(STORAGE_KEYS.settings_migrations),
          AsyncStorage.getItem(STORAGE_KEYS.base_currency),
          AsyncStorage.getItem(STORAGE_KEYS.fx_rates),
          AsyncStorage.getItem(STORAGE_KEYS.broker_defaults_by_subcategory),
          AsyncStorage.getItem(STORAGE_KEYS.settings_ai_config),
          AsyncStorage.getItem(STORAGE_KEYS.brokers),
        ]);
        if (whisperRaw) setWhisperApiKeyState(whisperRaw);

        // AI config: merge stored blob over DEFAULT_AI_CONFIG so any
        // NEW fields we add in future ship with sensible defaults even
        // on an old device where the stored blob doesn't have them.
        // Guard against corrupt JSON — a broken key shouldn't brick
        // the whole settings load.
        //
        // LEGACY MIGRATION: earlier versions embedded a plaintext
        // `apiKey` field inside this blob. If we spot one, we:
        //   1. move it to SecureStore (real encryption on native),
        //   2. re-write the blob without the plaintext copy,
        //   3. use it as the initial in-memory aiApiKey.
        // This is a one-shot — once the plaintext copy is gone, this
        // branch never runs again.
        let legacyApiKey = null;
        try {
          if (aiRaw) {
            const parsed = JSON.parse(aiRaw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              if (typeof parsed.apiKey === 'string' && parsed.apiKey) {
                legacyApiKey = parsed.apiKey;
              }
              // Strip the plaintext apiKey (if any) before we spread
              // into state; the field is intentionally no longer part
              // of DEFAULT_AI_CONFIG.
              const { apiKey: _dropped, ...rest } = parsed;
              setAiConfigState({ ...DEFAULT_AI_CONFIG, ...rest });
              if (legacyApiKey) {
                // Rewrite the blob WITHOUT the plaintext apiKey so a
                // subsequent app crash before migration completes
                // still leaves the plaintext excised. This is a
                // silent, non-blocking write.
                AsyncStorage.setItem(
                  STORAGE_KEYS.settings_ai_config,
                  JSON.stringify({ ...DEFAULT_AI_CONFIG, ...rest }),
                ).catch(() => { /* best-effort */ });
              }
            }
          }
        } catch (e) {
          console.warn('AI config parse failed, using defaults:', e);
        }

        // Now load the AI API key from SecureStore. Priority:
        //   1. SecureStore (current source of truth)
        //   2. Legacy plaintext value from the AsyncStorage blob (if
        //      SecureStore doesn't have one yet — i.e. first launch
        //      after the encryption upgrade).
        // The migrated key is written into SecureStore so subsequent
        // launches skip the legacy branch entirely.
        try {
          let key = await getSecret(STORAGE_KEYS.ai_api_key_secret);
          if (!key && legacyApiKey) {
            await setSecret(STORAGE_KEYS.ai_api_key_secret, legacyApiKey);
            key = legacyApiKey;
          }
          if (key) setAiApiKeyState(key);
        } catch (e) {
          console.warn('AI key load / migrate failed:', e);
        }

        // Broker auto-suggestion memory (small key→string object).
        // Corrupt / non-object storage → treat as empty rather than
        // throwing, so a bad write can't brick the whole load.
        try {
          const parsed = brokerDefRaw ? JSON.parse(brokerDefRaw) : {};
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            setBrokerDefaultsBySubCategoryState(parsed);
          } else {
            setBrokerDefaultsBySubCategoryState({});
          }
        } catch {
          setBrokerDefaultsBySubCategoryState({});
        }

        // User-editable broker list. Missing key = fresh install → seed
        // from BROKERS constant. Present but corrupt = fall back to
        // seed (never brick the whole load).
        //
        // NEW-BUILT-IN MERGE: when a new app version ships an extra
        // built-in broker (e.g. we add "Fidelity" to BROKERS in a
        // release), a persisted broker list from the old version won't
        // contain it. We merge in ANY missing built-in ids so upgraded
        // users automatically see the newcomers — the merge is by id
        // so a user's rename / recolor of an existing broker is
        // preserved untouched.
        try {
          const parsed = brokersRaw ? JSON.parse(brokersRaw) : null;
          if (Array.isArray(parsed) && parsed.length > 0) {
            const normalised = normalizeBrokers(parsed);
            const havingId = new Set(normalised.map((b) => b.id));
            const missing = seedBrokers().filter((b) => !havingId.has(b.id));
            setBrokersState(missing.length ? [...normalised, ...missing] : normalised);
          } else {
            setBrokersState(seedBrokers());
          }
        } catch {
          setBrokersState(seedBrokers());
        }

        // Currency plumbing — hydrate BEFORE accounts so the normalize
        // step below can backfill legacy accounts with the correct base.
        const loadedBase = baseRaw && isKnownCurrency(baseRaw)
          ? String(baseRaw).toUpperCase()
          : DEFAULT_BASE_CURRENCY;
        setBaseCurrencyState(loadedBase);
        try {
          const parsed = ratesRaw ? JSON.parse(ratesRaw) : {};
          setFxRatesState(sanitizeRateTable(parsed));
        } catch {
          setFxRatesState({});
        }

        // Which one-time category migrations have already run on this device.
        let migApplied;
        try {
          migApplied = new Set(migRaw ? JSON.parse(migRaw) : []);
        } catch {
          migApplied = new Set();
        }

        // Base load (fills missing `subCategories: []` on legacy shapes).
        let expense    = migrateCategoriesWithSubs(expRaw ? JSON.parse(expRaw) : DEFAULT_EXPENSE_CATEGORIES);
        let income     = migrateCategoriesWithSubs(incRaw ? JSON.parse(incRaw) : DEFAULT_INCOME_CATEGORIES);
        let investment = migrateCategoriesWithSubs(invRaw ? JSON.parse(invRaw) : DEFAULT_INVESTMENT_CATEGORIES);

        // One-time merge of default sub-categories for known seeded
        // categories. Adds any missing default subs to every default
        // category — preserves user edits and custom subs. Each bump of
        // the version key re-runs the merge so freshly-added defaults
        // land on existing installs without wiping customisations:
        //   v1 → only filled empty arrays (too conservative)
        //   v2 → merged basic starter subs across all defaults
        //   v3 → big expansion (Food went 4→16, plus dozens more across
        //        Transport, Shopping, Bills, Health, Fun, Other, Salary,
        //        Freelance, Investments, Stocks, MF, Crypto, Gold, FD,
        //        Real Estate, Other-invest). Any user who deliberately
        //        deleted a default sub will see it re-appear once —
        //        after which they can delete again and it stays gone.
        //   v4 → Gold Chit sub-category under Gold investments.
        if (!migApplied.has(CURRENT_CATEGORY_MIGRATION)) {
          expense    = mergeMissingDefaultSubcats(expense,    DEFAULT_EXPENSE_CATEGORIES);
          income     = mergeMissingDefaultSubcats(income,     DEFAULT_INCOME_CATEGORIES);
          investment = mergeMissingDefaultSubcats(investment, DEFAULT_INVESTMENT_CATEGORIES);
          for (const key of CATEGORY_MIGRATION_KEYS) migApplied.add(key);
          // BK-M3 fix: persist categories BEFORE the migration flag so
          // a crash between the two writes is recoverable (merge is
          // idempotent — it'll just re-run harmlessly next launch).
          // Fire-and-forget is fine; the auto-persist effect below is
          // now redundant (same data) but not conflicting.
          persistCategoriesThenMigrationFlag(
            { expense, income, investment },
            migApplied,
          );
        }

        setCategories({ expense, income, investment });

        // Decide accountGroups + accounts based on what's in storage.
        if (grpRaw && accRaw) {
          // Already on the new schema — load as-is.
          setAccountGroups(normalizeAccountGroups(JSON.parse(grpRaw)));
          setAccounts(normalizeAccounts(JSON.parse(accRaw), loadedBase));
        } else if (accRaw && !grpRaw) {
          // Old flat accounts exist but no groups — migrate.
          const oldAccounts = JSON.parse(accRaw);
          const { groups, accounts: migrated } = migrateFlatAccounts(oldAccounts);
          setAccountGroups(groups);
          setAccounts(normalizeAccounts(migrated, loadedBase));
        } else {
          // Fresh install — use defaults.
          setAccountGroups(DEFAULT_ACCOUNT_GROUPS);
          setAccounts(normalizeAccounts(DEFAULT_ACCOUNTS, loadedBase));
        }
      } catch (e) {
        console.warn('Failed to load settings:', e);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // ---- Auto-persist categories whenever they change (post-load) ----
  useEffect(() => {
    if (!ready) return;
    for (const type of CATEGORY_TYPES) {
      AsyncStorage.setItem(
        storageKeyForCategoryType(type),
        JSON.stringify(categories[type]),
      ).catch((e) => console.warn(`Save categories/${type} failed:`, e));
    }
  }, [categories, ready]);

  // ---- Auto-persist account groups + accounts ----
  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(
      STORAGE_KEYS.settings_account_groups,
      JSON.stringify(accountGroups),
    ).catch((e) => console.warn('Save account groups failed:', e));
  }, [accountGroups, ready]);

  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(
      STORAGE_KEYS.settings_accounts,
      JSON.stringify(accounts),
    ).catch((e) => console.warn('Save accounts failed:', e));
  }, [accounts, ready]);

  // Currency plumbing — persist base + fx rate table on change.
  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORAGE_KEYS.base_currency, baseCurrency)
      .catch((e) => console.warn('Save base currency failed:', e));
  }, [baseCurrency, ready]);
  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORAGE_KEYS.fx_rates, JSON.stringify(fxRates))
      .catch((e) => console.warn('Save FX rates failed:', e));
  }, [fxRates, ready]);
  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(
      STORAGE_KEYS.broker_defaults_by_subcategory,
      JSON.stringify(brokerDefaultsBySubCategory),
    ).catch((e) => console.warn('Save broker defaults failed:', e));
  }, [brokerDefaultsBySubCategory, ready]);

  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(
      STORAGE_KEYS.brokers,
      JSON.stringify(brokers),
    ).catch((e) => console.warn('Save brokers failed:', e));
  }, [brokers, ready]);

  // ---- Categories: add / delete ----
  const addCategory = useCallback((type, { label, emoji, color }) => {
    const trimmed = (label ?? '').trim();
    if (!trimmed) return null;
    const newCat = {
      id: `${type}_${shortId()}`,
      label: trimmed,
      emoji: (emoji ?? '📌').trim() || '📌',
      color: color ?? '#6b7280',
      subCategories: [],
    };
    setCategories((prev) => ({
      ...prev,
      [type]: [...prev[type], newCat],
    }));
    return newCat;
  }, []);

  const deleteCategory = useCallback((type, id) => {
    setCategories((prev) => ({
      ...prev,
      [type]: prev[type].filter((c) => c.id !== id),
    }));
  }, []);

  // Update a category's editable fields (label / emoji / color). Keeps
  // `id` and `subCategories` intact so existing transactions and children
  // continue to resolve.
  const updateCategory = useCallback((type, id, patch) => {
    const trimmedLabel = (patch?.label ?? '').trim();
    if (!trimmedLabel) return false;
    setCategories((prev) => ({
      ...prev,
      [type]: prev[type].map((c) =>
        c.id === id
          ? {
              ...c,
              label: trimmedLabel,
              emoji: (patch.emoji ?? c.emoji ?? '📌').trim() || '📌',
              color: patch.color ?? c.color,
            }
          : c,
      ),
    }));
    return true;
  }, []);

  // ---- Sub-categories: add / delete ----
  //
  // Sub-categories live inside their parent category. We copy-on-write the
  // parent so React sees a new reference and re-renders. Returns the created
  // sub-category (or null if invalid input) so the UI can react.
  const addSubCategory = useCallback((type, parentId, { label, emoji, color }) => {
    const trimmed = (label ?? '').trim();
    if (!trimmed || !parentId) return null;
    const newSub = {
      id: `sub_${parentId}_${shortId()}`,
      label: trimmed,
      emoji: (emoji ?? '🔖').trim() || '🔖',
      color: color ?? '#6b7280',
    };
    setCategories((prev) => ({
      ...prev,
      [type]: prev[type].map((c) =>
        c.id === parentId
          ? { ...c, subCategories: [...(c.subCategories ?? []), newSub] }
          : c,
      ),
    }));
    return newSub;
  }, []);

  const deleteSubCategory = useCallback((type, parentId, subId) => {
    setCategories((prev) => ({
      ...prev,
      [type]: prev[type].map((c) =>
        c.id === parentId
          ? {
              ...c,
              subCategories: (c.subCategories ?? []).filter((s) => s.id !== subId),
            }
          : c,
      ),
    }));
    // Prune the broker-defaults entry for this sub — otherwise the map
    // grows forever with dead keys, and re-using a stale key later (if
    // the user recreates a same-named sub with a new id) would be a
    // silent surprise.
    setBrokerDefaultsBySubCategoryState((prev) => {
      if (!prev || !(subId in prev)) return prev;
      const { [subId]: _dropped, ...rest } = prev;
      return rest;
    });
  }, []);

  // Update a sub-category in place. Preserves id + parent so referencing
  // transactions and the sub-category's location under its parent don't
  // change.
  const updateSubCategory = useCallback((type, parentId, subId, patch) => {
    const trimmedLabel = (patch?.label ?? '').trim();
    if (!trimmedLabel) return false;
    setCategories((prev) => ({
      ...prev,
      [type]: prev[type].map((c) =>
        c.id === parentId
          ? {
              ...c,
              subCategories: (c.subCategories ?? []).map((s) =>
                s.id === subId
                  ? {
                      ...s,
                      label: trimmedLabel,
                      emoji: (patch.emoji ?? s.emoji ?? '🔖').trim() || '🔖',
                      color: patch.color ?? s.color,
                    }
                  : s,
              ),
            }
          : c,
      ),
    }));
    return true;
  }, []);

  const resetCategoriesToDefault = useCallback((type) => {
    setCategories((prev) => ({
      ...prev,
      [type]: defaultsForCategoryType(type),
    }));
  }, []);

  // ---- Account Groups: add / delete / rename ----
  const addAccountGroup = useCallback(({ label, emoji, color }) => {
    const trimmed = (label ?? '').trim();
    if (!trimmed) return null;
    const newGrp = {
      id: prefixedId('grp'),
      label: trimmed,
      emoji: (emoji ?? '📦').trim() || '📦',
      color: color ?? '#6b7280',
    };
    setAccountGroups((prev) => [...prev, newGrp]);
    return newGrp;
  }, []);

  // Update an account group's editable fields. `id` is preserved so all
  // accounts already pointing at this group keep resolving.
  const updateAccountGroup = useCallback((id, patch) => {
    const trimmedLabel = (patch?.label ?? '').trim();
    if (!trimmedLabel) return false;
    setAccountGroups((prev) =>
      prev.map((g) =>
        g.id === id
          ? {
              ...g,
              label: trimmedLabel,
              emoji: (patch.emoji ?? g.emoji ?? '📦').trim() || '📦',
              color: patch.color ?? g.color,
            }
          : g,
      ),
    );
    return true;
  }, []);

  // A group can only be deleted if it holds no accounts. This is a
  // "restrict" cascade rule — safer default than silently orphaning.
  const deleteAccountGroup = useCallback((id) => {
    let deleted = false;
    setAccounts((prevAcc) => {
      const inGroup = prevAcc.filter((a) => a.groupId === id);
      if (inGroup.length > 0) {
        return prevAcc; // don't touch accounts
      }
      setAccountGroups((prevGrp) => prevGrp.filter((g) => g.id !== id));
      deleted = true;
      return prevAcc;
    });
    return deleted;
  }, []);

  // ---- Accounts: add / delete ----
  const addAccount = useCallback(({ label, emoji, color, groupId, currency, openingBalance, openingBalanceDate }) => {
    const trimmed = (label ?? '').trim();
    if (!trimmed || !groupId) return null;
    const parsedOpeningBalance = Number(openingBalance);
    const parsedOpeningDate = openingBalanceDate ? new Date(openingBalanceDate) : new Date();
    const newAcc = {
      id: prefixedId('acc'),
      groupId,
      label: trimmed,
      emoji: (emoji ?? '💳').trim() || '💳',
      color: color ?? '#6b7280',
      // This is a starting point for the account ledger, not income. It
      // deliberately lives with the account so it cannot affect budgets or
      // income/cash-flow reports.
      openingBalance: Number.isFinite(parsedOpeningBalance) ? parsedOpeningBalance : 0,
      openingBalanceDate: Number.isNaN(parsedOpeningDate.getTime())
        ? new Date().toISOString()
        : parsedOpeningDate.toISOString(),
      // Optional per-account currency. Falls back to the app-wide base so
      // legacy INR-only flows stay identical. New accounts opened
      // deliberately in USD/EUR/AED override this.
      currency: isKnownCurrency(currency) ? String(currency).toUpperCase() : baseCurrency,
    };
    setAccounts((prev) => [...prev, newAcc]);
    return newAcc;
  }, [baseCurrency]);

  const deleteAccount = useCallback((id) => {
    setAccounts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // Update an account's editable fields. Optionally reassigns the group
  // via `patch.groupId` — this is how a user moves an account from
  // "Wallets" to "Bank Accounts". `id` is always preserved so existing
  // transactions keep resolving.
  const updateAccount = useCallback((id, patch) => {
    const trimmedLabel = (patch?.label ?? '').trim();
    if (!trimmedLabel) return false;
    setAccounts((prev) =>
      prev.map((a) =>
        a.id === id
          ? {
              ...a,
              label: trimmedLabel,
              emoji: (patch.emoji ?? a.emoji ?? '💳').trim() || '💳',
              color: patch.color ?? a.color,
              groupId: patch.groupId ?? a.groupId,
              currency: isKnownCurrency(patch.currency)
                ? String(patch.currency).toUpperCase()
                : (a.currency ?? baseCurrency),
              ...(patch.openingBalance != null && Number.isFinite(Number(patch.openingBalance))
                ? { openingBalance: Number(patch.openingBalance) }
                : {}),
              ...(patch.openingBalanceDate != null
                ? {
                    openingBalanceDate: (() => {
                      const d = new Date(patch.openingBalanceDate);
                      return Number.isNaN(d.getTime())
                        ? (a.openingBalanceDate ?? new Date().toISOString())
                        : d.toISOString();
                    })(),
                  }
                : patch.openingBalance != null && Number.isFinite(Number(patch.openingBalance))
                  ? { openingBalanceDate: a.openingBalanceDate ?? new Date().toISOString() }
                  : {}),
              ...(patch.reconciliationBalance != null && Number.isFinite(Number(patch.reconciliationBalance))
                ? {
                    reconciliationBalance: Number(patch.reconciliationBalance),
                    reconciledAt: new Date().toISOString(),
                  }
                : {}),
            }
          : a,
      ),
    );
    return true;
  }, [baseCurrency]);

  // ---- Lookups (memoized indexes for O(1) reads) ----
  const accountsByGroup = useMemo(() => {
    const map = {};
    for (const a of accounts) {
      (map[a.groupId] ??= []).push(a);
    }
    return map;
  }, [accounts]);

  const findCategory = useCallback(
    (type, id) => categories[type].find((c) => c.id === id) ?? null,
    [categories],
  );

  // Two-level lookup: we don't index sub-categories globally because their
  // ids are only meaningful within a parent. Callers always know both.
  const findSubCategory = useCallback(
    (type, parentId, subId) => {
      if (!parentId || !subId) return null;
      const parent = categories[type].find((c) => c.id === parentId);
      return parent?.subCategories?.find((s) => s.id === subId) ?? null;
    },
    [categories],
  );

  const findAccount = useCallback(
    (id) => accounts.find((a) => a.id === id) ?? null,
    [accounts],
  );

  const findAccountGroup = useCallback(
    (id) => accountGroups.find((g) => g.id === id) ?? null,
    [accountGroups],
  );

  // ---- Restore: called by the Settings → Restore backup flow. ----------
  //
  // Replaces categories / accounts / accountGroups in one shot. Sanitises
  // each list through the same migration used at load time so an old-schema
  // backup file still ends up in the right shape. Auto-persist takes care
  // of writing the new state to AsyncStorage in the next effect cycle.
  //
  // BK-M1 fix: also re-runs mergeMissingDefaultSubcats against the
  // current app's DEFAULT_* seeds. Previously an old-schema backup could
  // arrive without subcategories that ship as defaults in the current
  // build — the load-time merge wouldn't rescue them because the
  // migration flag was already set on this device, so the user would be
  // stuck with the older shape until they hit "Reset categories" (which
  // nukes custom subs). Running the merge here backfills any missing
  // defaults immediately while preserving user edits + custom subs.
  //
  // BK-M2 fix: also accepts `settings_migrations` + `theme` payload.
  // Theme is handed off via a setter passed in from the caller because
  // ThemeContext owns that state; migration flag is persisted here.
  const restoreState = useCallback((payload) => {
    if (!payload) return;
    // Categories / accounts / accountGroups: if the payload omits the
    // section entirely we RESET to app-defaults (not []) so the app
    // stays usable — every screen depends on at least one category and
    // one account existing. Empty lists would soft-brick add flows.
    //
    // The old code no-op'd on missing keys, which produced a Frankenstein
    // hybrid of pre-restore settings + post-restore transactions.
    const cats = payload.categories || {};
    const mergedExpense = mergeMissingDefaultSubcats(
      migrateCategoriesWithSubs(
        Array.isArray(cats.expense) ? cats.expense : DEFAULT_EXPENSE_CATEGORIES,
      ),
      DEFAULT_EXPENSE_CATEGORIES,
    );
    const mergedIncome = mergeMissingDefaultSubcats(
      migrateCategoriesWithSubs(
        Array.isArray(cats.income) ? cats.income : DEFAULT_INCOME_CATEGORIES,
      ),
      DEFAULT_INCOME_CATEGORIES,
    );
    const mergedInvestment = mergeMissingDefaultSubcats(
      migrateCategoriesWithSubs(
        Array.isArray(cats.investment) ? cats.investment : DEFAULT_INVESTMENT_CATEGORIES,
      ),
      DEFAULT_INVESTMENT_CATEGORIES,
    );
    setCategories({
      expense:    mergedExpense,
      income:     mergedIncome,
      investment: mergedInvestment,
    });

    // BK-M2 fix: apply restored settings_migrations if present, then
    // union with the current-app expected keys so subsequent boots
    // don't re-run the merge we just did. Also persists via the same
    // ordered-write helper so a crash mid-restore is recoverable.
    let migApplied = new Set(CATEGORY_MIGRATION_KEYS);
    if (Array.isArray(payload.settingsMigrations)) {
      for (const k of payload.settingsMigrations) {
        if (typeof k === 'string') migApplied.add(k);
      }
    }
    persistCategoriesThenMigrationFlag(
      { expense: mergedExpense, income: mergedIncome, investment: mergedInvestment },
      migApplied,
    );

    setAccountGroups(normalizeAccountGroups(
      Array.isArray(payload.accountGroups) ? payload.accountGroups : DEFAULT_ACCOUNT_GROUPS,
    ));

    // Currency plumbing (F9). SettingsScreen passes either the modern
    // { baseCurrency, fxRates } shape (schemaVersion >= 6) inline on
    // the payload, OR a legacy { currency: { base, rates } } block.
    // Missing values leave the current settings alone (rather than
    // snapping back to INR default) because a pre-v6 backup file
    // predates multi-currency and has no reasonable answer for those
    // fields. Accounts are normalized against whichever base ends up
    // active — new or restored.
    const rawBase = payload?.baseCurrency ?? payload?.currency?.baseCurrency ?? payload?.currency?.base;
    const rawRates = payload?.fxRates ?? payload?.currency?.fxRates ?? payload?.currency?.rates;
    const restoredBase = isKnownCurrency(rawBase)
      ? String(rawBase).toUpperCase()
      : baseCurrency;
    setBaseCurrencyState(restoredBase);
    setFxRatesState(sanitizeRateTable(rawRates));

    setAccounts(
      normalizeAccounts(
        Array.isArray(payload.accounts) ? payload.accounts : DEFAULT_ACCOUNTS,
        restoredBase,
      ),
    );

    // Broker auto-suggestion memory. Missing / non-object payloads
    // reset to empty (never keep stale keys from the pre-restore
    // session — the restored transactions may not reference them).
    const bd = payload?.brokerDefaultsBySubCategory;
    if (bd && typeof bd === 'object' && !Array.isArray(bd)) {
      const cleaned = {};
      for (const [k, v] of Object.entries(bd)) {
        if (typeof k === 'string' && typeof v === 'string' && v.length > 0) {
          cleaned[k] = v;
        }
      }
      setBrokerDefaultsBySubCategoryState(cleaned);
    } else {
      setBrokerDefaultsBySubCategoryState({});
    }

    // Brokers list: fall back to current-build seed when the payload
    // omits the section (older backup files from before brokers became
    // user-editable). When present, run through normalizeBrokers so any
    // built-in ids get re-stamped with the current app's builtIn flag
    // and any new built-ins shipped since the backup was made are
    // merged in — same policy as the load path.
    const brokersPayload = payload?.brokers;
    if (Array.isArray(brokersPayload) && brokersPayload.length > 0) {
      const normalised = normalizeBrokers(brokersPayload);
      const havingId = new Set(normalised.map((b) => b.id));
      const missing = seedBrokers().filter((b) => !havingId.has(b.id));
      setBrokersState(missing.length ? [...normalised, ...missing] : normalised);
    } else {
      setBrokersState(seedBrokers());
    }
  }, [baseCurrency]);

  // ---- Multi-currency: setters + FX rate table CRUD ---------------------
  //
  // Changing the base currency does NOT retroactively recompute *InBase
  // fields on existing rows — those are frozen at add time. That's the
  // "bank statement" model: switching your presentation currency should
  // not silently rewrite what was actually posted historically.
  //
  // Consumers that want a live-converted display are welcome to run
  // convertToBase(amount, currency, fxRates, baseCurrency) at render time.
  const setBaseCurrency = useCallback((code) => {
    if (!isKnownCurrency(code)) return false;
    setBaseCurrencyState(String(code).toUpperCase());
    return true;
  }, []);

  // Upsert one row into the FX table. `rate` is expressed as
  // "1 unit foreign = <rate> base". Returns { ok } so the UI can toast.
  const setFxRate = useCallback((code, rate, note = 'manual') => {
    const key = String(code ?? '').toUpperCase();
    const n   = Number(rate);
    if (!key) return { ok: false, reason: 'no_code' };
    if (key === baseCurrency) return { ok: false, reason: 'base_currency' };
    if (!isFinite(n) || n <= 0) return { ok: false, reason: 'invalid_rate' };
    setFxRatesState((prev) => ({
      ...prev,
      [key]: {
        rate: n,
        updatedAt: new Date().toISOString(),
        note: typeof note === 'string' && note.length > 0 ? note : 'manual',
      },
    }));
    return { ok: true };
  }, [baseCurrency]);

  const deleteFxRate = useCallback((code) => {
    const key = String(code ?? '').toUpperCase();
    if (!key) return false;
    let removed = false;
    setFxRatesState((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      removed = true;
      return next;
    });
    return removed;
  }, []);

  // Broker auto-suggestion memory: record "user's last broker for this
  // sub-category". Callers pass falsy `brokerId` to CLEAR (currently
  // unused — Add/Edit flows only invoke this with a real broker + sub
  // pair). Kept truthy-only to avoid poisoning the map with nulls.
  const setBrokerDefaultForSubCategory = useCallback((subCategoryId, brokerId) => {
    if (!subCategoryId) return;
    setBrokerDefaultsBySubCategoryState((prev) => {
      if (!brokerId) {
        if (!(subCategoryId in prev)) return prev;
        const { [subCategoryId]: _dropped, ...rest } = prev;
        return rest;
      }
      // No-op when already set to the same value — avoids spurious
      // AsyncStorage writes on every unchanged submit.
      if (prev[subCategoryId] === brokerId) return prev;
      return { ...prev, [subCategoryId]: brokerId };
    });
  }, []);

  // ---- Brokers CRUD -----------------------------------------------------
  //
  // Add a new user broker. Auto-derives an id from the label (slugified +
  // random suffix to avoid collisions with built-in ids like `zerodha`).
  // Custom brokers always land with `builtIn: false` so they can be
  // freely deleted later.
  const addBroker = useCallback(({ label, emoji, color }) => {
    const trimmed = (label ?? '').trim();
    if (!trimmed) return null;
    const slug = trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '') || 'broker';
    const newBroker = {
      id: `${slug}_${shortId()}`,
      label: trimmed,
      emoji: (emoji ?? '🏦').trim() || '🏦',
      color: color ?? '#6b7280',
      builtIn: false,
    };
    setBrokersState((prev) => [...prev, newBroker]);
    return newBroker;
  }, []);

  // Update editable fields (label / emoji / color). Never mutates `id` or
  // the `builtIn` flag — those are structural. Callers pass whatever
  // subset of editable fields they want to change; unspecified fields
  // keep their previous value.
  const updateBroker = useCallback((id, patch) => {
    const trimmedLabel = (patch?.label ?? '').trim();
    if (!trimmedLabel) return false;
    setBrokersState((prev) => prev.map((b) =>
      b.id === id
        ? {
            ...b,
            label: trimmedLabel,
            emoji: (patch.emoji ?? b.emoji ?? '🏦').trim() || '🏦',
            color: patch.color ?? b.color,
          }
        : b,
    ));
    return true;
  }, []);

  // Delete a broker. Refuses to remove built-in entries — the UI should
  // hide the delete affordance for built-ins, but this is defence in
  // depth in case a stale button slips through. Custom brokers used by
  // existing transactions/holdings will still resolve by id lookup
  // returning undefined — the UI already handles unknown broker ids
  // (renders the raw id as fallback), so a delete doesn't corrupt
  // historical data.
  const deleteBroker = useCallback((id) => {
    let deleted = false;
    setBrokersState((prev) => {
      const target = prev.find((b) => b.id === id);
      if (!target || target.builtIn) return prev;
      deleted = true;
      return prev.filter((b) => b.id !== id);
    });
    return deleted;
  }, []);

  // Restore the entire broker list to the current app's BROKERS seed.
  // Nukes any custom brokers the user added AND reverts any rename /
  // recolour of built-ins. Meant for the "Reset to defaults" overflow
  // menu action — the UI confirms before calling.
  const resetBrokersToDefaults = useCallback(() => {
    setBrokersState(seedBrokers());
  }, []);

  // ---- Whisper API key: persist immediately (no useEffect indirection) ----
  const setWhisperApiKey = useCallback(async (key) => {
    const trimmed = (key ?? '').trim();
    setWhisperApiKeyState(trimmed);
    try {
      if (trimmed) {
        await AsyncStorage.setItem(STORAGE_KEYS.settings_whisper_api_key, trimmed);
      } else {
        await AsyncStorage.removeItem(STORAGE_KEYS.settings_whisper_api_key);
      }
    } catch (e) {
      console.warn('Save whisper key failed:', e);
    }
  }, []);

  // ---- AI Insights config: patch-merge + atomic persist ----
  //
  // Takes a partial patch (any subset of the config fields) and merges
  // it over the current config, then writes the FULL blob back to
  // AsyncStorage in one call. Doing patch-then-persist here (instead of
  // asking callers to send a full config every time) keeps Settings UI
  // simple — a provider dropdown just calls `setAiConfig({ provider,
  // baseUrl, model })` and doesn't have to know or preserve other
  // fields it doesn't touch.
  //
  // Convenience: if the caller passes `provider: '<key>'` matching a
  // preset, we auto-fill `baseUrl` + `model` from AI_PROVIDER_PRESETS
  // UNLESS the caller also supplied those fields explicitly (an
  // explicit value always wins over a preset auto-fill).
  //
  // SECURITY: if the caller passes `apiKey` in the patch, we DIVERT it
  // to SecureStore via setAiApiKey and STRIP it from the blob before
  // writing to AsyncStorage. Callers can therefore treat "apiKey" like
  // any other config field without knowing the security machinery
  // underneath — but the key never touches disk in plaintext.
  const setAiConfig = useCallback(async (patch) => {
    if (!patch) return;

    // Peel the apiKey out first so it never reaches the AsyncStorage
    // blob path. `blobPatch` is what we actually merge into aiConfig.
    let blobPatch = patch;
    if (Object.prototype.hasOwnProperty.call(patch, 'apiKey')) {
      const nextKey = (patch.apiKey ?? '').toString();
      setAiApiKeyState(nextKey);
      try {
        if (nextKey) {
          await setSecret(STORAGE_KEYS.ai_api_key_secret, nextKey);
        } else {
          await deleteSecret(STORAGE_KEYS.ai_api_key_secret);
        }
      } catch (e) {
        console.warn('Save AI API key failed:', e);
      }
      const { apiKey: _drop, ...rest } = patch;
      blobPatch = rest;
      if (Object.keys(blobPatch).length === 0) return;
    }

    let nextConfig = null;
    setAiConfigState((prev) => {
      const base = { ...prev, ...blobPatch };
      if (blobPatch.provider && blobPatch.provider !== prev.provider) {
        const preset = AI_PROVIDER_PRESETS[blobPatch.provider];
        if (preset) {
          if (blobPatch.baseUrl === undefined) base.baseUrl = preset.baseUrl;
          if (blobPatch.model   === undefined) base.model   = preset.model;
        }
      }
      // Defence in depth — even if a stale caller sneaks apiKey into
      // the blob path, drop it here so it can't be written to disk.
      if ('apiKey' in base) delete base.apiKey;
      nextConfig = base;
      return base;
    });
    try {
      if (nextConfig) {
        await AsyncStorage.setItem(
          STORAGE_KEYS.settings_ai_config,
          JSON.stringify(nextConfig),
        );
      }
    } catch (e) {
      console.warn('Save AI config failed:', e);
    }
  }, []);

  // Expose the current secure-store backing status for the Settings UI
  // ("Encrypted · iOS Keychain" vs "Browser storage — not encrypted").
  // Read once at boot and treated as a static value; the backing
  // doesn't change at runtime.
  const aiKeyBackingEncrypted = isBackingEncrypted();

  // BK-M2: expose the current app's expected migration keys so the
  // backup builder can include them in the payload. Static — doesn't
  // need to live in a state hook.
  const settingsMigrations = CATEGORY_MIGRATION_KEYS;

  const value = useMemo(
    () => ({
      ready,
      categories,
      accounts,
      accountGroups,
      accountsByGroup,
      addCategory,
      deleteCategory,
      updateCategory,
      addSubCategory,
      deleteSubCategory,
      updateSubCategory,
      resetCategoriesToDefault,
      addAccount,
      deleteAccount,
      updateAccount,
      addAccountGroup,
      deleteAccountGroup,
      updateAccountGroup,
      findCategory,
      findSubCategory,
      findAccount,
      findAccountGroup,
      whisperApiKey,
      setWhisperApiKey,
      // AI Insights (LLM-backed financial coach).
      aiConfig,
      setAiConfig,
      aiApiKey,               // never persisted in AsyncStorage — SecureStore only
      aiKeyBackingEncrypted,  // true = real keychain, false = web fallback
      // Multi-currency (F9 Tier 2).
      baseCurrency,
      fxRates,
      setBaseCurrency,
      setFxRate,
      deleteFxRate,
      // Broker auto-suggest memory (per investment sub-category).
      brokerDefaultsBySubCategory,
      setBrokerDefaultForSubCategory,
      // User-editable broker list (Zerodha / Groww / custom).
      brokers,
      addBroker,
      updateBroker,
      deleteBroker,
      resetBrokersToDefaults,
      restoreState,
      // BK-M2: settings migration keys — backup payload includes them so
      // a restore on another device can honour "already merged" state.
      settingsMigrations,
    }),
    [
      ready,
      categories,
      accounts,
      accountGroups,
      accountsByGroup,
      addCategory,
      deleteCategory,
      updateCategory,
      addSubCategory,
      deleteSubCategory,
      updateSubCategory,
      resetCategoriesToDefault,
      addAccount,
      deleteAccount,
      updateAccount,
      addAccountGroup,
      deleteAccountGroup,
      updateAccountGroup,
      findCategory,
      findSubCategory,
      findAccount,
      findAccountGroup,
      whisperApiKey,
      setWhisperApiKey,
      aiConfig,
      setAiConfig,
      aiApiKey,
      aiKeyBackingEncrypted,
      baseCurrency,
      fxRates,
      setBaseCurrency,
      setFxRate,
      deleteFxRate,
      brokerDefaultsBySubCategory,
      setBrokerDefaultForSubCategory,
      brokers,
      addBroker,
      updateBroker,
      deleteBroker,
      resetBrokersToDefaults,
      restoreState,
      settingsMigrations,
    ],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error('useSettings must be used within <SettingsProvider>');
  }
  return ctx;
}
