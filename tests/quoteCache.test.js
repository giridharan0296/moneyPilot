import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
  clearCachedQuotes,
  getCachedQuotes,
  mergeCachedQuotes,
  subscribeQuotes,
} from '../lib/quoteCache.js';

beforeEach(() => clearCachedQuotes());

describe('shared quote cache', () => {
  it('merges new quotes over old ones and keeps quotes a later fetch missed', () => {
    mergeCachedQuotes({ INFY: { price: 1500 }, TCS: { price: 4000 } });
    mergeCachedQuotes({ INFY: { price: 1510 } });
    assert.deepEqual(getCachedQuotes(), { INFY: { price: 1510 }, TCS: { price: 4000 } });
  });

  it('an empty or invalid result (offline fetch) leaves the cache and identity alone', () => {
    mergeCachedQuotes({ INFY: { price: 1 } });
    const before = getCachedQuotes();
    mergeCachedQuotes({});
    mergeCachedQuotes(null);
    mergeCachedQuotes(undefined);
    assert.equal(getCachedQuotes(), before);
  });

  it('notifies subscribers only when something changed, and unsubscribes cleanly', () => {
    let calls = 0;
    const off = subscribeQuotes(() => { calls += 1; });
    mergeCachedQuotes({ A: { price: 1 } });
    mergeCachedQuotes({});
    assert.equal(calls, 1);
    off();
    mergeCachedQuotes({ B: { price: 2 } });
    assert.equal(calls, 1);
  });

  it('hands out a new object per change so store snapshots differ', () => {
    const a = getCachedQuotes();
    mergeCachedQuotes({ A: { price: 1 } });
    assert.notEqual(getCachedQuotes(), a);
  });
});
