// ----------------------------------------------------------------------------
// entitlements.js — pure plan limits and usage counting (Free vs Pro).
//
// These are SOFT limits: counters live on the device, so they stop normal use
// rather than a determined user. Enforcement against a real purchase needs a
// store-verified entitlement, which is not wired up yet.
//
//   accounts    — total accounts held at once (not weekly)
//   imports     — statement / file imports per ISO week
//   calculators      — calculator screens opened per ISO week
//   receiptSessions  — receipt-to-transaction sessions per ISO week
//   ai               — AI Insights generation (on/off)
// ----------------------------------------------------------------------------

export const PLANS = ['free', 'pro'];

export const PLAN_LIMITS = {
  free: { accounts: 3, imports: 3, calculators: 10, receiptSessions: 3, ai: false },
  pro:  { accounts: Infinity, imports: Infinity, calculators: Infinity, receiptSessions: 5, ai: true },
};

export const WEEKLY_FEATURES = ['imports', 'calculators', 'receiptSessions'];

const FEATURE_LABELS = {
  accounts: 'accounts',
  imports: 'statement imports',
  calculators: 'calculator uses',
  receiptSessions: 'receipt sessions',
};

/** ISO week key in local time, e.g. "2026-W40". Weeks start on Monday. */
export function weekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayOfWeek = d.getUTCDay() || 7; // Mon=1 … Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek); // Thursday decides the ISO year
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Usage for the current week. Counts from a previous week are discarded. */
export function normalizeUsage(raw, now = new Date()) {
  const week = weekKey(now);
  const counts = Object.fromEntries(WEEKLY_FEATURES.map((f) => [f, 0]));
  if (raw && raw.week === week && raw.counts) {
    for (const f of WEEKLY_FEATURES) {
      const n = Number(raw.counts[f]);
      if (Number.isFinite(n) && n > 0) counts[f] = Math.floor(n);
    }
  }
  return { week, counts };
}

/** Usage after one more use of a weekly feature. */
export function addUse(raw, feature, now = new Date()) {
  const usage = normalizeUsage(raw, now);
  return { ...usage, counts: { ...usage.counts, [feature]: usage.counts[feature] + 1 } };
}

/** Usage after giving back one use, e.g. when the provider failed for us. Never below zero. */
export function subtractUse(raw, feature, now = new Date()) {
  const usage = normalizeUsage(raw, now);
  const next = Math.max(0, usage.counts[feature] - 1);
  return { ...usage, counts: { ...usage.counts, [feature]: next } };
}

/**
 * Whether `feature` is allowed on `plan`.
 *   used — current count for weekly features, or accounts held for `accounts`.
 */
export function checkAccess(plan, feature, used = 0) {
  const limits = PLAN_LIMITS[PLANS.includes(plan) ? plan : 'free'];
  if (feature === 'ai') {
    return { allowed: limits.ai, used: 0, limit: limits.ai ? Infinity : 0, remaining: limits.ai ? Infinity : 0 };
  }
  if (!(feature in limits)) return { allowed: false, used, limit: 0, remaining: 0 };
  const limit = limits[feature];
  return {
    allowed: used < limit,
    used,
    limit,
    remaining: Math.max(0, limit - used),
  };
}

/** Short user-facing explanation for a blocked feature. */
export function limitMessage(feature, status) {
  if (feature === 'ai') {
    return 'AI Insights is a Pro feature. The Free plan includes the rest of the app.';
  }
  const label = FEATURE_LABELS[feature] ?? feature;
  const period = WEEKLY_FEATURES.includes(feature) ? ' this week' : '';
  return `You have reached the Free plan limit of ${status.limit} ${label}${period}. Pro removes this limit.`;
}
