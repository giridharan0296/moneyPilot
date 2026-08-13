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

// Compute progress for a single goal against current NetWorth + expense data.
export function computeGoalProgress(goal, { assets = [], expenses = [] } = {}, now = new Date()) {
  const target = Number(goal.targetAmount) || 0;
  const linkedAssetIds    = new Set(goal.linkedAssetIds ?? []);
  const linkedCategoryIds = new Set(goal.linkedCategoryIds ?? []);

  let current = 0;

  if (goal.kind === 'save') {
    for (const a of assets) {
      if (linkedAssetIds.has(a.id)) current += Number(a.value) || 0;
    }
  } else if (goal.kind === 'spend_cap') {
    // A cap conceptually lives inside a window [startDate, deadline].
    // Previously we only enforced the lower bound — expenses on Aug 1 kept
    // pushing a July cap past 100%, and goalsSummary's "worst cap" got
    // dominated by expired caps until the user archived them by hand.
    const start = goal.startDate ? new Date(goal.startDate) : null;
    const end   = goal.deadline  ? new Date(goal.deadline)  : null;
    for (const e of expenses) {
      if (!linkedCategoryIds.has(e.categoryId)) continue;
      const when = new Date(e.createdAt);
      if (start && when < start) continue;
      if (end   && when > end)   continue;
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
  if (goal.deadline) {
    const deadline = new Date(goal.deadline);
    const start = goal.startDate
      ? new Date(goal.startDate)
      : (goal.createdAt ? new Date(goal.createdAt) : null);
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

  // Days remaining until the deadline (may be negative).
  let daysLeft = null;
  if (goal.deadline) {
    const ms = new Date(goal.deadline) - now;
    daysLeft = Math.ceil(ms / (24 * 60 * 60 * 1000));
  }

  // Monthly amount required to hit target by deadline. Only meaningful for
  // 'save' goals with a deadline that's in the future.
  let monthlyNeeded = null;
  if (goal.kind === 'save' && goal.deadline && daysLeft != null && daysLeft > 0) {
    const months = Math.max(daysLeft / 30, 1 / 30);
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
  };
}

// Summary across all active goals — used by the Dashboard strip.
export function goalsSummary(goals, { assets = [], expenses = [] } = {}) {
  const active = goals.filter((g) => g.active !== false);
  if (active.length === 0) return null;
  let closestSave = null;
  let worstCap    = null;
  for (const g of active) {
    const p = computeGoalProgress(g, { assets, expenses });
    if (g.kind === 'save' && p.percent < 1) {
      if (!closestSave || p.percent > closestSave.percent) {
        closestSave = { goal: g, ...p };
      }
    } else if (g.kind === 'spend_cap') {
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

/** Short tag for asset chips in the save-goal picker (Stock / MF / Cash). */
export function assetPickerTag(asset) {
  if (asset?.portfolioInstrumentKind === 'mutual_fund') return 'MF';
  if (asset?.portfolioInstrumentKind === 'stock') return 'Stock';
  if (asset?.categoryId === 'cash' || asset?.linkedAccountId) return 'Cash';
  return null;
}
