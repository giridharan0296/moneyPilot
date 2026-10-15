import { useEffect, useState } from 'react';

import { STORAGE_KEYS } from '../constants';
import { readStored, writeStored } from './safeStorage';

// The jeweller's own 22K ₹/g, typed in by the user. The COMEX-derived
// reference excludes Indian duty, GST and the local premium, so it undershoots
// what a shop actually charges; this lets the user pin the real rate.

let cache = null;          // { rate22k, updatedAt } | null
let loadPromise = null;
const listeners = new Set();

function emit() {
  listeners.forEach((listener) => listener(cache));
}

function parse(raw) {
  try {
    const parsed = JSON.parse(raw);
    const rate22k = Number(parsed?.rate22k);
    if (!(rate22k > 0)) return null;
    return { rate22k, updatedAt: parsed.updatedAt ?? null };
  } catch {
    return null;
  }
}

/** Load once from storage; later calls reuse the result. */
export function loadManualGoldRate() {
  if (!loadPromise) {
    loadPromise = readStored(STORAGE_KEYS.manual_gold_rate).then((raw) => {
      if (raw) cache = parse(raw);
      emit();
      return cache;
    });
  }
  return loadPromise;
}

/** Save today's 22K ₹/g. Pass a falsy/invalid value to clear it. */
export async function setManualGoldRate(rate22k) {
  await loadManualGoldRate();
  const n = Number(rate22k);
  cache = n > 0 ? { rate22k: n, updatedAt: new Date().toISOString() } : null;
  await writeStored(STORAGE_KEYS.manual_gold_rate, cache ? JSON.stringify(cache) : '');
  emit();
  return cache;
}

export function useManualGoldRate() {
  const [value, setValue] = useState(cache);
  useEffect(() => {
    listeners.add(setValue);
    loadManualGoldRate().then(setValue);
    return () => { listeners.delete(setValue); };
  }, []);
  return value;
}
