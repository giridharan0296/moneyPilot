import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

// ----------------------------------------------------------------------------
// DateFilterContext — a single piece of app-wide state describing "what
// slice of time am I looking at?".  Four modes:
//
//   month  { kind: 'month',  year, month }        e.g. Jul 2026
//   week   { kind: 'week',   weekStart }          Monday-anchored 7-day span
//   custom { kind: 'custom', startDate, endDate } inclusive both ends
//   all    { kind: 'all' }                        no filter
//
// Consumers care about two things:
//   1. filterByRange(items) — the universal filter function
//   2. label — a pretty string for the current range
//
// All range math funnels through `getRange(filter)` which returns a canonical
// [start, end) pair — makes the filter check dead simple.
// ----------------------------------------------------------------------------

const DateFilterContext = createContext(null);

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Monday-anchored week start (ISO 8601). Handles Sunday correctly by
// treating it as end-of-previous-week.
function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();               // Sun=0, Mon=1, ..., Sat=6
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  return d;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// Canonical range as [start, end) so a simple `d >= start && d < end` works.
function getRange(filter) {
  if (filter.kind === 'all') return null;

  if (filter.kind === 'month') {
    const start = new Date(filter.year, filter.month, 1);
    const end = new Date(filter.year, filter.month + 1, 1);
    return { start, end };
  }

  if (filter.kind === 'week') {
    const start = new Date(filter.weekStart);
    const end = new Date(start.getTime() + 7 * ONE_DAY_MS);
    return { start, end };
  }

  // custom: endDate is INCLUSIVE, so push to next-day midnight for [start, end).
  if (filter.kind === 'custom') {
    const start = new Date(filter.startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(filter.endDate);
    end.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }

  return null;
}

function labelFor(filter) {
  if (filter.kind === 'all') return 'All time';

  if (filter.kind === 'month') {
    return new Date(filter.year, filter.month, 1).toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    });
  }

  if (filter.kind === 'week') {
    const start = new Date(filter.weekStart);
    const end = new Date(start.getTime() + 6 * ONE_DAY_MS);
    const now = new Date();
    if (isSameDay(start, startOfWeek(now))) return 'This week';
    const opts = { day: 'numeric', month: 'short' };
    return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}`;
  }

  if (filter.kind === 'custom') {
    const opts = { day: 'numeric', month: 'short', year: 'numeric' };
    return `${filter.startDate.toLocaleDateString(undefined, opts)} – ${filter.endDate.toLocaleDateString(undefined, opts)}`;
  }

  return '';
}

// Defaults when the user picks a new mode.
function defaultsForKind(kind) {
  const now = new Date();
  if (kind === 'month') return { kind, year: now.getFullYear(), month: now.getMonth() };
  if (kind === 'week') return { kind, weekStart: startOfWeek(now) };
  if (kind === 'custom') {
    // Last 7 days by default.
    const endDate = new Date();
    endDate.setHours(0, 0, 0, 0);
    const startDate = new Date(endDate.getTime() - 6 * ONE_DAY_MS);
    return { kind, startDate, endDate };
  }
  return { kind: 'all' };
}

export function DateFilterProvider({ children }) {
  const [filter, setFilter] = useState(() => defaultsForKind('month'));

  const setKind = useCallback((kind) => setFilter(defaultsForKind(kind)), []);

  // Shift by delta units. For 'month' shifts by 1 month; for 'week' by 7 days.
  // No-op for 'custom' and 'all'.
  const shift = useCallback((delta) => {
    setFilter((prev) => {
      if (prev.kind === 'month') {
        const d = new Date(prev.year, prev.month + delta, 1);
        return { kind: 'month', year: d.getFullYear(), month: d.getMonth() };
      }
      if (prev.kind === 'week') {
        const start = new Date(prev.weekStart.getTime() + delta * 7 * ONE_DAY_MS);
        return { kind: 'week', weekStart: start };
      }
      return prev;
    });
  }, []);

  const jumpToCurrent = useCallback(() => {
    setFilter((prev) => defaultsForKind(prev.kind));
  }, []);

  const setCustomRange = useCallback((startDate, endDate) => {
    setFilter({ kind: 'custom', startDate, endDate });
  }, []);

  // Jump the filter so that `date` is visible. Used after adding a
  // transaction whose date falls outside the current view — surfacing the
  // just-added row instead of leaving the user staring at an unchanged list
  // wondering if the save worked.
  //
  // Chooses the smallest sensible view: the month containing `date`. Weeks
  // and custom ranges are too narrow to be a good "let me confirm this
  // saved" landing spot.
  const showMonthOf = useCallback((date) => {
    const d = new Date(date);
    setFilter({ kind: 'month', year: d.getFullYear(), month: d.getMonth() });
  }, []);

  // Convenience: is this timestamp in the currently-visible range?
  // Screens use this right after adding a transaction to decide whether
  // to prompt the user to switch views.
  const isInCurrentRange = useCallback(
    (date) => {
      const range = getRange(filter);
      if (!range) return true; // 'all' shows everything
      const d = new Date(date);
      return d >= range.start && d < range.end;
    },
    [filter],
  );

  // Universal filter function — called by every screen.
  const filterByRange = useCallback(
    (items) => {
      const range = getRange(filter);
      if (!range) return items;
      return items.filter((item) => {
        const d = new Date(item.createdAt);
        return d >= range.start && d < range.end;
      });
    },
    [filter],
  );

  const value = useMemo(
    () => ({
      filter,
      kind: filter.kind,
      label: labelFor(filter),
      isAllTime: filter.kind === 'all',
      canShift: filter.kind === 'month' || filter.kind === 'week',
      setKind,
      goPrev: () => shift(-1),
      goNext: () => shift(1),
      jumpToCurrent,
      setCustomRange,
      showMonthOf,
      isInCurrentRange,
      filterByRange,
    }),
    [
      filter,
      setKind,
      shift,
      jumpToCurrent,
      setCustomRange,
      showMonthOf,
      isInCurrentRange,
      filterByRange,
    ],
  );

  return (
    <DateFilterContext.Provider value={value}>
      {children}
    </DateFilterContext.Provider>
  );
}

export function useDateFilter() {
  const ctx = useContext(DateFilterContext);
  if (!ctx) {
    throw new Error('useDateFilter must be used within <DateFilterProvider>');
  }
  return ctx;
}
