import { useSyncExternalStore } from 'react';

import { getCachedQuotes, subscribeQuotes } from '../lib/quoteCache';

/** Live quotes for logged holdings, shared by every screen that values them. */
export default function useCachedQuotes() {
  return useSyncExternalStore(subscribeQuotes, getCachedQuotes, getCachedQuotes);
}
