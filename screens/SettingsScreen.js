import { useState, useEffect, useCallback } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveTextFile } from '../lib/saveFile';
import { pickTextFile } from '../lib/openFile';
import { reloadApp } from '../lib/reload';
import { STORAGE_KEYS, AI_PROVIDER_PRESETS } from '../constants';
import { useSettings } from '../contexts/SettingsContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { usePortfolio } from '../contexts/PortfolioContext';
import { useNetWorth } from '../contexts/NetWorthContext';
import { useRecurring } from '../contexts/RecurringContext';
import { useBudgets } from '../contexts/BudgetContext';
import { useTransfers } from '../contexts/TransfersContext';
import { useGoals } from '../contexts/GoalsContext';
import { useInsurancePolicies } from '../contexts/InsurancePoliciesContext';
import { useLoans } from '../contexts/LoansContext';
import {
  useTheme,
  useThemedStyles,
  useThemeColors,
  THEME_MODES,
  FONT_OPTIONS,
} from '../contexts/ThemeContext';
import buildCsv from '../lib/exportCsv';
import { CURRENCIES, currencyMeta, isBaseCurrencyLocked } from '../lib/currency';
import { spacing } from '../lib/theme';
import { InfoCallout, StatusBadge } from '../components/UiPrimitives';
import {
  computeVoiceNotesUsage,
  deleteOldVoiceNotes,
  deleteOrphanVoiceNotes,
  formatBytes,
} from '../lib/voiceNotes';
import AppIcon from '../components/AppIcon';
import HelpSheet from '../components/HelpSheet';
import { useDemoRestore } from '../hooks/useDemoRestore';

// Bump when the backup shape changes in an incompatible way. Older
// versions of the app will refuse to restore a file with a higher
// schemaVersion.
//
// v1: initial (transactions, categories, accounts, portfolio, netWorth, recurring)
// v2: adds `budgets` list. Older files (v1) restore fine — budgets default
//     to []. Newer files created against a v1-capable app would be refused
//     by that older app (as intended).
// v3: adds `transfers` list (balance-sheet movements). Same backward-compat
//     behavior — restoring an older backup just leaves transfers empty.
// v4: adds `goals` list (savings targets + spending caps). Same policy —
//     older backups restore fine with `goals = []`.
// v5: adds `loans` (first-class loans with an event ledger) AND
//     `netWorth.history` (daily NW snapshots powering NetWorthChart).
//     Older backups restore fine — loans and NW history default to [].
// v6: multi-currency (F9 Tier 2). Adds `currency: { baseCurrency, fxRates }`
//     to the payload. Accounts now carry a `currency` field; transactions,
//     assets, and liabilities all carry optional `currency` +
//     `*InBase` snapshots. Older backups restore fine — a missing
//     `currency` payload leaves the user's current base/rates alone and
//     legacy rows are treated as base currency at aggregation time.
// v7: adds `preferences: { theme, settingsMigrations }` to the payload
//     — theme is a user preference; settingsMigrations tracks which
//     one-shot category-merge migrations have already run. Older
//     backups restore fine — theme defaults to 'system' and
//     settingsMigrations is unioned with the current app's expected
//     keys on restore.
// v8: adds `insurancePolicies` list. Older backups restore fine with [].
const BACKUP_SCHEMA_VERSION = 8;
const BACKUP_APP_ID = 'expense-tracker';

// YYYY-MM-DD-HHmm used as filename suffix — always sortable, avoids
// characters that some file systems / share-sheet targets reject.
function fileStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}`
  );
}

// BK-H2 pre-flight validation. Walks each expected backup section and
// confirms it's either absent (fine — restoreState handles the missing
// case per the B4.2 clear-on-missing policy) OR the right shape.
// Returns { ok: true } or { ok: false, reason: <human string> }.
//
// The check is intentionally SHAPE-only — we don't validate individual
// row semantics (each context's normalizer already handles those,
// gracefully falling back to defaults for garbage rows). What we're
// preventing here is the "d.transactions is a string" class of bugs
// where a malformed backup would slip past all the ?? {} defaults and
// then throw deep inside a downstream setter, leaving the restore
// half-applied.
function validateBackupSections(d) {
  const isArrayOrMissing = (v) => v == null || Array.isArray(v);
  const isObjOrMissing   = (v) => v == null || (typeof v === 'object' && !Array.isArray(v));

  const checks = [
    ['transactions',           isObjOrMissing(d.transactions)],
    ['transactions.expenses',  isArrayOrMissing(d.transactions?.expenses)],
    ['transactions.income',    isArrayOrMissing(d.transactions?.income)],
    ['transactions.investments', isArrayOrMissing(d.transactions?.investments)],
    ['categories',             isObjOrMissing(d.categories)],
    ['categories.expense',     isArrayOrMissing(d.categories?.expense)],
    ['categories.income',      isArrayOrMissing(d.categories?.income)],
    ['categories.investment',  isArrayOrMissing(d.categories?.investment)],
    ['accounts',               isArrayOrMissing(d.accounts)],
    ['accountGroups',          isArrayOrMissing(d.accountGroups)],
    ['portfolio',              isObjOrMissing(d.portfolio)],
    ['portfolio.holdings',     isArrayOrMissing(d.portfolio?.holdings)],
    ['netWorth',               isObjOrMissing(d.netWorth)],
    ['netWorth.assets',        isArrayOrMissing(d.netWorth?.assets)],
    ['netWorth.liabilities',   isArrayOrMissing(d.netWorth?.liabilities)],
    ['netWorth.history',       isArrayOrMissing(d.netWorth?.history)],
    ['recurring',              isObjOrMissing(d.recurring)],
    ['recurring.rules',        isArrayOrMissing(d.recurring?.rules)],
    ['budgets',                isArrayOrMissing(d.budgets)],
    ['transfers',              isArrayOrMissing(d.transfers)],
    ['goals',                  isArrayOrMissing(d.goals)],
    ['insurancePolicies',      isArrayOrMissing(d.insurancePolicies)],
    ['loans',                  isArrayOrMissing(d.loans)],
    ['customLoanKinds',        isArrayOrMissing(d.customLoanKinds)],
    ['currency',               isObjOrMissing(d.currency)],
    ['currency.fxRates',       isObjOrMissing(d.currency?.fxRates)],
    ['preferences',            isObjOrMissing(d.preferences)],
    ['preferences.settingsMigrations',
                               isArrayOrMissing(d.preferences?.settingsMigrations)],
    ['preferences.theme',
                               d.preferences?.theme == null
                                 || (typeof d.preferences.theme === 'string'
                                     && ['light', 'dark', 'system'].includes(d.preferences.theme))],
    ['preferences.font',
                               d.preferences?.font == null
                                 || (typeof d.preferences.font === 'string'
                                     && FONT_OPTIONS.some((f) => f.id === d.preferences.font))],
  ];

  for (const [path, ok] of checks) {
    if (!ok) {
      return {
        ok: false,
        reason: `Section \`${path}\` has an unexpected shape.`,
      };
    }
  }
  return { ok: true };
}

// ----------------------------------------------------------------------------
// SettingsScreen — manage user-editable master data:
//   - Accounts (grouped: e.g. "Bank Accounts" > HDFC, ICICI, ...)
//   - Category lists (one per transaction type)
//
// The Accounts section is a two-level hierarchy: each group is a card that
// lists the accounts inside it. Groups and accounts can both be added,
// renamed (via delete+re-add for now), or deleted.
// ----------------------------------------------------------------------------

export default function AdvancedSettingsScreen({ navigation, route }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const section = route?.params?.section ?? 'advanced';
  const sectionLabel = {
    appearance: 'Appearance',
    accounts_data: 'Accounts & data',
    ai: 'AI',
    advanced: 'Advanced',
  }[section] ?? 'Settings';
  const {
    accounts,
    accountGroups,
    categories,
    // Account + Category CRUD used to live directly on this screen
    // (via <AccountsSection> and three <Section> blocks). In the v4
    // polish pass both moved into dedicated screens — see
    // screens/AccountsScreen.js and screens/CategoriesScreen.js.
    // The hub cards below just navigate; every add/edit/delete
    // handler is pulled from SettingsContext by the child screens.
    whisperApiKey,
    setWhisperApiKey,
    aiConfig,
    setAiConfig,
    aiApiKey,               // sourced from SecureStore, not AsyncStorage
    aiKeyBackingEncrypted,  // true = real keychain; false = web fallback
    baseCurrency,
    fxRates,
    setBaseCurrency,
    setFxRate,
    deleteFxRate,
    brokerDefaultsBySubCategory,
    brokers,
    // BK-M2: static list of migration keys the current app expects to
    // be applied. Included in the backup payload so a device restoring
    // this backup can honour "already merged" state and skip redundant
    // work.
    settingsMigrations,
  } = useSettings();

  const {
    expenses,
    income,
    investments,
  } = useTransactions();

  const {
    holdings,
    pricesUpdatedAt,
  } = usePortfolio();

  const {
    assets,
    liabilities,
    history: netWorthHistory,
  } = useNetWorth();

  const {
    loans,
    customLoanKinds,
  } = useLoans();

  const {
    rules: recurringRules,
  } = useRecurring();

  const {
    budgets,
  } = useBudgets();

  const {
    transfers,
  } = useTransfers();

  const {
    goals,
  } = useGoals();

  const {
    policies: insurancePolicies,
  } = useInsurancePolicies();

  const { applyRestore, loadDemoData } = useDemoRestore();

  const { mode: themeMode, setThemeMode, fontId, setFontId } = useTheme();
  // BK-M2: include theme mode + font in backup payload. Lightweight
  // user preferences — silly to make the user re-pick on every device.

  const [exporting, setExporting] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [lastBackupAt, setLastBackupAt] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEYS.last_backup_at);
        if (!cancelled && raw) setLastBackupAt(raw);
      } catch {
        /* ignore */
      }
    })();
    return () => { cancelled = true; };
  }, []);
  const [restoring, setRestoring] = useState(false);

  // ---- Export all transactions to a CSV file and open native share sheet ----
  const handleExport = async () => {
    setExporting(true);
    try {
      const total = expenses.length + income.length + investments.length;
      if (total === 0) {
        Alert.alert('Nothing to export', 'Add some transactions first.');
        return;
      }
      const csv = buildCsv(
        { expenses, income, investments },
        { categories, accounts },
      );
      const stamp = fileStamp();
      const result = await saveTextFile({
        filename: `finance-export-${stamp}.csv`,
        content: csv,
        mimeType: 'text/csv',
      });
      if (!result.ok) {
        Alert.alert('Export failed', result.reason ?? 'Unknown error');
      } else if (result.reason === 'no_share' && result.savedTo) {
        Alert.alert('File saved', `Saved to:\n${result.savedTo}`);
      }
    } catch (e) {
      console.warn('Export failed:', e);
      Alert.alert('Export failed', e.message ?? 'Unknown error');
    } finally {
      setExporting(false);
    }
  };

  // ---- Backup: write EVERYTHING to a single JSON file --------------------
  //
  // Includes transactions + master data (categories/accounts/groups) +
  // portfolio holdings + net worth (assets/liabilities). Voice-note audio
  // files are NOT bundled — the backup file would balloon and most sharing
  // targets (email, chat) reject large attachments. Voice-note filenames
  // are preserved so if the user restores on the same device the audio
  // still plays; restoring on a different device silently loses the audio
  // but keeps the transaction (this seemed like the least surprising
  // trade-off).
  //
  // What's deliberately omitted from the backup:
  //   - whisperApiKey. It's a secret. Backup files often end up in cloud
  //     storage, email, chat, etc. — none of those are places to leak an
  //     API key. User re-enters it manually after restore.
  const handleBackup = async () => {
    setBackingUp(true);
    try {
      const payload = {
        app: BACKUP_APP_ID,
        schemaVersion: BACKUP_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        data: {
          transactions: { expenses, income, investments },
          categories,
          accounts,
          accountGroups,
          portfolio: { holdings, pricesUpdatedAt },
          netWorth: { assets, liabilities, history: netWorthHistory },
          recurring: { rules: recurringRules },
          budgets,
          transfers,
          goals,
          insurancePolicies,
          loans,
          customLoanKinds,
          // F9 Tier-2 (multi-currency). The base currency + FX rate
          // table are the parameters that give meaning to every
          // amountInBase / valueInBase snapshot on rows. If a backup
          // is restored on a device with a different base, the row
          // snapshots would silently be misread — so we bundle them.
          currency: {
            baseCurrency,
            fxRates,
          },
          // BK-M2: user preferences + one-shot migration flags.
          // Theme is a pure preference. settingsMigrations lets a
          // restore skip redundant merges; the restoring device
          // still unions with its own expected keys so a newer app
          // still runs any new migrations shipped since the backup.
          preferences: {
            theme: themeMode,
            font: fontId,
            settingsMigrations,
            // Broker auto-suggestion map. Small, purely a UX
            // convenience — losing it just means the picker won't
            // pre-fill on the restored device until the user picks
            // a broker again. Bundled inside `preferences` (not at
            // top-level) to keep the backup shape narrow.
            brokerDefaultsBySubCategory,
          },
        },
      };
      const json = JSON.stringify(payload, null, 2);
      const stamp = fileStamp();
      const result = await saveTextFile({
        filename: `finance-backup-${stamp}.json`,
        content: json,
        mimeType: 'application/json',
      });
      if (!result.ok) {
        Alert.alert('Backup failed', result.reason ?? 'Unknown error');
      } else {
        const iso = new Date().toISOString();
        setLastBackupAt(iso);
        AsyncStorage.setItem(STORAGE_KEYS.last_backup_at, iso).catch(() => {});
        if (result.reason === 'no_share' && result.savedTo) {
          Alert.alert('Backup saved', `Saved to:\n${result.savedTo}`);
        } else {
          Alert.alert('Backup exported', 'Keep the JSON file somewhere safe.');
        }
      }
    } catch (e) {
      console.warn('Backup failed:', e);
      Alert.alert('Backup failed', e.message ?? 'Unknown error');
    } finally {
      setBackingUp(false);
    }
  };

  // ---- Restore: pick a backup JSON, validate, confirm, apply -------------
  //
  // Restoring is destructive — it REPLACES current data. We guard it with:
  //   1. Signature check ("app: expense-tracker" + valid schemaVersion)
  //   2. BK-H2: shape validation of every section BEFORE calling any
  //      restoreState. Bad payload → we never touch state, so a partial
  //      apply can't leave the user in a Frankenstein hybrid.
  //   3. Explicit confirmation dialog with the backup's export date so
  //      the user knows what they're about to overwrite.
  const handleRestore = async () => {
    setRestoring(true);
    try {
      const picked = await pickTextFile({ mimeTypes: ['application/json', '*/*'] });
      if (picked.cancelled) return;
      const text = picked.text;

      let payload;
      try {
        payload = JSON.parse(text);
      } catch (parseErr) {
        Alert.alert(
          'Invalid file',
          'This file isn\'t valid JSON. Pick a backup exported from this app.',
        );
        return;
      }

      // Signature checks.
      if (payload?.app !== BACKUP_APP_ID) {
        Alert.alert(
          'Not a backup from this app',
          'The file doesn\'t look like a finance backup. Aborting.',
        );
        return;
      }
      // BK-L5: stricter schemaVersion validation. Reject 0, negatives,
      // fractional, NaN, Infinity — previously `typeof x === 'number'`
      // accepted all of those (typeof NaN === 'number'), and a payload
      // with `schemaVersion: 0` would slip past the too-new check and
      // trip downstream restoreState calls on wildly-wrong shapes.
      if (
        typeof payload.schemaVersion !== 'number'
        || !Number.isFinite(payload.schemaVersion)
        || !Number.isInteger(payload.schemaVersion)
        || payload.schemaVersion < 1
      ) {
        Alert.alert(
          'Invalid backup format',
          `The backup's schemaVersion (${JSON.stringify(payload.schemaVersion)}) isn't a valid version number. Pick a backup exported from this app.`,
        );
        return;
      }
      if (payload.schemaVersion > BACKUP_SCHEMA_VERSION) {
        Alert.alert(
          'Newer backup format',
          `This backup was created with a newer version of the app (schema v${payload.schemaVersion}). Update the app before restoring.`,
        );
        return;
      }

      // BK-H2 pre-flight validation. Every section must be either
      // absent (payload silence — restoreState treats that as "clear
      // this section" per the B4.2 policy) OR an array-of-objects.
      // Any type mismatch aborts BEFORE we touch state.
      const validation = validateBackupSections(payload.data ?? {});
      if (!validation.ok) {
        Alert.alert(
          'Backup is malformed',
          `${validation.reason}\n\nNothing has been changed. Pick a different backup file.`,
        );
        return;
      }

      const exportedAt = payload.exportedAt
        ? new Date(payload.exportedAt).toLocaleString()
        : 'unknown date';

      // Confirmation — count what we're about to replace so the number is
      // in the dialog, not just a scary "everything".
      //
      // BK-L4 tie-in: portfolio holdings count reads through
      // `d.portfolio` (the presence of the key) rather than
      // `d.portfolio?.holdings ?? []`. If the backup omits portfolio
      // entirely we display "holdings kept" instead of a misleading
      // "0 holdings" (which would suggest a wipe).
      const d = payload.data ?? {};
      const t = d.transactions ?? {};
      const fxRateCount = Object.keys(d.currency?.fxRates ?? {}).length;
      const holdingsLine = d.portfolio?.holdings !== undefined
        ? `${(d.portfolio.holdings ?? []).length} holdings`
        : 'holdings kept (not in backup)';
      const counts = [
        `${(t.expenses ?? []).length} expenses`,
        `${(t.income ?? []).length} income`,
        `${(t.investments ?? []).length} investments`,
        `${(d.assets ?? d.netWorth?.assets ?? []).length} assets`,
        `${(d.liabilities ?? d.netWorth?.liabilities ?? []).length} liabilities`,
        holdingsLine,
        `${(d.recurring?.rules ?? []).length} recurring rules`,
        `${(d.budgets ?? []).length} budgets`,
        `${(d.transfers ?? []).length} transfers`,
        `${(d.goals ?? []).length} goals`,
        `${(d.insurancePolicies ?? []).length} insurance policies`,
        `${(d.loans ?? []).length} loans`,
        `${(d.netWorth?.history ?? []).length} NW snapshots`,
        d.currency?.baseCurrency
          ? `base ${d.currency.baseCurrency}${fxRateCount ? ` + ${fxRateCount} FX rates` : ''}`
          : null,
        d.preferences?.theme
          ? `theme ${d.preferences.theme}`
          : null,
      ].filter(Boolean).join(', ');

      Alert.alert(
        'Restore this backup?',
        `Exported ${exportedAt}.\n\nThis will REPLACE all current data with:\n${counts}\n\nYour Whisper API key is unaffected. This can NOT be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Restore',
            style: 'destructive',
            onPress: () => applyRestore(payload),
          },
        ],
      );
    } catch (e) {
      console.warn('Restore failed:', e);
      Alert.alert('Restore failed', e.message ?? 'Unknown error');
    } finally {
      setRestoring(false);
    }
  };

  // Push the restored payload into each context — see hooks/useDemoRestore.js.
  // handleRestore calls applyRestore after validation; load demo uses the same path.

  // ---- Reset everything -------------------------------------------------
  //
  // Nuclear option: wipes every AsyncStorage key we own, then reloads the
  // app so all contexts re-hydrate from empty storage (and re-seed their
  // defaults where they have any — SettingsContext restores default
  // categories/accounts, for instance).
  //
  // Guarded behind a destructive Alert so a stray tap can't obliterate
  // years of data. The alert copy names exactly what gets deleted, and
  // reminds the user that Backup runs before Reset if they want a safety
  // net.
  const FINANCIAL_DATA_KEYS = [
    STORAGE_KEYS.expenses, STORAGE_KEYS.income, STORAGE_KEYS.investments,
    STORAGE_KEYS.portfolio_holdings, STORAGE_KEYS.portfolio_prices_updated_at,
    STORAGE_KEYS.assets, STORAGE_KEYS.liabilities, STORAGE_KEYS.networth_history,
    STORAGE_KEYS.recurring_rules, STORAGE_KEYS.budgets, STORAGE_KEYS.transfers,
    STORAGE_KEYS.goals, STORAGE_KEYS.insurance_policies, STORAGE_KEYS.loans, STORAGE_KEYS.ai_insights_cache,
  ].filter(Boolean);

  const handleResetAll = () => {
    Alert.alert(
      'Choose what to reset',
      'Financial data only keeps accounts, categories and preferences. '
        + 'It clears transfers, loans, holdings, net worth, recurring rules, '
        + 'budgets and goals. Reset everything also removes master data and '
        + 'preferences. Default accounts and categories will then be restored.\n\n'
        + 'Consider tapping "Backup (JSON)" first if you might want '
        + 'this data back. This action CANNOT be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Financial data only', style: 'destructive', onPress: performResetFinancialData },
        { text: 'Everything', style: 'destructive', onPress: performResetEverything },
      ],
    );
  };

  // Load a rich demo dataset in one tap. Uses the same restore path as
  // ♻️ Restore (applyRestore + validateBackupSections) so any errors
  // surface with the same partial-restore UI, and every context re-
  // hydrates atomically. Two-tap confirm because it REPLACES current
  // data — same posture as Restore.
  //
  // WEB CAVEAT: react-native-web's Alert polyfill does NOT invoke the
  // `onPress` callback for multi-button alerts, so tapping "Load demo
  // data" would silently no-op in the browser. Branch on Platform to
  // use window.confirm() there.
  const handleLoadDemo = () => loadDemoData();

  // NOTE: `confirmResetCategories` (BK-H6) used to live here, wrapping
  // each per-type reset in a destructive Alert. In the v4 polish pass
  // categories moved to a dedicated screen (CategoriesScreen.js) which
  // owns its own reset flow behind an overflow menu, so this helper
  // was removed along with the three <Section> blocks that called it.

  const reloadAfterReset = () => {
    const reloaded = reloadApp();
    if (!reloaded) {
      Alert.alert('Reset complete', 'Data cleared. Please close and reopen the app to finish.');
    }
  };

  const performResetFinancialData = async () => {
    try {
      await AsyncStorage.multiRemove(FINANCIAL_DATA_KEYS);
      reloadAfterReset();
    } catch (e) {
      console.warn('Financial data reset failed:', e);
      Alert.alert('Reset failed', e.message ?? 'Unknown error');
    }
  };

  const performResetEverything = async () => {
    try {
      // Delete every known key. multiRemove is atomic-ish on both iOS and
      // Android — either all keys go, or the whole operation fails.
      await AsyncStorage.multiRemove(Object.values(STORAGE_KEYS));
      await setAiConfig({ apiKey: '' });

      // Reload the app so every context re-runs its hydration effect
      // against the now-empty storage. If we skipped the reload, contexts
      // would keep serving their in-memory (now-stale) copies until the
      // user manually closed and reopened the app.
      reloadAfterReset();
    } catch (e) {
      console.warn('Reset failed:', e);
      Alert.alert('Reset failed', e.message ?? 'Unknown error');
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.settingsHelpRow}>
          <Text style={styles.settingsHelpLabel}>{sectionLabel}</Text>
          <HelpSheet
            title="Settings"
            summary="Set up the app’s master data and preferences here."
            items={['Categories, accounts, brokers, and currency affect entry forms.', 'Backups, privacy controls, and destructive actions are further down this page.']}
          />
        </View>

        {/* ============================================================
            YOUR DATA
            The stuff a new install needs before it can log anything —
            categories, accounts, brokers, currency. Placed first
            because these are the fields the "Add" flows depend on and
            because they're the surfaces users most often revisit.
            ============================================================ */}
        {section === 'accounts_data' && (
          <>
        <Text style={styles.groupHeader}>Your data</Text>

        {/* ---- CATEGORIES HUB CARD ----
            Categories used to be THREE full-length <Section> blocks
            stacked here — Income, Expense, and Investment lists back-
            to-back, each with its own header + Reset link + add
            button. Great for editing but overwhelming when the user
            just wants to change currency or theme (they had to swipe
            past ~40 rows).

            v4 polish: one card summarising per-type counts, tap opens
            a dedicated CategoriesScreen with a segmented tab, swipe-
            to-delete, and reset behind an overflow menu. Same
            capability, ~200 fewer pixels of Settings scroll. */}
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => navigation.navigate('Categories')}
          style={styles.catHub}
          accessibilityRole="button"
          accessibilityLabel="Manage categories"
        >
          <View style={[styles.catHubIcon, { backgroundColor: '#0891b222' }]}>
            <AppIcon name="tag" size={20} color="#0891b2" strokeWidth={2.2} />
          </View>
          <View style={styles.catHubBody}>
            <Text style={styles.catHubTitle}>Categories</Text>
            <View style={styles.catHubCountRow}>
              <View style={styles.catHubCountPill}>
                <View style={[styles.catHubDot, { backgroundColor: '#059669' }]} />
                <Text style={styles.catHubCountText}>
                  {categories.income?.length ?? 0} income
                </Text>
              </View>
              <View style={styles.catHubCountPill}>
                <View style={[styles.catHubDot, { backgroundColor: '#dc2626' }]} />
                <Text style={styles.catHubCountText}>
                  {categories.expense?.length ?? 0} expense
                </Text>
              </View>
              <View style={styles.catHubCountPill}>
                <View style={[styles.catHubDot, { backgroundColor: '#7c3aed' }]} />
                <Text style={styles.catHubCountText}>
                  {categories.investment?.length ?? 0} investment
                </Text>
              </View>
            </View>
            <Text style={styles.catHubHint}>
              Add, edit, or reorganise categories and sub-categories.
            </Text>
          </View>
          <AppIcon
            name="chevron-right"
            size={18}
            color={themeColors.text.muted}
            strokeWidth={2}
          />
        </TouchableOpacity>

        {/* ---- ACCOUNTS HUB CARD ----
            Accounts used to render inline as a full <AccountsSection>
            here — every group card expanded, every account row, every
            add form all stacked in the middle of Settings. Fine when
            you're managing accounts, but overwhelming when you're
            just here to change currency or theme.

            v4 polish: the two-level (groups > accounts) tree moved
            into its own screen with swipe-to-delete on account rows,
            group edit/delete in the card header, and a header + button
            for adding a new group. Same capability, ~200 fewer pixels
            of Settings scroll. */}
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => navigation.navigate('Accounts')}
          style={styles.acctHub}
          accessibilityRole="button"
          accessibilityLabel="Manage accounts"
        >
          <View style={[styles.acctHubIcon, { backgroundColor: '#0ea5e922' }]}>
            <AppIcon name={'wallet'} size={20} color={'#0ea5e9'} strokeWidth={2.2} />
          </View>
          <View style={styles.acctHubBody}>
            <Text style={styles.acctHubTitle}>Accounts</Text>
            <View style={styles.acctHubCountRow}>
              <View style={styles.acctHubCountPill}>
                <AppIcon name="layout-grid" size={11} color={themeColors.text.secondary} strokeWidth={2.2} />
                <Text style={styles.acctHubCountText}>
                  {accountGroups.length} {accountGroups.length === 1 ? 'group' : 'groups'}
                </Text>
              </View>
              <View style={styles.acctHubCountPill}>
                <AppIcon name={'wallet'} size={11} color={themeColors.text.secondary} strokeWidth={2.2} />
                <Text style={styles.acctHubCountText}>
                  {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}
                </Text>
              </View>
            </View>
            <Text style={styles.acctHubHint}>
              Manage bank accounts, cash, wallets, and multi-currency accounts.
            </Text>
          </View>
          <AppIcon
            name="chevron-right"
            size={18}
            color={themeColors.text.muted}
            strokeWidth={2}
          />
        </TouchableOpacity>

        {/* ---- BROKERS HUB CARD ----
            Brokers were introduced as a first-class user-editable list
            in the same v4 polish pass that gave Categories and Accounts
            their dedicated screens. Historically brokers were a static
            constant baked into the app — great for the 10 built-in
            Indian brokers, useless if you invest via Fidelity or IBKR.

            Accounts (above) hold CASH; Brokers (here) hold
            INVESTMENTS. Keeping the two hub cards adjacent reinforces
            that pairing without merging them (which would break the
            "from account → to broker" model of an investment
            transaction and lose broker-CSV reconciliation). See
            screens/BrokersScreen.js. */}
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => navigation.navigate('Brokers')}
          style={styles.acctHub}
          accessibilityRole="button"
          accessibilityLabel="Manage brokers"
        >
          <View style={[styles.acctHubIcon, { backgroundColor: '#f9731622' }]}>
            <AppIcon name="trending-up" size={20} color="#f97316" strokeWidth={2.2} />
          </View>
          <View style={styles.acctHubBody}>
            <Text style={styles.acctHubTitle}>Brokers</Text>
            <View style={styles.acctHubCountRow}>
              <View style={styles.acctHubCountPill}>
                <AppIcon name="briefcase" size={11} color={themeColors.text.secondary} strokeWidth={2.2} />
                <Text style={styles.acctHubCountText}>
                  {(brokers ?? []).length} {(brokers ?? []).length === 1 ? 'broker' : 'brokers'}
                </Text>
              </View>
              {(() => {
                const custom = (brokers ?? []).filter((b) => !b.builtIn).length;
                if (custom === 0) return null;
                return (
                  <View style={styles.acctHubCountPill}>
                    <View style={[styles.catHubDot, { backgroundColor: '#f97316' }]} />
                    <Text style={styles.acctHubCountText}>
                      {custom} custom
                    </Text>
                  </View>
                );
              })()}
            </View>
            <Text style={styles.acctHubHint}>
              Zerodha, Groww, Upstox — plus any custom platform you use
              for investments.
            </Text>
          </View>
          <AppIcon
            name="chevron-right"
            size={18}
            color={themeColors.text.muted}
            strokeWidth={2}
          />
        </TouchableOpacity>

        {/* CURRENCY — base + FX rate table. Belongs in "Your data" too
            because base currency is a master field every amount is
            normalised against. Kept as the last item of the group so
            it visually caps the master-data cluster with the more
            complex form. */}
        <CurrencySection
          baseCurrency={baseCurrency}
          fxRates={fxRates}
          onChangeBase={setBaseCurrency}
          onSetRate={setFxRate}
          onDeleteRate={deleteFxRate}
        />
          </>
        )}

        {/* ============================================================
            INTELLIGENCE
            Opt-in features that add automation on top of your data.
            Grouped together so users considering "should I enable
            LLM / voice?" can compare them in one glance.
            ============================================================ */}
        {section === 'ai' && (
          <>
        <Text style={styles.groupHeader}>Intelligence</Text>

        {/* AI INSIGHTS — LLM-backed personal-finance coach */}
        <AiInsightsSection
          config={aiConfig}
          apiKey={aiApiKey}
          keyEncrypted={aiKeyBackingEncrypted}
          onChange={setAiConfig}
        />

        {/* VOICE TRANSCRIPTION — OpenAI Whisper API key */}
        <WhisperKeySection
          apiKey={whisperApiKey}
          onSave={setWhisperApiKey}
          keyEncrypted={aiKeyBackingEncrypted}
        />
          </>
        )}

        {/* ============================================================
            BACKUP & MAINTENANCE
            Data-shaped operations: portable exports, JSON round-trip
            backup, voice-note disk cleanup, and the demo seeder
            (which also replaces data — reason enough to keep it here
            near backup instead of at the top).
            ============================================================ */}
        {section === 'advanced' && (
          <>
        <Text style={styles.groupHeader}>Backup & maintenance</Text>

        {/* EXPORT & BACKUP
            Slimmed-down layout: the "what's inside a backup" paragraph
            and the "what's NOT inside" warning both moved behind an
            InfoChip so the section stops eating half a screen on load.
            The destructive Restore path already surfaces its own
            confirmation Alert before touching data, so pushing the
            static explainer to on-demand is safe. */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Export & Backup</Text>
            <InfoChip
              title="About Export & Backup"
              body={
                'CSV is a spreadsheet-friendly export of your transactions only.\n\n'
                + 'JSON Backup is a complete round-trip file — restoring it on this app rebuilds every screen.\n\n'
                + 'INCLUDED in the JSON backup:\n'
                + '• Transactions, categories, accounts, holdings\n'
                + '• Assets, liabilities, recurring rules\n'
                + '• Budgets, transfers, goals, loans\n'
                + '• Daily net-worth snapshots\n'
                + '• Base currency + FX rate table\n'
                + '• Theme preference + internal migration flags\n\n'
                + 'NOT INCLUDED:\n'
                + '• Voice-note audio files (filenames are preserved so playback still works after a same-device restore, but a cross-device restore silently loses the audio)\n'
                + '• The Whisper API key — re-enter it from Settings after restore.'
              }
            />
          </View>

          <TouchableOpacity
            onPress={handleExport}
            disabled={exporting}
            style={[styles.exportBtn, exporting && { opacity: 0.6 }]}
            activeOpacity={0.7}
          >
            <View style={styles.exportBtnInner}>
              {!exporting && (
                // Sits on the always-dark exportBtn (bg.hero) — icon has to
                // stay light. `text.primary` was resolving to near-black on
                // near-black in light mode too (latent bug).
                <AppIcon name="upload" size={16} color={themeColors.text.onHero} strokeWidth={2.1} />
              )}
              <Text style={styles.exportBtnText}>
                {exporting ? 'Preparing…' : 'Export transactions CSV'}
              </Text>
            </View>
          </TouchableOpacity>

          <View style={styles.backupButtonRow}>
            <TouchableOpacity
              onPress={handleBackup}
              disabled={backingUp || restoring}
              style={[
                styles.backupBtn,
                styles.backupBtnPrimary,
                (backingUp || restoring) && { opacity: 0.6 },
              ]}
              activeOpacity={0.7}
            >
              <View style={styles.backupBtnInner}>
                {!backingUp && (
                  // backupBtnPrimary is a fixed brand blue (#2563eb) — same
                  // in both themes — so its icon has to stay light. Prior
                  // `text.inverse` collapsed to near-black in dark mode.
                  <AppIcon name="save" size={15} color={themeColors.text.onHero} strokeWidth={2.1} />
                )}
                <Text style={styles.backupBtnPrimaryText}>
                  {backingUp ? 'Preparing…' : 'Backup (JSON)'}
                </Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleRestore}
              disabled={backingUp || restoring}
              style={[
                styles.backupBtn,
                styles.backupBtnGhost,
                (backingUp || restoring) && { opacity: 0.6 },
              ]}
              activeOpacity={0.7}
            >
              <View style={styles.backupBtnInner}>
                {!restoring && (
                  <AppIcon
                    name="rotate-ccw"
                    size={15}
                    color={themeColors.text.primary}
                    strokeWidth={2.1}
                  />
                )}
                <Text style={styles.backupBtnGhostText}>
                  {restoring ? 'Opening…' : 'Restore'}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
          <Text style={styles.backupLastHint}>
            {lastBackupAt
              ? `Last backup ${new Date(lastBackupAt).toLocaleString(undefined, {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}`
              : 'No backup on this device yet — export a JSON copy periodically.'}
          </Text>
          {/* The old "Backup includes …" paragraph + orange "NOT
              included" warning that used to live here have moved into
              the InfoChip in the section header — tap ⓘ to read them.
              Nothing was removed; the surface is just calmer at rest. */}
        </View>

        {/* TRY THE APP — one-tap "Load demo data" seeds a rich sample
            dataset so every screen has something to render. Deliberately
            styled as a soft accent (not danger red) so it feels inviting;
            the destructive confirm dialog handles the "this replaces
            your data" warning. */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>Try the app</Text>
              <Text style={styles.sectionSubtitle}>
                Seed a realistic demo dataset so every screen has something
                to show.
              </Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={handleLoadDemo}
            style={styles.demoBtn}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Load demo data"
            accessibilityHint="Replaces current data with a rich sample dataset that exercises every feature."
          >
            <View style={styles.demoBtnIconWrap}>
              <AppIcon name="clapperboard" size={28} color="#0369a1" strokeWidth={1.9} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.demoBtnTitle}>Load demo data</Text>
              <Text style={styles.demoBtnSub}>
                Two financial years of transactions, portfolio holdings with
                unit logs, synced Net Worth assets, 2 EPF UANs, 6 budgets,
                5 goals, 5 loans, allocation targets, and full net-worth history.
              </Text>
            </View>
          </TouchableOpacity>
          <View style={styles.backupHelpWarnRow}>
            <AppIcon name="alert-triangle" size={12} color="#b45309" strokeWidth={2} />
            <Text style={styles.backupHelpWarn}>
              Replaces all current data. Tap Backup first if you want
              your real data back.
            </Text>
          </View>
        </View>

        {/* VOICE NOTES STORAGE — disk-usage report + safe cleanup actions.
            Kept inside the "Backup & maintenance" group because it's a
            disk / storage operation, not a feature toggle. Only surfaces
            on native — web has no voice-note filesystem to clean. */}
        {Platform.OS !== 'web' && (
          <VoiceNotesSection
            referencedPaths={
              // Collect every voice-note file path still linked to a
              // live transaction OR a live transfer. The cleanup helpers
              // never touch referenced files, so this keeps working
              // rows' playback intact.
              [
                ...expenses,
                ...income,
                ...investments,
                ...transfers,
              ]
                .map((row) => row?.voiceNote?.file)
                .filter(Boolean)
            }
          />
        )}
          </>
        )}

        {/* ============================================================
            LOOK & FEEL
            Personal preferences that don't touch data. Placed near
            the bottom because they're the "already-a-user" tweak —
            new installs need the master data cards above much more
            urgently than a theme toggle.
            ============================================================ */}
        {section === 'appearance' && (
          <>
        <Text style={styles.groupHeader}>Look & feel</Text>

        {/* APPEARANCE */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>Appearance</Text>
              <Text style={styles.sectionSubtitle}>
                Match your OS or force a fixed theme.
              </Text>
            </View>
          </View>
          <View style={styles.themeRow}>
            {THEME_MODES.map((m) => {
              const active = m === themeMode;
              return (
                <TouchableOpacity
                  key={m}
                  onPress={() => setThemeMode(m)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Theme: ${m}`}
                  style={[styles.themeChip, active && styles.themeChipActive]}
                >
                  <View style={styles.themeChipInner}>
                    <AppIcon
                      name={m === 'light' ? 'sun' : m === 'dark' ? 'moon' : 'monitor'}
                      size={14}
                      color={
                        active
                          ? themeColors.text.inverse
                          : themeColors.text.secondary
                      }
                      strokeWidth={2.1}
                    />
                    <Text
                      style={[
                        styles.themeChipText,
                        active && styles.themeChipTextActive,
                      ]}
                    >
                      {m === 'light' ? 'Light' : m === 'dark' ? 'Dark' : 'System'}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* FONT — compact chips; name rendered in its own typeface */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>Font</Text>
              <Text style={styles.sectionSubtitle}>
                Typeface used across the app.
              </Text>
            </View>
          </View>
          <View style={styles.fontRow}>
            {FONT_OPTIONS.map((f) => {
              const active = f.id === fontId;
              const labelFamily = f.weights
                ? (f.weights['600'] || f.weights['400'])
                : undefined;
              return (
                <TouchableOpacity
                  key={f.id}
                  onPress={() => setFontId(f.id)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Font: ${f.label}`}
                  accessibilityState={{ selected: active }}
                  style={[styles.fontChip, active && styles.fontChipActive]}
                >
                  <Text
                    style={[
                      styles.fontChipText,
                      labelFamily ? { fontFamily: labelFamily } : null,
                      active && styles.fontChipTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {f.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* DANGER ZONE — full wipe of all local data. Kept at the bottom
            of the screen and styled red so it can't be tapped accidentally. */}
          </>
        )}

        {section === 'advanced' && (
        <View style={[styles.section, styles.dangerSection]}>
          <View style={styles.sectionHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.sectionTitle, styles.dangerTitle]}>Danger zone</Text>
              <Text style={styles.sectionSubtitle}>
                Irreversible actions. Consider tapping Backup first.
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.dangerBtn}
            activeOpacity={0.85}
            onPress={handleResetAll}
            accessibilityRole="button"
            accessibilityLabel="Reset everything"
            accessibilityHint="Clears every transaction, category, account, budget, transfer, goal, holding, and preference from this device."
          >
            <View style={styles.dangerBtnIconWrap}>
              <AppIcon name="bomb" size={28} color="#b91c1c" strokeWidth={1.9} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.dangerBtnTitle}>Reset everything</Text>
              <Text style={styles.dangerBtnSub}>
                Wipe all transactions, master data, preferences, and re-seed
                defaults.
              </Text>
            </View>
          </TouchableOpacity>
        </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ----------------------------------------------------------------------------
// InfoChip — tiny ⓘ button used in section headers to hide long
// explainers / warnings behind a one-tap alert instead of always
// occupying vertical space.
//
// Rationale: sections like "Export & Backup" and "Currency" carried
// ~5 lines of always-visible help copy + a warning callout. Fine on
// first read, wasted pixels forever after. This chip lets us keep
// exactly the same information available (nothing removed) while
// giving the section a compact resting state — the info only shows
// when the user actually needs it.
//
// Uses the shared `Alert.alert` primitive rather than a custom modal
// so it feels native on iOS / Android and works identically on web
// without extra dependencies.
// ----------------------------------------------------------------------------
function InfoChip({ title, body, color }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  return (
    <TouchableOpacity
      onPress={() => Alert.alert(title, body, [{ text: 'Got it' }])}
      hitSlop={10}
      style={styles.infoChip}
      accessibilityRole="button"
      accessibilityLabel={`About ${title}`}
      accessibilityHint="Opens a short explainer for this section."
    >
      <AppIcon
        name="info"
        size={14}
        color={color ?? themeColors.text.muted}
        strokeWidth={2.2}
      />
    </TouchableOpacity>
  );
}

// ----------------------------------------------------------------------------
// VoiceNotesSection — disk-usage report + safe cleanup actions for the
// voice-notes directory (B6.6).
//
// UX:
//   - Show live totals: N files · X MB.
//   - Two safe actions:
//       (1) Delete orphans — files no transaction/transfer references.
//       (2) Delete older than 30 days (still spares referenced files).
//   - Both confirm before deleting; the toast shows exactly how much was
//     reclaimed so the user has feedback.
//
// Referenced paths come from the parent so we never nuke audio that's
// still linked from a live row.
// ----------------------------------------------------------------------------
function VoiceNotesSection({ referencedPaths }) {
  const styles = useThemedStyles(makeStyles);
  const [usage, setUsage] = useState({ count: 0, totalBytes: 0 });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const u = await computeVoiceNotesUsage();
      setUsage(u);
    } catch (e) {
      console.warn('Failed to compute voice-notes usage:', e);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const runCleanup = async (mode) => {
    const label = mode === 'orphans'
      ? 'Delete orphan voice notes?'
      : 'Delete voice notes older than 30 days?';
    const body = mode === 'orphans'
      ? 'This removes audio files that no longer belong to any transaction. '
        + 'Files still linked from a live row are always kept.'
      : 'This removes audio files older than 30 days that no live '
        + 'transaction still references. Newer audio and referenced audio '
        + 'are always kept.';
    Alert.alert(label, body, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            const res = mode === 'orphans'
              ? await deleteOrphanVoiceNotes(referencedPaths)
              : await deleteOldVoiceNotes(30, referencedPaths);
            await refresh();
            Alert.alert(
              'Voice notes cleaned',
              res.deletedCount === 0
                ? 'Nothing to delete — everything on disk is still in use.'
                : `Removed ${res.deletedCount} file${res.deletedCount === 1 ? '' : 's'} · ${formatBytes(res.deletedBytes)}`,
            );
          } catch (e) {
            console.warn('Voice-notes cleanup failed:', e);
            Alert.alert('Cleanup failed', e.message ?? 'Unknown error');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const inUseCount = new Set(referencedPaths).size;
  const orphanCount = Math.max(0, usage.count - inUseCount);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Voice notes storage</Text>
      <Text style={styles.sectionHelp}>
        Recordings you attach to transactions live on this device. Cleanup
        actions never touch audio still linked from a live row.
      </Text>

      <View style={styles.voiceUsageCard}>
        <View style={styles.voiceUsageRow}>
          <Text style={styles.voiceUsageLabel}>On disk</Text>
          <Text style={styles.voiceUsageValue}>
            {usage.count} {usage.count === 1 ? 'file' : 'files'} · {formatBytes(usage.totalBytes)}
          </Text>
        </View>
        <View style={styles.voiceUsageRow}>
          <Text style={styles.voiceUsageLabel}>Linked from a row</Text>
          <Text style={styles.voiceUsageValue}>{inUseCount}</Text>
        </View>
        <View style={styles.voiceUsageRow}>
          <Text style={styles.voiceUsageLabel}>Orphans</Text>
          <Text style={[
            styles.voiceUsageValue,
            orphanCount > 0 && { color: '#b45309' },
          ]}>
            {orphanCount}
          </Text>
        </View>
      </View>

      <View style={styles.voiceButtonRow}>
        <TouchableOpacity
          onPress={() => runCleanup('orphans')}
          disabled={busy || usage.count === 0}
          activeOpacity={0.7}
          style={[
            styles.voiceBtn,
            styles.voiceBtnGhost,
            (busy || usage.count === 0) && styles.voiceBtnDisabled,
          ]}
        >
          <Text style={styles.voiceBtnGhostText}>
            {busy ? 'Working…' : 'Delete orphans'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => runCleanup('old')}
          disabled={busy || usage.count === 0}
          activeOpacity={0.7}
          style={[
            styles.voiceBtn,
            styles.voiceBtnGhost,
            (busy || usage.count === 0) && styles.voiceBtnDisabled,
          ]}
        >
          <Text style={styles.voiceBtnGhostText}>
            {busy ? 'Working…' : 'Delete > 30 days'}
          </Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity onPress={refresh} activeOpacity={0.7} style={{ marginTop: 8 }}>
        <Text style={{ fontSize: 12, color: '#2563eb', fontWeight: '600' }}>
          Refresh
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ----------------------------------------------------------------------------
// AiInsightsSection — configures the LLM-backed personal-finance coach
// (see contexts/AiInsightsContext.js, lib/aiInsights.js).
//
// UX flow:
//   1. Feature toggle at the top (off by default).
//   2. Privacy notice with an explicit "I understand" checkbox. Must be
//      accepted before generation is unlocked.
//   3. Provider dropdown (OpenAI / Groq / OpenRouter / DeepSeek / Custom).
//      Picking a preset auto-fills baseUrl + model — but both remain
//      editable in case the user wants a different model on the same
//      provider (e.g. gpt-4o instead of gpt-4o-mini).
//   4. API key (masked, with a Show toggle).
//   5. Base URL + model as editable text fields.
//
// The section is intentionally LONG. AI usage on a finance app deserves
// visible controls, not a hidden toggle.
// ----------------------------------------------------------------------------
export function AiInsightsSection({ config, apiKey, keyEncrypted, onChange }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const [keyReveal,  setKeyReveal]  = useState(false);
  const [keyDraft,   setKeyDraft]   = useState(apiKey ?? '');

  // Keep the local draft in sync when the parent supplies a new key
  // (e.g. after the SecureStore migration finishes on cold boot, or a
  // restore-from-backup writes into settings). Guard against loops by
  // only pushing when values actually differ.
  useEffect(() => {
    if ((apiKey ?? '') !== keyDraft) {
      setKeyDraft(apiKey ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  const enabled            = !!config?.enabled;
  const consentAccepted    = !!config?.consentAcceptedAt;
  const confirmBeforeSend  = config?.confirmBeforeSend !== false;   // default ON
  const provider           = config?.provider ?? 'openai';
  const currentPreset      = AI_PROVIDER_PRESETS[provider] ?? AI_PROVIDER_PRESETS.custom;
  const hasKey             = !!apiKey;
  const keyMasked          = hasKey
    ? `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`
    : '';

  const toggleEnabled = () => onChange({ enabled: !enabled });

  const toggleConsent = () => onChange({
    consentAcceptedAt: consentAccepted ? null : new Date().toISOString(),
  });

  const changeProvider = (nextProvider) => {
    // The context's setter auto-fills baseUrl + model from the preset
    // when the provider changes. See SettingsContext.setAiConfig.
    onChange({ provider: nextProvider });
  };

  const saveKey = () => {
    onChange({ apiKey: keyDraft.trim() });
  };

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>AI Insights</Text>
          <Text style={styles.sectionSubtitle}>
            Optional. Sends an aggregate summary of your finances to an
            LLM (OpenAI / Groq / OpenRouter / DeepSeek / Cursor / custom) to
            surface actionable observations. Individual transactions
            are never sent.
          </Text>
        </View>
      </View>

      {/* Master toggle — a big obvious switch (chip-style so it matches
          the rest of the settings screen's look). */}
      <TouchableOpacity
        style={[
          styles.aiToggle,
          enabled && { backgroundColor: '#6366f1', borderColor: '#6366f1' },
        ]}
        activeOpacity={0.85}
        onPress={toggleEnabled}
      >
        <AppIcon
          name={enabled ? 'check' : 'x'}
          size={16}
          color={enabled ? '#fff' : themeColors.text.secondary}
          strokeWidth={2.4}
        />
        <Text style={[
          styles.aiToggleLabel,
          enabled && { color: '#fff' },
        ]}>
          {enabled ? 'AI Insights is ON' : 'AI Insights is OFF'}
        </Text>
      </TouchableOpacity>

      {enabled && (
        <>
          {/* Privacy consent — explicit acknowledgement. Regeneration
              is gated on both `enabled` AND `consentAcceptedAt` (see
              AiInsightsContext.generate). */}
          <View style={styles.aiPrivacyCard}>
            <Text style={styles.aiPrivacyTitle}>Before you continue</Text>
            <Text style={styles.aiPrivacyBody}>
              When you tap Generate, this app sends an aggregate summary
              of your finances to the AI provider you pick below:
              category totals, budget usage, goal progress, loan
              balances, and net-worth snapshots.
              {'\n\n'}
              We NEVER send individual transaction rows, account
              numbers, voice notes, or any personally identifying
              information.
              {'\n\n'}
              Your API key is stored on this device only. Deleting the
              app or clearing app data removes it.
            </Text>
            <TouchableOpacity
              style={styles.aiConsent}
              onPress={toggleConsent}
              activeOpacity={0.7}
            >
              <View style={[
                styles.aiCheckbox,
                consentAccepted && { backgroundColor: '#6366f1', borderColor: '#6366f1' },
              ]}>
                {consentAccepted && (
                  <AppIcon name="check" size={12} color="#fff" strokeWidth={3} />
                )}
              </View>
              <Text style={styles.aiConsentLabel}>
                I understand and accept the privacy tradeoff.
              </Text>
            </TouchableOpacity>
          </View>

          {/* Provider picker — horizontal chip row. */}
          <Text style={styles.aiFieldLabel}>Provider</Text>
          <View style={styles.aiProviderRow}>
            {Object.entries(AI_PROVIDER_PRESETS).map(([key, preset]) => {
              const active = provider === key;
              return (
                <TouchableOpacity
                  key={key}
                  activeOpacity={0.85}
                  onPress={() => changeProvider(key)}
                  style={[
                    styles.aiProviderChip,
                    active && { backgroundColor: '#6366f1', borderColor: '#6366f1' },
                  ]}
                >
                  <Text style={[
                    styles.aiProviderLabel,
                    active && { color: '#fff' },
                  ]}>
                    {preset.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* API key — masked with Show toggle.
              The status badge shows WHERE the key is stored so the user
              knows the encryption story at a glance (iOS Keychain /
              Android Keystore = green, web fallback = amber). */}
          <Text style={styles.aiFieldLabel}>API key</Text>
          <View style={[
            styles.aiKeyBadge,
            {
              backgroundColor: keyEncrypted ? '#059669' + '18' : '#f59e0b' + '18',
              borderColor:     keyEncrypted ? '#059669' + '55' : '#f59e0b' + '55',
            },
          ]}>
            <AppIcon
              name={keyEncrypted ? 'check' : 'alert-triangle'}
              size={12}
              color={keyEncrypted ? '#059669' : '#b45309'}
              strokeWidth={2.4}
            />
            <Text style={[
              styles.aiKeyBadgeText,
              { color: keyEncrypted ? '#065f46' : '#7c2d12' },
            ]}>
              {keyEncrypted
                ? (Platform.OS === 'ios'
                    ? 'Encrypted · iOS Keychain'
                    : Platform.OS === 'android'
                      ? 'Encrypted · Android Keystore'
                      : 'Encrypted · device secure store')
                : Platform.OS === 'web'
                  ? 'Browser storage — not encrypted'
                  : 'Not encrypted — rebuild app (expo-secure-store missing)'}
            </Text>
          </View>
          <View style={{ gap: 8, marginTop: 8 }}>
            <TextInput
              value={keyDraft}
              onChangeText={setKeyDraft}
              placeholder={currentPreset.keyHint || 'your-key'}
              placeholderTextColor="#9aa0a6"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={!keyReveal}
              style={styles.addInput}
            />
            <View style={styles.whisperButtonRow}>
              <TouchableOpacity
                onPress={() => setKeyReveal((r) => !r)}
                style={[styles.whisperBtn, styles.whisperBtnGhost]}
                activeOpacity={0.7}
              >
                <Text style={styles.whisperBtnGhostText}>
                  {keyReveal ? 'Hide' : 'Show'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={saveKey}
                style={[styles.whisperBtn, styles.whisperBtnPrimary]}
                activeOpacity={0.7}
              >
                <Text style={styles.whisperBtnPrimaryText}>Save key</Text>
              </TouchableOpacity>
              {hasKey && (
                <TouchableOpacity
                  onPress={() => onChange({ apiKey: '' })}
                  style={[styles.whisperBtn, styles.whisperBtnDanger]}
                  activeOpacity={0.7}
                >
                  <Text style={styles.whisperBtnDangerText}>Remove</Text>
                </TouchableOpacity>
              )}
            </View>
            {hasKey && (
              <Text style={styles.whisperStatusText}>
                Current: {keyMasked}
              </Text>
            )}
          </View>

          {/* Base URL + Model — editable so users can point at any
              OpenAI-compatible endpoint or pick a different model on the
              same provider. */}
          <Text style={styles.aiFieldLabel}>Base URL</Text>
          <TextInput
            value={config?.baseUrl ?? ''}
            onChangeText={(v) => onChange({ baseUrl: v.trim() })}
            placeholder="https://api.openai.com/v1"
            placeholderTextColor="#9aa0a6"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.addInput}
          />

          <Text style={styles.aiFieldLabel}>Model</Text>
          <TextInput
            value={config?.model ?? ''}
            onChangeText={(v) => onChange({ model: v.trim() })}
            placeholder={provider === 'cursor' ? 'blank = Cursor default' : 'gpt-4o-mini'}
            placeholderTextColor="#9aa0a6"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.addInput}
          />

          {currentPreset.docs && provider !== 'custom' && (
            <Text style={styles.whisperHelp}>
              {provider === 'cursor'
                ? 'Paste a Cursor Dashboard user API key (Cloud Agents). Browsers cannot call Cursor (CORS) — use Electron or Android/iOS. Insights starts a no-repo agent, then deletes it. Does not work for voice transcription.'
                : `Get a key from the provider's console. Preset default: ${currentPreset.model}`}
            </Text>
          )}

          {/* Ask-before-send toggle. When ON (the default), tapping
              Generate on the Insights screen opens a preview modal
              showing the exact JSON payload with a Cancel/Send choice.
              Users can also inspect the payload at any time via the
              "Preview data" chip on the Insights screen. */}
          <TouchableOpacity
            style={[
              styles.aiToggle,
              confirmBeforeSend && { backgroundColor: '#6366f1', borderColor: '#6366f1' },
              { marginTop: 16 },
            ]}
            activeOpacity={0.85}
            onPress={() => onChange({ confirmBeforeSend: !confirmBeforeSend })}
          >
            <AppIcon
              name={confirmBeforeSend ? 'check' : 'x'}
              size={16}
              color={confirmBeforeSend ? '#fff' : themeColors.text.secondary}
              strokeWidth={2.4}
            />
            <Text style={[
              styles.aiToggleLabel,
              confirmBeforeSend && { color: '#fff' },
            ]}>
              Preview data before every send
            </Text>
          </TouchableOpacity>
          <Text style={styles.whisperHelp}>
            {confirmBeforeSend
              ? 'You\'ll see the exact JSON summary that will be sent, with Cancel / Send buttons. Recommended.'
              : 'Generate will fire immediately without a preview. You can still inspect the payload from the Insights screen.'}
          </Text>
        </>
      )}
    </View>
  );
}

// ----------------------------------------------------------------------------
// WhisperKeySection — stores the OpenAI Whisper API key for transcribing
// voice notes on transactions.
//
// UX choices:
//   - Show as password (secureTextEntry) with a "Show" toggle so the user
//     can verify what they pasted.
//   - Save on tap (not on every keystroke) so partial pastes don't clobber
//     the previous good key.
//   - Show a masked preview when a key is already set so the user knows
//     the app is configured without leaking the full secret on screen.
// ----------------------------------------------------------------------------
export function WhisperKeySection({ apiKey, onSave, keyEncrypted }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const [draft, setDraft] = useState('');
  const [reveal, setReveal] = useState(false);
  const [editing, setEditing] = useState(false);

  const hasKey = !!apiKey;
  const masked = hasKey
    ? `${apiKey.slice(0, 5)}…${apiKey.slice(-4)}`
    : '';

  const startEdit = () => {
    setDraft(apiKey || '');
    setEditing(true);
  };

  const cancel = () => {
    setDraft('');
    setEditing(false);
    setReveal(false);
  };

  const save = async () => {
    await onSave(draft);
    setEditing(false);
    setReveal(false);
  };

  const clear = () => {
    Alert.alert('Remove API key?', 'Voice transcription will stop working.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await onSave('');
          setDraft('');
          setEditing(false);
        },
      },
    ]);
  };

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>Voice Transcription</Text>
          <Text style={styles.sectionSubtitle}>
            Optional. Uses OpenAI Whisper to auto-fill the note field from your
            voice recording. Costs ~$0.006 / minute of audio.
          </Text>
        </View>
      </View>

      {!editing ? (
        <View>
          <View style={styles.whisperStatusRow}>
            <View style={styles.whisperStatusIcon}>
              <AppIcon
                name={hasKey ? 'check' : 'settings'}
                size={14}
                color={hasKey ? '#059669' : themeColors.text.secondary}
                strokeWidth={2.2}
              />
            </View>
            <Text style={styles.whisperStatusText}>
              {hasKey ? `Key set: ${masked}` : 'Not configured'}
            </Text>
          </View>
          <View style={styles.whisperButtonRow}>
            <TouchableOpacity
              onPress={startEdit}
              style={[styles.whisperBtn, styles.whisperBtnPrimary]}
              activeOpacity={0.7}
            >
              <Text style={styles.whisperBtnPrimaryText}>
                {hasKey ? 'Change key' : 'Add API key'}
              </Text>
            </TouchableOpacity>
            {hasKey && (
              <TouchableOpacity
                onPress={clear}
                style={[styles.whisperBtn, styles.whisperBtnDanger]}
                activeOpacity={0.7}
              >
                <Text style={styles.whisperBtnDangerText}>Remove</Text>
              </TouchableOpacity>
            )}
          </View>
          {!hasKey && (
            <Text style={styles.whisperHelp}>
              Get a key at platform.openai.com → API keys. It starts with{' '}
              <Text style={{ fontFamily: 'monospace' }}>sk-</Text>.
            </Text>
          )}
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {/* Same encryption badge as the AI Insights key section — this key
              can rack up charges on whoever holds the device, so it belongs
              in the Keychain/Keystore, never plaintext. */}
          <View style={[
            styles.aiKeyBadge,
            {
              backgroundColor: keyEncrypted ? '#059669' + '18' : '#f59e0b' + '18',
              borderColor:     keyEncrypted ? '#059669' + '55' : '#f59e0b' + '55',
            },
          ]}>
            <AppIcon
              name={keyEncrypted ? 'check' : 'alert-triangle'}
              size={12}
              color={keyEncrypted ? '#059669' : '#b45309'}
              strokeWidth={2.4}
            />
            <Text style={[
              styles.aiKeyBadgeText,
              { color: keyEncrypted ? '#065f46' : '#7c2d12' },
            ]}>
              {keyEncrypted
                ? (Platform.OS === 'ios'
                    ? 'Encrypted · iOS Keychain'
                    : Platform.OS === 'android'
                      ? 'Encrypted · Android Keystore'
                      : 'Encrypted · device secure store')
                : Platform.OS === 'web'
                  ? 'Browser storage — not encrypted'
                  : 'Not encrypted — rebuild app (expo-secure-store missing)'}
            </Text>
          </View>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="sk-..."
            placeholderTextColor="#9aa0a6"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={!reveal}
            style={styles.addInput}
          />
          <View style={styles.whisperButtonRow}>
            <TouchableOpacity
              onPress={() => setReveal((r) => !r)}
              style={[styles.whisperBtn, styles.whisperBtnGhost]}
              activeOpacity={0.7}
            >
              <Text style={styles.whisperBtnGhostText}>
                {reveal ? 'Hide' : 'Show'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={cancel}
              style={[styles.whisperBtn, styles.whisperBtnGhost]}
              activeOpacity={0.7}
            >
              <Text style={styles.whisperBtnGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={save}
              style={[styles.whisperBtn, styles.whisperBtnPrimary]}
              activeOpacity={0.7}
              disabled={!draft.trim()}
            >
              <Text style={styles.whisperBtnPrimaryText}>Save</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.whisperHelp}>
            {keyEncrypted
              ? 'Stored in your device’s secure keychain, not in the app’s regular data.'
              : 'Your browser has no secure keychain, so this is stored in ordinary browser storage.'}
          </Text>
        </View>
      )}
    </View>
  );
}

// ----------------------------------------------------------------------------
// (removed in v4) AccountsSection + GroupCard used to live here,
// rendering the two-level [Group → Accounts] UI inline in Settings.
// Both moved into screens/AccountsScreen.js. The Settings surface
// now shows a compact hub card that pushes into the dedicated screen.
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// CurrencySection — F9 Tier 2 UI:
//   * Base currency selector (the currency every aggregate reports in).
//   * FX rate table (manual entry). Rows the app has ever seen used as a
//     transaction / account / asset currency need a rate; a missing one
//     just means base-currency identity (rate 1.0).
//
// Behaviour notes:
//   * Base changes never rewrite historical `*InBase` snapshots. Rows
//     stay at whatever they were frozen at; only new rows use the new
//     base going forward. A soft explainer surfaces this.
//   * Rate updates likewise don't retroactively affect past rows.
//   * The base-currency row is not editable (it's always 1:1 with itself).
// ----------------------------------------------------------------------------
export function CurrencySection({
  baseCurrency,
  fxRates,
  onChangeBase,
  onSetRate,
  onDeleteRate,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const [addingCode, setAddingCode] = useState(null); // e.g. 'USD'
  const [addingRate, setAddingRate] = useState('');

  // The base can't change under existing entries (see isBaseCurrencyLocked).
  const { expenses: ledgerExpenses, income: ledgerIncome, investments: ledgerInvestments } = useTransactions();
  const { transfers: ledgerTransfers } = useTransfers();
  const { loans: ledgerLoans } = useLoans();
  const baseIsLocked = isBaseCurrencyLocked({
    expenses: ledgerExpenses,
    income: ledgerIncome,
    investments: ledgerInvestments,
    transfers: ledgerTransfers,
    loans: ledgerLoans,
  });

  const sortedRateRows = Object.entries(fxRates ?? {})
    .filter(([code]) => code !== baseCurrency)
    .sort(([a], [b]) => a.localeCompare(b));

  // Currencies not yet in the rate table (candidates for "Add rate").
  const availableToAdd = CURRENCIES
    .map((c) => c.code)
    .filter((code) => code !== baseCurrency && !(code in (fxRates ?? {})));

  const baseMeta = currencyMeta(baseCurrency);

  const commitRate = () => {
    if (!addingCode) return;
    const res = onSetRate?.(addingCode, addingRate);
    if (res?.ok) {
      setAddingCode(null);
      setAddingRate('');
    } else {
      Alert.alert(
        'Invalid rate',
        'Enter a positive number. E.g. for USD → INR, use 88.4.',
      );
    }
  };

  return (
    <View style={styles.section}>
      {/* Compact header: the multi-line explainer + FX-behaviour warning
          that used to sit here moved into the InfoChip so the section's
          resting state is a single-line title. The destructive base-
          change and delete-rate paths still surface their own
          confirmation Alerts before touching data. */}
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Currency</Text>
        <InfoChip
          title="About Currency"
          body={
            'BASE CURRENCY\n'
            + 'Every dashboard total, chart, and report is expressed in this. Foreign-currency rows keep their native amount too — you\'ll see both on the row.\n\n'
            + 'The base can only be changed while you have no transactions, transfers or loans: every saved total is stored in it, so switching later would relabel your amounts rather than convert them. To switch, back up, reset, then set the new base before adding entries.\n\n'
            + 'FX RATES\n'
            + 'Set the current exchange rate for each foreign currency you use. These prefill the rate field when you add a transaction or foreign account.\n\n'
            + 'Updating a rate here does NOT retroactively re-value existing rows (their per-row rate is frozen at add time — matches how bank statements behave).'
          }
        />
      </View>

      {/* ---- Base currency picker ---- */}
      <Text style={styles.pickerLabel}>Base currency</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.currencyRow}
      >
        {CURRENCIES.map((c) => {
          const selected = baseCurrency === c.code;
          return (
            <TouchableOpacity
              key={c.code}
              onPress={() => {
                if (selected) return;
                if (baseIsLocked) {
                  Alert.alert(
                    'Base currency is locked',
                    `Your entries are saved in ${baseCurrency}, and every total is added up in it. Switching to ${c.code} now would relabel those amounts instead of converting them.

To change it: back up your data, reset in Settings → Advanced, then set the new base currency before adding entries.`,
                  );
                  return;
                }
                Alert.alert(
                  'Change base currency?',
                  `New totals and entries will use ${c.code}.`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: `Use ${c.code}`, onPress: () => onChangeBase?.(c.code) },
                  ],
                );
              }}
              style={[styles.currencyChip, selected && styles.currencyChipActive]}
              activeOpacity={0.7}
            >
              <Text style={[styles.currencyChipCode, selected && styles.currencyChipCodeActive]}>
                {c.code}
              </Text>
              <Text style={styles.currencyChipSymbol}>{c.symbol}</Text>
              {selected ? <StatusBadge label="Base" tone="info" icon="check" /> : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ---- FX rate table ----
          Standalone help paragraph removed (moved to InfoChip above).
          The section header ⓘ covers both base-currency and FX-rate
          semantics in one place, so users looking for context find it
          predictably at the top. */}
      <Text style={[styles.pickerLabel, { marginTop: 16 }]}>
        FX rates (1 unit → {baseCurrency})
      </Text>

      {sortedRateRows.length === 0 && (
        <InfoCallout
          icon="repeat"
          title="No foreign rates"
          body="Add only the currencies you use."
          compact
        />
      )}

      {sortedRateRows.map(([code, row]) => {
        const meta = currencyMeta(code);
        return (
          <View key={code} style={styles.fxRow}>
            <Text style={styles.fxCode}>{code}</Text>
            <Text style={styles.fxSymbol}>{meta.symbol}</Text>
            <Text style={styles.fxRate}>
              1 = {baseMeta.symbol} {Number(row.rate).toLocaleString('en-IN', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 4,
              })}
            </Text>
            <TouchableOpacity
              hitSlop={8}
              onPress={() => {
                setAddingCode(code);
                setAddingRate(String(row.rate));
              }}
              style={styles.itemEdit}
            >
              <AppIcon name="edit-3" size={13} color={themeColors.text.secondary} strokeWidth={2} />
            </TouchableOpacity>
            <TouchableOpacity
              hitSlop={8}
              onPress={() =>
                Alert.alert(
                  `Delete ${code} rate?`,
                  `Existing ${code} entries stay unchanged. New entries will need a rate.`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => onDeleteRate?.(code) },
                  ],
                )
              }
              style={styles.itemDelete}
            >
              <AppIcon name="x" size={13} color={themeColors.text.secondary} strokeWidth={2.2} />
            </TouchableOpacity>
          </View>
        );
      })}

      {addingCode && (
        <View style={styles.fxAddCard}>
          <Text style={styles.fxAddTitle}>
            {addingCode} → {baseCurrency}
          </Text>
          <View style={styles.fxEquationRow}>
            <Text style={styles.fxEquationText}>1 {addingCode} =</Text>
            <TextInput
              style={[styles.addInput, styles.fxEquationInput]}
              keyboardType="decimal-pad"
              value={addingRate}
              onChangeText={setAddingRate}
              placeholder="88.40"
              placeholderTextColor="#9aa0a6"
              autoFocus
            />
            <Text style={styles.fxEquationText}>{baseCurrency}</Text>
          </View>
          <View style={styles.formButtonsRow}>
            <TouchableOpacity
              onPress={() => { setAddingCode(null); setAddingRate(''); }}
              style={[styles.formBtn, styles.formBtnCancel]}
              activeOpacity={0.7}
            >
              <Text style={styles.formBtnCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={commitRate}
              style={[styles.formBtn, styles.formBtnAdd]}
              activeOpacity={0.7}
            >
              <Text style={styles.formBtnAddText}>Save rate</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {!addingCode && availableToAdd.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.currencyRow}
        >
          {availableToAdd.map((code) => (
            <TouchableOpacity
              key={code}
              onPress={() => { setAddingCode(code); setAddingRate(''); }}
              style={styles.currencyChip}
              activeOpacity={0.7}
            >
              <Text style={styles.currencyChipCode}>+ {code}</Text>
              <Text style={styles.currencyChipSymbol}>
                {currencyMeta(code).symbol}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

// ----------------------------------------------------------------------------
// (removed in v4 polish pass) All of these lived inline in Settings and
// have been extracted into dedicated screens:
//
//   * function Section({ ... })         // one per category type
//   * function CategoryRow({ ... })     // sub-category expand-inline
//     → moved to screens/CategoriesScreen.js
//
//   * function AccountsSection({ ... }) // container + add-group form
//   * function GroupCard({ ... })       // per-group card + account rows
//     → moved to screens/AccountsScreen.js
//
//   * function AddForm({ ... })         // shared name / emoji / color /
//                                       // currency form
//     → now inlined as a self-contained EditorForm inside each
//       dedicated screen. Kept independent per screen so the two can
//       evolve without stepping on each other (e.g. Accounts editor
//       has the currency chip row; Categories editor doesn't).
//
// The Settings surface now shows a compact hub card for each and
// pushes into the dedicated screen. See the JSX above for the
// catHub / acctHub cards.
// ----------------------------------------------------------------------------

const makeStyles = (c) => ({
  root: { flex: 1, backgroundColor: c.bg.canvas },
  container: { padding: spacing.lg, paddingBottom: 60 },
  pageHint: {
    fontSize: 12,
    color: c.text.secondary,
    marginBottom: 20,
    lineHeight: 18,
  },
  settingsHelpRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  settingsHelpLabel: { color: c.text.secondary, fontSize: 13, fontWeight: '700' },

  // Group header — the little "YOUR DATA", "INTELLIGENCE", ...
  // uppercase caption above each chapter of the Settings screen. Mirrors
  // iOS-style settings list section headers: small, muted, tracked-out,
  // sits just above the first card of its group. Deliberately quiet so
  // the section cards themselves stay the visual focus.
  //
  // Top margin gives breathing room above every header EXCEPT the
  // first (whose parent's pageHint already has `marginBottom: 20`).
  // The two spacings compose to ~28 dp of air between the intro copy
  // and the very first group header — matches what native settings
  // apps do without needing a per-first-child override.
  groupHeader: {
    fontSize: 11,
    fontWeight: '800',
    color: c.text.muted,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: 4,
    marginBottom: 12,
    paddingLeft: 4,
  },

  section: {
    backgroundColor: c.bg.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: c.text.primary },
  sectionSubtitle: { fontSize: 12, color: c.text.secondary, marginTop: 2 },
  // Small ⓘ button rendered inside a section header. Compact tap
  // target with a subtle backing so it reads as "extra info here"
  // without competing with the section title.
  infoChip: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: c.bg.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  // Titles-only row: same shape as sectionHeader but reserves the
  // trailing space for an InfoChip so it doesn't wrap onto its own
  // row on narrow screens.
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  resetLink: {
    fontSize: 12,
    color: '#2563eb',
    fontWeight: '600',
    paddingHorizontal: 8,
  },
  sectionBody: { gap: 8 },

  // ---- Categories hub card ----
  // The single-row card that replaced the three inline category
  // sections. Modeled on the ToolsMenu / MoreMenu card pattern
  // (tinted icon badge on the left, chevron on the right) so it
  // reads as "tap to open a screen" without needing text like
  // "manage" — the shape does the talking.
  catHub: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bg.surface,
    borderRadius: 16,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: c.border.subtle,
    gap: 12,
  },
  catHubIcon: {
    width: 44, height: 44,
    borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  catHubBody:  { flex: 1 },
  catHubTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: c.text.primary,
    marginBottom: 6,
  },
  catHubCountRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  catHubCountPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: c.bg.surfaceAlt,
  },
  catHubDot: { width: 6, height: 6, borderRadius: 3 },
  catHubCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: c.text.secondary,
    letterSpacing: 0.2,
  },
  catHubHint: {
    fontSize: 12,
    color: c.text.muted,
    lineHeight: 16,
  },

  // ---- Accounts hub card ----
  // Same visual grammar as catHub above so both cards read as siblings
  // in Settings — the icon + title + count-pill row + hint copy structure
  // is identical, only the tint (sky-blue) and iconography (wallet)
  // change.
  acctHub: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bg.surface,
    borderRadius: 16,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: c.border.subtle,
    gap: 12,
  },
  acctHubIcon: {
    width: 44, height: 44,
    borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  acctHubBody:  { flex: 1 },
  acctHubTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: c.text.primary,
    marginBottom: 6,
  },
  acctHubCountRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  acctHubCountPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: c.bg.surfaceAlt,
  },
  acctHubCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: c.text.secondary,
    letterSpacing: 0.2,
  },
  acctHubHint: {
    fontSize: 12,
    color: c.text.muted,
    lineHeight: 16,
  },

  emptyRow: {
    fontSize: 12,
    color: c.text.muted,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 8,
  },
  emptyGroupHint: {
    fontSize: 12,
    color: c.text.secondary,
    textAlign: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    backgroundColor: c.bg.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderStyle: 'dashed',
  },

  // ---- Group card ----
  groupCard: {
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderWidth: 1,
    borderColor: c.border.subtle,
    gap: 8,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  groupTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: c.text.primary },
  groupDeleteBtn: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#fee2e2',
    alignItems: 'center', justifyContent: 'center',
  },
  groupDeleteText: { color: '#b91c1c', fontSize: 12, fontWeight: '700' },
  groupEditBtn: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#dbeafe',
    alignItems: 'center', justifyContent: 'center',
    marginRight: 6,
  },
  groupEditText: { color: '#1d4ed8', fontSize: 12, fontWeight: '700' },

  // ---- Item row (used for both accounts and categories) ----
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bg.surface,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  itemDot: {
    width: 8, height: 8, borderRadius: 4, marginRight: 10,
  },
  itemEmoji: { fontSize: 18, marginRight: 8 },
  itemLabel: { flex: 1, fontSize: 14, color: c.text.primary, fontWeight: '500' },
  itemDelete: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: c.bg.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  itemDeleteText: { color: c.text.secondary, fontSize: 12, fontWeight: '700' },
  itemEdit: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#dbeafe',
    alignItems: 'center', justifyContent: 'center',
    marginRight: 6,
  },
  itemEditText: { color: '#1d4ed8', fontSize: 12, fontWeight: '700' },

  addButton: {
    borderRadius: 10,
    paddingVertical: 10,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
  },
  addButtonText: { color: '#2563eb', fontWeight: '700', fontSize: 13 },
  addGroupButton: { marginTop: 4 },

  addAccountButton: {
    borderRadius: 10,
    paddingVertical: 8,
    backgroundColor: c.bg.surface,
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#c7d2fe',
  },
  addAccountButtonText: { color: '#2563eb', fontWeight: '600', fontSize: 12 },

  // Currency (F9 Tier 2) --------------------------------------------------
  currencyBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#eef2ff',
    marginRight: 6,
  },
  currencyBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#3730a3',
    letterSpacing: 0.4,
  },
  fxEquationRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fxEquationInput: { flex: 1, marginBottom: 0, textAlign: 'center' },
  fxEquationText: { color: c.text.primary, fontSize: 13, fontWeight: '800' },
  currencyRow: {
    gap: 6,
    paddingVertical: 4,
    paddingRight: 8,
  },
  currencyChip: {
    minWidth: 62,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.border.subtle,
    backgroundColor: c.bg.surfaceAlt,
    alignItems: 'center',
  },
  currencyChipActive: {
    borderColor: '#2563eb',
    backgroundColor: '#dbeafe',
  },
  currencyChipCode: {
    fontSize: 11,
    fontWeight: '700',
    color: c.text.secondary,
    letterSpacing: 0.4,
  },
  currencyChipCodeActive: {
    color: '#1e40af',
  },
  currencyChipSymbol: {
    fontSize: 12,
    color: c.text.secondary,
    marginTop: 2,
  },
  fxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border.subtle,
  },
  fxCode: {
    fontSize: 13,
    fontWeight: '700',
    color: c.text.primary,
    width: 44,
  },
  fxSymbol: {
    fontSize: 13,
    color: c.text.secondary,
    width: 30,
  },
  fxRate: {
    flex: 1,
    fontSize: 13,
    color: c.text.secondary,
    fontVariant: ['tabular-nums'],
  },
  fxAddCard: {
    marginTop: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#c7d2fe',
    backgroundColor: '#eff6ff',
  },
  fxAddTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1e40af',
    marginBottom: 4,
  },

  // ---- Sub-category nested list under an expanded category row ----
  subCountBadge: {
    fontSize: 11,
    color: c.text.secondary,
    fontWeight: '700',
    textAlign: 'right',
  },
  subCountBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginRight: 8,
  },
  subList: {
    marginLeft: 20,
    marginTop: -2,
    marginBottom: 6,
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderLeftColor: c.border.subtle,
    gap: 6,
    paddingVertical: 6,
  },
  subEmpty: {
    fontSize: 11,
    color: c.text.muted,
    fontStyle: 'italic',
    paddingVertical: 4,
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  subDot: { width: 6, height: 6, borderRadius: 3, marginRight: 8 },
  subEmoji: { fontSize: 15, marginRight: 6 },
  subLabel: { flex: 1, fontSize: 13, color: c.text.primary, fontWeight: '500' },
  subDelete: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: c.bg.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  subEdit: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#dbeafe',
    alignItems: 'center', justifyContent: 'center',
    marginRight: 6,
  },
  addSubButton: {
    borderRadius: 8,
    paddingVertical: 6,
    backgroundColor: c.bg.surface,
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#c7d2fe',
  },
  addSubButtonText: { color: '#2563eb', fontWeight: '600', fontSize: 11 },

  exportBtn: {
    backgroundColor: c.bg.hero,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  exportBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' },
  exportBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  backupButtonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  backupBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backupBtnPrimary: {
    backgroundColor: '#2563eb',
  },
  backupBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' },
  backupBtnPrimaryText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  backupBtnGhost: {
    backgroundColor: c.bg.surface,
    borderWidth: 1,
    borderColor: '#c7d2fe',
  },
  backupBtnGhostText: {
    color: '#2563eb',
    fontWeight: '700',
    fontSize: 13,
  },
  backupLastHint: {
    marginTop: 10,
    fontSize: 12,
    color: c.text.secondary,
    lineHeight: 16,
  },
  backupHelp: {
    fontSize: 11,
    color: c.text.secondary,
    marginTop: 8,
    lineHeight: 15,
  },
  // BK-L3: styled callout so the "not included" list can't get lost.
  backupHelpWarnRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 6,
  },
  backupHelpWarn: {
    fontSize: 11,
    color: '#b45309',
    fontWeight: '600',
    lineHeight: 15,
    flexShrink: 1,
  },

  // Voice notes storage (B6.6)
  sectionHelp: {
    fontSize: 12,
    color: c.text.secondary,
    marginTop: 2,
    marginBottom: 10,
    lineHeight: 16,
  },
  voiceUsageCard: {
    backgroundColor: c.bg.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 4,
    marginBottom: 10,
  },
  voiceUsageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  voiceUsageLabel: { fontSize: 13, color: c.text.secondary },
  voiceUsageValue: { fontSize: 13, fontWeight: '700', color: c.text.primary },
  voiceButtonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  voiceBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  voiceBtnGhost: {
    borderWidth: 1,
    borderColor: c.border.strong,
    backgroundColor: c.bg.surface,
  },
  voiceBtnGhostText: { fontSize: 13, fontWeight: '700', color: c.text.secondary },
  voiceBtnDisabled: { opacity: 0.5 },

  // Theme picker chips (Appearance section)
  themeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  themeChip: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: c.border.subtle,
    backgroundColor: c.bg.surfaceAlt,
    alignItems: 'center',
  },
  themeChipInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  themeChipActive: {
    borderColor: '#2563eb',
    backgroundColor: '#eff6ff',
  },
  themeChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: c.text.secondary,
  },
  themeChipTextActive: {
    color: '#1d4ed8',
  },

  // Font picker chips (Look & feel → Font) — compact wrap, like theme chips
  fontRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  fontChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: c.border.subtle,
    backgroundColor: c.bg.surfaceAlt,
  },
  fontChipActive: {
    borderColor: '#2563eb',
    backgroundColor: '#eff6ff',
  },
  fontChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: c.text.secondary,
  },
  fontChipTextActive: {
    color: '#1d4ed8',
  },

  addForm: {
    backgroundColor: c.bg.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: c.border.subtle,
    gap: 10,
  },
  addFormRow: { flexDirection: 'row', gap: 8 },
  addInput: {
    backgroundColor: c.bg.surface,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: c.text.primary,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  emojiInput: {
    width: 60,
    textAlign: 'center',
    fontSize: 20,
  },
  pickerLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: c.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  colorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  colorSwatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorSwatchSelected: {
    borderColor: c.text.primary,
  },
  formButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  formBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  formBtnCancel: { backgroundColor: c.bg.surfaceAlt },
  formBtnCancelText: { color: c.text.secondary, fontWeight: '600' },
  formBtnAdd: { backgroundColor: '#2563eb' },
  formBtnAddText: { color: '#fff', fontWeight: '700' },

  whisperStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  whisperStatusIcon: { marginRight: 4 },
  whisperStatusText: {
    fontSize: 13,
    color: c.text.secondary,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  whisperButtonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  whisperBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  whisperBtnPrimary: { backgroundColor: '#2563eb' },
  whisperBtnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  whisperBtnGhost: {
    backgroundColor: c.bg.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  whisperBtnGhostText: { color: c.text.secondary, fontWeight: '600', fontSize: 13 },
  whisperBtnDanger: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  whisperBtnDangerText: { color: '#dc2626', fontWeight: '600', fontSize: 13 },
  whisperHelp: {
    fontSize: 11,
    color: c.text.secondary,
    marginTop: 8,
    lineHeight: 15,
  },

  // ---- AI Insights section --------------------------------------------
  //
  // Own scale for chip / toggle sizing so it reads a touch more
  // prominent than the surrounding sections — AI is a headline feature
  // and merits the extra visual weight.
  aiToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border.subtle,
    backgroundColor: c.bg.surfaceAlt,
    marginTop: 8,
  },
  aiToggleLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: c.text.primary,
  },
  aiPrivacyCard: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#6366f1' + '33',
    backgroundColor: '#6366f1' + '10',
  },
  aiPrivacyTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: c.text.primary,
    marginBottom: 6,
  },
  aiPrivacyBody: {
    fontSize: 12,
    color: c.text.secondary,
    lineHeight: 17,
  },
  aiConsent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  aiCheckbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: c.border.strong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.bg.surface,
  },
  aiConsentLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: c.text.primary,
    flex: 1,
  },
  aiFieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: c.text.secondary,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    marginTop: 14,
    marginBottom: 6,
  },
  aiProviderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  aiProviderChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.border.subtle,
    backgroundColor: c.bg.surfaceAlt,
  },
  aiProviderLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: c.text.secondary,
  },
  // Small pill sitting right above the API-key input showing where
  // the key gets stored. Green when the platform offers real
  // encryption (iOS Keychain / Android Keystore); amber on web
  // (localStorage fallback — not actually encrypted).
  aiKeyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  aiKeyBadgeText: { fontSize: 11, fontWeight: '700' },

  // Danger zone (Reset everything). Red border + soft red fill so it
  // stands out at the bottom of the screen without shouting.
  dangerSection: {
    borderColor: '#fecaca',
    backgroundColor: '#fff5f5',
  },
  dangerTitle: {
    color: '#b91c1c',
  },
  dangerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#dc2626',
    backgroundColor: c.bg.surface,
    marginTop: 8,
  },
  dangerBtnIconWrap: { width: 28, alignItems: 'center' },
  dangerBtnTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#dc2626',
  },
  dangerBtnSub: {
    fontSize: 12,
    color: '#7f1d1d',
    marginTop: 2,
    lineHeight: 16,
  },

  // "Try the app" — soft green accent so it feels inviting (vs. red for
  // Danger zone). The destructive confirm dialog handles the warning
  // that this replaces existing data.
  demoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#10b981',
    backgroundColor: '#ecfdf5',
    marginTop: 8,
  },
  demoBtnIconWrap: { width: 28, alignItems: 'center' },
  demoBtnTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#047857',
  },
  demoBtnSub: {
    fontSize: 12,
    color: '#065f46',
    marginTop: 2,
    lineHeight: 16,
  },
});
