// Recurring rules: schedule maths, catch-up sweeps, idempotency, pause/resume,
// edits and time-zone safety. The pure logic in lib/recurring.js is checked
// against a brute-force day-by-day oracle so the "jump" arithmetic can't drift
// from the calendar, and every group runs in several time zones (Node
// re-reads process.env.TZ on assignment).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import {
  applyRulePatch,
  buildRecurringRuleInput,
  formatFrequency,
  generateDueOccurrences,
  lastRunDateOnResume,
  nextOccurrenceAfter,
  parseRuleDate,
  planRuleSweep,
  ruleStartDate,
  toLocalDayKey,
  transactionFromRule,
  upcomingOccurrence,
} from '../lib/recurring.js';

const ZONES = ['Asia/Kolkata', 'America/New_York', 'Pacific/Auckland', 'UTC'];
const originalTZ = process.env.TZ;

function inEachZone(name, body) {
  for (const tz of ZONES) {
    describe(`${name} [${tz}]`, () => {
      before(() => { process.env.TZ = tz; });
      after(() => {
        if (originalTZ === undefined) delete process.env.TZ;
        else process.env.TZ = originalTZ;
      });
      body(tz);
    });
  }
}

// ---- helpers ---------------------------------------------------------------
const day = (y, m, d) => new Date(y, m - 1, d);              // local midnight, m is 1-based
const key = (d) => toLocalDayKey(d);
const keys = (list) => list.map(key);

// A rule shaped like RecurringContext.addRule builds it.
function makeRule(start, overrides = {}) {
  return {
    id: 'rec_1',
    type: 'expense',
    amount: 100,
    categoryId: 'bills',
    subCategoryId: null,
    accountId: 'acc1',
    currency: null,
    fxRate: null,
    note: 'Rent',
    frequency: 'monthly',
    monthlyMode: 'date',
    nthWeek: null,
    weekday: null,
    anchorDay: start.getDate(),
    anchorMonth: start.getMonth(),
    startDate: start.toISOString(),
    startDateLocal: key(start),
    endDate: null,
    lastRunDate: null,
    active: true,
    ...overrides,
  };
}

const dim = (y, m0) => new Date(y, m0 + 1, 0).getDate();

// Independent oracle: does `d` (local midnight) fire for this rule? Walks the
// calendar rather than doing any interval arithmetic.
function fires(rule, d) {
  const start = day(...rule.startDateLocal.split('-').map(Number));
  if (d < start) return false;
  const y = d.getFullYear();
  const m0 = d.getMonth();
  const date = d.getDate();
  const dow = d.getDay();
  const last = dim(y, m0);
  const isWeekday = (n) => { const w = new Date(y, m0, n).getDay(); return w !== 0 && w !== 6; };
  switch (rule.frequency) {
    case 'daily': return true;
    case 'weekly': return Math.round((Date.UTC(y, m0, date) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 864e5) % 7 === 0;
    case 'yearly': return m0 === rule.anchorMonth && date === Math.min(rule.anchorDay, last);
    case 'monthly': {
      if (rule.monthlyMode === 'lastWorkingDay') {
        if (!isWeekday(date)) return false;
        for (let n = date + 1; n <= last; n++) if (isWeekday(n)) return false;
        return true;
      }
      if (rule.monthlyMode === 'firstWorkingDay') {
        if (!isWeekday(date)) return false;
        for (let n = 1; n < date; n++) if (isWeekday(n)) return false;
        return true;
      }
      if (rule.monthlyMode === 'nthWeekday') {
        if (dow !== rule.weekday) return false;
        if (rule.nthWeek === -1) return date + 7 > last;
        const ordinal = Math.ceil(date / 7);
        if (rule.nthWeek === 5) return ordinal === 5 || (ordinal === 4 && date + 7 > last && new Date(y, m0, date + 7).getMonth() !== m0);
        return ordinal === rule.nthWeek;
      }
      return date === Math.min(rule.anchorDay, last);
    }
    default: return false;
  }
}

// Every firing in (after, upTo] (both local midnights; `after` may be null).
function oracle(rule, after, upTo) {
  const out = [];
  const end = rule.endDate ? new Date(rule.endDate) : null;
  const endDay = end ? day(end.getFullYear(), end.getMonth() + 1, end.getDate()) : null;
  const from = day(...rule.startDateLocal.split('-').map(Number));
  for (let d = new Date(from); d <= upTo; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    if (after && d <= after) continue;
    if (endDay && d > endDay) break;
    if (fires(rule, d)) out.push(key(d));
  }
  return out;
}

// One app launch: plan the sweep, "commit" it into a ledger + rules.
function launch(state, now, ctx = {}) {
  const plan = planRuleSweep(state.rules, { accounts: [{ id: 'acc1' }], baseCurrency: 'INR', fxRates: {}, now, ...ctx });
  const ledger = new Map(state.ledger);
  for (const { tx } of plan.toAdd) if (!ledger.has(tx.id)) ledger.set(tx.id, tx); // addTransaction dedupes on id
  return { rules: plan.updatedRules, ledger, added: plan.toAdd.length, plan };
}

// ---- next-occurrence maths --------------------------------------------------
inEachZone('recurring schedule maths', () => {
  it('daily / weekly step by 1 and 7 days', () => {
    const daily = makeRule(day(2026, 3, 30), { frequency: 'daily' });
    assert.deepEqual(keys(generateDueOccurrences(daily, day(2026, 4, 2))), ['2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02']);
    const weekly = makeRule(day(2026, 3, 27), { frequency: 'weekly' }); // a Friday, crosses DST changes
    assert.deepEqual(keys(generateDueOccurrences(weekly, day(2026, 4, 20))), ['2026-03-27', '2026-04-03', '2026-04-10', '2026-04-17']);
  });

  it('monthly on the 31st clamps to the last day and springs back (no drift)', () => {
    const r = makeRule(day(2027, 1, 31));
    assert.deepEqual(keys(generateDueOccurrences(r, day(2027, 6, 30))),
      ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31', '2027-06-30']);
  });

  it('monthly on the 29th / 30th clamps in February, leap year keeps the 29th', () => {
    assert.deepEqual(keys(generateDueOccurrences(makeRule(day(2027, 1, 29)), day(2027, 3, 29))), ['2027-01-29', '2027-02-28', '2027-03-29']);
    assert.deepEqual(keys(generateDueOccurrences(makeRule(day(2028, 1, 29)), day(2028, 3, 29))), ['2028-01-29', '2028-02-29', '2028-03-29']);
    assert.deepEqual(keys(generateDueOccurrences(makeRule(day(2027, 1, 30)), day(2027, 3, 30))), ['2027-01-30', '2027-02-28', '2027-03-30']);
  });

  it('yearly Feb 29 lands on Feb 28 in common years and Feb 29 again in leap years', () => {
    const r = makeRule(day(2028, 2, 29), { frequency: 'yearly' });
    assert.deepEqual(keys(generateDueOccurrences(r, day(2032, 12, 31))),
      ['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
  });

  it('yearly on Dec 31 / Jan 1 stays put across year ends', () => {
    assert.deepEqual(keys(generateDueOccurrences(makeRule(day(2026, 12, 31), { frequency: 'yearly' }), day(2029, 1, 1))), ['2026-12-31', '2027-12-31', '2028-12-31']);
    assert.deepEqual(keys(generateDueOccurrences(makeRule(day(2026, 1, 1), { frequency: 'yearly' }), day(2028, 1, 1))), ['2026-01-01', '2027-01-01', '2028-01-01']);
  });

  it('last / first working day and nth weekday, including the "last" and 5th-fallback cases', () => {
    const lastWd = makeRule(day(2026, 1, 1), { monthlyMode: 'lastWorkingDay' });
    // Jan 31 2026 is a Saturday -> Fri 30th; Feb 28 2026 is a Saturday -> Fri 27th; Mar 31 Tue.
    assert.deepEqual(keys(generateDueOccurrences(lastWd, day(2026, 3, 31))), ['2026-01-30', '2026-02-27', '2026-03-31']);
    const firstWd = makeRule(day(2026, 1, 1), { monthlyMode: 'firstWorkingDay' });
    // Jan 1 Thu, Feb 1 Sun -> Mon 2nd, Mar 1 Sun -> Mon 2nd.
    assert.deepEqual(keys(generateDueOccurrences(firstWd, day(2026, 3, 31))), ['2026-01-01', '2026-02-02', '2026-03-02']);
    const second = makeRule(day(2026, 1, 1), { monthlyMode: 'nthWeekday', nthWeek: 2, weekday: 5 });
    assert.deepEqual(keys(generateDueOccurrences(second, day(2026, 3, 31))), ['2026-01-09', '2026-02-13', '2026-03-13']);
    const lastWed = makeRule(day(2026, 1, 1), { monthlyMode: 'nthWeekday', nthWeek: -1, weekday: 3 });
    assert.deepEqual(keys(generateDueOccurrences(lastWed, day(2026, 3, 31))), ['2026-01-28', '2026-02-25', '2026-03-25']);
    // 5th Friday does not exist in Feb 2026 -> falls back to the last Friday instead of skipping the month.
    const fifthFri = makeRule(day(2026, 1, 1), { monthlyMode: 'nthWeekday', nthWeek: 5, weekday: 5 });
    assert.deepEqual(keys(generateDueOccurrences(fifthFri, day(2026, 3, 31))), ['2026-01-30', '2026-02-27', '2026-03-27']);
  });

  it('a start date after the working-day target fires next month, not backwards', () => {
    const r = makeRule(day(2026, 1, 31), { monthlyMode: 'lastWorkingDay' }); // Jan 30 already past
    assert.deepEqual(keys(generateDueOccurrences(r, day(2026, 3, 31))), ['2026-02-27', '2026-03-31']);
  });

  it('end date is inclusive and stops everything after it', () => {
    const r = makeRule(day(2026, 1, 15), { endDate: day(2026, 3, 15).toISOString() });
    assert.deepEqual(keys(generateDueOccurrences(r, day(2027, 1, 1))), ['2026-01-15', '2026-02-15', '2026-03-15']);
    assert.equal(nextOccurrenceAfter(r, day(2026, 3, 15)), null);
    assert.equal(upcomingOccurrence(r, day(2026, 3, 16)), null);
    assert.equal(key(upcomingOccurrence(r, day(2026, 3, 15))), '2026-03-15');
  });

  it('end date before the start date generates nothing', () => {
    const r = makeRule(day(2026, 5, 1), { endDate: day(2026, 4, 1).toISOString() });
    assert.deepEqual(generateDueOccurrences(r, day(2026, 12, 1)), []);
    assert.equal(upcomingOccurrence(r, day(2026, 1, 1)), null);
  });

  it('a future start date generates nothing yet and is the upcoming occurrence', () => {
    const r = makeRule(day(2026, 12, 5));
    assert.deepEqual(generateDueOccurrences(r, day(2026, 9, 22)), []);
    assert.equal(key(upcomingOccurrence(r, day(2026, 9, 22))), '2026-12-05');
  });

  it('a rule that fires today is generated today and is also "upcoming" today', () => {
    const r = makeRule(day(2026, 8, 22));
    assert.deepEqual(keys(generateDueOccurrences(r, day(2026, 9, 22))), ['2026-08-22', '2026-09-22']);
    assert.equal(key(upcomingOccurrence(r, day(2026, 9, 22))), '2026-09-22');
    assert.equal(key(nextOccurrenceAfter(r, day(2026, 9, 22))), '2026-10-22');
  });

  it('time of day in "now" / lastRunDate never shifts the day', () => {
    const r = makeRule(day(2026, 1, 15), { lastRunDate: new Date(2026, 0, 15, 23, 59, 59).toISOString() });
    assert.deepEqual(keys(generateDueOccurrences(r, new Date(2026, 1, 15, 0, 0, 1))), ['2026-02-15']);
    assert.deepEqual(keys(generateDueOccurrences(r, new Date(2026, 1, 14, 23, 59, 59))), []);
  });

  it('a daily rule older than 5000 days still fires (used to stop silently at ~13.7 years)', () => {
    const r = makeRule(day(2010, 1, 1), { frequency: 'daily', lastRunDate: day(2026, 9, 18).toISOString() });
    assert.deepEqual(keys(generateDueOccurrences(r, day(2026, 9, 22))), ['2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22']);
    assert.equal(key(upcomingOccurrence(r, day(2026, 9, 22))), '2026-09-22');
  });

  it('back-filling 500 old daily occurrences is fast (no O(n^2) stepping)', () => {
    const r = makeRule(day(2010, 1, 1), { frequency: 'daily' });
    const t0 = Date.now();
    const list = generateDueOccurrences(r, day(2026, 9, 22));
    assert.equal(list.length, 500);
    assert.ok(Date.now() - t0 < 500, `took ${Date.now() - t0}ms`);
  });

  it('an unknown frequency or corrupt weekday fields neither throw nor hang', () => {
    assert.deepEqual(generateDueOccurrences(makeRule(day(2026, 1, 1), { frequency: 'quarterly' }), day(2027, 1, 1)), []);
    assert.equal(nextOccurrenceAfter(makeRule(day(2026, 1, 1), { frequency: 'fortnightly' }), day(2026, 2, 1)), null);
    for (const bad of [{ nthWeek: 0, weekday: 5 }, { nthWeek: -3, weekday: 9 }, { nthWeek: 'x', weekday: 'Fri' }, { nthWeek: 2, weekday: NaN }, { nthWeek: 99, weekday: -1 }]) {
      const r = makeRule(day(2026, 1, 1), { monthlyMode: 'nthWeekday', ...bad });
      const list = generateDueOccurrences(r, day(2026, 6, 30));
      assert.equal(list.length, 6, JSON.stringify(bad)); // one per month, whatever the fallback day is
    }
  });

  it('formatFrequency labels the stored anchor, not the device time zone', () => {
    assert.equal(formatFrequency(makeRule(day(2026, 1, 31))), 'Monthly · 31st');
    assert.equal(formatFrequency(makeRule(day(2026, 1, 1), { monthlyMode: 'nthWeekday', nthWeek: -1, weekday: 3 })), 'Monthly · last Wednesday');
    assert.equal(formatFrequency(makeRule(day(2026, 1, 1), { frequency: 'daily' })), 'Daily');
  });
});

// ---- differential test against the oracle -----------------------------------
inEachZone('recurring schedule vs day-by-day oracle', () => {
  const starts = [day(2024, 2, 29), day(2025, 1, 31), day(2025, 6, 15), day(2026, 1, 1), day(2026, 12, 31)];
  const shapes = [
    { frequency: 'daily' },
    { frequency: 'weekly' },
    { frequency: 'yearly' },
    { frequency: 'monthly', monthlyMode: 'date' },
    { frequency: 'monthly', monthlyMode: 'lastWorkingDay' },
    { frequency: 'monthly', monthlyMode: 'firstWorkingDay' },
    ...[1, 2, 3, 4, -1].flatMap((nthWeek) => [0, 3, 5, 6].map((weekday) => ({ frequency: 'monthly', monthlyMode: 'nthWeekday', nthWeek, weekday }))),
  ];
  const now = day(2028, 9, 15);

  it('generateDueOccurrences matches the calendar for every rule shape x start date (from scratch, capped at 500)', () => {
    for (const start of starts) {
      for (const shape of shapes) {
        const rule = makeRule(start, shape);
        const want = oracle(rule, null, now).slice(0, 500);
        assert.deepEqual(keys(generateDueOccurrences(rule, now)), want, `${key(start)} ${JSON.stringify(shape)}`);
      }
    }
  });

  it('resuming from any lastRunDate yields exactly the firings after it', () => {
    for (const start of starts.slice(0, 3)) {
      for (const shape of shapes.filter((_, i) => i % 3 === 0)) {
        const rule = makeRule(start, shape);
        for (const last of [day(2025, 2, 28), day(2026, 6, 15), day(2028, 6, 30), day(2028, 9, 15)]) {
          const r = { ...rule, lastRunDate: last.toISOString() };
          const want = oracle(rule, last, now).slice(0, 500);
          assert.deepEqual(keys(generateDueOccurrences(r, now)), want, `${key(start)} ${JSON.stringify(shape)} last=${key(last)}`);
        }
      }
    }
  });

  it('nextOccurrenceAfter / upcomingOccurrence agree with the calendar for every day of a year', () => {
    for (const shape of shapes.filter((_, i) => i % 4 === 0)) {
      const rule = makeRule(day(2025, 1, 31), shape);
      const all = oracle(rule, null, day(2027, 12, 31)); // sorted YYYY-MM-DD keys
      const firstAfter = (k) => all.find((f) => f > k) ?? null;
      const firstOnOrAfter = (k) => all.find((f) => f >= k) ?? null;
      for (let d = day(2025, 1, 1); d < day(2026, 3, 1); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
        const next = nextOccurrenceAfter(rule, d);
        assert.equal(next ? key(next) : null, firstAfter(key(d)), `after ${key(d)} ${JSON.stringify(shape)}`);
        const up = upcomingOccurrence(rule, d);
        assert.equal(up ? key(up) : null, firstOnOrAfter(key(d)), `on/after ${key(d)} ${JSON.stringify(shape)}`);
      }
    }
  });

  it('respects an end date the same way as the oracle', () => {
    for (const shape of shapes.filter((_, i) => i % 5 === 0)) {
      const rule = makeRule(day(2025, 1, 31), { ...shape, endDate: day(2026, 7, 4).toISOString() });
      assert.deepEqual(keys(generateDueOccurrences(rule, now)), oracle(rule, null, now).slice(0, 500), JSON.stringify(shape));
    }
  });
});

// ---- sweeps: catch-up, idempotency, reloads -----------------------------------
inEachZone('recurring sweeps', () => {
  it('app closed for months: one row per missed month, exactly once, ids per rule + day', () => {
    const rule = makeRule(day(2026, 1, 5), { lastRunDate: day(2026, 1, 5).toISOString() }); // ran Jan 5, then closed
    const s1 = launch({ rules: [rule], ledger: new Map() }, day(2026, 9, 22));
    assert.deepEqual([...s1.ledger.keys()].sort(), ['rec_1_2026-02-05', 'rec_1_2026-03-05', 'rec_1_2026-04-05', 'rec_1_2026-05-05', 'rec_1_2026-06-05', 'rec_1_2026-07-05', 'rec_1_2026-08-05', 'rec_1_2026-09-05']);
    assert.equal(s1.added, 8);
  });

  it('is idempotent: repeated sweeps and reloads add nothing until the next occurrence', () => {
    const rule = makeRule(day(2026, 1, 5), { lastRunDate: day(2026, 1, 5).toISOString() });
    let state = launch({ rules: [rule], ledger: new Map() }, day(2026, 9, 22));
    const size = state.ledger.size;
    for (let i = 0; i < 3; i++) {
      state = launch(state, day(2026, 9, 22));
      assert.equal(state.added, 0);
      assert.equal(state.ledger.size, size);
    }
    // a "reload" that lost the rules write (crash between the two saves) re-plans the same ids -> deduped by id
    const crashed = launch({ rules: [rule], ledger: state.ledger }, day(2026, 9, 22));
    assert.equal(crashed.ledger.size, size);
    // next day still nothing; on Oct 5 exactly one more
    assert.equal(launch(state, day(2026, 10, 4)).added, 0);
    const oct = launch(state, new Date(2026, 9, 5, 23));
    assert.equal(oct.added, 1);
    assert.ok(oct.ledger.has('rec_1_2026-10-05'));
  });

  it('opening the app every single day never duplicates or misses an occurrence', () => {
    let state = { rules: [makeRule(day(2026, 1, 31)), makeRule(day(2026, 1, 1), { id: 'rec_2', frequency: 'weekly' }), makeRule(day(2026, 1, 1), { id: 'rec_3', monthlyMode: 'lastWorkingDay' })], ledger: new Map() };
    let total = 0;
    for (let d = day(2026, 1, 1); d <= day(2026, 12, 31); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      state = launch(state, d);
      total += state.added;
    }
    const want = state.rules.reduce((n, r) => n + oracle({ ...r, lastRunDate: null }, null, day(2026, 12, 31)).length, 0);
    assert.equal(total, want);
    assert.equal(state.ledger.size, want);
  });

  it('a very old daily rule catches up 500 per sweep with no gaps and no repeats', () => {
    const rule = makeRule(day(2022, 1, 1), { frequency: 'daily' });
    const now = day(2026, 9, 22);
    let state = { rules: [rule], ledger: new Map() };
    const sizes = [];
    for (let i = 0; i < 6; i++) {
      state = launch(state, now);
      sizes.push(state.added);
    }
    const total = oracle(rule, null, now).length;
    assert.deepEqual(sizes.slice(0, 3), [500, 500, 500]);
    assert.equal(state.ledger.size, total);
    assert.equal(sizes.reduce((a, b) => a + b, 0), total);
    const ids = [...state.ledger.keys()].sort();
    assert.equal(ids[0], 'rec_1_2022-01-01');
    assert.equal(ids[ids.length - 1], 'rec_1_2026-09-22');
  });

  it('paused rules generate nothing; resuming months later skips the paused stretch', () => {
    const active = makeRule(day(2026, 1, 5), { lastRunDate: day(2026, 3, 5).toISOString() });
    const paused = applyRulePatch(active, { active: false }, day(2026, 3, 20));
    assert.equal(paused.lastRunDate, active.lastRunDate);
    assert.equal(launch({ rules: [paused], ledger: new Map() }, day(2026, 9, 20)).added, 0);

    const resumed = applyRulePatch(paused, { active: true }, day(2026, 9, 22));
    // Sep 5 was during the pause -> not created; Oct 5 onward is.
    assert.deepEqual(keys(generateDueOccurrences(resumed, day(2026, 9, 22))), []);
    assert.deepEqual(keys(generateDueOccurrences(resumed, day(2026, 10, 6))), ['2026-10-05']);
  });

  it('resuming on the very day a rule fires still generates that day', () => {
    const paused = makeRule(day(2026, 1, 22), { active: false, lastRunDate: day(2026, 2, 22).toISOString() });
    const resumed = applyRulePatch(paused, { active: true }, day(2026, 9, 22));
    assert.deepEqual(keys(generateDueOccurrences(resumed, day(2026, 9, 22))), ['2026-09-22']);
  });

  it('pause/resume on the same day (accidental toggle) loses nothing', () => {
    const rule = makeRule(day(2026, 1, 5), { lastRunDate: day(2026, 8, 5).toISOString() });
    const back = applyRulePatch(applyRulePatch(rule, { active: false }, day(2026, 9, 5)), { active: true }, day(2026, 9, 5));
    assert.deepEqual(keys(generateDueOccurrences(back, day(2026, 9, 5))), ['2026-09-05']);
  });

  it('lastRunDateOnResume keeps a cursor that is already ahead', () => {
    const rule = makeRule(day(2026, 1, 5), { lastRunDate: day(2026, 12, 1).toISOString() });
    assert.equal(key(new Date(lastRunDateOnResume(rule, day(2026, 9, 22)))), '2026-12-01');
    assert.equal(key(new Date(lastRunDateOnResume({ ...rule, lastRunDate: null }, day(2026, 9, 22)))), '2026-09-21');
    assert.equal(key(new Date(lastRunDateOnResume({ ...rule, lastRunDate: 'garbage' }, day(2026, 9, 22)))), '2026-09-21');
  });

  it('editing after rows were generated: new amount applies going forward, history untouched', () => {
    const rule = makeRule(day(2026, 1, 5));
    let state = launch({ rules: [rule], ledger: new Map() }, day(2026, 3, 10));
    assert.equal(state.ledger.size, 3);
    const edited = applyRulePatch(state.rules[0], { amount: 250, note: 'Rent (new)' });
    assert.equal(edited.lastRunDate, state.rules[0].lastRunDate);
    state = launch({ rules: [edited], ledger: state.ledger }, day(2026, 4, 10));
    assert.equal(state.added, 1);
    assert.equal(state.ledger.get('rec_1_2026-03-05').amount, 100);
    assert.equal(state.ledger.get('rec_1_2026-04-05').amount, 250);
    assert.equal(state.ledger.get('rec_1_2026-04-05').note, 'Rent (new)');
  });

  it('moving the schedule forward does not back-fill; moving it into the past only fires from the cursor on', () => {
    const rule = makeRule(day(2026, 1, 5), { lastRunDate: day(2026, 9, 5).toISOString() });
    const later = applyRulePatch(rule, { startDate: day(2027, 1, 10) });
    assert.equal(launch({ rules: [later], ledger: new Map() }, day(2026, 9, 22)).added, 0);
    const earlier = applyRulePatch(rule, { startDate: day(2020, 1, 10) });
    assert.deepEqual(keys(generateDueOccurrences(earlier, day(2026, 10, 12))), ['2026-09-10', '2026-10-10']);
  });

  it('deleting a rule stops generation; its generated rows keep their rule id', () => {
    const rule = makeRule(day(2026, 1, 5));
    const state = launch({ rules: [rule], ledger: new Map() }, day(2026, 3, 10));
    const after = launch({ rules: [], ledger: state.ledger }, day(2026, 9, 10));
    assert.equal(after.added, 0);
    assert.ok([...after.ledger.values()].every((tx) => tx.recurringRuleId === 'rec_1'));
  });

  it('end date reached: last occurrence generated once, then never again', () => {
    const rule = makeRule(day(2026, 1, 5), { endDate: day(2026, 3, 5).toISOString() });
    let state = launch({ rules: [rule], ledger: new Map() }, day(2026, 9, 22));
    assert.equal(state.added, 3);
    state = launch(state, day(2027, 9, 22));
    assert.equal(state.added, 0);
  });

  it('a rule whose account was deleted still sweeps (row lands with no account, base currency)', () => {
    const rule = makeRule(day(2026, 1, 5), { accountId: 'gone' });
    const s = launch({ rules: [rule], ledger: new Map() }, day(2026, 3, 10));
    assert.equal(s.added, 3);
    assert.equal(s.plan.toAdd[0].tx.currency, 'INR');
    assert.equal(s.plan.toAdd[0].tx.accountId, 'gone');
  });

  it('expense, income and investment rules each keep their own type and shape', () => {
    const inv = makeRule(day(2026, 1, 5), { id: 'rec_inv', type: 'investment', brokerId: 'groww', instrumentSymbol: 'NIFTYBEES', instrumentName: 'Nifty BeES', instrumentType: 'etf', investmentUnits: 2 });
    const inc = makeRule(day(2026, 1, 5), { id: 'rec_inc', type: 'income' });
    const s = launch({ rules: [inv, inc, makeRule(day(2026, 1, 5))], ledger: new Map() }, day(2026, 1, 6));
    assert.deepEqual(s.plan.toAdd.map((e) => e.type).sort(), ['expense', 'income', 'investment']);
    const invTx = s.plan.toAdd.find((e) => e.type === 'investment').tx;
    assert.equal(invTx.brokerId, 'groww');
    assert.equal(invTx.instrumentSymbol, 'NIFTYBEES');
    assert.equal(invTx.investmentUnits, 2);
    assert.equal('brokerId' in s.plan.toAdd.find((e) => e.type === 'income').tx, false);
  });

  it('foreign-currency rule without any rate is skipped and stays due; a rate later unblocks it', () => {
    const rule = makeRule(day(2026, 1, 5), { currency: 'EUR' });
    const blocked = launch({ rules: [rule], ledger: new Map() }, day(2026, 3, 10));
    assert.equal(blocked.added, 0);
    assert.deepEqual(blocked.plan.skippedCurrencies, ['EUR']);
    assert.equal(blocked.rules[0].lastRunDate, null);
    const ok = launch({ rules: blocked.rules, ledger: new Map() }, day(2026, 3, 10), { fxRates: { EUR: { rate: 90 } } });
    assert.equal(ok.added, 3);
    assert.equal(ok.plan.toAdd[0].tx.amountInBase, 9000);
  });

  it('an inactive rule (paused, or `active` missing on an old backup) is never swept', () => {
    assert.equal(launch({ rules: [makeRule(day(2026, 1, 5), { active: false })], ledger: new Map() }, day(2026, 9, 22)).added, 0);
  });
});

// ---- time zones and date-only values ------------------------------------------
describe('recurring rule dates are calendar days, not instants', () => {
  before(() => { process.env.TZ = 'America/New_York'; });
  after(() => {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  });

  it('a bare YYYY-MM-DD is that local day (new Date() would read it as UTC = the day before)', () => {
    assert.equal(key(parseRuleDate('2026-01-15')), '2026-01-15');
    assert.equal(toLocalDayKey('2026-01-15'), '2026-01-15');
    const r = { frequency: 'monthly', startDate: '2026-01-31' };
    assert.equal(key(ruleStartDate(r)), '2026-01-31');
    const withEnd = makeRule(day(2026, 1, 1), { endDate: '2026-03-01' });
    assert.deepEqual(keys(generateDueOccurrences(withEnd, day(2026, 12, 1))), ['2026-01-01', '2026-02-01', '2026-03-01']);
  });

  it('a rule authored in India keeps its day when opened in New York', () => {
    // Created on the 15th in Kolkata: the ISO instant is the 14th at 18:30Z, startDateLocal is the truth.
    const rule = makeRule(day(2026, 1, 15), { startDate: '2026-01-14T18:30:00.000Z', startDateLocal: '2026-01-15', anchorDay: 15 });
    assert.equal(key(ruleStartDate(rule)), '2026-01-15');
    assert.equal(formatFrequency(rule), 'Monthly · 15th');
    assert.deepEqual(keys(generateDueOccurrences(rule, day(2026, 3, 20))), ['2026-01-15', '2026-02-15', '2026-03-15']);
  });

  it('saving the edit form on another time zone does not move the rule by a day', () => {
    const rule = makeRule(day(2026, 1, 15), { startDate: '2026-01-14T18:30:00.000Z', startDateLocal: '2026-01-15', anchorDay: 15 });
    // What the OLD form sent back: new Date(rule.startDate) = Jan 14 in New York.
    const patched = applyRulePatch(rule, { amount: 5, startDate: new Date(rule.startDate) });
    assert.equal(patched.startDateLocal, '2026-01-14'); // an actual pick of the 14th re-anchors...
    // ...which is why the form now seeds its picker from ruleStartDate(): same day in, same day out.
    const same = applyRulePatch(rule, { amount: 5, startDate: ruleStartDate(rule) });
    assert.equal(same.startDateLocal, '2026-01-15');
    assert.equal(same.anchorDay, 15);
    assert.equal(same.startDate, rule.startDate);
  });

  it('changing the start day re-freezes startDate / startDateLocal / anchors together', () => {
    const rule = makeRule(day(2026, 1, 15), { frequency: 'yearly' });
    const moved = applyRulePatch(rule, { startDate: day(2026, 3, 31) });
    assert.equal(moved.startDateLocal, '2026-03-31');
    assert.equal(moved.anchorDay, 31);
    assert.equal(moved.anchorMonth, 2);
    assert.equal(key(new Date(moved.startDate)), '2026-03-31');
  });

  it('invalid dates and amounts in a patch are ignored, not thrown', () => {
    const rule = makeRule(day(2026, 1, 15), { endDate: day(2026, 6, 1).toISOString() });
    const patched = applyRulePatch(rule, { startDate: 'nonsense', endDate: 'nonsense', amount: -5 });
    assert.equal(patched.startDateLocal, rule.startDateLocal);
    assert.equal(patched.endDate, rule.endDate);
    assert.equal(patched.amount, rule.amount);
    assert.equal(applyRulePatch(rule, { endDate: null }).endDate, null);
  });

  it('transaction ids and createdAt are the local day, stable however often it is generated', () => {
    const tx1 = transactionFromRule(makeRule(day(2026, 1, 5)), day(2026, 3, 5));
    const tx2 = transactionFromRule(makeRule(day(2026, 1, 5)), new Date(2026, 2, 5, 18, 30));
    assert.equal(tx1.id, 'rec_1_2026-03-05');
    assert.equal(tx2.id, tx1.id);
    assert.equal(key(new Date(tx1.createdAt)), '2026-03-05');
    assert.equal(tx1.recurringRuleId, 'rec_1');
  });
});

describe('buildRecurringRuleInput', () => {
  it('returns null unless the form asked for a recurring rule', () => {
    assert.equal(buildRecurringRuleInput({ makeRecurring: false }, 'expense'), null);
    assert.equal(buildRecurringRuleInput(null, 'expense'), null);
  });
  it('never back-fills the transaction the user just entered, and carries investment fields', () => {
    const input = buildRecurringRuleInput({ makeRecurring: true, amount: 5, categoryId: 'c', accountId: 'a', date: '2026-01-05', brokerId: 'zerodha', investmentUnits: 3 }, 'investment');
    assert.equal(input.backfillPast, false);
    assert.equal(input.frequency, 'monthly');
    assert.equal(input.brokerId, 'zerodha');
    assert.equal(input.investmentUnits, 3);
  });
});
