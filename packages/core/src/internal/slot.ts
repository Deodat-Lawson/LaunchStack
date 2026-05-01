/**
 * HMR/dual-bundle-safe singleton slot.
 *
 * Background: core's `configureXxx` / `getXxx` pattern stored values in
 * module-level `let _x = null` variables. Two failure modes broke that
 * naive form:
 *   1. Next dev-server HMR re-evaluates a module without re-running the
 *      host's `createEngine`, leaving the slot at null while the cached
 *      engine on globalThis still claims to be initialised.
 *   2. Bundler code-splitting can produce two copies of the same source
 *      file (one per import-graph entry), each with its own `_x` slot.
 *
 * Storing the value on `globalThis` under a stable `Symbol.for(...)` key
 * defeats both: every module copy reads from the same global property,
 * and HMR re-evaluation cannot reset it.
 */

const STORE: Record<symbol, unknown> = globalThis as unknown as Record<symbol, unknown>;

export interface Slot<T> {
  get(): T | undefined;
  set(value: T): void;
  clear(): void;
}

export function createSlot<T>(name: string): Slot<T> {
  const key = Symbol.for(`@launchstack/core:${name}`);
  return {
    get: () => STORE[key] as T | undefined,
    set: (value: T) => {
      STORE[key] = value;
    },
    clear: () => {
      delete STORE[key];
    },
  };
}
