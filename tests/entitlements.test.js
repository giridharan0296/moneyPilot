import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  addUse,
  subtractUse,
  checkAccess,
  limitMessage,
  normalizeUsage,
  weekKey,
} from '../lib/entitlements.js';

describe('weekKey', () => {
  it('uses ISO weeks that start on Monday', () => {
    // 2026-10-04 is a Sunday, the last day of ISO week 40.
    assert.equal(weekKey(new Date(2026, 9, 4)), '2026-W40');
    // 2026-10-05 is the Monday that starts week 41.
    assert.equal(weekKey(new Date(2026, 9, 5)), '2026-W41');
  });

  it('handles year boundaries', () => {
    // 2027-01-01 is a Friday and belongs to ISO week 53 of 2026.
    assert.equal(weekKey(new Date(2027, 0, 1)), '2026-W53');
    // 2025-12-29 is a Monday and starts ISO week 1 of 2026.
    assert.equal(weekKey(new Date(2025, 11, 29)), '2026-W01');
  });
});

describe('normalizeUsage', () => {
  const now = new Date(2026, 9, 7);

  it('starts at zero when nothing is stored', () => {
    assert.deepEqual(normalizeUsage(null, now), {
      week: '2026-W41',
      counts: { imports: 0, calculators: 0, receiptSessions: 0 },
    });
  });

  it('keeps counts from the same week', () => {
    const raw = { week: '2026-W41', counts: { imports: 2, calculators: 5, receiptSessions: 0 } };
    assert.deepEqual(normalizeUsage(raw, now).counts, { imports: 2, calculators: 5, receiptSessions: 0 });
  });

  it('resets counts when the stored week is older', () => {
    const raw = { week: '2026-W40', counts: { imports: 3, calculators: 10 } };
    assert.deepEqual(normalizeUsage(raw, now).counts, { imports: 0, calculators: 0, receiptSessions: 0 });
  });

  it('ignores corrupt counts', () => {
    const raw = { week: '2026-W41', counts: { imports: 'abc', calculators: -4 } };
    assert.deepEqual(normalizeUsage(raw, now).counts, { imports: 0, calculators: 0, receiptSessions: 0 });
  });
});

describe('addUse', () => {
  it('increments only the given feature and does not mutate the input', () => {
    const now = new Date(2026, 9, 7);
    const before = { week: '2026-W41', counts: { imports: 1, calculators: 0 } };
    const after = addUse(before, 'imports', now);
    assert.equal(after.counts.imports, 2);
    assert.equal(after.counts.calculators, 0);
    assert.equal(before.counts.imports, 1);
  });

  it('starts a fresh week when the stored week is old', () => {
    const now = new Date(2026, 9, 7);
    const old = { week: '2026-W40', counts: { imports: 3, calculators: 9 } };
    assert.deepEqual(addUse(old, 'calculators', now).counts, { imports: 0, calculators: 1, receiptSessions: 0 });
  });
});

describe('checkAccess', () => {
  it('Free allows accounts below the cap and blocks at the cap', () => {
    assert.equal(checkAccess('free', 'accounts', 2).allowed, true);
    const atCap = checkAccess('free', 'accounts', 3);
    assert.equal(atCap.allowed, false);
    assert.equal(atCap.remaining, 0);
  });

  it('Free allows 3 receipt sessions a week and Pro allows 5', () => {
    assert.equal(checkAccess('free', 'receiptSessions', 2).allowed, true);
    assert.equal(checkAccess('free', 'receiptSessions', 3).allowed, false);
    assert.equal(checkAccess('pro', 'receiptSessions', 4).allowed, true);
    assert.equal(checkAccess('pro', 'receiptSessions', 5).allowed, false);
  });

  it('Free caps weekly imports and calculators', () => {
    assert.equal(checkAccess('free', 'imports', 2).allowed, true);
    assert.equal(checkAccess('free', 'imports', 3).allowed, false);
    assert.equal(checkAccess('free', 'calculators', 9).remaining, 1);
  });

  it('Free blocks AI Insights', () => {
    assert.equal(checkAccess('free', 'ai').allowed, false);
  });

  it('Pro has no limits and includes AI', () => {
    assert.equal(checkAccess('pro', 'accounts', 500).allowed, true);
    assert.equal(checkAccess('pro', 'imports', 500).allowed, true);
    assert.equal(checkAccess('pro', 'calculators', 500).allowed, true);
    assert.equal(checkAccess('pro', 'ai').allowed, true);
  });

  it('unknown plans fall back to Free', () => {
    assert.equal(checkAccess('gold', 'imports', 3).allowed, false);
  });

  it('unknown features are blocked', () => {
    assert.equal(checkAccess('pro', 'export-everything').allowed, false);
  });
});

describe('limitMessage', () => {
  it('names the limit for weekly features', () => {
    const status = checkAccess('free', 'imports', 3);
    assert.match(limitMessage('imports', status), /limit of 3 statement imports this week/);
  });

  it('names the account cap without a weekly period', () => {
    const status = checkAccess('free', 'accounts', 3);
    const msg = limitMessage('accounts', status);
    assert.match(msg, /limit of 3 accounts\./);
    assert.doesNotMatch(msg, /this week/);
  });

  it('explains that AI is a Pro feature', () => {
    assert.match(limitMessage('ai', checkAccess('free', 'ai')), /Pro feature/);
  });
});

describe('subtractUse', () => {
  it('gives back one use and never goes below zero', () => {
    const now = new Date(2026, 9, 6);
    const raw = { week: '2026-W41', counts: { receiptSessions: 2 } };
    assert.equal(subtractUse(raw, 'receiptSessions', now).counts.receiptSessions, 1);
    assert.equal(subtractUse({ week: '2026-W41', counts: { receiptSessions: 0 } }, 'receiptSessions', now).counts.receiptSessions, 0);
  });
});
