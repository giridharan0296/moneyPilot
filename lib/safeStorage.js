// ----------------------------------------------------------------------------
// safeStorage.js — guarded AsyncStorage access for the data contexts.
//
// The contexts load their data on mount, then auto-persist on every change.
// Without a guard, a failed or corrupt read leaves the in-memory state empty
// and the very next persist overwrites the real data with []. This module
// makes that impossible:
//
//   * readStored / readStoredJson read ONE key at a time (retrying transient
//     failures), so a bad key can't take its neighbours down with it.
//   * A value that can't be parsed is copied to `<key>.corrupt` before
//     anything can overwrite it, and the problem is reported.
//   * A key that couldn't be read at all, or whose load threw, is BLOCKED:
//     writeStored ignores it for the rest of the session, so the stored data
//     is left untouched.
//   * Problems are exposed (getLoadProblems / subscribeLoadProblems) so the UI
//     can tell the user instead of failing silently.
//
// clearWriteBlocks() is for deliberate replacement of data (restore from
// backup, demo data, reset) — after that the new data may be saved again.
// ----------------------------------------------------------------------------

import AsyncStorage from '@react-native-async-storage/async-storage';

const blocked = new Map();   // key -> 'unreadable' | 'unusable' | 'unexpected'
let problems = [];           // immutable snapshot, replaced on every change
const listeners = new Set();

function emit() {
  listeners.forEach((listener) => listener());
}

function noteProblem(key, kind) {
  if (problems.some((p) => p.key === key && p.kind === kind)) return;
  problems = [...problems, { key, kind, at: Date.now() }];
  emit();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Raw string for `key`, or null. Retries transient failures; on a persistent
 *  failure the key is blocked from writes and the problem is reported. */
export async function readStored(key, { retries = 2 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await AsyncStorage.getItem(key);
    } catch (error) {
      if (attempt < retries) {
        await sleep(150 * (attempt + 1));
      } else {
        console.warn(`Could not read ${key}; writes to it are blocked this session.`, error);
      }
    }
  }
  blocked.set(key, 'unreadable');
  noteProblem(key, 'unreadable');
  return null;
}

/** Like readStored, but the value must be valid JSON. Unparseable data is
 *  copied to `<key>.corrupt` (so it can be recovered) and null is returned.
 *
 *  `blockOnCorrupt` also blocks writes to the key. Use it where starting from
 *  defaults would break references held elsewhere (e.g. accounts, which every
 *  transaction points at). */
export async function readStoredJson(key, { blockOnCorrupt = false, ...options } = {}) {
  const raw = await readStored(key, options);
  if (raw == null) return null;
  try {
    JSON.parse(raw);
    return raw;
  } catch (error) {
    console.warn(`Saved data for ${key} is not valid JSON; keeping a copy.`, error);
    try {
      await AsyncStorage.setItem(`${key}.corrupt`, raw);
    } catch {
      // Best effort — the original stays in place until something overwrites it.
    }
    if (blockOnCorrupt) {
      blocked.set(key, 'unusable');
      noteProblem(key, 'unusable');
    } else {
      noteProblem(key, 'corrupt');
    }
    return null;
  }
}

/** Drop-in for AsyncStorage.setItem that refuses to write a blocked key. */
export function writeStored(key, value) {
  if (blocked.has(key)) return Promise.resolve();
  return AsyncStorage.setItem(key, value);
}

/** Protect keys whose load threw or produced an unusable shape. */
export function blockWrites(keys, kind = 'unexpected') {
  for (const key of [].concat(keys)) {
    blocked.set(key, kind);
    noteProblem(key, kind);
  }
}

export function isWriteBlocked(key) {
  return blocked.has(key);
}

/** Call before intentionally replacing data (restore, demo data, reset). */
export function clearWriteBlocks() {
  blocked.clear();
  problems = problems.filter((p) => p.kind === 'corrupt');
  emit();
}

/** Forget reported problems once the user has seen them. */
export function dismissLoadProblems() {
  problems = [];
  emit();
}

export function getLoadProblems() {
  return problems;
}

export function subscribeLoadProblems(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// '@financeApp/expenses/v1' -> 'expenses'
// '@financeApp/settings/accounts/v1' -> 'accounts'
function labelFor(key) {
  const parts = String(key).split('/').slice(1);
  if (parts.length > 1 && /^v\d+$/.test(parts[parts.length - 1])) parts.pop();
  if (parts.length > 1 && parts[0] === 'settings') parts.shift();
  return (parts.join(' ') || String(key)).replace(/_/g, ' ');
}

function nameList(list) {
  const names = [...new Set(list.map((p) => labelFor(p.key)))];
  const extra = names.length > 3 ? ` and ${names.length - 3} more` : '';
  return { shown: names.slice(0, 3).join(', ') + extra, plural: names.length > 1 };
}

/** Plain-language summary for a banner. Null when there is nothing to say. */
export function describeLoadProblems(list = problems) {
  if (list.length === 0) return null;
  const paused = list.filter((p) => p.kind !== 'corrupt');   // saving is blocked
  const emptied = list.filter((p) => p.kind === 'corrupt');  // started empty, copy kept
  const sentences = [];
  if (paused.length > 0) {
    const { shown, plural } = nameList(paused);
    sentences.push(
      `Couldn't read ${shown}. Changes to ${plural ? 'them' : 'it'} won't be saved this session, so nothing is overwritten.`,
    );
  }
  if (emptied.length > 0) {
    const { shown, plural } = nameList(emptied);
    sentences.push(
      `${shown.charAt(0).toUpperCase()}${shown.slice(1)} ${plural ? 'were' : 'was'} unreadable and started empty. A copy of the original was kept on this device.`,
    );
  }
  sentences.push('Restart the app, or restore a backup in Settings.');
  return { title: 'Some saved data could not be loaded', body: sentences.join(' ') };
}
