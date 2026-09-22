// ----------------------------------------------------------------------------
// goals.js — pure helpers for savings / spending goals.
//
// Goal shape:
//   {
//     id,
//     name,               // "House down payment", "Emergency fund"
//     emoji,              // "🏠", "🚨"
//     targetAmount,       // number ≥ 0
//     deadline,           // ISO string | null
//     kind,               // 'save' — accumulate money toward a target
//                         // 'spend_cap' — stay under a total spend
//     // Sources for progress computation. At least ONE must be set.
//     linkedAssetIds,     // asset ids in NetWorth whose value counts toward
//                         //   progress (e.g. a savings account)
//     linkedCategoryIds,  // for spend_cap: expense category ids to sum
//     startDate,          // ISO string | null — for spend_cap, the "reset"
//                         //   anchor. For save, when the goal started
//                         //   (used to compute expected/actual pace).
//     createdAt,
//     active,             // false → archived, hidden from main list
//   }
//
// Progress computation:
//   - kind='save': current = sum(value of linkedAssetIds).
//                  progress = current / targetAmount.
//                  status: 'ahead' (≥100%), 'on_track' (≥ elapsed%),
//                          'behind' otherwise.
//   - kind='spend_cap': current = sum(expenses in linkedCategoryIds
//                                     since startDate, up to now).
//                       progress = current / targetAmount.
//                       status: 'safe' (<80%), 'warn' (<100%), 'over' (≥100%).
// ----------------------------------------------------------------------------

import { baseAmountOf } from './currency';

export const KINDS = ['save', 'spend_cap'];

export const KIND_META = {
  save: {
    label: 'Save toward a target',
    icon: 'target',
    color: '#059669',
    helper: "Track progress toward a savings target. Pick which Net Worth assets count toward the goal — deposits into those accounts automatically raise your progress.",
  },
  spend_cap: {
    label: 'Cap spending',
    icon: 'octagon',
    color: '#dc2626',
    helper: "Set a maximum you don't want to exceed for one or more expense categories between a start date and deadline.",
  },
};

// Goal dates arrive as full ISO strings (the pickers keep the clock time of
// when they were opened) or, from imports/backups, bare 'YYYY-MM-DD'. A bare
// date is read as LOCAL midnight — new Date('2026-10-01') is UTC midnight,
// which is still Sep 30 for anyone west of Greenwich. Unparseable → null.
export function parseGoalDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  const d = bare
    ? new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3]))
    : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
// Average month length, so a 365-day runway is 12 months (not 12.17).
const DAYS_PER_MONTH = 30.4375;

// Compute progress for a single goal against current NetWorth + expense data.
// `assets` / `expenses` must already be in the base currency (see
// goalInputsInBase) — the target is a base-currency number.
export function computeGoalProgress(goal, { assets = [], expenses = [] } = {}, now = new Date()) {
  const target = Number(goal.targetAmount) || 0;
  const linkedAssetIds    = new Set(goal.linkedAssetIds ?? []);
  const linkedCategoryIds = new Set(goal.linkedCategoryIds ?? []);
  const deadline = parseGoalDate(goal.deadline);

  let current = 0;
  // Linked assets that no longer exist in Net Worth (deleted after the goal
  // was made). They contribute 0, so the UI needs a way to say why.
  let staleLinks = 0;

  if (goal.kind === 'save') {
    const seen = new Set();
    for (const a of assets) {
      if (linkedAssetIds.has(a.id)) {
        current += Number(a.value) || 0;
        seen.add(a.id);
      }
    }
    staleLinks = linkedAssetIds.size - seen.size;
  } else if (goal.kind === 'spend_cap') {
    // A cap conceptually lives inside a window [startDate, deadline], both
    // days inclusive. Pickers keep the clock time of when they were opened,
    // so compare against the whole start day / whole deadline day — otherwise
    // spend earlier on the start day, or later on the deadline day, is dropped.
    const start = parseGoalDate(goal.startDate);
    const windowStart = start ? startOfDay(start).getTime() : null;
    const windowEnd   = deadline ? endOfDay(deadline).getTime() : null;
    for (const e of expenses) {
      if (!linkedCategoryIds.has(e.categoryId)) continue;
      const when = new Date(e.createdAt).getTime();
      if (Number.isNaN(when)) continue;
      if (windowStart != null && when < windowStart) continue;
      if (windowEnd   != null && when > windowEnd)   continue;
      current += Number(e.amount) || 0;
    }
  }

  // Return the TRUE ratio here. Clamping at 1.5 broke goalsSummary's
  // "worst cap" ranking — a cap at 400% and one at 300% both resolved
  // to 1.5, so which one surfaced was arbitrary. The progress-bar UI
  // clamps for display; the ranking logic wants the honest number.
  const percent = target > 0 ? current / target : 0;
  const remaining = Math.max(target - current, 0);

  // Elapsed fraction from startDate → deadline (used to grade "save" goals).
  let elapsedFraction = null;
  if (deadline) {
    const start = parseGoalDate(goal.startDate) ?? parseGoalDate(goal.createdAt);
    if (start && deadline > start) {
      const total = deadline - start;
      const so_far = Math.max(0, Math.min(total, now - start));
      elapsedFraction = so_far / total;
    }
  }

  let status;
  if (goal.kind === 'save') {
    if (percent >= 1)        status = 'complete';
    else if (elapsedFraction != null && percent >= elapsedFraction) status = 'on_track';
    else if (elapsedFraction == null && percent > 0)                status = 'in_progress';
    else                                                            status = 'behind';
  } else {
    if (percent >= 1)        status = 'over';
    else if (percent >= 0.8) status = 'warn';
    else                     status = 'safe';
  }

  // Whole calendar days until the deadline (0 = today, negative = past). The
  // stored deadline carries a clock time, so subtracting instants would be
  // off by one depending on the hour the app is opened.
  let daysLeft = null;
  if (deadline) {
    daysLeft = Math.round((startOfDay(deadline) - startOfDay(now)) / DAY_MS);
  }

  // Monthly amount required to hit target by deadline. Only meaningful for
  // 'save' goals with a deadline that's in the future. Under a month to go
  // the whole remainder is due, so the figure never exceeds what is left.
  let monthlyNeeded = null;
  if (goal.kind === 'save' && deadline && daysLeft != null && daysLeft > 0) {
    const months = Math.max(daysLeft / DAYS_PER_MONTH, 1);
    monthlyNeeded = remaining / months;
  }

  return {
    current,
    target,
    percent,
    remaining,
    status,
    daysLeft,
    monthlyNeeded,
    elapsedFraction,
    staleLinks,
  };
}

// Validation for the date fields of the goal form (null when fine). A cap's
// window must not end before it starts, and a NEW goal can't already be over.
export function goalDateError({ kind, startDate, deadline, isNew = false }, now = new Date()) {
  const end = parseGoalDate(deadline);
  if (!end) return null;
  if (isNew && startOfDay(end) < startOfDay(now)) {
    return 'That deadline has already passed. Pick today or a later date.';
  }
  if (kind === 'spend_cap') {
    const start = parseGoalDate(startDate);
    if (start && startOfDay(end) < startOfDay(start)) {
      return 'The deadline must be on or after the start date.';
    }
  }
  return null;
}

// Assets / expenses with their face amounts rewritten to base currency (via
// the frozen *InBase snapshot, else the current rate). Goal targets are base
// currency, so every caller of computeGoalProgress feeds it these.
export function goalInputsInBase({ assets = [], expenses = [] } = {}, fxRates, baseCurrency) {
  return {
    assets: assets.map((a) => ({ ...a, value: baseAmountOf(a, fxRates, baseCurrency, 'value') })),
    expenses: expenses.map((e) => ({ ...e, amount: baseAmountOf(e, fxRates, baseCurrency, 'amount') })),
  };
}

// Summary across all active goals — used by the Dashboard strip.
export function goalsSummary(goals, { assets = [], expenses = [] } = {}, now = new Date()) {
  const active = (goals ?? []).filter((g) => g.active !== false);
  if (active.length === 0) return null;
  let closestSave = null;
  let worstCap    = null;
  for (const g of active) {
    const p = computeGoalProgress(g, { assets, expenses }, now);
    if (g.kind === 'save' && p.percent < 1) {
      if (!closestSave || p.percent > closestSave.percent) {
        closestSave = { goal: g, ...p };
      }
    } else if (g.kind === 'spend_cap') {
      // A cap whose window has closed can no longer be acted on — don't let
      // it sit on Home as "at risk" until the user archives it by hand.
      if (p.daysLeft != null && p.daysLeft < 0) continue;
      if (!worstCap || p.percent > worstCap.percent) {
        worstCap = { goal: g, ...p };
      }
    }
  }
  return { count: active.length, closestSave, worstCap };
}

/** Asset ids already linked to save goals (optionally excluding one goal while editing). */
export function buildClaimedAssetIdSet(goals = [], { excludeGoalId = null } = {}) {
  const claimed = new Set();
  for (const g of goals) {
    if (g.kind !== 'save') continue;
    if (excludeGoalId && g.id === excludeGoalId) continue;
    for (const id of g.linkedAssetIds ?? []) {
      if (id) claimed.add(id);
    }
  }
  return claimed;
}

export function filterAssetsForGoalPicker(assets = [], goals = [], { excludeGoalId = null } = {}) {
  const claimed = buildClaimedAssetIdSet(goals, { excludeGoalId });
  return assets.filter((a) => !claimed.has(a.id));
}

/** Net Worth asset id mirrored from a Settings account ledger, if any. */
export function assetIdForLinkedAccount(assets = [], accountId) {
  if (!accountId) return null;
  return assets.find((a) => a.linkedAccountId === accountId)?.id ?? null;
}

export function isAccountClaimedByGoal(accountId, assets = [], goals = [], { excludeGoalId = null } = {}) {
  const assetId = assetIdForLinkedAccount(assets, accountId);
  if (!assetId) return false;
  return buildClaimedAssetIdSet(goals, { excludeGoalId }).has(assetId);
}

export function filterAccountsForGoalPicker(accounts = [], assets = [], goals = [], opts = {}) {
  return accounts.filter((acc) => !isAccountClaimedByGoal(acc.id, assets, goals, opts));
}

/** Save-goal assets that are not already mirrored from an account. */
export function filterOtherAssetsForGoalPicker(assets = [], goals = [], opts = {}) {
  return filterAssetsForGoalPicker(assets, goals, opts).filter((a) => !a.linkedAccountId);
}

/** Short tag for asset chips in the save-goal picker (Stock / MF / Cash). */
export function assetPickerTag(asset) {
  if (asset?.portfolioInstrumentKind === 'mutual_fund') return 'MF';
  if (asset?.portfolioInstrumentKind === 'stock') return 'Stock';
  if (asset?.categoryId === 'cash' || asset?.linkedAccountId) return 'Cash';
  return null;
}
