// ----------------------------------------------------------------------------
// insurancePolicies.js — pure helpers for the Insurance policies feature.
//
// Premiums are still logged as normal expense (or investment for ULIP)
// transactions; this module tracks policy metadata, renewal dates, and
// optional links to recurring rules.
// ----------------------------------------------------------------------------

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
    expenseCategoryId: 'bills',
    expenseSubCategoryId: 'bills_insurance',
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

/** Map policy premium frequency to recurring rule frequency (no quarterly). */
export function premiumFrequencyToRecurring(frequency) {
  if (frequency === 'yearly') return 'yearly';
  if (frequency === 'quarterly') return 'monthly';
  return 'monthly';
}

export function normalizePolicy(raw) {
  const type = TYPE_BY_ID[raw?.type] ? raw.type : 'other';
  const defaults = defaultExpenseCategoriesForType(type);
  const freq = PREMIUM_FREQUENCIES.some((f) => f.id === raw?.premiumFrequency)
    ? raw.premiumFrequency
    : 'yearly';

  return {
    id: raw?.id ?? null,
    name: (raw?.name ?? '').trim(),
    type,
    insurer: (raw?.insurer ?? '').trim(),
    policyNumber: (raw?.policyNumber ?? '').trim(),
    premiumAmount: Number(raw?.premiumAmount) || 0,
    premiumFrequency: freq,
    renewalDate: raw?.renewalDate ?? null,
    coverAmount: raw?.coverAmount != null && raw.coverAmount !== ''
      ? Number(raw.coverAmount) || 0
      : null,
    expenseCategoryId: raw?.expenseCategoryId ?? defaults.expenseCategoryId,
    expenseSubCategoryId: raw?.expenseSubCategoryId ?? defaults.expenseSubCategoryId,
    recurringRuleId: raw?.recurringRuleId ?? null,
    tags: Array.isArray(raw?.tags) ? raw.tags.filter(Boolean) : [],
    notes: (raw?.notes ?? '').trim(),
    active: raw?.active !== false,
    createdAt: raw?.createdAt ?? new Date().toISOString(),
  };
}

export function renewalStatus(renewalDate, now = new Date()) {
  if (!renewalDate) return null;
  const d = new Date(renewalDate);
  if (Number.isNaN(d.getTime())) return null;

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
  const note = policy.insurer
    ? `${policy.name} (${policy.insurer})`
    : policy.name;

  return {
    type: txType,
    amount: policy.premiumAmount,
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
