// ----------------------------------------------------------------------------
// DEFAULT app data. These are only used the very first time the app runs
// (before the user has customized anything). After that, the SettingsContext
// takes over — it reads user's categories/accounts from AsyncStorage and
// only falls back here if storage is empty.
//
// Renamed to DEFAULT_* to make it explicit that these are seed values,
// not the source of truth at runtime.
// ----------------------------------------------------------------------------

/** Home-screen / window title — plain label, not a product codename. */
export const APP_DISPLAY_NAME = 'MoneyPilot';

export const STORAGE_KEYS = {
  // Transaction lists
  expenses:    '@financeApp/expenses/v1',
  income:      '@financeApp/income/v1',
  investments: '@financeApp/investments/v1',

  // User settings (categories + accounts)
  settings_categories_expense:    '@financeApp/settings/categories/expense/v1',
  settings_categories_income:     '@financeApp/settings/categories/income/v1',
  settings_categories_investment: '@financeApp/settings/categories/investment/v1',
  settings_accounts:              '@financeApp/settings/accounts/v1',
  settings_account_groups:        '@financeApp/settings/account_groups/v1',

  // Portfolio holdings imported from broker CSVs
  portfolio_holdings:             '@financeApp/portfolio/holdings/v1',
  portfolio_prices_updated_at:    '@financeApp/portfolio/pricesUpdatedAt/v1',

  // Last successful Backup export (ISO). Device-local nag only — not
  // required inside the backup JSON itself.
  last_backup_at:                 '@financeApp/backup/lastAt/v1',
  setup_checklist_dismissed:      '@financeApp/onboarding/setupDismissed/v1',
  setup_currency_confirmed:       '@financeApp/onboarding/currencyConfirmed/v1',
  guided_onboarding_step:         '@financeApp/onboarding/guidedStep/v1',
  welcome_screen_seen:            '@financeApp/onboarding/welcomeSeen/v1',
  ui_collapsible_sections:        '@financeApp/ui/collapsibleSections/v1',
  dashboard_layout:               '@financeApp/ui/dashboardLayout/v1',

  // Net worth: what you own (assets) and what you owe (liabilities)
  assets:                         '@financeApp/networth/assets/v1',
  liabilities:                    '@financeApp/networth/liabilities/v1',
  // Rolling per-day net-worth snapshots — feeds NetWorthChart. Managed
  // via lib/netWorthHistory.js. Capped and dedup'd by day.
  networth_history:               '@financeApp/networth/history/v1',
  // Portfolio holdings the user removed from the balance sheet (still in Portfolio).
  portfolio_sync_hidden_symbols:  '@financeApp/networth/portfolioHidden/v1',

  // Legacy plaintext location for the Whisper (voice-note transcription)
  // API key. Superseded by whisper_api_key_secret below — kept only as a
  // one-shot migration source. See SettingsContext load path.
  settings_whisper_api_key:       '@financeApp/settings/whisperApiKey/v1',

  // SecureStore key holding the Whisper API key. Same reasoning as
  // ai_api_key_secret above — a separate SecureStore-only key so the
  // value never touches AsyncStorage. Value: raw API key string.
  whisper_api_key_secret:         '@financeApp/secrets/whisperApiKey/v1',

  // Recurring transaction rules (subscriptions, salary, SIPs, ...).
  recurring_rules:                '@financeApp/recurring/rules/v1',

  // Budgets: per-category (or overall) spending limits per period.
  budgets:                        '@financeApp/budgets/v1',

  // Transfers: balance-sheet movements (lend/borrow/repay/loan-repay) that
  // shouldn't count as income or expense but DO create/adjust NetWorth items.
  transfers:                      '@financeApp/transfers/v1',

  // Loans: first-class formal loans (home / car / personal / education /
  // credit-card / informal) with principal + rate + tenure + EMI + an
  // append-only event ledger. Distinct from NetWorth.liabilities (which
  // stays around for hand-entered non-loan liabilities) — every loan
  // auto-creates a mirror liability so Net Worth stays consistent.
  loans:                          '@financeApp/loans/v1',
  // User-created loan types (beyond the built-in LOAN_KINDS list).
  loan_kinds:                     '@financeApp/loans/customKinds/v1',

  // Theme preference: 'light' | 'dark' | 'system'.
  theme:                          '@financeApp/theme/v1',

  // App font preference: id from lib/fonts.js FONT_OPTIONS (e.g. 'system',
  // 'dm-sans', 'nunito'). Persisted separately from theme so either can
  // change without rewriting the other key.
  font:                           '@financeApp/font/v1',

  // Multi-currency (F9 Tier 2):
  //   base_currency — the ISO 4217 code we aggregate every row into
  //                   (default 'INR'). Users can switch it from Settings
  //                   at any time; existing rows keep their snapshotted
  //                   *InBase values because per-row conversion is frozen
  //                   at add time.
  //   fx_rates      — manual FX rate table:
  //                   { USD: { rate: 88.40, updatedAt: ISO, note }, ... }
  //                   All rates express "1 unit foreign in base".
  base_currency:                  '@financeApp/currency/base/v1',
  fx_rates:                       '@financeApp/currency/fxRates/v1',

  // Jeweller's own 22K ₹/g, typed by the user. When set it replaces the
  // COMEX-derived gold reference for today's valuations. { rate22k, updatedAt }
  manual_gold_rate:               '@financeApp/metals/manualGoldRate/v1',

  // Broker auto-suggestion memory: which broker was last used per
  // investment sub-category. Shape: { [subCategoryId]: brokerId }.
  // Populated on Add/Edit of an investment transaction that has both
  // a subCategoryId and a brokerId; consumed by TransactionForm to
  // pre-fill the broker picker when the user later picks the same
  // sub-category again. Never overwrites a broker the user has
  // already chosen on the current row.
  broker_defaults_by_subcategory: '@financeApp/settings/brokerDefaultsBySubCategory/v1',

  // User-managed broker list (Zerodha, Groww, custom ones the user adds
  // themselves, ...). Persisted separately from `BROKERS` in constants.js
  // — that constant is only the SEED for first-launch and the "reset to
  // defaults" action. On first launch the seed is copied into this key
  // with `builtIn: true` marks; user edits (add/delete/rename) write
  // back here. See SettingsContext + screens/BrokersScreen.js.
  brokers:                        '@financeApp/settings/brokers/v1',

  // Savings / spending goals (target amount + optional deadline + linked
  // NetWorth items so progress is auto-computed).
  goals:                          '@financeApp/goals/v1',

  // Insurance policies — premium, renewal, optional recurring link.
  insurance_policies:             '@financeApp/insurance/policies/v1',
  sip_scenarios:                  '@financeApp/calculators/sipScenarios/v1',
  swp_scenarios:                  '@financeApp/calculators/swpScenarios/v1',

  // Target allocation % per investment category (portfolio balancing).
  allocation_targets:             '@financeApp/investments/allocationTargets/v1',

  // One-time migration flags — a JSON array of ids for migrations we've
  // already applied on this device. Grows over time; existing entries are
  // never re-run. See SettingsContext for the migration runner.
  settings_migrations:            '@financeApp/settings/migrations/v1',

  // AI Insights configuration. Blob shape:
  //   { enabled, provider, baseUrl, model, consentAcceptedAt,
  //     confirmBeforeSend }
  // Stored as a single JSON blob so updates are atomic (no risk of
  // half-migrated state between fields when the user switches
  // providers).
  //
  // NOTE — `apiKey` is DELIBERATELY absent from this blob. The API key
  // is stored separately via lib/secureKeyStore.js (iOS Keychain /
  // Android Keystore-backed EncryptedSharedPreferences), NOT in
  // AsyncStorage. Anything that touches the key must go through the
  // secure store — see SettingsContext.setAiConfig({ apiKey }).
  //
  // Legacy: older versions of this app DID store `apiKey` in this blob
  // as plaintext. On first load we migrate the plaintext value out to
  // SecureStore and blank the field in the AsyncStorage blob. See
  // SettingsContext load path.
  settings_ai_config:             '@financeApp/settings/aiConfig/v1',

  // SecureStore key holding the AI API key. Kept in a separate key
  // (not part of settings_ai_config) because SecureStore is on the
  // device keychain, not AsyncStorage. Value: raw API key string.
  ai_api_key_secret:              '@financeApp/secrets/aiApiKey/v1',

  // Last generated insights bundle + generatedAt timestamp. Cached so
  // reopening the Insights screen shows the last set without hammering
  // the LLM (regeneration costs real money / tokens). Shape:
  //   { insights: [...], generatedAt: ISO, provider, model }
  ai_insights_cache:              '@financeApp/ai/insightsCache/v1',

  // Plan tier ('free' | 'pro'). Missing means Free. Written by billing once
  // store purchases are wired up; see contexts/EntitlementContext.js.
  entitlement_plan:               '@financeApp/entitlements/plan/v1',

  // Weekly usage counters for soft plan limits. Shape:
  //   { week: 'YYYY-Www', counts: { imports, calculators } }
  // Counts from an older week are discarded (lib/entitlements.js).
  entitlement_usage:              '@financeApp/entitlements/usage/v1',

  // Google Sign-In session blob (user profile + token metadata). Stored in
  // SecureStore via lib/secureKeyStore — not AsyncStorage.
  auth_session_secret:            '@financeApp/secrets/authSession/v1',
};

// ---------------------------------------------------------------------------
// AI provider presets — one entry per OpenAI-compatible endpoint we ship
// as a one-tap default. Every entry gives us base URL + a good default
// model + a hint for the API-key field so users don't have to Google
// where to get one. Users can still edit any field after picking a preset
// (or pick 'custom' and enter their own endpoint entirely).
//
// Why OpenAI-compatible specifically? It's the de-facto lingua franca —
// OpenAI, Groq, DeepSeek, OpenRouter, Together, Perplexity, most local
// llama.cpp servers all speak it. One HTTP client covers all of them.
// Anthropic (Claude) speaks a slightly different shape; users who want
// Claude can go via OpenRouter which normalises it.
//
// Model choices lean toward CHEAP + FAST since insight generation isn't
// creative writing; the LLM just re-phrases numbers we already extracted.
// gpt-4o-mini is ~$0.15/M tokens = well under ₹0.10 per generation.
// ---------------------------------------------------------------------------
export const AI_PROVIDER_PRESETS = {
  openai: {
    label:   'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model:   'gpt-4o-mini',
    keyHint: 'sk-...',
    docs:    'https://platform.openai.com/api-keys',
  },
  anthropic: {
    label:   'Anthropic (Claude)',
    baseUrl: 'https://api.anthropic.com/v1',
    // Haiku is the cheap, fast default and reads images. Any Claude model ID works.
    model:   'claude-haiku-4-5-20251001',
    keyHint: 'sk-ant-...',
    docs:    'https://console.anthropic.com/settings/keys',
  },
  groq: {
    label:   'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model:   'llama-3.3-70b-versatile',
    keyHint: 'gsk_...',
    docs:    'https://console.groq.com/keys',
  },
  openrouter: {
    label:   'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    // Free tier model — swappable in Settings. OpenRouter routes to
    // whichever provider is currently serving the model best.
    model:   'meta-llama/llama-3.3-70b-instruct:free',
    keyHint: 'sk-or-...',
    docs:    'https://openrouter.ai/settings/keys',
  },
  deepseek: {
    label:   'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model:   'deepseek-chat',
    keyHint: 'sk-...',
    docs:    'https://platform.deepseek.com/api_keys',
  },
  cursor: {
    label:   'Cursor',
    baseUrl: 'https://api.cursor.com/v1',
    // Blank = Cursor account / team default. Cloud Agents is not
    // OpenAI /chat/completions — see lib/cursorAgents.js.
    model:   '',
    keyHint: 'crsr_...',
    docs:    'https://cursor.com/docs/api',
  },
  custom: {
    label:   'Custom (self-hosted / other)',
    baseUrl: '',
    model:   '',
    keyHint: 'your-key',
    docs:    '',
  },
};

// Default AI config used when the user has never touched Settings → AI
// Insights. `enabled: false` means the feature stays fully dormant until
// the user opts in — no accidental network calls, no accidental data
// leakage. `consentAcceptedAt: null` is the flag we check before
// generating; must be non-null (privacy notice acknowledged) AND
// `enabled: true` before any LLM call is dispatched.
//
// `confirmBeforeSend: true` opens a preview modal every time the user
// taps Generate, letting them see the exact JSON summary that will
// leave the device and Cancel if they don't want to send it. Default
// ON so users have transparency by default; power users can turn it
// off after they've inspected the payload a few times.
//
// NOTE: `apiKey` is NOT part of this blob — it lives in SecureStore.
// See STORAGE_KEYS.ai_api_key_secret above.
export const DEFAULT_AI_CONFIG = {
  enabled:            false,
  provider:           'openai',
  baseUrl:            AI_PROVIDER_PRESETS.openai.baseUrl,
  model:              AI_PROVIDER_PRESETS.openai.model,
  consentAcceptedAt:  null,
  confirmBeforeSend:  true,
};

// ---------------------------------------------------------------------------
// Net-worth master data: categories for classifying assets and liabilities.
// Same shape as transaction categories so the UI patterns transfer directly.
// ---------------------------------------------------------------------------

export const DEFAULT_ASSET_CATEGORIES = [
  { id: 'cash',        label: 'Cash & Bank',       emoji: '💵', color: '#10b981' },
  { id: 'investments', label: 'Investments',       emoji: '📈', color: '#6366f1' },
  { id: 'realestate',  label: 'Real Estate',       emoji: '🏠', color: '#f59e0b' },
  { id: 'vehicles',    label: 'Vehicles',          emoji: '🚗', color: '#3b82f6' },
  { id: 'gold',        label: 'Gold & Precious',   emoji: '🥇', color: '#eab308' },
  { id: 'fixed',       label: 'Fixed Deposits',    emoji: '🏦', color: '#14b8a6' },
  { id: 'lent',        label: 'Money Lent',        emoji: '↗️', color: '#8b5cf6' },
  { id: 'other_asset', label: 'Other',             emoji: '📦', color: '#6b7280' },
];

export const DEFAULT_LIABILITY_CATEGORIES = [
  { id: 'home_loan',   label: 'Home Loan',      emoji: '🏠', color: '#dc2626' },
  { id: 'car_loan',    label: 'Car Loan',       emoji: '🚗', color: '#ef4444' },
  { id: 'personal',    label: 'Personal Loan',  emoji: '💰', color: '#f97316' },
  { id: 'credit_card', label: 'Credit Card',    emoji: '💳', color: '#ec4899' },
  { id: 'education',   label: 'Education Loan', emoji: '🎓', color: '#a855f7' },
  { id: 'gold_loan',   label: 'Gold Loan',      emoji: '🥇', color: '#ca8a04' },
  { id: 'borrowed',    label: 'Money Borrowed', emoji: '↘️', color: '#8b5cf6' },
  { id: 'other_liab',  label: 'Other',          emoji: '📦', color: '#6b7280' },
];

// Brokers we know how to parse CSVs for. Adding a new broker = add an entry
// here + a column map in lib/parseHoldings.js:BROKER_COLUMNS.
//
// `hint` is a short one-liner shown in ImportHoldingsScreen telling the
// user WHERE in their broker's UI the CSV lives. Keep it under ~90 chars.
export const BROKERS = [
  {
    id: 'zerodha', label: 'Zerodha', emoji: '🟠', color: '#f97316',
    hint: 'Console → Portfolio → Holdings → Download XLSX.',
  },
  {
    id: 'groww', label: 'Groww', emoji: '🟢', color: '#10b981',
    hint: 'Web → Investments → Stocks → Reports → Holdings (CSV).',
  },
  {
    id: 'upstox', label: 'Upstox', emoji: '🟣', color: '#7c3aed',
    hint: 'Pro Web → Reports → Holdings Report → Export as CSV.',
  },
  {
    id: 'icici', label: 'ICICI Direct', emoji: '🔶', color: '#ea580c',
    hint: 'icicidirect.com → Portfolio → Equity Holdings → Download.',
  },
  {
    id: 'hdfcsec', label: 'HDFC Securities', emoji: '🔷', color: '#1d4ed8',
    hint: 'HDFC Sec → Portfolio → Holdings → Export (CSV / Excel).',
  },
  {
    id: 'kotak', label: 'Kotak Securities', emoji: '🟦', color: '#0e7490',
    hint: 'Kotak Neo / Securities → Portfolio → Export (CSV).',
  },
  {
    id: 'fivepaisa', label: '5paisa', emoji: '🟥', color: '#dc2626',
    hint: '5paisa Web → Portfolio → Holdings → Export CSV.',
  },
  {
    id: 'angelone', label: 'Angel One', emoji: '🅰', color: '#0284c7',
    hint: 'Angel One / Angel Broking → Portfolio → Export.',
  },
  {
    id: 'motilal', label: 'Motilal Oswal', emoji: '🟨', color: '#ca8a04',
    hint: 'Motilal Oswal → Portfolio → Holdings → Download CSV.',
  },
  {
    id: 'sharekhan', label: 'Sharekhan', emoji: '🟩', color: '#65a30d',
    hint: 'Sharekhan → Portfolio → Holdings → Export CSV.',
  },
  {
    id: 'mf', label: 'Mutual Funds (CAS)', emoji: '📈', color: '#0891b2',
    hint: 'CAMS / KFintech / MF Central consolidated statement (CSV export).',
  },
  {
    id: 'generic', label: 'Other (auto-detect)', emoji: '📄', color: '#6b7280',
    hint: 'Any CSV or Excel file with symbol, quantity, average price, and current price columns.',
  },
];

// Categories can optionally contain a `subCategories` list. Sub-categories
// have the same shape as categories (id/label/emoji/color) but scope their
// ids to be locally unique within the parent — they're always looked up
// through the parent (`category.subCategories.find(...)`), never globally.
function othersSubFor(category) {
  return {
    id: `${category.id}_other`,
    label: 'Others',
    emoji: '📦',
    color: category.color ?? '#6b7280',
  };
}

export function ensureOthersSubcategories(list) {
  if (!Array.isArray(list)) return list;
  return list.map((category) => {
    const subs = Array.isArray(category.subCategories) ? category.subCategories : [];
    const otherId = `${category.id}_other`;
    if (subs.some((item) => item?.id === otherId)) {
      return { ...category, subCategories: subs };
    }
    return { ...category, subCategories: [...subs, othersSubFor(category)] };
  });
}

const EXPENSE_CATEGORY_SEEDS = [
  {
    id: 'food', label: 'Food', emoji: '🍔', color: '#f97316',
    subCategories: [
      { id: 'food_restaurant',   label: 'Restaurant',    emoji: '🍽️', color: '#f97316' },
      { id: 'food_delivery',     label: 'Delivery',      emoji: '🛵', color: '#f59e0b' },
      { id: 'food_groceries',    label: 'Groceries',     emoji: '🛒', color: '#84cc16' },
      { id: 'food_coffee',       label: 'Coffee / Tea',  emoji: '☕', color: '#a16207' },
      { id: 'food_street',       label: 'Street Food',   emoji: '🌮', color: '#ea580c' },
      { id: 'food_snacks',       label: 'Snacks',        emoji: '🍿', color: '#eab308' },
      { id: 'food_bakery',       label: 'Bakery',        emoji: '🥐', color: '#d97706' },
      { id: 'food_fastfood',     label: 'Fast Food',     emoji: '🍟', color: '#f97316' },
      { id: 'food_alcohol',      label: 'Alcohol / Bar', emoji: '🍺', color: '#a16207' },
      { id: 'food_fruitveg',     label: 'Fruits & Veg',  emoji: '🥕', color: '#65a30d' },
      { id: 'food_meat',         label: 'Meat & Fish',   emoji: '🥩', color: '#b91c1c' },
      { id: 'food_dairy',        label: 'Dairy & Eggs',  emoji: '🥛', color: '#0ea5e9' },
      { id: 'food_dessert',      label: 'Dessert',       emoji: '🍦', color: '#ec4899' },
      { id: 'food_water',        label: 'Water / Milk',  emoji: '💧', color: '#0891b2' },
      { id: 'food_party',        label: 'Party Catering',emoji: '🎂', color: '#e11d48' },
    ],
  },
  {
    id: 'transport', label: 'Transport', emoji: '🚗', color: '#3b82f6',
    subCategories: [
      { id: 'transport_cab',         label: 'Cab',              emoji: '🚕', color: '#3b82f6' },
      { id: 'transport_auto',        label: 'Auto Rickshaw',    emoji: '🛺', color: '#f59e0b' },
      { id: 'transport_bike',        label: 'Bike / 2-Wheeler', emoji: '🏍️', color: '#0ea5e9' },
      { id: 'transport_fuel',        label: 'Fuel',             emoji: '⛽', color: '#0ea5e9' },
      { id: 'transport_ev',          label: 'EV Charging',      emoji: '🔌', color: '#10b981' },
      { id: 'transport_public',      label: 'Local Bus',        emoji: '🚌', color: '#0284c7' },
      { id: 'transport_metro',       label: 'Metro / Local Train', emoji: '🚆', color: '#4f46e5' },
      { id: 'transport_parking',     label: 'Parking',          emoji: '🅿️', color: '#64748b' },
      { id: 'transport_toll',        label: 'Toll / FASTag',    emoji: '🛣️', color: '#78716c' },
      { id: 'transport_maintenance', label: 'Service / Repair', emoji: '🛠️', color: '#7c2d12' },
      { id: 'transport_insurance',   label: 'Vehicle Insurance',emoji: '🛡️', color: '#0d9488' },
    ],
  },
  {
    id: 'bills', label: 'Bills', emoji: '🧾', color: '#10b981',
    subCategories: [
      { id: 'bills_rent',           label: 'Rent',              emoji: '🏠', color: '#10b981' },
      { id: 'bills_maintenance',    label: 'Maintenance / Society', emoji: '🧹', color: '#059669' },
      { id: 'bills_insurance',      label: 'Insurance',         emoji: '🛡️', color: '#0d9488' },
      { id: 'bills_tax',            label: 'Property / Municipal Tax', emoji: '🏛️', color: '#78716c' },
      { id: 'bills_subscription',   label: 'Subscription',      emoji: '🔁', color: '#a855f7' },
      { id: 'bills_credit_card',    label: 'Credit Card Bill',  emoji: '💳', color: '#4338ca' },
      // Auto-selected when a Transfer of kind 'loan_repayment' has a
      // non-zero interest split. See TransfersContext for the linkage.
      { id: 'bills_loan_interest',  label: 'Loan Interest',     emoji: '💳', color: '#dc2626' },
    ],
  },
  {
    id: 'utilities', label: 'Utilities', emoji: '💡', color: '#eab308',
    subCategories: [
      { id: 'utilities_electricity', label: 'Electricity',    emoji: '💡', color: '#f59e0b' },
      { id: 'utilities_water',       label: 'Water',          emoji: '🚰', color: '#0ea5e9' },
      { id: 'utilities_gas',         label: 'Gas / LPG',      emoji: '🔥', color: '#ea580c' },
      { id: 'utilities_internet',    label: 'Internet',       emoji: '🌐', color: '#0284c7' },
      { id: 'utilities_phone',       label: 'Phone / Mobile', emoji: '📱', color: '#6366f1' },
      { id: 'utilities_dth',         label: 'DTH / Cable',    emoji: '📺', color: '#7c3aed' },
    ],
  },
  {
    id: 'health', label: 'Healthcare', emoji: '🩺', color: '#ef4444',
    subCategories: [
      { id: 'health_doctor',      label: 'Doctor',       emoji: '👨‍⚕️', color: '#ef4444' },
      { id: 'health_pharmacy',    label: 'Pharmacy',     emoji: '💊', color: '#dc2626' },
      { id: 'health_hospital',    label: 'Hospital',     emoji: '🏥', color: '#b91c1c' },
      { id: 'health_diagnostic',  label: 'Lab / Tests',  emoji: '🧪', color: '#f97316' },
      { id: 'health_dental',      label: 'Dental',       emoji: '🦷', color: '#0ea5e9' },
      { id: 'health_vision',      label: 'Vision / Eye', emoji: '👓', color: '#4f46e5' },
      { id: 'health_gym',         label: 'Gym',          emoji: '🏋️', color: '#f97316' },
      { id: 'health_fitness',     label: 'Yoga / Fitness class', emoji: '🧘', color: '#a855f7' },
      { id: 'health_wellness',    label: 'Wellness / Spa', emoji: '🧖', color: '#ec4899' },
      { id: 'health_supplements', label: 'Supplements',  emoji: '💪', color: '#10b981' },
      { id: 'health_mental',      label: 'Mental Health', emoji: '🧠', color: '#7c3aed' },
      { id: 'health_insurance',   label: 'Health Insurance', emoji: '🛡️', color: '#0d9488' },
    ],
  },
  {
    id: 'education', label: 'Education', emoji: '🎓', color: '#4f46e5',
    subCategories: [
      { id: 'education_school',       label: 'School Fees',          emoji: '🏫', color: '#4f46e5' },
      { id: 'education_college',      label: 'College Fees',         emoji: '🎓', color: '#4338ca' },
      { id: 'education_tuition',      label: 'Tuition / Coaching',   emoji: '👩‍🏫', color: '#6366f1' },
      { id: 'education_courses',      label: 'Online Courses',       emoji: '💻', color: '#0ea5e9' },
      { id: 'education_books',        label: 'Textbooks / Study Material', emoji: '📚', color: '#7c3aed' },
      { id: 'education_exam',         label: 'Exam Fees',            emoji: '📝', color: '#f59e0b' },
      { id: 'education_certification',label: 'Certification',        emoji: '📜', color: '#0d9488' },
      { id: 'education_stationery',   label: 'Stationery',           emoji: '✏️', color: '#ec4899' },
      { id: 'education_supplies',     label: 'School Supplies',      emoji: '🎒', color: '#f97316' },
      { id: 'education_uniform',      label: 'Uniform',              emoji: '👔', color: '#64748b' },
      { id: 'education_software',     label: 'Educational Software', emoji: '🖥️', color: '#0891b2' },
      { id: 'education_loan',         label: 'Student Loan Payment', emoji: '🏦', color: '#dc2626' },
    ],
  },
  {
    id: 'household', label: 'Household', emoji: '🏠', color: '#84cc16',
    subCategories: [
      { id: 'household_help',       label: 'Domestic Help',       emoji: '🧹', color: '#65a30d' },
      { id: 'household_cleaning',   label: 'Cleaning Supplies',   emoji: '🧽', color: '#84cc16' },
      { id: 'household_toiletries', label: 'Toiletries',          emoji: '🧻', color: '#22c55e' },
      { id: 'household_laundry',    label: 'Laundry',             emoji: '🧺', color: '#0ea5e9' },
      { id: 'household_pest',       label: 'Pest Control',        emoji: '🐜', color: '#a16207' },
      { id: 'household_decor',      label: 'Home Décor',          emoji: '🖼️', color: '#ec4899' },
      { id: 'household_kitchenware',label: 'Kitchenware',         emoji: '🍳', color: '#f97316' },
      { id: 'household_furniture',  label: 'Furniture',           emoji: '🛋️', color: '#a16207' },
      { id: 'household_appliances', label: 'Appliances',          emoji: '🔌', color: '#6366f1' },
      { id: 'household_repairs',    label: 'Repairs',             emoji: '🔧', color: '#78716c' },
      { id: 'household_gardening',  label: 'Gardening',           emoji: '🪴', color: '#10b981' },
      { id: 'household_security',   label: 'Home Security',       emoji: '🔒', color: '#0d9488' },
      { id: 'household_moving',     label: 'Moving / Relocation', emoji: '📦', color: '#3b82f6' },
    ],
  },
  {
    id: 'shopping', label: 'Shopping', emoji: '🛍️', color: '#ec4899',
    subCategories: [
      { id: 'shopping_clothes',      label: 'Clothing',              emoji: '👕', color: '#ec4899' },
      { id: 'shopping_footwear',     label: 'Footwear',              emoji: '👟', color: '#be185d' },
      { id: 'shopping_accessories',  label: 'Fashion Accessories',   emoji: '👜', color: '#db2777' },
      { id: 'shopping_electronics',  label: 'Consumer Electronics',  emoji: '💻', color: '#8b5cf6' },
      { id: 'shopping_books',        label: 'Books & Magazines',     emoji: '📚', color: '#7c3aed' },
      { id: 'shopping_kids',         label: 'Toys',                  emoji: '🧸', color: '#fb7185' },
      { id: 'shopping_sports',       label: 'Sports Equipment',      emoji: '⚽', color: '#10b981' },
      { id: 'shopping_jewelry',      label: 'Jewelry & Watches',     emoji: '💍', color: '#eab308' },
      { id: 'shopping_bags_luggage', label: 'Bags & Wallets',        emoji: '🎒', color: '#c026d3' },
    ],
  },
  {
    id: 'personal_care', label: 'Personal Care', emoji: '🧴', color: '#f472b6',
    subCategories: [
      { id: 'personal_care_haircut',     label: 'Haircut',              emoji: '✂️', color: '#db2777' },
      { id: 'personal_care_salon',       label: 'Salon',                emoji: '💇', color: '#ec4899' },
      { id: 'personal_care_grooming',    label: 'Grooming',             emoji: '🪒', color: '#8b5cf6' },
      { id: 'personal_care_skincare',    label: 'Skincare',             emoji: '🧴', color: '#f472b6' },
      { id: 'personal_care_cosmetics',   label: 'Cosmetics',            emoji: '💄', color: '#e11d48' },
      { id: 'personal_care_spa',         label: 'Spa',                  emoji: '💆', color: '#a855f7' },
      { id: 'personal_care_hygiene',     label: 'Personal Hygiene',     emoji: '🧼', color: '#0ea5e9' },
      { id: 'personal_care_alterations', label: 'Clothing Alterations', emoji: '🧵', color: '#7c3aed' },
    ],
  },
  {
    id: 'fun', label: 'Fun', emoji: '🎉', color: '#8b5cf6',
    subCategories: [
      { id: 'fun_movies',        label: 'Cinema',                emoji: '🎬', color: '#8b5cf6' },
      { id: 'fun_subscriptions', label: 'Streaming Entertainment',emoji: '📺', color: '#a855f7' },
      { id: 'fun_games',         label: 'Gaming',                emoji: '🎮', color: '#6366f1' },
      { id: 'fun_concerts',      label: 'Concerts & Live Events',emoji: '🎤', color: '#ec4899' },
      { id: 'fun_sports',        label: 'Recreational Sports',   emoji: '⚽', color: '#10b981' },
      { id: 'fun_hobbies',       label: 'Creative Hobbies',      emoji: '🎨', color: '#f97316' },
      { id: 'fun_party',         label: 'Nightlife & Parties',   emoji: '🥳', color: '#f43f5e' },
      { id: 'fun_amusement',     label: 'Amusement Parks',       emoji: '🎢', color: '#0ea5e9' },
      { id: 'fun_museums',       label: 'Museums & Attractions', emoji: '🏛️', color: '#14b8a6' },
    ],
  },
  {
    id: 'travel', label: 'Travel', emoji: '✈️', color: '#06b6d4',
    subCategories: [
      { id: 'travel_flights',          label: 'Flights',              emoji: '✈️', color: '#6366f1' },
      { id: 'travel_trains',           label: 'Intercity Train',      emoji: '🚆', color: '#4f46e5' },
      { id: 'travel_bus',              label: 'Intercity Bus',        emoji: '🚌', color: '#0284c7' },
      { id: 'travel_hotel',            label: 'Hotel / Accommodation',emoji: '🏨', color: '#0891b2' },
      { id: 'travel_visa',             label: 'Visa',                 emoji: '🛂', color: '#64748b' },
      { id: 'travel_insurance',        label: 'Travel Insurance',     emoji: '🛡️', color: '#0d9488' },
      { id: 'travel_local_transport',  label: 'Local Transport',      emoji: '🚕', color: '#3b82f6' },
      { id: 'travel_food',             label: 'Food during Travel',   emoji: '🍽️', color: '#f97316' },
      { id: 'travel_sightseeing',      label: 'Sightseeing',          emoji: '📸', color: '#ec4899' },
      { id: 'travel_tour_package',     label: 'Tour Package',         emoji: '🧳', color: '#06b6d4' },
      { id: 'travel_forex',            label: 'Foreign Exchange',     emoji: '💱', color: '#14b8a6' },
      { id: 'travel_luggage',          label: 'Luggage',              emoji: '🧳', color: '#a16207' },
      { id: 'travel_roaming',          label: 'Roaming / Travel SIM', emoji: '📱', color: '#7c3aed' },
    ],
  },
  {
    id: 'gifts', label: 'Gifts', emoji: '🎁', color: '#a855f7',
    subCategories: [
      { id: 'gifts_birthday',         label: 'Birthday',           emoji: '🎂', color: '#f43f5e' },
      { id: 'gifts_wedding',          label: 'Wedding Gift',       emoji: '💒', color: '#ec4899' },
      { id: 'gifts_anniversary',      label: 'Anniversary',        emoji: '💞', color: '#e11d48' },
      { id: 'gifts_festival',         label: 'Festival',           emoji: '🎊', color: '#f59e0b' },
      { id: 'gifts_housewarming',     label: 'Housewarming',       emoji: '🏠', color: '#0ea5e9' },
      { id: 'gifts_baby',             label: 'Baby / Newborn',     emoji: '👶', color: '#fb7185' },
      { id: 'gifts_thank_you',        label: 'Thank-you / Host',   emoji: '🙏', color: '#14b8a6' },
      { id: 'gifts_just_because',     label: 'Just Because',       emoji: '💝', color: '#f472b6' },
      { id: 'gifts_other',            label: 'Other Gift',         emoji: '🎁', color: '#8b5cf6' },
    ],
  },
  {
    id: 'family_support', label: 'Family Support', emoji: '👨‍👩‍👧', color: '#ec4899',
    subCategories: [
      { id: 'family_support_father',  label: 'Father',       emoji: '👨', color: '#6366f1' },
      { id: 'family_support_mother',  label: 'Mother',       emoji: '👩', color: '#f472b6' },
      { id: 'family_support_parents', label: 'Both Parents', emoji: '👴', color: '#ec4899' },
      { id: 'family_support_sibling', label: 'Sibling',      emoji: '👫', color: '#8b5cf6' },
      { id: 'family_support_other',   label: 'Other Family', emoji: '🏠', color: '#a855f7' },
    ],
  },
  {
    id: 'events', label: 'Events & Functions', emoji: '💒', color: '#e11d48',
    // Sub-categories = spend department (venue, catering, …). Tag the
    // function — e.g. wedding-2026, reception, sangeet, housewarming,
    // bride-viewing (porutham / first visit).
    subCategories: [
      { id: 'events_venue',         label: 'Venue / Hall',           emoji: '🏛️', color: '#6366f1' },
      { id: 'events_catering',      label: 'Catering & Food',        emoji: '🍽️', color: '#f97316' },
      { id: 'events_sweets_snacks', label: 'Sweets & Snacks',        emoji: '🍬', color: '#ec4899' },
      { id: 'events_decor',         label: 'Decor & Flowers',        emoji: '💐', color: '#ec4899' },
      { id: 'events_photography',   label: 'Photography / Video',    emoji: '📸', color: '#8b5cf6' },
      { id: 'events_clothing',      label: 'Clothing',               emoji: '👗', color: '#db2777' },
      { id: 'events_jewellery',     label: 'Jewellery & Ornaments',  emoji: '💍', color: '#c026d3' },
      { id: 'events_accessories',   label: 'Accessories',            emoji: '👜', color: '#be185d' },
      { id: 'events_cosmetics',     label: 'Cosmetics & Makeup',     emoji: '💄', color: '#e11d48' },
      { id: 'events_entertainment', label: 'Music / DJ / Entertainment', emoji: '🎤', color: '#7c3aed' },
      { id: 'events_invitations',   label: 'Invitations & Printing', emoji: '💌', color: '#14b8a6' },
      { id: 'events_priest',        label: 'Priest / Rituals',       emoji: '🪔', color: '#f97316' },
      { id: 'events_gifts_favors',  label: 'Guest Gifts & Favors',   emoji: '🎁', color: '#a855f7' },
      { id: 'events_planning',      label: 'Planner / Coordinator',  emoji: '📋', color: '#0ea5e9' },
      { id: 'events_travel',        label: 'Travel',               emoji: '✈️', color: '#06b6d4' },
      { id: 'events_guest_travel',  label: 'Guest Travel & Stay',    emoji: '🏨', color: '#0891b2' },
      { id: 'events_other',         label: 'Miscellaneous',          emoji: '🎊', color: '#6b7280' },
    ],
  },
  {
    id: 'pets', label: 'Pets', emoji: '🐾', color: '#a16207',
    subCategories: [
      { id: 'pets_food',       label: 'Pet Food',        emoji: '🦴', color: '#a16207' },
      { id: 'pets_vet',        label: 'Veterinary Care', emoji: '🩺', color: '#ef4444' },
      { id: 'pets_grooming',   label: 'Grooming',        emoji: '🛁', color: '#0ea5e9' },
      { id: 'pets_medicine',   label: 'Medicine',        emoji: '💊', color: '#dc2626' },
      { id: 'pets_accessories',label: 'Accessories',     emoji: '🦮', color: '#f59e0b' },
      { id: 'pets_boarding',   label: 'Boarding',        emoji: '🏠', color: '#6366f1' },
      { id: 'pets_training',   label: 'Training',        emoji: '🎓', color: '#10b981' },
      { id: 'pets_adoption',   label: 'Adoption',        emoji: '❤️', color: '#e11d48' },
    ],
  },
  {
    id: 'other', label: 'Other', emoji: '📦', color: '#6b7280',
    subCategories: [
      { id: 'other_donation',  label: 'Donation',       emoji: '🤝', color: '#f97316' },
      { id: 'other_fees',      label: 'Fees & Charges', emoji: '📄', color: '#6b7280' },
      { id: 'other_kids',      label: 'Kids',           emoji: '👶', color: '#fb7185' },
      { id: 'other_legal',     label: 'Legal',          emoji: '⚖️', color: '#78716c' },
      { id: 'other_tax',       label: 'Tax Payment',    emoji: '🏛️', color: '#dc2626' },
      // No explicit "Miscellaneous"/"Others" sub here — ensureOthersSubcategories
      // (below) already appends one automatically for every category,
      // including this one. A second, hand-written catch-all sub used to
      // duplicate it (two near-identical "Miscellaneous"/"Others" chips).
    ],
  },
];

export const DEFAULT_EXPENSE_CATEGORIES = ensureOthersSubcategories(EXPENSE_CATEGORY_SEEDS);

const INCOME_CATEGORY_SEEDS = [
  {
    id: 'salary', label: 'Employment Income', emoji: '💼', color: '#059669',
    subCategories: [
      { id: 'salary_base',          label: 'Base Pay',      emoji: '💵', color: '#059669' },
      { id: 'salary_bonus',         label: 'Bonus',         emoji: '🎁', color: '#10b981' },
      { id: 'salary_incentive',     label: 'Incentive',     emoji: '🏆', color: '#84cc16' },
      { id: 'salary_overtime',      label: 'Overtime',      emoji: '⏰', color: '#f59e0b' },
      { id: 'salary_commission',    label: 'Commission',    emoji: '📊', color: '#0ea5e9' },
      { id: 'salary_reimbursement', label: 'Reimbursement', emoji: '💵', color: '#0d9488' },
      { id: 'salary_esop',          label: 'ESOP / RSU',    emoji: '📈', color: '#6366f1' },
      { id: 'salary_allowances',    label: 'Allowances',    emoji: '🧾', color: '#0d9488' },
      { id: 'salary_profit_share',  label: 'Profit Sharing',emoji: '🤝', color: '#14b8a6' },
      { id: 'salary_leave',         label: 'Leave Encashment', emoji: '🏖️', color: '#0ea5e9' },
      { id: 'salary_gratuity',      label: 'Gratuity',      emoji: '🏆', color: '#eab308' },
      { id: 'salary_severance',     label: 'Severance',     emoji: '📄', color: '#64748b' },
    ],
  },
  {
    id: 'freelance', label: 'Business Income', emoji: '💻', color: '#0ea5e9',
    subCategories: [
      { id: 'freelance_client',     label: 'Client Work',    emoji: '🧑‍💻', color: '#0ea5e9' },
      { id: 'freelance_consulting', label: 'Consulting',     emoji: '🗂️', color: '#0284c7' },
      { id: 'freelance_content',    label: 'Content Creation', emoji: '🎥', color: '#7c3aed' },
      { id: 'freelance_teaching',   label: 'Teaching / Tuition', emoji: '📚', color: '#f59e0b' },
      { id: 'freelance_royalty',    label: 'Royalty',        emoji: '📜', color: '#0284c7' },
      { id: 'freelance_tips',       label: 'Tips',           emoji: '🪙', color: '#eab308' },
      { id: 'freelance_sales',      label: 'Sales Revenue',  emoji: '🛒', color: '#10b981' },
      { id: 'freelance_service',    label: 'Service Revenue',emoji: '🧰', color: '#14b8a6' },
      { id: 'freelance_partnership',label: 'Partnership Profit Share', emoji: '🤝', color: '#059669' },
      { id: 'freelance_revenue_share', label: 'Revenue Share', emoji: '📊', color: '#0891b2' },
      { id: 'freelance_affiliate',  label: 'Affiliate Income', emoji: '🔗', color: '#8b5cf6' },
      { id: 'freelance_advertising',label: 'Advertising Income', emoji: '📣', color: '#f97316' },
      { id: 'freelance_reimbursement', label: 'Business Reimbursement', emoji: '🧾', color: '#0d9488' },
    ],
  },
  {
    id: 'investments', label: 'Investment Income', emoji: '📈', color: '#14b8a6',
    subCategories: [
      { id: 'income_dividend', label: 'Dividend',       emoji: '💰', color: '#14b8a6' },
      { id: 'income_interest', label: 'Savings Interest', emoji: '🏦', color: '#0d9488' },
      { id: 'income_capgain',  label: 'Capital Gain',   emoji: '📈', color: '#0891b2' },
      { id: 'income_coupon',   label: 'Bond Coupon',    emoji: '📃', color: '#6366f1' },
      { id: 'income_swp',      label: 'SWP Payout', emoji: '🔄', color: '#059669' },
      { id: 'income_mis',      label: 'MIS Interest Payout', emoji: '💵', color: '#0d9488' },
      { id: 'income_mf_dividend', label: 'Mutual Fund Dividend', emoji: '💰', color: '#10b981' },
      { id: 'income_fd_interest', label: 'FD / RD Interest', emoji: '🏦', color: '#0369a1' },
      { id: 'income_ppf_interest', label: 'PPF Interest', emoji: '🏛️', color: '#7c3aed' },
      { id: 'income_epf_interest', label: 'EPF Interest', emoji: '🏢', color: '#4338ca' },
      { id: 'income_reit', label: 'REIT Distribution', emoji: '🏙️', color: '#0891b2' },
      { id: 'income_invit', label: 'InvIT Distribution', emoji: '🛣️', color: '#0284c7' },
      { id: 'income_crypto_yield', label: 'Crypto Yield / Staking', emoji: '🪙', color: '#a855f7' },
    ],
  },
  {
    id: 'rental', label: 'Rental Income', emoji: '🏠', color: '#84cc16',
    subCategories: [
      { id: 'rental_residential', label: 'Residential Rent', emoji: '🏠', color: '#84cc16' },
      { id: 'rental_commercial', label: 'Commercial Rent', emoji: '🏢', color: '#65a30d' },
      { id: 'rental_land', label: 'Land Lease', emoji: '🌳', color: '#10b981' },
      { id: 'rental_equipment', label: 'Equipment Rental', emoji: '🧰', color: '#f59e0b' },
      { id: 'rental_vehicle', label: 'Vehicle Rental', emoji: '🚗', color: '#3b82f6' },
      { id: 'rental_maintenance', label: 'Maintenance Recovered', emoji: '🧾', color: '#0d9488' },
    ],
  },
  {
    id: 'pension_benefits', label: 'Pension & Benefits', emoji: '🧓', color: '#7c3aed',
    subCategories: [
      { id: 'benefits_pension', label: 'Pension', emoji: '🏦', color: '#7c3aed' },
      { id: 'benefits_annuity', label: 'Annuity', emoji: '🔁', color: '#8b5cf6' },
      { id: 'benefits_government', label: 'Government Benefit', emoji: '🏛️', color: '#6366f1' },
      { id: 'benefits_disability', label: 'Disability Benefit', emoji: '🤝', color: '#0ea5e9' },
      { id: 'benefits_scholarship', label: 'Scholarship / Stipend', emoji: '🎓', color: '#10b981' },
      { id: 'benefits_family', label: 'Family Support', emoji: '👨‍👩‍👧', color: '#ec4899' },
    ],
  },
  {
    id: 'gift', label: 'Gift', emoji: '🎁', color: '#8b5cf6',
    subCategories: [
      { id: 'gift_family',   label: 'Family',    emoji: '👨‍👩‍👧', color: '#8b5cf6' },
      { id: 'gift_festival', label: 'Festival',  emoji: '🎊', color: '#a855f7' },
      { id: 'gift_wedding',  label: 'Wedding',   emoji: '💒', color: '#ec4899' },
      { id: 'gift_birthday', label: 'Birthday',  emoji: '🎂', color: '#f43f5e' },
      { id: 'gift_random',   label: 'Just Because', emoji: '💝', color: '#f472b6' },
    ],
  },
  {
    id: 'refund', label: 'Refund', emoji: '↩️', color: '#f59e0b',
    subCategories: [
      { id: 'refund_purchase',  label: 'Purchase',        emoji: '🛍️', color: '#f59e0b' },
      { id: 'refund_tax',       label: 'Tax',             emoji: '🧾', color: '#eab308' },
      { id: 'refund_travel',    label: 'Travel',          emoji: '✈️', color: '#f97316' },
      { id: 'refund_deposit',   label: 'Security Deposit',emoji: '🔐', color: '#0ea5e9' },
      { id: 'refund_insurance', label: 'Insurance Claim', emoji: '🛡️', color: '#0d9488' },
    ],
  },
  {
    id: 'other', label: 'Other', emoji: '💰', color: '#6b7280',
    subCategories: [
      { id: 'other_reimbursement', label: 'General Reimbursement', emoji: '💵', color: '#10b981' },
      { id: 'other_cashback',      label: 'Cashback',       emoji: '💳', color: '#0ea5e9' },
      { id: 'other_rewards',       label: 'Rewards Points', emoji: '🎯', color: '#a855f7' },
      { id: 'other_sale',          label: 'Sale of Item',   emoji: '🏷️', color: '#6b7280' },
      { id: 'other_prize',         label: 'Prize / Lottery',emoji: '🏆', color: '#eab308' },
      { id: 'other_pocket',        label: 'Pocket Money',   emoji: '🪙', color: '#78716c' },
      { id: 'other_compensation',  label: 'Compensation / Settlement', emoji: '⚖️', color: '#64748b' },
    ],
  },
];

export const DEFAULT_INCOME_CATEGORIES = ensureOthersSubcategories(INCOME_CATEGORY_SEEDS);

const INVESTMENT_CATEGORY_SEEDS = [
  {
    id: 'mutual_funds', label: 'Mutual Funds', emoji: '📈', color: '#8b5cf6',
    subCategories: [
      { id: 'mf_equity',        label: 'Equity',            emoji: '📊', color: '#8b5cf6' },
      { id: 'mf_debt',          label: 'Debt',              emoji: '📃', color: '#7c3aed' },
      { id: 'mf_hybrid',        label: 'Hybrid',            emoji: '⚖️', color: '#a855f7' },
      { id: 'mf_index',         label: 'Index',             emoji: '🎯', color: '#9333ea' },
      { id: 'mf_elss',          label: 'ELSS (Tax-saver)',  emoji: '🧾', color: '#059669' },
      { id: 'mf_liquid',        label: 'Liquid',            emoji: '💧', color: '#0ea5e9' },
      { id: 'mf_international', label: 'International',     emoji: '🌐', color: '#0284c7' },
      { id: 'mf_large_cap',     label: 'Large Cap',         emoji: '🏢', color: '#6366f1' },
      { id: 'mf_mid_cap',       label: 'Mid Cap',           emoji: '📈', color: '#8b5cf6' },
      { id: 'mf_small_cap',     label: 'Small Cap',         emoji: '🌱', color: '#a855f7' },
      { id: 'mf_flexi_cap',     label: 'Flexi Cap',         emoji: '🔄', color: '#7c3aed' },
      { id: 'mf_sectoral',      label: 'Sectoral / Thematic', emoji: '🎯', color: '#ec4899' },
      { id: 'mf_arbitrage',     label: 'Arbitrage',         emoji: '⚖️', color: '#14b8a6' },
      { id: 'mf_fof',           label: 'Fund of Funds',     emoji: '🧺', color: '#0891b2' },
    ],
  },
  {
    id: 'stocks', label: 'Stocks', emoji: '📊', color: '#6366f1',
    subCategories: [
      { id: 'stocks_indian',    label: 'Domestic Stocks', emoji: '🇮🇳', color: '#6366f1' },
      { id: 'stocks_esop',      label: 'ESOP / RSU',   emoji: '🏢', color: '#8b5cf6' },
      { id: 'stocks_intl',      label: 'International Stocks',emoji: '🌐', color: '#0284c7' },
      { id: 'stocks_unlisted',  label: 'Unlisted Shares', emoji: '📜', color: '#7c3aed' },
      { id: 'stocks_basket',    label: 'Stock Basket / Smallcase', emoji: '🧺', color: '#0ea5e9' },
    ],
  },
  {
    id: 'etfs', label: 'ETFs', emoji: '📊', color: '#0891b2',
    subCategories: [
      { id: 'etf_equity', label: 'Equity ETF', emoji: '📈', color: '#6366f1' },
      { id: 'etf_index', label: 'Index ETF', emoji: '🎯', color: '#4f46e5' },
      { id: 'etf_gold', label: 'Gold ETF', emoji: '🥇', color: '#eab308' },
      { id: 'etf_silver', label: 'Silver ETF', emoji: '🥈', color: '#94a3b8' },
      { id: 'etf_debt', label: 'Debt ETF', emoji: '📃', color: '#7c3aed' },
      { id: 'etf_international', label: 'International ETF', emoji: '🌐', color: '#0284c7' },
      { id: 'etf_sector', label: 'Sector ETF', emoji: '🏭', color: '#ec4899' },
    ],
  },
  {
    id: 'gold', label: 'Precious Metals', emoji: '🥇', color: '#f59e0b',
    subCategories: [
      { id: 'gold_physical',   label: 'Physical',      emoji: '🥇', color: '#f59e0b' },
      { id: 'gold_chit',       label: 'Gold Chit',     emoji: '🪙', color: '#d97706' },
      { id: 'gold_digital',    label: 'Digital Gold',  emoji: '📱', color: '#d97706' },
      { id: 'gold_silver',     label: 'Physical Silver', emoji: '🥈', color: '#94a3b8' },
      { id: 'gold_silver_digital', label: 'Digital Silver', emoji: '📱', color: '#94a3b8' },
    ],
  },
  {
    id: 'fd', label: 'Bank Deposits', emoji: '🏦', color: '#0ea5e9',
    subCategories: [
      { id: 'fd_bank',      label: 'Bank FD',           emoji: '🏦', color: '#0ea5e9' },
      { id: 'fd_corporate', label: 'Corporate FD',      emoji: '🏢', color: '#0284c7' },
      { id: 'fd_recurring', label: 'Recurring Deposit', emoji: '🔄', color: '#0369a1' },
      { id: 'fd_tax_saver', label: 'Tax-saver FD',      emoji: '🧾', color: '#0d9488' },
      { id: 'fd_sweep',     label: 'Sweep Deposit',     emoji: '🔄', color: '#14b8a6' },
    ],
  },
  {
    id: 'government_savings', label: 'Government Savings', emoji: '🏛️', color: '#7c3aed',
    subCategories: [
      { id: 'gov_ppf', label: 'PPF', emoji: '🏛️', color: '#7c3aed' },
      { id: 'gov_ssy', label: 'Sukanya Samriddhi', emoji: '👧', color: '#ec4899' },
      { id: 'gov_nsc', label: 'NSC', emoji: '📜', color: '#a16207' },
      { id: 'gov_kvp', label: 'KVP', emoji: '📄', color: '#d97706' },
      { id: 'gov_scss', label: 'Senior Citizens Savings Scheme', emoji: '🧓', color: '#0d9488' },
      { id: 'gov_mis', label: 'Post Office MIS', emoji: '🏤', color: '#0891b2' },
    ],
  },
  {
    id: 'retirement', label: 'Retirement', emoji: '🌅', color: '#8b5cf6',
    subCategories: [
      { id: 'retirement_nps1', label: 'NPS Tier I', emoji: '🏛️', color: '#8b5cf6' },
      { id: 'retirement_nps2', label: 'NPS Tier II', emoji: '🏛️', color: '#a855f7' },
      { id: 'retirement_vpf', label: 'VPF', emoji: '🏢', color: '#6366f1' },
      { id: 'retirement_superannuation', label: 'Superannuation', emoji: '🧓', color: '#7c3aed' },
      { id: 'retirement_annuity', label: 'Pension / Annuity', emoji: '🔁', color: '#0d9488' },
    ],
  },
  {
    id: 'bonds', label: 'Bonds & Fixed Income', emoji: '📃', color: '#64748b',
    subCategories: [
      { id: 'bonds_government', label: 'Government Bond', emoji: '🏛️', color: '#6366f1' },
      { id: 'bonds_tbill', label: 'Treasury Bill', emoji: '📄', color: '#4f46e5' },
      { id: 'bonds_corporate', label: 'Corporate Bond', emoji: '🏢', color: '#64748b' },
      { id: 'bonds_sgb', label: 'Sovereign Gold Bond', emoji: '🥇', color: '#eab308' },
      { id: 'bonds_rbi', label: 'RBI Bond', emoji: '🏦', color: '#0ea5e9' },
      { id: 'bonds_ncd', label: 'Debenture / NCD', emoji: '🧾', color: '#7c3aed' },
      { id: 'bonds_tax_free', label: 'Tax-free Bond', emoji: '🛡️', color: '#10b981' },
    ],
  },
  {
    id: 'real_estate', label: 'Real Estate', emoji: '🏠', color: '#14b8a6',
    subCategories: [
      { id: 're_residential', label: 'Residential', emoji: '🏠', color: '#14b8a6' },
      { id: 're_commercial',  label: 'Commercial',  emoji: '🏢', color: '#0d9488' },
      { id: 're_land',        label: 'Land / Plot', emoji: '🌳', color: '#84cc16' },
      { id: 're_reit',        label: 'REIT',        emoji: '📈', color: '#0891b2' },
      { id: 're_agricultural',label: 'Agricultural Land', emoji: '🌾', color: '#65a30d' },
      { id: 're_construction',label: 'Under-construction Property', emoji: '🏗️', color: '#f59e0b' },
      { id: 're_invit',       label: 'InvIT', emoji: '🛣️', color: '#0284c7' },
      { id: 're_fractional',  label: 'Fractional Real Estate', emoji: '🧩', color: '#8b5cf6' },
    ],
  },
  {
    id: 'insurance_investments', label: 'Insurance Investments', emoji: '🛡️', color: '#0d9488',
    subCategories: [
      { id: 'insurance_ulip', label: 'ULIP', emoji: '📈', color: '#0d9488' },
      { id: 'insurance_endowment', label: 'Endowment Plan', emoji: '📜', color: '#14b8a6' },
      { id: 'insurance_money_back', label: 'Money-back Plan', emoji: '💵', color: '#10b981' },
      { id: 'insurance_annuity', label: 'Annuity Plan', emoji: '🔁', color: '#0891b2' },
    ],
  },
  {
    id: 'crypto', label: 'Crypto', emoji: '🪙', color: '#a855f7',
    subCategories: [
      { id: 'crypto_btc',   label: 'Bitcoin',    emoji: '₿', color: '#f59e0b' },
      { id: 'crypto_eth',   label: 'Ethereum',   emoji: '⧫', color: '#6366f1' },
      { id: 'crypto_alt',   label: 'Altcoins',   emoji: '🪙', color: '#a855f7' },
      { id: 'crypto_stable',label: 'Stablecoin', emoji: '💵', color: '#10b981' },
      { id: 'crypto_defi',  label: 'DeFi',       emoji: '🔗', color: '#0ea5e9' },
    ],
  },
  {
    id: 'derivatives', label: 'Derivatives', emoji: '⚡', color: '#dc2626',
    subCategories: [
      { id: 'derivatives_futures', label: 'Futures', emoji: '📈', color: '#dc2626' },
      { id: 'derivatives_options', label: 'Options', emoji: '🎯', color: '#e11d48' },
      { id: 'derivatives_currency', label: 'Currency Derivatives', emoji: '💱', color: '#f97316' },
      { id: 'derivatives_commodity', label: 'Commodity Derivatives', emoji: '🛢️', color: '#a16207' },
    ],
  },
  {
    id: 'other', label: 'Alternative Investments', emoji: '💼', color: '#6b7280',
    subCategories: [
      { id: 'other_epf',         label: 'EPF',            emoji: '🏢', color: '#4338ca' },
      { id: 'other_startup',     label: 'Startup',        emoji: '🚀', color: '#f97316' },
      { id: 'other_p2p',         label: 'P2P Lending',    emoji: '🤝', color: '#f59e0b' },
      { id: 'other_chit',        label: 'Chit Fund',      emoji: '💼', color: '#dc2626' },
      { id: 'other_collectible', label: 'Collectibles',   emoji: '🎨', color: '#ec4899' },
      { id: 'other_private_equity', label: 'Private Equity', emoji: '🏢', color: '#6366f1' },
      { id: 'other_invoice', label: 'Invoice Discounting', emoji: '🧾', color: '#0ea5e9' },
      { id: 'other_structured', label: 'Structured Product', emoji: '🧩', color: '#8b5cf6' },
    ],
  },
];

export const DEFAULT_INVESTMENT_CATEGORIES = ensureOthersSubcategories(INVESTMENT_CATEGORY_SEEDS);

// Account GROUPS are containers ("Bank Accounts", "Wallets", "Cash", ...).
// Groups hold one or more concrete accounts. Transactions reference an
// account's id — the group is derived by lookup.
export const DEFAULT_ACCOUNT_GROUPS = [
  { id: 'grp_bank',   label: 'Bank Accounts', emoji: '🏦', color: '#0ea5e9' },
  { id: 'grp_wallet', label: 'Digital Accounts', emoji: '📲', color: '#8b5cf6' },
  { id: 'grp_cash',   label: 'Cash',          emoji: '💵', color: '#84cc16' },
  { id: 'grp_credit', label: 'Credit Cards',  emoji: '💳', color: '#ec4899' },
];

// Seed exactly ONE default account so the very first "Add expense" flow
// doesn't dead-end at "No account, add one in Settings". Cash is the safe
// choice — universally applicable, non-branded, and clearly labelled so
// the user knows to replace or supplement it with their real accounts
// (HDFC Savings, GPay, HDFC Regalia, …).
//
// Note for migrated users: the previous flat accounts (Cash, Bank, Credit
// Card) survive migration so any existing transactions keep resolving.
export const DEFAULT_ACCOUNTS = [
  { id: 'acc_cash', label: 'Cash', emoji: '💵', color: '#84cc16', groupId: 'grp_cash' },
];

// Preset colors offered in the "Add category / account" form.
// Twelve is a nice compromise — enough variety, still fits neatly.
export const COLOR_PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#10b981', '#14b8a6', '#0ea5e9',
  '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899',
];

// Image scan / upload entry points (expense bill scan, income payslip upload,
// Receipts to Transactions). Switched off for now; flip to true to restore.
export const SCAN_UPLOAD_ENABLED = false;

// Compact category picker (summary row + quick picks + searchable sheet).
// Set to false to go back to the full wrapping chip rows.
export const CATEGORY_SHEET_ENABLED = true;
