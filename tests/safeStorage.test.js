import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  blockWrites,
  clearWriteBlocks,
  dismissLoadProblems,
  describeLoadProblems,
  getLoadProblems,
  isWriteBlocked,
  readStored,
  readStoredJson,
  writeStored,
} from '../lib/safeStorage.js';

beforeEach(() => {
  AsyncStorage.__reset();
  clearWriteBlocks();
  dismissLoadProblems();
});

describe('readStored', () => {
  it('returns the stored string, or null when missing', async () => {
    await AsyncStorage.setItem('k', '[1,2]');
    assert.equal(await readStored('k'), '[1,2]');
    assert.equal(await readStored('missing'), null);
    assert.equal(getLoadProblems().length, 0);
  });

  it('retries a transient read failure and succeeds', async () => {
    await AsyncStorage.setItem('k', '"ok"');
    AsyncStorage.__failNextGets(2);
    assert.equal(await readStored('k'), '"ok"');
    assert.equal(isWriteBlocked('k'), false);
  });

  it('blocks writes and reports a persistent read failure', async () => {
    await AsyncStorage.setItem('k', '[{"id":1}]');
    AsyncStorage.__failNextGets(10);
    assert.equal(await readStored('k'), null);
    assert.equal(isWriteBlocked('k'), true);
    assert.equal(getLoadProblems()[0].kind, 'unreadable');
  });
});

describe('readStoredJson', () => {
  it('returns valid JSON untouched', async () => {
    await AsyncStorage.setItem('k', '[1]');
    assert.equal(await readStoredJson('k'), '[1]');
  });

  it('keeps a copy of unparseable data and reports it', async () => {
    await AsyncStorage.setItem('k', '[{"id":1},');
    assert.equal(await readStoredJson('k'), null);
    assert.equal(AsyncStorage.__dump()['k.corrupt'], '[{"id":1},');
    assert.deepEqual(getLoadProblems().map((p) => p.kind), ['corrupt']);
  });
});

describe('writeStored', () => {
  it('writes normally', async () => {
    await writeStored('k', 'v');
    assert.equal(AsyncStorage.__dump().k, 'v');
  });

  it('refuses to overwrite a blocked key', async () => {
    await AsyncStorage.setItem('k', 'real data');
    blockWrites('k');
    await writeStored('k', '[]');
    assert.equal(AsyncStorage.__dump().k, 'real data');
  });

  it('writes again after clearWriteBlocks (restore / reset)', async () => {
    blockWrites('k');
    clearWriteBlocks();
    await writeStored('k', 'restored');
    assert.equal(AsyncStorage.__dump().k, 'restored');
  });
});

// The scenario from the review: one bad key must not wipe the others, and a
// failed load must not let default state overwrite stored data.
describe('load-failure wipe scenario', () => {
  it('an unreadable expenses key leaves income and expenses intact on the next save', async () => {
    await AsyncStorage.setItem('@financeApp/expenses/v1', '[{"id":"e1","amount":50}]');
    await AsyncStorage.setItem('@financeApp/income/v1', '[{"id":"i1","amount":900}]');

    AsyncStorage.__failNextGets(3); // exhausts the retries for the first key only
    const expenses = await readStoredJson('@financeApp/expenses/v1');
    const income = await readStoredJson('@financeApp/income/v1');
    assert.equal(expenses, null);
    assert.equal(income, '[{"id":"i1","amount":900}]'); // neighbour still loads

    // What the persist effects do once `ready` flips:
    await writeStored('@financeApp/expenses/v1', '[]');
    await writeStored('@financeApp/income/v1', income);

    assert.equal(AsyncStorage.__dump()['@financeApp/expenses/v1'], '[{"id":"e1","amount":50}]');
    assert.equal(AsyncStorage.__dump()['@financeApp/income/v1'], '[{"id":"i1","amount":900}]');
  });
});

describe('describeLoadProblems', () => {
  it('is null when there are no problems', () => {
    assert.equal(describeLoadProblems([]), null);
  });

  it('names the affected data and whether saving is paused', () => {
    const corrupt = describeLoadProblems([{ key: '@financeApp/expenses/v1', kind: 'corrupt' }]);
    assert.match(corrupt.body, /expenses/i);
    assert.match(corrupt.body, /copy/);

    const blockedMsg = describeLoadProblems([{ key: '@financeApp/budgets/v1', kind: 'unreadable' }]);
    assert.match(blockedMsg.body, /budgets/);
    assert.match(blockedMsg.body, /won't be saved/);
  });
});

describe('blockOnCorrupt', () => {
  it('keeps a copy, blocks writes and reports it as unusable', async () => {
    await AsyncStorage.setItem('accounts', '{not json');
    assert.equal(await readStoredJson('accounts', { blockOnCorrupt: true }), null);
    assert.equal(AsyncStorage.__dump()['accounts.corrupt'], '{not json');
    assert.equal(isWriteBlocked('accounts'), true);
    await writeStored('accounts', '[]');
    assert.equal(AsyncStorage.__dump().accounts, '{not json'); // untouched
    assert.equal(getLoadProblems()[0].kind, 'unusable');
    assert.match(describeLoadProblems().body, /won't be saved/);
  });

  it('does not block by default', async () => {
    await AsyncStorage.setItem('k', 'oops');
    await readStoredJson('k');
    assert.equal(isWriteBlocked('k'), false);
  });
});

describe('describeLoadProblems wording', () => {
  it('labels keys in plain words', () => {
    const d = describeLoadProblems([{ key: '@financeApp/settings/accounts/v1', kind: 'unusable' }]);
    assert.match(d.body, /Couldn't read accounts\./);
    assert.doesNotMatch(d.body, /settings/);
  });

  it('separates data that started empty from data whose saving is paused', () => {
    const d = describeLoadProblems([
      { key: '@financeApp/expenses/v1', kind: 'corrupt' },
      { key: '@financeApp/settings/accounts/v1', kind: 'unusable' },
    ]);
    assert.match(d.body, /Couldn't read accounts\. Changes to it won't be saved/);
    assert.match(d.body, /Expenses was unreadable and started empty/);
    assert.doesNotMatch(d.body, /Changes to it won't be saved[^.]*expenses/);
  });

  it('uses plurals correctly', () => {
    const d = describeLoadProblems([
      { key: '@financeApp/budgets/v1', kind: 'corrupt' },
      { key: '@financeApp/goals/v1', kind: 'corrupt' },
    ]);
    assert.match(d.body, /Budgets, goals were unreadable/);
  });
});
