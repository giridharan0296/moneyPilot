import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import {
  assetIdForLinkedAccount,
  assetPickerTag,
  buildClaimedAssetIdSet,
  computeGoalProgress,
  filterAccountsForGoalPicker,
  filterAssetsForGoalPicker,
  filterOtherAssetsForGoalPicker,
  goalDateError,
  goalInputsInBase,
  goalsSummary,
  isAccountClaimedByGoal,
  parseGoalDate,
} from '../lib/goals.js';

const at = (y, m, d, h = 12, min = 0) => new Date(y, m, d, h, min);
const NOW = at(2026, 8, 22, 10); // Tue 22 Sep 2026, 10:00

const saveGoal = (over = {}) => ({
  id: 'g1', name: 'House', kind: 'save', targetAmount: 100000, deadline: null,
  linkedAssetIds: ['a1'], linkedCategoryIds: [], startDate: null,
  createdAt: at(2026, 5, 22).toISOString(), active: true, ...over,
});
const capGoal = (over = {}) => ({
  id: 'c1', name: 'Eating out', kind: 'spend_cap', targetAmount: 1000,
  deadline: at(2026, 8, 30, 9).toISOString(), linkedAssetIds: [], linkedCategoryIds: ['food'],
  startDate: at(2026, 8, 10, 15).toISOString(), createdAt: at(2026, 8, 10).toISOString(), active: true, ...over,
});
const asset = (id, value, extra = {}) => ({ id, name: id, value, ...extra });
const exp = (when, amount, categoryId = 'food') => ({ createdAt: when.toISOString(), amount, categoryId });

// (Deleting process.env.TZ does not restore the zone on Windows, so assign it back.)
const SYSTEM_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
function withTimeZone(tz) {
  before(() => { process.env.TZ = tz; });
  after(() => { process.env.TZ = SYSTEM_TZ; });
}

describe('parseGoalDate', () => {
  it('reads a bare YYYY-MM-DD as LOCAL midnight, not UTC', () => {
    const d = parseGoalDate('2026-10-01');
    assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()], [2026, 9, 1, 0]);
  });

  it('accepts ISO strings and Dates; rejects junk', () => {
    assert.equal(parseGoalDate('2026-10-01T10:00:00.000Z').toISOString(), '2026-10-01T10:00:00.000Z');
    assert.ok(parseGoalDate(new Date(2026, 0, 1)) instanceof Date);
    for (const bad of [null, undefined, '', 'nope', new Date('x')]) assert.equal(parseGoalDate(bad), null);
  });

  describe('west of Greenwich (America/Los_Angeles)', () => {
    withTimeZone('America/Los_Angeles');
    it('a bare date stays on its own calendar day', () => {
      const d = parseGoalDate('2026-10-01');
      assert.equal(d.getDate(), 1);
      // The old new Date('2026-10-01') would have been 30 Sep here.
      assert.equal(new Date('2026-10-01').getDate(), 30);
    });
    it('days left is measured to that calendar day', () => {
      const p = computeGoalProgress(saveGoal({ deadline: '2026-10-01' }), { assets: [asset('a1', 0)] }, new Date(2026, 8, 22, 10));
      assert.equal(p.daysLeft, 9);
    });
  });
});

describe('save goals', () => {
  it('sums only the linked assets', () => {
    const p = computeGoalProgress(saveGoal({ linkedAssetIds: ['a1', 'a2'] }), {
      assets: [asset('a1', 30000), asset('a2', 20000), asset('a3', 999999)],
    }, NOW);
    assert.equal(p.current, 50000);
    assert.equal(p.percent, 0.5);
    assert.equal(p.remaining, 50000);
    assert.equal(p.staleLinks, 0);
  });

  it('is complete at exactly 100% and beyond, with no remainder', () => {
    const at100 = computeGoalProgress(saveGoal(), { assets: [asset('a1', 100000)] }, NOW);
    assert.equal(at100.status, 'complete');
    assert.equal(at100.remaining, 0);
    const beyond = computeGoalProgress(saveGoal(), { assets: [asset('a1', 250000)] }, NOW);
    assert.equal(beyond.percent, 2.5);
    assert.equal(beyond.remaining, 0);
  });

  it('a target of 0 gives 0%, never NaN or Infinity', () => {
    const p = computeGoalProgress(saveGoal({ targetAmount: 0 }), { assets: [asset('a1', 500)] }, NOW);
    assert.equal(p.percent, 0);
    assert.equal(p.remaining, 0);
    assert.ok(Number.isFinite(p.percent));
  });

  it('coerces junk asset values and a junk target to 0', () => {
    const p = computeGoalProgress(saveGoal({ targetAmount: 'abc' }), { assets: [asset('a1', 'x')] }, NOW);
    assert.deepEqual([p.current, p.target, p.percent], [0, 0, 0]);
  });

  it('an overdrawn linked account lowers progress and can go negative without breaking', () => {
    const p = computeGoalProgress(saveGoal({ linkedAssetIds: ['a1', 'a2'] }), {
      assets: [asset('a1', 20000), asset('a2', -5000)],
    }, NOW);
    assert.equal(p.current, 15000);
    const neg = computeGoalProgress(saveGoal(), { assets: [asset('a1', -5000)] }, NOW);
    assert.equal(neg.remaining, 105000);
  });

  it('counts links whose asset was deleted as stale (they contribute nothing)', () => {
    const p = computeGoalProgress(saveGoal({ linkedAssetIds: ['a1', 'gone1', 'gone2'] }), {
      assets: [asset('a1', 1000)],
    }, NOW);
    assert.equal(p.current, 1000);
    assert.equal(p.staleLinks, 2);
    assert.equal(computeGoalProgress(saveGoal({ linkedAssetIds: [] }), { assets: [] }, NOW).staleLinks, 0);
  });

  it('is "in progress" without a deadline once something is saved, "behind" while empty', () => {
    assert.equal(computeGoalProgress(saveGoal(), { assets: [asset('a1', 1)] }, NOW).status, 'in_progress');
    assert.equal(computeGoalProgress(saveGoal(), { assets: [asset('a1', 0)] }, NOW).status, 'behind');
  });

  it('grades progress against elapsed time when there is a deadline', () => {
    // start 1 Sep 00:00 -> deadline 1 Oct 00:00, now 16 Sep 00:00 => half elapsed.
    const goal = saveGoal({
      startDate: at(2026, 8, 1, 0).toISOString(),
      deadline: at(2026, 9, 1, 0).toISOString(),
    });
    const half = new Date(2026, 8, 16, 0, 0);
    const on = computeGoalProgress(goal, { assets: [asset('a1', 50000)] }, half);
    assert.equal(on.elapsedFraction.toFixed(2), '0.50');
    assert.equal(on.status, 'on_track');
    assert.equal(computeGoalProgress(goal, { assets: [asset('a1', 49999)] }, half).status, 'behind');
  });

  it('a deadline on or before the start date leaves no schedule to grade', () => {
    const p = computeGoalProgress(saveGoal({
      startDate: at(2026, 8, 10).toISOString(), deadline: at(2026, 8, 5).toISOString(),
    }), { assets: [asset('a1', 1)] }, NOW);
    assert.equal(p.elapsedFraction, null);
  });

  it('elapsed fraction is clamped to 0..1 before the start and after the deadline', () => {
    const goal = saveGoal({
      startDate: at(2026, 9, 1, 0).toISOString(), deadline: at(2026, 10, 1, 0).toISOString(),
    });
    assert.equal(computeGoalProgress(goal, { assets: [] }, NOW).elapsedFraction, 0);
    assert.equal(computeGoalProgress(goal, { assets: [] }, at(2027, 0, 1)).elapsedFraction, 1);
  });
});

describe('days left and monthly amount needed', () => {
  const run = (deadline, current, now = NOW, over = {}) => computeGoalProgress(
    saveGoal({ targetAmount: 120000, deadline, ...over }), { assets: [asset('a1', current)] }, now,
  );

  it('12 calendar months away needs a twelfth of what remains each month', () => {
    const p = run(at(2027, 8, 22, 0).toISOString(), 0);
    assert.equal(p.daysLeft, 365);
    // 365 days / 30.4375 = 11.99 months -> ~10,008 a month (the old /30 gave ~9,863).
    assert.ok(p.monthlyNeeded > 10000 && p.monthlyNeeded < 10020, String(p.monthlyNeeded));
  });

  it('counts only what is still needed', () => {
    const p = run(at(2027, 8, 22, 0).toISOString(), 60000);
    assert.ok(p.monthlyNeeded > 5000 && p.monthlyNeeded < 5010, String(p.monthlyNeeded));
  });

  it('with under a month to go the whole remainder is due, never a multiple of it', () => {
    const p = run(at(2026, 8, 27, 12).toISOString(), 100000);
    assert.equal(p.daysLeft, 5);
    assert.equal(p.remaining, 20000);
    assert.equal(p.monthlyNeeded, 20000);   // was 20000 / (5/30) = 120,000
  });

  it('no monthly figure once nothing is left, on the deadline day, or after it', () => {
    assert.equal(run(at(2027, 0, 1).toISOString(), 120000).monthlyNeeded, 0);
    const today = run(at(2026, 8, 22, 18).toISOString(), 0);
    assert.equal(today.daysLeft, 0);
    assert.equal(today.monthlyNeeded, null);
    const past = run(at(2026, 8, 20, 12).toISOString(), 0);
    assert.equal(past.daysLeft, -2);
    assert.equal(past.monthlyNeeded, null);
  });

  it('days left is by calendar day, whatever the clock time of the stored deadline', () => {
    // Same deadline day, stored at 00:00 and at 23:00, viewed at 10:00 and 23:59.
    for (const h of [0, 9, 23]) {
      for (const [nh, nm] of [[0, 1], [10, 0], [23, 59]]) {
        const p = run(at(2026, 9, 1, h).toISOString(), 0, new Date(2026, 8, 22, nh, nm));
        assert.equal(p.daysLeft, 9, `deadline ${h}:00 now ${nh}:${nm}`);
      }
    }
  });

  it('the morning after the deadline is overdue by 1 day, not "today"', () => {
    const p = run(at(2026, 8, 21, 15).toISOString(), 0, at(2026, 8, 22, 9));
    assert.equal(p.daysLeft, -1);
  });

  it('crosses a leap day correctly', () => {
    const p = run(at(2028, 2, 1, 0).toISOString(), 0, at(2028, 1, 28, 8));
    assert.equal(p.daysLeft, 2);    // 28 Feb -> 29 Feb -> 1 Mar
    const plain = run(at(2027, 2, 1, 0).toISOString(), 0, at(2027, 1, 28, 8));
    assert.equal(plain.daysLeft, 1);
  });

  it('a goal without a deadline has no days-left or monthly figure', () => {
    const p = run(null, 0);
    assert.deepEqual([p.daysLeft, p.monthlyNeeded], [null, null]);
  });

  it('an unparseable deadline is treated as none instead of producing NaN', () => {
    const p = run('garbage', 0);
    assert.deepEqual([p.daysLeft, p.monthlyNeeded, p.elapsedFraction], [null, null, null]);
  });
});

describe('spend-cap goals', () => {
  const run = (expenses, goal = capGoal(), now = NOW) => computeGoalProgress(goal, { expenses }, now);

  it('counts the whole start day and the whole deadline day, whatever the stored clock time', () => {
    // start stored 15:00 on the 10th, deadline stored 09:00 on the 30th.
    const p = run([
      exp(at(2026, 8, 10, 8), 100),     // morning of the start day: inside
      exp(at(2026, 8, 30, 20), 200),    // evening of the deadline day: inside
      exp(at(2026, 8, 9, 23, 59), 999), // day before: outside
      exp(at(2026, 9, 1, 0, 1), 999),   // day after: outside
    ]);
    assert.equal(p.current, 300);
  });

  it('only sums linked categories', () => {
    const p = run([exp(at(2026, 8, 12), 100, 'food'), exp(at(2026, 8, 12), 500, 'bills')]);
    assert.equal(p.current, 100);
  });

  it('with no start or no deadline the open side is unbounded', () => {
    const rows = [exp(at(2020, 0, 1), 5), exp(at(2030, 0, 1), 7)];
    assert.equal(run(rows, capGoal({ startDate: null, deadline: null })).current, 12);
    assert.equal(run(rows, capGoal({ startDate: at(2025, 0, 1).toISOString(), deadline: null })).current, 7);
  });

  it('ignores a row with an unparseable date', () => {
    assert.equal(run([{ createdAt: 'nope', amount: 500, categoryId: 'food' }]).current, 0);
  });

  it('is safe under 80%, warns from 80%, is over at exactly 100%', () => {
    const at80 = run([exp(at(2026, 8, 12), 800)]);
    assert.equal(at80.status, 'warn');
    assert.equal(run([exp(at(2026, 8, 12), 799)]).status, 'safe');
    assert.equal(run([exp(at(2026, 8, 12), 1000)]).status, 'over');
    assert.equal(run([exp(at(2026, 8, 12), 4000)]).percent, 4);   // honest ratio, not clamped
  });

  it('has no schedule-based monthly figure', () => {
    assert.equal(run([]).monthlyNeeded, null);
  });

  it('accepts bare-date strings for the window', () => {
    const p = run([exp(at(2026, 8, 30, 22), 50)], capGoal({ startDate: '2026-09-10', deadline: '2026-09-30' }));
    assert.equal(p.current, 50);
    assert.equal(p.daysLeft, 8);
  });
});

describe('goalsSummary', () => {
  const assets = [asset('a1', 50000), asset('a2', 90000)];
  const goals = [
    saveGoal({ id: 's1', linkedAssetIds: ['a1'] }),                       // 50%
    saveGoal({ id: 's2', linkedAssetIds: ['a2'] }),                       // 90%
    saveGoal({ id: 's3', linkedAssetIds: ['a2'], targetAmount: 90000 }),  // done -> not "closest"
    saveGoal({ id: 's4', active: false, linkedAssetIds: ['a2'], targetAmount: 91000 }),
  ];

  it('is null with no goals or only archived goals', () => {
    assert.equal(goalsSummary([], { assets }, NOW), null);
    assert.equal(goalsSummary(undefined, { assets }, NOW), null);
    assert.equal(goalsSummary([saveGoal({ active: false })], { assets }, NOW), null);
  });

  it('picks the unfinished save goal that is closest to done and skips archived ones', () => {
    const s = goalsSummary(goals, { assets }, NOW);
    assert.equal(s.count, 3);
    assert.equal(s.closestSave.goal.id, 's2');
    assert.equal(s.worstCap, null);
  });

  it('ranks caps by true ratio, so 400% beats 300%', () => {
    const rows = [exp(at(2026, 8, 12), 3000, 'food'), exp(at(2026, 8, 12), 4000, 'fun')];
    const s = goalsSummary([
      capGoal({ id: 'x' }),
      capGoal({ id: 'y', linkedCategoryIds: ['fun'] }),
    ], { expenses: rows }, NOW);
    assert.equal(s.worstCap.goal.id, 'y');
    assert.equal(s.worstCap.percent, 4);
  });

  it('ignores a cap whose window has already closed', () => {
    const ended = capGoal({ id: 'old', deadline: at(2026, 7, 31, 9).toISOString(), startDate: at(2026, 7, 1).toISOString() });
    const s = goalsSummary([ended, saveGoal()], {
      assets, expenses: [exp(at(2026, 7, 15), 5000)],
    }, NOW);
    assert.equal(s.worstCap, null);
    assert.equal(s.count, 2);
  });

  it('still shows a cap on the deadline day itself', () => {
    const lastDay = capGoal({ deadline: at(2026, 8, 22, 0).toISOString() });
    const s = goalsSummary([lastDay], { expenses: [exp(at(2026, 8, 22, 9), 900)] }, NOW);
    assert.equal(s.worstCap.status, 'warn');
  });
});

describe('goals in a foreign / mixed currency', () => {
  const fx = { USD: { rate: 90, updatedAt: '2026-09-01T00:00:00.000Z' } };

  it('converts assets and expenses to base before comparing with the base-currency target', () => {
    const { assets, expenses } = goalInputsInBase({
      assets: [
        asset('a1', 1000, { currency: 'USD', valueInBase: 85000 }),  // frozen snapshot
        asset('a2', 2000),                                             // INR
        asset('a3', 10, { currency: 'USD', valueInBase: null }),      // legacy: uses today's rate
      ],
      expenses: [{ ...exp(at(2026, 8, 12), 10), currency: 'USD', amountInBase: 850 }],
    }, fx, 'INR');
    assert.deepEqual(assets.map((a) => a.value), [85000, 2000, 900]);
    assert.equal(expenses[0].amount, 850);

    const p = computeGoalProgress(saveGoal({ linkedAssetIds: ['a1', 'a2'] }), { assets }, NOW);
    assert.equal(p.current, 87000);
    // Without conversion the goal would have read 1000 + 2000 = 3000.
    const raw = computeGoalProgress(saveGoal({ linkedAssetIds: ['a1', 'a2'] }), {
      assets: [asset('a1', 1000), asset('a2', 2000)],
    }, NOW);
    assert.equal(raw.current, 3000);
  });

  it('tolerates missing inputs', () => {
    assert.deepEqual(goalInputsInBase(undefined, fx, 'INR'), { assets: [], expenses: [] });
  });
});

describe('goalDateError', () => {
  it('needs no dates to pass', () => {
    assert.equal(goalDateError({ kind: 'save', deadline: null, isNew: true }, NOW), null);
  });

  it('rejects a NEW goal whose deadline day has passed, but allows today', () => {
    assert.match(goalDateError({ kind: 'save', deadline: at(2026, 8, 21, 23), isNew: true }, NOW), /passed/);
    assert.equal(goalDateError({ kind: 'save', deadline: at(2026, 8, 22, 0), isNew: true }, NOW), null);
    // Editing an old goal must still save.
    assert.equal(goalDateError({ kind: 'save', deadline: at(2026, 0, 1), isNew: false }, NOW), null);
  });

  it('rejects a cap that ends before it starts, allowing the same day', () => {
    const start = at(2026, 8, 10, 15);
    assert.match(goalDateError({ kind: 'spend_cap', startDate: start, deadline: at(2026, 8, 9, 23) }, NOW), /on or after/);
    assert.equal(goalDateError({ kind: 'spend_cap', startDate: start, deadline: at(2026, 8, 10, 1) }, NOW), null);
  });
});

describe('goal link pickers', () => {
  const assets = [
    asset('a1', 1, { linkedAccountId: 'acc1' }),
    asset('a2', 1),
    asset('a3', 1, { linkedAccountId: 'acc3' }),
  ];
  const accounts = [{ id: 'acc1' }, { id: 'acc2' }, { id: 'acc3' }];
  const goals = [
    saveGoal({ id: 'g1', linkedAssetIds: ['a1'] }),
    saveGoal({ id: 'g2', linkedAssetIds: ['a2', ''] }),
    { id: 'cap', kind: 'spend_cap', linkedAssetIds: ['a3'] },   // caps never claim assets
  ];

  it('claims the assets of save goals only, ignoring blanks', () => {
    assert.deepEqual([...buildClaimedAssetIdSet(goals)].sort(), ['a1', 'a2']);
  });

  it('lets a goal keep its own links while editing', () => {
    assert.deepEqual([...buildClaimedAssetIdSet(goals, { excludeGoalId: 'g1' })], ['a2']);
    assert.deepEqual(filterAssetsForGoalPicker(assets, goals, { excludeGoalId: 'g1' }).map((a) => a.id), ['a1', 'a3']);
  });

  it('hides accounts already claimed through their mirrored asset', () => {
    assert.equal(assetIdForLinkedAccount(assets, 'acc1'), 'a1');
    assert.equal(assetIdForLinkedAccount(assets, 'nope'), null);
    assert.equal(assetIdForLinkedAccount(assets, null), null);
    assert.equal(isAccountClaimedByGoal('acc1', assets, goals), true);
    assert.equal(isAccountClaimedByGoal('acc2', assets, goals), false);   // no mirrored asset yet
    assert.deepEqual(filterAccountsForGoalPicker(accounts, assets, goals).map((a) => a.id), ['acc2', 'acc3']);
  });

  it('offers only unclaimed non-account assets in the "other assets" list', () => {
    assert.deepEqual(filterOtherAssetsForGoalPicker(assets, goals).map((a) => a.id), []);
    assert.deepEqual(filterOtherAssetsForGoalPicker(assets, [], {}).map((a) => a.id), ['a2']);
  });

  it('tags asset chips', () => {
    assert.equal(assetPickerTag({ portfolioInstrumentKind: 'mutual_fund' }), 'MF');
    assert.equal(assetPickerTag({ portfolioInstrumentKind: 'stock' }), 'Stock');
    assert.equal(assetPickerTag({ categoryId: 'cash' }), 'Cash');
    assert.equal(assetPickerTag({ linkedAccountId: 'x' }), 'Cash');
    assert.equal(assetPickerTag({}), null);
    assert.equal(assetPickerTag(null), null);
  });
});
