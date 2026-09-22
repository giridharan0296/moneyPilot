import { useSyncExternalStore } from 'react';

import {
  getLoadProblems,
  subscribeLoadProblems,
} from '../lib/safeStorage';

/** Storage problems found while loading data (see lib/safeStorage.js). */
export default function useLoadProblems() {
  return useSyncExternalStore(subscribeLoadProblems, getLoadProblems, getLoadProblems);
}
