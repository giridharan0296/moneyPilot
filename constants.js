// ----------------------------------------------------------------------------
// DEFAULT app data. These are only used the very first time the app runs
// (before the user has customized anything). After that, the SettingsContext
// takes over — it reads user's categories/accounts from AsyncStorage and
// only falls back here if storage is empty.
//
// Renamed to DEFAULT_* to make it explicit that these are seed values,
// not the source of truth at runtime.
// ----------------------------------------------------------------------------

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

  // Net worth: what you own (assets) and what you owe (liabilities)
  assets:                         '@financeApp/networth/assets/v1',
  liabilities:                    '@financeApp/networth/liabilities/v1',
  // Rolling per-day net-worth snapshots — feeds NetWorthChart. Managed
  // via lib/netWorthHistory.js. Capped and dedup'd by day.
  networth_history:               '@financeApp/networth/history/v1',

  // API key for OpenAI Whisper (voice-note transcription). Stored locally.
  // Consider expo-secure-store for production use.
  settings_whisper_api_key:       '@financeApp/settings/whisperApiKey/v1',

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
  // secure store — see SettingsContext.setAiApiKey.
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
    hint: 'Console → Portfolio → Holdings → Download (CSV or XLSX).',
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
    hint: 'Any CSV with columns for symbol, quantity, average price, and current price.',
  },
];

// Categories can optionally contain a `subCategories` list. Sub-categories
// have the same shape as categories (id/label/emoji/color) but scope their
// ids to be locally unique within the parent — they're always looked up
// through the parent (`category.subCategories.find(...)`), never globally.
export const DEFAULT_EXPENSE_CATEGORIES = [
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
      { id: 'food_dining_out',   label: 'Dining Out',    emoji: '🍷', color: '#dc2626' },
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
      { id: 'transport_public',      label: 'Bus',              emoji: '🚌', color: '#0284c7' },
      { id: 'transport_metro',       label: 'Metro / Train',    emoji: '🚆', color: '#4f46e5' },
      { id: 'transport_travel',      label: 'Flight / Travel',  emoji: '✈️', color: '#6366f1' },
      { id: 'transport_parking',     label: 'Parking',          emoji: '🅿️', color: '#64748b' },
      { id: 'transport_toll',        label: 'Toll / FASTag',    emoji: '🛣️', color: '#78716c' },
      { id: 'transport_maintenance', label: 'Service / Repair', emoji: '🛠️', color: '#7c2d12' },
      { id: 'transport_insurance',   label: 'Vehicle Insurance',emoji: '🛡️', color: '#0d9488' },
    ],
  },
  {
    id: 'shopping', label: 'Shopping', emoji: '🛍️', color: '#ec4899',
    subCategories: [
      { id: 'shopping_clothes',      label: 'Clothes',       emoji: '👕', color: '#ec4899' },
      { id: 'shopping_footwear',     label: 'Footwear',      emoji: '👟', color: '#be185d' },
      { id: 'shopping_accessories',  label: 'Accessories',   emoji: '👜', color: '#db2777' },
      { id: 'shopping_electronics',  label: 'Electronics',   emoji: '💻', color: '#8b5cf6' },
      { id: 'shopping_household',    label: 'Household',     emoji: '🏠', color: '#f43f5e' },
      { id: 'shopping_furniture',    label: 'Furniture',     emoji: '🛋️', color: '#a16207' },
      { id: 'shopping_appliances',   label: 'Appliances',    emoji: '🔌', color: '#6366f1' },
      { id: 'shopping_beauty',       label: 'Beauty / Care', emoji: '💄', color: '#f472b6' },
      { id: 'shopping_books',        label: 'Books',         emoji: '📚', color: '#7c3aed' },
      { id: 'shopping_kids',         label: 'Kids / Toys',   emoji: '🧸', color: '#fb7185' },
      { id: 'shopping_sports',       label: 'Sports Gear',   emoji: '⚽', color: '#10b981' },
      { id: 'shopping_jewelry',      label: 'Jewelry',       emoji: '💍', color: '#eab308' },
      { id: 'shopping_gifts',        label: 'Gifts Given',   emoji: '🎁', color: '#a855f7' },
    ],
  },
  {
    id: 'bills', label: 'Bills', emoji: '🧾', color: '#10b981',
    subCategories: [
      { id: 'bills_rent',           label: 'Rent',              emoji: '🏠', color: '#10b981' },
      { id: 'bills_maintenance',    label: 'Maintenance / Society', emoji: '🧹', color: '#059669' },
      { id: 'bills_electricity',    label: 'Electricity',       emoji: '💡', color: '#f59e0b' },
      { id: 'bills_water',          label: 'Water',             emoji: '🚰', color: '#0ea5e9' },
      { id: 'bills_gas',            label: 'Gas / LPG',         emoji: '🔥', color: '#ea580c' },
      { id: 'bills_internet',       label: 'Internet',          emoji: '🌐', color: '#0ea5e9' },
      { id: 'bills_phone',          label: 'Phone / Mobile',    emoji: '📱', color: '#6366f1' },
      { id: 'bills_dth',            label: 'DTH / Cable',       emoji: '📺', color: '#7c3aed' },
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
    id: 'health', label: 'Health', emoji: '💊', color: '#ef4444',
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
    id: 'fun', label: 'Fun', emoji: '🎉', color: '#8b5cf6',
    subCategories: [
      { id: 'fun_movies',        label: 'Movies',        emoji: '🎬', color: '#8b5cf6' },
      { id: 'fun_subscriptions', label: 'Streaming',     emoji: '📺', color: '#a855f7' },
      { id: 'fun_games',         label: 'Games',         emoji: '🎮', color: '#6366f1' },
      { id: 'fun_concerts',      label: 'Concerts / Events', emoji: '🎤', color: '#ec4899' },
      { id: 'fun_sports',        label: 'Sports',        emoji: '⚽', color: '#10b981' },
      { id: 'fun_hobbies',       label: 'Hobbies',       emoji: '🎨', color: '#f97316' },
      { id: 'fun_books',         label: 'Books',         emoji: '📖', color: '#7c3aed' },
      { id: 'fun_party',         label: 'Party',         emoji: '🥳', color: '#f43f5e' },
      { id: 'fun_travel',        label: 'Weekend Trip',  emoji: '🏖️', color: '#0ea5e9' },
    ],
  },
  {
    id: 'other', label: 'Other', emoji: '📦', color: '#6b7280',
    subCategories: [
      { id: 'other_donation',  label: 'Donation',       emoji: '🤝', color: '#f97316' },
      { id: 'other_fees',      label: 'Fees & Charges', emoji: '📄', color: '#6b7280' },
      { id: 'other_repairs',   label: 'Repairs',        emoji: '🔧', color: '#78716c' },
      { id: 'other_pets',      label: 'Pets',           emoji: '🐾', color: '#a16207' },
      { id: 'other_education', label: 'Education',      emoji: '🎓', color: '#4f46e5' },
      { id: 'other_kids',      label: 'Kids',           emoji: '👶', color: '#fb7185' },
      { id: 'other_gifts',     label: 'Gifts Given',    emoji: '🎁', color: '#a855f7' },
      { id: 'other_salon',     label: 'Salon / Grooming', emoji: '💇', color: '#ec4899' },
      { id: 'other_legal',     label: 'Legal',          emoji: '⚖️', color: '#78716c' },
      { id: 'other_tax',       label: 'Tax Payment',    emoji: '🏛️', color: '#dc2626' },
      { id: 'other_misc',      label: 'Miscellaneous',  emoji: '❓', color: '#6b7280' },
    ],
  },
];

export const DEFAULT_INCOME_CATEGORIES = [
  {
    id: 'salary', label: 'Salary', emoji: '💼', color: '#059669',
    subCategories: [
      { id: 'salary_base',          label: 'Base Pay',      emoji: '💵', color: '#059669' },
      { id: 'salary_bonus',         label: 'Bonus',         emoji: '🎁', color: '#10b981' },
      { id: 'salary_incentive',     label: 'Incentive',     emoji: '🏆', color: '#84cc16' },
      { id: 'salary_overtime',      label: 'Overtime',      emoji: '⏰', color: '#f59e0b' },
      { id: 'salary_commission',    label: 'Commission',    emoji: '📊', color: '#0ea5e9' },
      { id: 'salary_reimbursement', label: 'Reimbursement', emoji: '💵', color: '#0d9488' },
      { id: 'salary_esop',          label: 'ESOP / RSU',    emoji: '📈', color: '#6366f1' },
    ],
  },
  {
    id: 'freelance', label: 'Freelance', emoji: '💻', color: '#0ea5e9',
    subCategories: [
      { id: 'freelance_client',     label: 'Client Work',    emoji: '🧑‍💻', color: '#0ea5e9' },
      { id: 'freelance_consulting', label: 'Consulting',     emoji: '🗂️', color: '#0284c7' },
      { id: 'freelance_content',    label: 'Content Creation', emoji: '🎥', color: '#7c3aed' },
      { id: 'freelance_teaching',   label: 'Teaching / Tuition', emoji: '📚', color: '#f59e0b' },
      { id: 'freelance_royalty',    label: 'Royalty',        emoji: '📜', color: '#0284c7' },
      { id: 'freelance_tips',       label: 'Tips',           emoji: '🪙', color: '#eab308' },
    ],
  },
  {
    id: 'investments', label: 'Investments', emoji: '📈', color: '#14b8a6',
    subCategories: [
      { id: 'income_dividend', label: 'Dividend',       emoji: '💰', color: '#14b8a6' },
      { id: 'income_interest', label: 'Interest',       emoji: '🏦', color: '#0d9488' },
      { id: 'income_capgain',  label: 'Capital Gain',   emoji: '📈', color: '#0891b2' },
      { id: 'income_rental',   label: 'Rental Income',  emoji: '🏠', color: '#059669' },
      { id: 'income_coupon',   label: 'Bond Coupon',    emoji: '📃', color: '#6366f1' },
      { id: 'income_maturity', label: 'FD / RD Maturity', emoji: '🏦', color: '#0369a1' },
      { id: 'income_swp',      label: 'SWP Payout', emoji: '🔄', color: '#059669' },
      { id: 'income_mis',      label: 'MIS Interest Payout', emoji: '💵', color: '#0d9488' },
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
      { id: 'other_reimbursement', label: 'Reimbursement',  emoji: '💵', color: '#10b981' },
      { id: 'other_cashback',      label: 'Cashback',       emoji: '💳', color: '#0ea5e9' },
      { id: 'other_rewards',       label: 'Rewards Points', emoji: '🎯', color: '#a855f7' },
      { id: 'other_sale',          label: 'Sale of Item',   emoji: '🏷️', color: '#6b7280' },
      { id: 'other_prize',         label: 'Prize / Lottery',emoji: '🏆', color: '#eab308' },
      { id: 'other_loan_received', label: 'Loan Received',  emoji: '🤝', color: '#f59e0b' },
      { id: 'other_rent_received', label: 'Rent Received',  emoji: '🏠', color: '#059669' },
      { id: 'other_pocket',        label: 'Pocket Money',   emoji: '🪙', color: '#78716c' },
    ],
  },
];

export const DEFAULT_INVESTMENT_CATEGORIES = [
  {
    id: 'stocks', label: 'Stocks', emoji: '📊', color: '#6366f1',
    subCategories: [
      { id: 'stocks_indian',    label: 'Indian',       emoji: '🇮🇳', color: '#6366f1' },
      { id: 'stocks_us',        label: 'US',           emoji: '🇺🇸', color: '#4f46e5' },
      { id: 'stocks_dividend',  label: 'Dividend',     emoji: '💰', color: '#4338ca' },
      { id: 'stocks_ipo',       label: 'IPO',          emoji: '🎯', color: '#0ea5e9' },
      { id: 'stocks_fno',       label: 'F&O',          emoji: '⚡', color: '#dc2626' },
      { id: 'stocks_esop',      label: 'ESOP / RSU',   emoji: '🏢', color: '#8b5cf6' },
      { id: 'stocks_intl',      label: 'International',emoji: '🌐', color: '#0284c7' },
    ],
  },
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
      { id: 'mf_sip',           label: 'SIP',               emoji: '🔁', color: '#f59e0b' },
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
    id: 'gold', label: 'Gold', emoji: '🥇', color: '#f59e0b',
    subCategories: [
      { id: 'gold_physical',   label: 'Physical',      emoji: '🥇', color: '#f59e0b' },
      { id: 'gold_etf',        label: 'Gold ETF',      emoji: '📈', color: '#eab308' },
      { id: 'gold_sgb',        label: 'SGB',           emoji: '🏛️', color: '#ca8a04' },
      { id: 'gold_digital',    label: 'Digital Gold',  emoji: '📱', color: '#d97706' },
      { id: 'gold_silver',     label: 'Silver',        emoji: '🥈', color: '#94a3b8' },
    ],
  },
  {
    id: 'fd', label: 'Fixed Deposit', emoji: '🏦', color: '#0ea5e9',
    subCategories: [
      { id: 'fd_bank',      label: 'Bank FD',           emoji: '🏦', color: '#0ea5e9' },
      { id: 'fd_corporate', label: 'Corporate FD',      emoji: '🏢', color: '#0284c7' },
      { id: 'fd_recurring', label: 'Recurring Deposit', emoji: '🔄', color: '#0369a1' },
      { id: 'fd_tax_saver', label: 'Tax-saver FD',      emoji: '🧾', color: '#0d9488' },
      { id: 'fd_ssy',       label: 'SSY',               emoji: '👧', color: '#ec4899' },
      { id: 'fd_kvp',       label: 'KVP / NSC',         emoji: '📜', color: '#a16207' },
    ],
  },
  {
    id: 'real_estate', label: 'Real Estate', emoji: '🏠', color: '#14b8a6',
    subCategories: [
      { id: 're_residential', label: 'Residential', emoji: '🏠', color: '#14b8a6' },
      { id: 're_commercial',  label: 'Commercial',  emoji: '🏢', color: '#0d9488' },
      { id: 're_land',        label: 'Land / Plot', emoji: '🌳', color: '#84cc16' },
      { id: 're_reit',        label: 'REIT',        emoji: '📈', color: '#0891b2' },
    ],
  },
  {
    id: 'other', label: 'Other', emoji: '💼', color: '#6b7280',
    subCategories: [
      { id: 'other_bonds',       label: 'Bonds / T-Bill', emoji: '📃', color: '#6366f1' },
      { id: 'other_ppf_nps',     label: 'PPF',            emoji: '🏛️', color: '#7c3aed' },
      { id: 'other_nps',         label: 'NPS',            emoji: '🏛️', color: '#a855f7' },
      { id: 'other_epf',         label: 'EPF',            emoji: '🏢', color: '#4338ca' },
      { id: 'other_insurance',   label: 'ULIP / Endowment', emoji: '🛡️', color: '#0d9488' },
      { id: 'other_startup',     label: 'Startup',        emoji: '🚀', color: '#f97316' },
      { id: 'other_p2p',         label: 'P2P Lending',    emoji: '🤝', color: '#f59e0b' },
      { id: 'other_chit',        label: 'Chit Fund',      emoji: '💼', color: '#dc2626' },
      { id: 'other_collectible', label: 'Collectibles',   emoji: '🎨', color: '#ec4899' },
    ],
  },
];

// Account GROUPS are containers ("Bank Accounts", "Wallets", "Cash", ...).
// Groups hold one or more concrete accounts. Transactions reference an
// account's id — the group is derived by lookup.
export const DEFAULT_ACCOUNT_GROUPS = [
  { id: 'grp_bank',   label: 'Bank Accounts', emoji: '🏦', color: '#0ea5e9' },
  { id: 'grp_wallet', label: 'Wallets',       emoji: '📱', color: '#8b5cf6' },
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
