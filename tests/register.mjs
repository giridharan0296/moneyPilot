// Registers the module-resolution hooks used by `npm test`.
import { register } from 'node:module';

register('./loader.mjs', import.meta.url);
