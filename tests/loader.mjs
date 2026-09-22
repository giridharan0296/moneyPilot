// Node ESM resolve hook for running the app's plain-JS modules under
// `node --test`:
//   * the app imports siblings without an extension ('./currency'), which
//     Node's ESM resolver rejects — try '.js' and '/index.js';
//   * native/RN packages are replaced with in-memory stubs from tests/stubs.
import { fileURLToPath } from 'node:url';

const STUBS = new Map([
  ['@react-native-async-storage/async-storage', new URL('./stubs/async-storage.js', import.meta.url).href],
]);

export async function resolve(specifier, context, nextResolve) {
  if (STUBS.has(specifier)) {
    return { url: STUBS.get(specifier), shortCircuit: true };
  }
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    try {
      return await nextResolve(specifier, context);
    } catch (error) {
      if (error.code !== 'ERR_MODULE_NOT_FOUND' && error.code !== 'ERR_UNSUPPORTED_DIR_IMPORT') throw error;
      for (const suffix of ['.js', '/index.js']) {
        try {
          return await nextResolve(specifier + suffix, context);
        } catch {
          // try the next candidate
        }
      }
      throw error;
    }
  }
  return nextResolve(specifier, context);
}
