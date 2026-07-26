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
//   formatFrequency(rule)               → human label
//   transactionFromRule(rule, date)     → transaction shape for adder
//   FREQUENCIES                         → picker options
// ----------------------------------------------------------------------------

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
    const d = new Date(rule.startDate);
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
    const nth = rule.nthWeek ?? 1;
    const wd  = rule.weekday ?? 5; // default Friday
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
// and stepForward on which calendar day the rule is anchored to, even
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

// Advance `from` by one frequency interval. Preserves the ORIGINAL anchor's
// day-of-month for monthly-by-date / yearly so drift over long horizons
// doesn't accumulate (e.g. "Jan 31 → Feb 28 → Mar 31", not "→ Feb 28 → Mar 28").
function stepForward(from, rule) {
  const frequency = rule.frequency;
  const next = new Date(from);

  if (frequency === 'daily') {
    next.setDate(next.getDate() + 1);
    return midnight(next);
  }
  if (frequency === 'weekly') {
    next.setDate(next.getDate() + 7);
    return midnight(next);
  }
  if (frequency === 'monthly') {
    // Jump to the 1st of the following month, then recompute the target for
    // that month using the rule's mode. Using the 1st (not `from.getDate()`)
    // avoids the classic "Jan 31 → Feb 31 rolls to Mar 3" bug.
    const nextMonth = new Date(next.getFullYear(), next.getMonth() + 1, 1);
    return monthlyTargetInMonth(nextMonth.getFullYear(), nextMonth.getMonth(), rule);
  }
  if (frequency === 'yearly') {
    const { month: anchorMonth, day: anchorDay } = anchorMonthDayForRule(rule);
    const y = next.getFullYear() + 1;
    const dim = daysInMonth(y, anchorMonth);
    next.setFullYear(y, anchorMonth, Math.min(anchorDay, dim));
    return midnight(next);
  }
  throw new Error(`Unknown frequency: ${frequency}`);
}

// The next occurrence STRICTLY AFTER `from` (never equal to `from` — used
// when generating "missed since last run").
export function nextOccurrenceAfter(rule, from) {
  const anchor = firstOccurrenceForRule(rule);
  const fromDay = midnight(from);
  const endDay = rule.endDate ? midnight(new Date(rule.endDate)) : null;

  if (anchor > fromDay) {
    if (endDay && anchor > endDay) return null;
    return anchor;
  }

  let cur = anchor;
  for (let i = 0; i < 5000; i++) {
    cur = stepForward(cur, rule);
    if (cur > fromDay) {
      if (endDay && cur > endDay) return null;
      return cur;
    }
  }
  return null;
}

// The next occurrence at or after today. Used to show "Next: <date>" beside
// a rule in the list.
export function upcomingOccurrence(rule, today = new Date()) {
  const anchor = firstOccurrenceForRule(rule);
  const todayDay = midnight(today);
  const endDay = rule.endDate ? midnight(new Date(rule.endDate)) : null;

  if (anchor >= todayDay) {
    if (endDay && anchor > endDay) return null;
    return anchor;
  }

  let cur = anchor;
  for (let i = 0; i < 5000; i++) {
    cur = stepForward(cur, rule);
    if (cur >= todayDay) {
      if (endDay && cur > endDay) return null;
      return cur;
    }
  }
  return null;
}

// All occurrences a rule is DUE for that haven't been generated yet.
//
// Bounds:
//   start = rule.lastRunDate  (or one instant before rule's first occurrence
//                              if never run, so the anchor itself gets included)
//   end   = min(today, rule.endDate)
//
// Cap of 500 protects against a user setting startDate way in the past
// with a "daily" frequency — we still generate up to 500 back-fills but
// stop there rather than freezing the UI.
export function generateDueOccurrences(rule, today = new Date()) {
  if (!rule || rule.active === false) return [];
  const endDay = rule.endDate ? midnight(new Date(rule.endDate)) : null;
  const todayDay = midnight(today);
  const stopAt = endDay && endDay < todayDay ? endDay : todayDay;

  let cursor;
  if (rule.lastRunDate) {
    cursor = midnight(new Date(rule.lastRunDate));
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
// aware) so the label agrees with what stepForward will actually fire on.
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
export function transactionFromRule(rule, date) {
  return {
    id: `${rule.id}_${dayKeyLocal(date)}`,
    amount: rule.amount,
    categoryId: rule.categoryId,
    subCategoryId: rule.subCategoryId ?? null,
    accountId: rule.accountId,
    note: rule.note || '',
    voiceNote: null,
    // Include a marker so if the user ever wants to see "auto-generated"
    // rows in the UI later, we can. Doesn't affect existing screens.
    recurringRuleId: rule.id,
    createdAt: midnight(date).toISOString(),
  };
}

// Public helper — exported so RecurringContext can also serialize the
// same YYYY-MM-DD local key at rule create/update time. Keeps the "one
// canonical local-day representation" invariant in one place.
export function toLocalDayKey(dateOrIso) {
  const d = dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso);
  if (isNaN(d.getTime())) return null;
  return dayKeyLocal(d);
}
