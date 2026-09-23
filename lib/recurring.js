// ----------------------------------------------------------------------------
// recurring.js — pure date math for recurring transaction rules.
//
// No React, no AsyncStorage, no side effects: given a rule + a "now" date,
// this file tells you the next occurrence, or every missed occurrence, or a
// human label for the schedule. Keeping this pure makes it trivially
// testable and lets the same functions power both the runtime auto-add on
// app start and the "Next: <date>" preview shown next to each rule.
//
// Frequency semantics ("advance by interval from anchor"):
//   daily   → +1 day at a time
//   weekly  → +7 days at a time
//   monthly → +1 calendar month. Modes:
//               'date'             → anchor day-of-month (default; auto-clamped
//                                    to last day of shorter months so "31st"
//                                    still fires every month)
//               'lastWorkingDay'   → last Mon–Fri of the month
//               'firstWorkingDay'  → first Mon–Fri of the month
//               'nthWeekday'       → e.g. "2nd Friday", "last Wednesday"
//                                    (needs `nthWeek` 1..4 or -1 for "last",
//                                    and `weekday` 0..6 where 0=Sun)
//   yearly  → +1 calendar year (Feb 29 → Feb 28 on non-leap years)
//
// Public API:
//   nextOccurrenceAfter(rule, from)     → Date | null (strictly after `from`)
//   upcomingOccurrence(rule, today?)    → Date | null (at or after today)
//   generateDueOccurrences(rule, now?)  → Date[] (missed since lastRunDate)
//   planRuleSweep(rules, ctx)           → what the startup sweep should add
//   formatFrequency(rule)               → human label
//   applyRulePatch(rule, patch, now?)   → the edited rule (re-anchors, resume)
//   transactionFromRule(rule, date)     → transaction shape for adder
//   FREQUENCIES                         → picker options
// ----------------------------------------------------------------------------

import { lookupRate, roundMoney } from './currency';

export const FREQUENCIES = [
  { id: 'daily',   label: 'Daily',   icon: 'calendar' },
  { id: 'weekly',  label: 'Weekly',  icon: 'calendar' },
  { id: 'monthly', label: 'Monthly', icon: 'calendar' },
  { id: 'yearly',  label: 'Yearly',  icon: 'calendar' },
];

// Monthly-mode options exported for the form picker. Only meaningful when
// frequency === 'monthly'. Older rules without a mode are treated as 'date'.
export const MONTHLY_MODES = [
  { id: 'date',             label: 'Specific date',            icon: 'pin' },
  { id: 'lastWorkingDay',   label: 'Last working day',         icon: 'flag' },
  { id: 'firstWorkingDay',  label: 'First working day',        icon: 'zap' },
  { id: 'nthWeekday',       label: 'Nth weekday (e.g. 2nd Fri)', icon: 'calendar' },
];

// Weekday names for the nth-weekday picker + labels. Order matches JS
// Date.getDay() (0 = Sunday .. 6 = Saturday) so no conversion needed anywhere.
export const WEEKDAYS = [
  { id: 0, short: 'Sun', long: 'Sunday' },
  { id: 1, short: 'Mon', long: 'Monday' },
  { id: 2, short: 'Tue', long: 'Tuesday' },
  { id: 3, short: 'Wed', long: 'Wednesday' },
  { id: 4, short: 'Thu', long: 'Thursday' },
  { id: 5, short: 'Fri', long: 'Friday' },
  { id: 6, short: 'Sat', long: 'Saturday' },
];

// Nth-week choices; -1 sentinel means "the last one in the month" (used so we
// don't have to store the string 'last' anywhere and can compare numerically).
export const NTH_WEEK_CHOICES = [
  { id: 1,  label: '1st' },
  { id: 2,  label: '2nd' },
  { id: 3,  label: '3rd' },
  { id: 4,  label: '4th' },
  { id: -1, label: 'Last' },
];

// Return a new Date at 00:00 local time (midnight-aligned). Recurring rules
// don't have a wall-clock time — we just care about the day.
function midnight(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Number of days in `year` / `month` (month is 0-indexed like Date).
function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

// True for Saturday / Sunday. Public holidays are intentionally NOT
// considered — see the README-style note at the top of the file.
function isWeekend(d) {
  const dow = d.getDay();
  return dow === 0 || dow === 6;
}

// Last Mon–Fri of the given month.
function lastWorkingDayOfMonth(year, month) {
  const d = new Date(year, month, daysInMonth(year, month));
  while (isWeekend(d)) d.setDate(d.getDate() - 1);
  return midnight(d);
}

// First Mon–Fri of the given month.
function firstWorkingDayOfMonth(year, month) {
  const d = new Date(year, month, 1);
  while (isWeekend(d)) d.setDate(d.getDate() + 1);
  return midnight(d);
}

// Nth occurrence of `weekday` (0=Sun..6=Sat) in the given month.
// `nth` is 1..4, or -1 for "the last one in the month".
// If nth === 5 (or nth === 4 for a month that only has 4) and the target
// weekday doesn't have that many occurrences, we fall back to the last
// occurrence in that month so the rule never silently skips a month.
function nthWeekdayOfMonth(year, month, nth, weekday) {
  if (nth === -1) {
    const d = new Date(year, month, daysInMonth(year, month));
    while (d.getDay() !== weekday) d.setDate(d.getDate() - 1);
    return midnight(d);
  }
  const first = new Date(year, month, 1);
  while (first.getDay() !== weekday) first.setDate(first.getDate() + 1);
  const target = new Date(first);
  target.setDate(first.getDate() + (nth - 1) * 7);
  if (target.getMonth() !== month) {
    // Overshot — this month doesn't have an Nth <weekday>. Fall back to the
    // most recent one that IS in this month.
    while (target.getMonth() !== month) target.setDate(target.getDate() - 7);
  }
  return midnight(target);
}

// Parse a "YYYY-MM-DD" LOCAL calendar string into a Date at local midnight.
// Unlike `new Date(iso)` which is instant-in-time (TZ-sensitive), the returned
// Date has the same Y/M/D fields as the input on every device — so it's the
// right primitive for "the calendar day the user chose in the picker".
//
// Returns null when the input isn't the expected shape.
function parseLocalDateString(s) {
  if (typeof s !== 'string') return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!isFinite(y) || !isFinite(mo) || !isFinite(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const out = new Date(y, mo - 1, d);
  out.setHours(0, 0, 0, 0);
  return out;
}

// Rule dates are ISO instants we wrote ourselves, but a hand-edited backup or a
// template can carry a bare 'YYYY-MM-DD'. That is a LOCAL calendar day; new
// Date() would read it as UTC midnight and land on the previous day anywhere
// west of Greenwich.
export function parseRuleDate(value) {
  if (value instanceof Date) return new Date(value.getTime());
  return parseLocalDateString(value) ?? new Date(value);
}

// The rule's ORIGINAL local-calendar anchor as a Date at local midnight.
// This is the single source of truth for "the day the user picked when
// creating this rule". Order of preference:
//   1) rule.startDateLocal ("YYYY-MM-DD") — new field, timezone-safe.
//   2) rule.startDate (ISO instant) — legacy fallback. Interpreted in the
//      current device's local timezone, which is wrong if the rule was
//      authored on a different device — but is the best we can do for
//      pre-migration data.
//
// Used by anchorDayForRule / firstOccurrenceForRule / formatFrequency so
// every consumer agrees on which day the user meant.
function getRuleAnchorDate(rule) {
  if (!rule) return null;
  const localFromString = parseLocalDateString(rule.startDateLocal);
  if (localFromString) return localFromString;
  if (rule.startDate) {
    const d = parseRuleDate(rule.startDate);
    if (!isNaN(d.getTime())) return midnight(d);
  }
  return null;
}

// Format a Date as "YYYY-MM-DD" in the LOCAL calendar. Used to build tx
// ids and to persist startDateLocal on rule create/update.
function dayKeyLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Read the anchor day-of-month for a monthly-by-date rule.
//
// Preference order:
//   1) rule.anchorDay (integer 1..31) — explicit persisted anchor.
//   2) getRuleAnchorDate's day-of-month — derives from startDateLocal or
//      falls back to startDate in device TZ.
function anchorDayForRule(rule) {
  if (rule?.anchorDay != null) {
    const n = Math.round(Number(rule.anchorDay));
    if (n >= 1 && n <= 31) return n;
  }
  const anchor = getRuleAnchorDate(rule);
  return anchor ? anchor.getDate() : 1;
}

// Same idea for yearly rules: month/day pair.
function anchorMonthDayForRule(rule) {
  const anchor = getRuleAnchorDate(rule);
  const month = rule?.anchorMonth != null
    ? Math.round(Number(rule.anchorMonth))
    : (anchor ? anchor.getMonth() : 0);
  const day = rule?.anchorDay != null
    ? Math.round(Number(rule.anchorDay))
    : (anchor ? anchor.getDate() : 1);
  return { month, day };
}

// Compute the target date within (year, month) that a monthly rule fires on,
// given the rule's mode. Returns a midnight-aligned Date.
function monthlyTargetInMonth(year, month, rule) {
  const mode = rule.monthlyMode || 'date';
  if (mode === 'lastWorkingDay')  return lastWorkingDayOfMonth(year, month);
  if (mode === 'firstWorkingDay') return firstWorkingDayOfMonth(year, month);
  if (mode === 'nthWeekday') {
    // A corrupt value (0, "Fri", 7 ...) made the weekday search loop forever
    // — at app start, so the app never opened again. Clamp instead.
    const n = Math.round(Number(rule.nthWeek ?? 1));
    const nth = n === -1 ? -1 : Math.min(5, Math.max(1, Number.isFinite(n) ? n : 1));
    const w = Math.round(Number(rule.weekday ?? 5)); // default Friday
    const wd = Number.isFinite(w) && w >= 0 && w <= 6 ? w : 5;
    return nthWeekdayOfMonth(year, month, nth, wd);
  }
  // 'date' (default) — anchor day-of-month, clamped to month length.
  const anchorDay = anchorDayForRule(rule);
  const dim = daysInMonth(year, month);
  return midnight(new Date(year, month, Math.min(anchorDay, dim)));
}

// The FIRST occurrence a rule ever generates. Handles the case where the
// user's startDate falls mid-month but the rule is anchored to something
// like "last working day" (in which case the first firing might be later
// this month, or in the following month if we've already passed it).
//
// BK-L1 fix: sources the anchor from getRuleAnchorDate (which prefers
// startDateLocal) so the "first occurrence" agrees with formatFrequency
// and nextOccurrenceAfter on which calendar day the rule is anchored to, even
// when the backup was authored on a different-timezone device.
function firstOccurrenceForRule(rule) {
  const anchor = getRuleAnchorDate(rule) ?? midnight(new Date());
  const startDay = midnight(anchor);
  const mode = rule.monthlyMode || 'date';

  // Non-monthly rules, or monthly-by-date, use startDate directly — the same
  // behaviour as before this feature existed.
  if (rule.frequency !== 'monthly' || mode === 'date') return startDay;

  // Monthly with a computed anchor (working day / nth weekday): walk forward
  // month-by-month until we find a target that is >= startDate. A 12-iter
  // cap is way more than enough (every mode always finds a valid target in
  // its own month).
  let year  = startDay.getFullYear();
  let month = startDay.getMonth();
  for (let i = 0; i < 12; i++) {
    const target = monthlyTargetInMonth(year, month, rule);
    if (target >= startDay) return target;
    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }
  return startDay; // theoretically unreachable
}

const KNOWN_FREQUENCIES = new Set(['daily', 'weekly', 'monthly', 'yearly']);
const DAY_MS = 24 * 60 * 60 * 1000;

// Local midnight of the day `n` days after `d` (DST-safe: calendar
// arithmetic, not +24h).
function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

// The first occurrence on or after `day` (a local-midnight Date), or null for
// a rule whose frequency we don't know.
//
// A rule's occurrences are its first occurrence followed by one per interval:
//   daily   every day            weekly  every 7th day from the first
//   monthly one target per month (mode + anchor day decide which day, so
//           "31st" clamps to the last day of shorter months and never drifts)
//   yearly  the anchor month/day each year (Feb 29 -> Feb 28 in common years)
// Every one of those is computed directly. Stepping through them one at a
// time from the start made each call O(age of the rule) — 500 back-fills of an
// old daily rule meant millions of Date objects on the UI thread — and a
// 5000-step guard silently stopped daily rules older than ~13.7 years.
function firstOccurrenceOnOrAfter(rule, day) {
  if (!KNOWN_FREQUENCIES.has(rule.frequency)) return null;
  const anchor = firstOccurrenceForRule(rule);
  if (anchor >= day) return anchor;

  if (rule.frequency === 'daily') return day;

  if (rule.frequency === 'weekly') {
    const gapDays = Math.round((day - anchor) / DAY_MS);
    return addDays(anchor, Math.ceil(gapDays / 7) * 7);
  }

  if (rule.frequency === 'monthly') {
    const gapMonths = (day.getFullYear() - anchor.getFullYear()) * 12
      + (day.getMonth() - anchor.getMonth());
    // The target for month M can only be >= day when M is day's month or
    // later, and it always exists, so at most two months need checking.
    for (let i = Math.max(1, gapMonths); i < Math.max(1, gapMonths) + 3; i++) {
      const monthIndex = anchor.getMonth() + i;
      const target = monthlyTargetInMonth(
        anchor.getFullYear() + Math.floor(monthIndex / 12),
        monthIndex % 12,
        rule,
      );
      if (target >= day) return target;
    }
    return null;
  }

  // yearly
  const { month, day: anchorDay } = anchorMonthDayForRule(rule);
  const firstYear = Math.max(1, day.getFullYear() - anchor.getFullYear());
  for (let i = firstYear; i < firstYear + 3; i++) {
    const y = anchor.getFullYear() + i;
    const target = new Date(y, month, Math.min(anchorDay, daysInMonth(y, month)));
    if (target >= day) return target;
  }
  return null;
}

// The next occurrence STRICTLY AFTER `from` (never equal to `from` — used
// when generating "missed since last run").
export function nextOccurrenceAfter(rule, from) {
  const fromDay = midnight(from);
  const cur = firstOccurrenceOnOrAfter(rule, addDays(fromDay, 1));
  if (!cur) return null;
  const endDay = rule.endDate ? midnight(parseRuleDate(rule.endDate)) : null;
  if (endDay && cur > endDay) return null;
  return cur;
}

// The next occurrence at or after today. Used to show "Next: <date>" beside
// a rule in the list.
export function upcomingOccurrence(rule, today = new Date()) {
  const cur = firstOccurrenceOnOrAfter(rule, midnight(today));
  if (!cur) return null;
  const endDay = rule.endDate ? midnight(parseRuleDate(rule.endDate)) : null;
  if (endDay && cur > endDay) return null;
  return cur;
}

// All occurrences a rule is DUE for that haven't been generated yet.
//
// Bounds:
//   start = rule.lastRunDate  (or one instant before rule's first occurrence
//                              if never run, so the anchor itself gets included)
//   end   = min(today, rule.endDate)
//
// Cap of 500 protects against a user setting startDate way in the past
// with a "daily" frequency — we still generate up to 500 back-fills per
// sweep but stop there rather than freezing the UI; lastRunDate then sits at
// the 500th, so the next sweep continues from there without gaps or repeats.
// A rule with an unknown frequency (hand-edited or restored from a newer
// backup) is skipped instead of throwing and taking the whole sweep down.
export function generateDueOccurrences(rule, today = new Date()) {
  if (!rule || rule.active === false) return [];
  if (!KNOWN_FREQUENCIES.has(rule.frequency)) return [];
  const endDay = rule.endDate ? midnight(parseRuleDate(rule.endDate)) : null;
  const todayDay = midnight(today);
  const stopAt = endDay && endDay < todayDay ? endDay : todayDay;

  let cursor;
  if (rule.lastRunDate) {
    cursor = midnight(parseRuleDate(rule.lastRunDate));
  } else {
    const first = firstOccurrenceForRule(rule);
    cursor = new Date(first.getTime() - 1);
  }

  const occurrences = [];
  const CAP = 500;
  while (occurrences.length < CAP) {
    const next = nextOccurrenceAfter(rule, cursor);
    if (!next) break;
    if (next > stopAt) break;
    occurrences.push(next);
    cursor = next;
  }
  return occurrences;
}

// English ordinal for 1..31 (1st, 2nd, 3rd, 4th, ...).
function ordinal(n) {
  const d = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (d === 1) return `${n}st`;
  if (d === 2) return `${n}nd`;
  if (d === 3) return `${n}rd`;
  return `${n}th`;
}

// Human-friendly frequency label, e.g. "Monthly · 1st" or
// "Monthly · Last working day" or "Monthly · 2nd Friday".
//
// BK-L1 fix: derives the anchor from getRuleAnchorDate (startDateLocal-
// aware) so the label agrees with what nextOccurrenceAfter will actually fire on.
// Previously read `new Date(rule.startDate)` directly, which resolved the
// weekly weekday in device TZ — a rule authored as "Weekly · Fri" on
// IST could label itself "Weekly · Thu" on a UTC-5 device.
export function formatFrequency(rule) {
  const anchor = getRuleAnchorDate(rule) ?? new Date();
  switch (rule.frequency) {
    case 'daily':
      return 'Daily';
    case 'weekly': {
      const dow = anchor.toLocaleDateString(undefined, { weekday: 'short' });
      return `Weekly · ${dow}`;
    }
    case 'monthly': {
      const mode = rule.monthlyMode || 'date';
      if (mode === 'lastWorkingDay')  return 'Monthly · last working day';
      if (mode === 'firstWorkingDay') return 'Monthly · first working day';
      if (mode === 'nthWeekday') {
        const nth = rule.nthWeek ?? 1;
        const wd  = rule.weekday ?? 5;
        const nthLabel = nth === -1 ? 'last' : ordinal(nth);
        const wdLabel  = WEEKDAYS.find((w) => w.id === wd)?.long ?? 'Friday';
        return `Monthly · ${nthLabel} ${wdLabel}`;
      }
      return `Monthly · ${ordinal(anchorDayForRule(rule))}`;
    }
    case 'yearly': {
      const { month, day } = anchorMonthDayForRule(rule);
      // Format via a synthetic Date so month names honour the device locale.
      const synth = new Date(2000, month, day);
      const md = synth.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
      return `Yearly · ${md}`;
    }
    default:
      return rule.frequency;
  }
}

// Build a Transaction from a Rule + a target date. Same shape TransactionsList
// uses when creating an item, so the runtime code path is identical.
//
// BK-M9 fix: id is now derived from the LOCAL CALENDAR DAY of `date`
// (YYYY-MM-DD in device time), not `date.getTime()`. `date.getTime()` is
// an instant-in-time; two sweeps for "the same logical day" run on
// different-TZ devices would produce different `getTime()` values and
// therefore different ids, defeating the dedupe. The local calendar day
// is stable within any single device (and mostly stable across devices
// as long as the user hasn't crossed a date line between sweeps).
/**
 * Work out the currency, rate and base amount a rule's next transactions
 * should carry.
 *
 *   currency → what the rule was created with, else its account's, else base
 *   rate     → today's table rate, else the rate saved on the rule
 *   neither  → { ok: false }: the caller must skip the rule and tell the user.
 *              Converting a foreign amount 1:1 would silently lie about the
 *              base value, so there is deliberately no such fallback.
 */
export function prepareRuleForGeneration(rule, account, fxRates, baseCurrency) {
  const base = String(baseCurrency).toUpperCase();
  const currency = String(rule.currency ?? account?.currency ?? base).toUpperCase();
  let fxRate = 1;
  if (currency !== base) {
    const tableRate = lookupRate(fxRates, currency, base)?.rate;
    const savedRate = Number(rule.fxRate);
    fxRate = tableRate ?? (Number.isFinite(savedRate) && savedRate > 0 ? savedRate : null);
    if (fxRate == null) return { ok: false, missingCurrency: currency };
  }
  return {
    ok: true,
    rule: {
      ...rule,
      currency,
      fxRate,
      amountInBase: roundMoney((Number(rule.amount) || 0) * fxRate),
    },
  };
}

export function transactionFromRule(rule, date) {
  const tx = {
    id: `${rule.id}_${dayKeyLocal(date)}`,
    amount: rule.amount,
    categoryId: rule.categoryId,
    subCategoryId: rule.subCategoryId ?? null,
    accountId: rule.accountId,
    currency: rule.currency ?? null,
    fxRate: rule.fxRate ?? null,
    amountInBase: rule.amountInBase ?? null,
    note: rule.note || '',
    tags: Array.isArray(rule.tags) ? rule.tags : [],
    voiceNote: null,
    recurringRuleId: rule.id,
    createdAt: midnight(date).toISOString(),
  };
  if (rule.type === 'investment') {
    tx.brokerId = rule.brokerId ?? null;
    tx.instrumentSymbol = rule.instrumentSymbol ?? null;
    tx.instrumentName = rule.instrumentName ?? null;
    tx.instrumentType = rule.instrumentType ?? null;
    tx.investmentUnits = rule.investmentUnits ?? null;
  }
  return tx;
}

/**
 * The catch-up sweep, as a pure function so it can be tested without React.
 *
 * For every active rule: work out the occurrences due up to `now`, price the
 * rule (currency / rate), and advance its lastRunDate to the last one.
 *   toAdd              [{ type, tx }] to hand to addTransaction
 *   updatedRules       the rules array with lastRunDate advanced
 *   skippedCurrencies  currencies with no rate anywhere; those rules are left
 *                      untouched (still due) and retried next time
 * Re-running with the returned rules and the same `now` yields nothing, and
 * transaction ids are per rule + local day, so a repeat can never duplicate.
 */
export function planRuleSweep(rules, { accounts = [], baseCurrency, fxRates, now = new Date() } = {}) {
  const toAdd = [];
  const skippedCurrencies = new Set();
  const updatedRules = (rules ?? []).map((rule) => {
    if (!rule.active) return rule;
    const dueDates = generateDueOccurrences(rule, now);
    if (dueDates.length === 0) return rule;
    const account = accounts.find((item) => item.id === rule.accountId);
    const prepared = prepareRuleForGeneration(rule, account, fxRates, baseCurrency);
    if (!prepared.ok) {
      skippedCurrencies.add(prepared.missingCurrency);
      return rule;
    }
    for (const date of dueDates) {
      toAdd.push({ type: rule.type, tx: transactionFromRule(prepared.rule, date) });
    }
    return { ...rule, lastRunDate: dueDates[dueDates.length - 1].toISOString() };
  });
  return { toAdd, updatedRules, skippedCurrencies: [...skippedCurrencies] };
}

/** Build RecurringContext.addRule input from a saved transaction form. */
export function buildRecurringRuleInput(values, type) {
  if (!values?.makeRecurring) return null;
  const payload = {
    type,
    amount: values.amount,
    categoryId: values.categoryId,
    subCategoryId: values.subCategoryId ?? null,
    accountId: values.accountId,
    note: values.note ?? '',
    tags: Array.isArray(values.tags) ? values.tags : [],
    frequency: values.recurringFrequency ?? 'monthly',
    startDate: values.date,
    endDate: values.recurringEndDate ?? null,
    backfillPast: false,
    currency: values.currency ?? null,
    fxRate: values.fxRate ?? null,
    amountInBase: values.amountInBase ?? null,
  };
  if (type === 'investment') {
    payload.brokerId = values.brokerId ?? null;
    payload.instrumentSymbol = values.instrumentSymbol ?? null;
    payload.instrumentName = values.instrumentName ?? null;
    payload.instrumentType = values.instrumentType ?? null;
    payload.investmentUnits = values.investmentUnits ?? null;
  }
  return payload;
}

// The calendar day the user picked as the rule's start, as a local-midnight Date
// (startDateLocal-aware). Edit forms must seed their date picker from THIS, not
// from new Date(rule.startDate): the ISO instant is a different day on a
// device in another time zone, and saving the form would re-anchor the rule.
export function ruleStartDate(rule) {
  return getRuleAnchorDate(rule);
}

// Where the catch-up cursor goes when a paused rule is switched back on.
// "Paused rules stop generating transactions until you re-enable them": the
// months it sat paused are skipped, not back-filled in one go (resuming a
// salary rule after a 3-month career break must not mint 3 salaries). Firings
// from yesterday onward still count, and a cursor already ahead of that stays.
export function lastRunDateOnResume(rule, now = new Date()) {
  const yesterday = addDays(midnight(now), -1);
  const last = rule?.lastRunDate ? midnight(parseRuleDate(rule.lastRunDate)) : null;
  return (last && last >= yesterday ? last : yesterday).toISOString();
}

// Apply an edit (from the form or a toggle) to a rule and return the new rule.
// Keeps startDate / startDateLocal / anchorDay / anchorMonth in lock-step, and
// resets the catch-up cursor when a paused rule is re-enabled. Bad input
// (invalid dates, non-positive amount) is ignored field-by-field rather than
// throwing inside a state updater.
export function applyRulePatch(rule, patch, now = new Date()) {
  const { startDate, endDate, amount, ...rest } = patch ?? {};
  const next = { ...rule, ...rest };

  if (startDate) {
    const d = parseRuleDate(startDate);
    // Re-anchor only when the CALENDAR DAY actually changed. The edit form
    // always sends its date back; without this check, merely changing the
    // amount on a device in another time zone shifted the rule by a day.
    const current = getRuleAnchorDate(rule);
    if (!isNaN(d.getTime()) && (!current || dayKeyLocal(d) !== dayKeyLocal(current))) {
      next.startDate = d.toISOString();
      next.anchorDay = d.getDate();
      next.anchorMonth = d.getMonth();
      next.startDateLocal = dayKeyLocal(d);
    }
  }
  if (endDate === null) {
    next.endDate = null;
  } else if (endDate) {
    const e = parseRuleDate(endDate);
    if (!isNaN(e.getTime())) next.endDate = e.toISOString();
  }
  if (amount != null) {
    const n = Number(amount);
    if (Number.isFinite(n) && n > 0) next.amount = n;
  }
  if (rest.active === true && rule.active === false && rest.lastRunDate === undefined) {
    next.lastRunDate = lastRunDateOnResume(rule, now);
  }
  return next;
}

// Public helper — exported so RecurringContext can also serialize the
// same YYYY-MM-DD local key at rule create/update time. Keeps the "one
// canonical local-day representation" invariant in one place.
export function toLocalDayKey(dateOrIso) {
  const d = parseRuleDate(dateOrIso);
  if (isNaN(d.getTime())) return null;
  return dayKeyLocal(d);
}
