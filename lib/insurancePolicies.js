// ----------------------------------------------------------------------------
// insurancePolicies.js — pure helpers for the Insurance policies feature.
//
// Premiums are still logged as normal expense (or investment for ULIP)
// transactions; this module tracks policy metadata, renewal dates, and
// optional links to recurring rules.
// ----------------------------------------------------------------------------

import { roundMoney } from './currency';

export const POLICY_TYPES = [
  {
    id: 'health',
    label: 'Health',
    emoji: '🏥',
    expenseCategoryId: 'health',
    expenseSubCategoryId: 'health_insurance',
  },
  {
    id: 'term',
    label: 'Term life',
    emoji: '🛡️',
    expenseCategoryId: 'bills',
    expenseSubCategoryId: 'bills_insurance',
  },
  {
    id: 'motor',
    label: 'Motor',
    emoji: '🚗',
    expenseCategoryId: 'transport',
    expenseSubCategoryId: 'transport_insurance',
  },
  {
    id: 'home',
    label: 'Home',
    emoji: '🏠',
    expenseCategoryId: 'bills',
    expenseSubCategoryId: 'bills_insurance',
  },
  {
    id: 'travel',
    label: 'Travel',
    emoji: '✈️',
    expenseCategoryId: 'travel',
    expenseSubCategoryId: null,
  },
  {
    id: 'ulip',
    label: 'ULIP / Endowment',
    emoji: '📈',
    // Premiums log as INVESTMENTS, so these are investment category ids —
    // an expense category ('bills') doesn't exist for that transaction type.
    expenseCategoryId: 'insurance_investments',
    expenseSubCategoryId: 'insurance_ulip',
    premiumAsInvestment: true,
  },
  {
    id: 'other',
    label: 'Other',
    emoji: '📋',
    expenseCategoryId: 'bills',
    expenseSubCategoryId: 'bills_insurance',
  },
];

export const PREMIUM_FREQUENCIES = [
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'yearly', label: 'Yearly' },
];

const TYPE_BY_ID = Object.fromEntries(POLICY_TYPES.map((t) => [t.id, t]));

export function policyTypeMeta(typeId) {
  return TYPE_BY_ID[typeId] ?? TYPE_BY_ID.other;
}

export function defaultExpenseCategoriesForType(typeId) {
  const t = policyTypeMeta(typeId);
  return {
    expenseCategoryId: t.expenseCategoryId,
    expenseSubCategoryId: t.expenseSubCategoryId ?? null,
  };
}

export function premiumTransactionType(typeId) {
  return policyTypeMeta(typeId).premiumAsInvestment ? 'investment' : 'expense';
}

/** Map policy premium frequency to recurring rule frequency (no quarterly).
 *  A quarterly premium becomes a monthly rule — see recurringTemplateFromPolicy
 *  for how the amount is scaled so it isn't tripled. */
export function premiumFrequencyToRecurring(frequency) {
  if (frequency === 'yearly') return 'yearly';
  if (frequency === 'quarterly') return 'monthly';
  return 'monthly';
}

// A bare 'YYYY-MM-DD' (imports / backups) is LOCAL midnight; new Date() would
// read it as UTC and show the wrong day west of Greenwich. Bad input → null.
function parseRenewalDate(value) {
  if (value == null || value === '') return null;
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  const d = bare
    ? new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3]))
    : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Money fields must be finite and positive; anything else (NaN, negative,
// Infinity from a hand-edited backup) collapses to 0 / null instead of
// poisoning totals.
function positiveOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function normalizePolicy(raw) {
  const type = TYPE_BY_ID[raw?.type] ? raw.type : 'other';
  const defaults = defaultExpenseCategoriesForType(type);
  // ULIP policies saved before investment categories were used carry the old
  // expense default; move them to the investment one.
  const legacyUlip = TYPE_BY_ID[type].premiumAsInvestment && raw?.expenseCategoryId === 'bills';
  const categoryGiven = raw?.expenseCategoryId != null && !legacyUlip;
  const freq = PREMIUM_FREQUENCIES.some((f) => f.id === raw?.premiumFrequency)
    ? raw.premiumFrequency
    : 'yearly';

  return {
    id: raw?.id ?? null,
    name: (raw?.name ?? '').trim(),
    type,
    insurer: (raw?.insurer ?? '').trim(),
    policyNumber: (raw?.policyNumber ?? '').trim(),
    premiumAmount: positiveOrZero(raw?.premiumAmount),
    premiumFrequency: freq,
    renewalDate: raw?.renewalDate ?? null,
    coverAmount: raw?.coverAmount != null && raw.coverAmount !== ''
      ? positiveOrZero(raw.coverAmount)
      : null,
    expenseCategoryId: categoryGiven ? raw.expenseCategoryId : defaults.expenseCategoryId,
    // The type's default sub-category belongs to the type's default category;
    // pairing it with a category the user chose would point at a sub-category
    // that isn't under it.
    expenseSubCategoryId: categoryGiven
      ? (raw.expenseSubCategoryId ?? null)
      : defaults.expenseSubCategoryId,
    recurringRuleId: raw?.recurringRuleId ?? null,
    tags: Array.isArray(raw?.tags) ? raw.tags.filter(Boolean) : [],
    notes: (raw?.notes ?? '').trim(),
    active: raw?.active !== false,
    createdAt: raw?.createdAt ?? new Date().toISOString(),
  };
}

export function renewalStatus(renewalDate, now = new Date()) {
  const d = parseRenewalDate(renewalDate);
  if (!d) return null;

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfRenewal = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((startOfRenewal - startOfToday) / (24 * 60 * 60 * 1000));

  if (days < 0) {
    return { kind: 'overdue', days: Math.abs(days), label: `${Math.abs(days)}d overdue` };
  }
  if (days === 0) {
    return { kind: 'soon', days: 0, label: 'Due today' };
  }
  if (days <= 30) {
    return { kind: 'soon', days, label: `${days}d left` };
  }
  return {
    kind: 'ok',
    days,
    label: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
  };
}

export function recurringTemplateFromPolicy(policy) {
  const txType = premiumTransactionType(policy.type);
  const frequency = premiumFrequencyToRecurring(policy.premiumFrequency);
  const baseNote = policy.insurer
    ? `${policy.name} (${policy.insurer})`
    : policy.name;
  // Recurring rules have no quarterly cadence. Rather than triple the outflow
  // with the full premium every month, spread it over three monthly instalments.
  const quarterly = policy.premiumFrequency === 'quarterly';
  const note = quarterly ? `${baseNote} (quarterly premium ÷ 3)` : baseNote;

  return {
    type: txType,
    amount: quarterly ? roundMoney(policy.premiumAmount / 3) : policy.premiumAmount,
    categoryId: policy.expenseCategoryId,
    subCategoryId: policy.expenseSubCategoryId,
    note,
    frequency,
    startDate: policy.renewalDate ?? new Date().toISOString(),
    active: true,
  };
}

export function expensePrefillFromPolicy(policy) {
  const txType = premiumTransactionType(policy.type);
  return {
    type: txType,
    prefill: {
      amount: policy.premiumAmount,
      categoryId: policy.expenseCategoryId,
      subCategoryId: policy.expenseSubCategoryId,
      note: policy.insurer ? `${policy.name} (${policy.insurer})` : policy.name,
      tags: policy.tags ?? [],
    },
  };
}
