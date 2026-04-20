/**
 * Legacy compatibility shim. Historically the app opened its own postgres.js
 * client here; now the Drizzle client lives on the Engine (see
 * apps/web/src/server/engine.ts). `db` and `toRows` stay exported so the
 * ~120 existing callers that `import { db } from "~/server/db"` continue to
 * work unchanged — each import now resolves to the engine's client.
 *
 * New call sites should prefer `getEngine().db` directly.
 */

import { getEngine } from "~/server/engine";

export { toRows } from "@launchstack/core/db";

// Proxy so the engine is only built when `db` is actually used at runtime
// (not at import time). Keeps env validation lazy for tooling that imports
// this file without a full server env present.
export const db = new Proxy({} as ReturnType<typeof getEngine>["db"], {
  get(_target, prop, receiver) {
    const engineDb = getEngine().db;
    const value = Reflect.get(engineDb, prop, receiver) as unknown;
    if (typeof value === "function") {
      return (value as (...args: unknown[]) => unknown).bind(engineDb);
    }
    return value;
  },
});
