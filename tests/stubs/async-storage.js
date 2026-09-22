// In-memory AsyncStorage for tests, with switches to simulate failures.
const store = new Map();
let failGets = 0;
let failSets = 0;

const AsyncStorage = {
  async getItem(key) {
    if (failGets > 0) {
      failGets -= 1;
      throw new Error('simulated read failure');
    }
    return store.has(key) ? store.get(key) : null;
  },
  async setItem(key, value) {
    if (failSets > 0) {
      failSets -= 1;
      throw new Error('simulated write failure');
    }
    store.set(key, String(value));
  },
  async removeItem(key) {
    store.delete(key);
  },
  async multiGet(keys) {
    return Promise.all(keys.map(async (k) => [k, await AsyncStorage.getItem(k)]));
  },
  async multiSet(pairs) {
    for (const [k, v] of pairs) await AsyncStorage.setItem(k, v);
  },
  async clear() {
    store.clear();
  },

  // ---- test controls ----
  __reset() {
    store.clear();
    failGets = 0;
    failSets = 0;
  },
  __failNextGets(n) {
    failGets = n;
  },
  __failNextSets(n) {
    failSets = n;
  },
  __dump() {
    return Object.fromEntries(store);
  },
};

export default AsyncStorage;
