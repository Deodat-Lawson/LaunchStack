/**
 * Job Dispatcher Factory
 *
 * Returns the configured job dispatcher. Inngest is the only backend
 * today; the module-level singleton survives repeated imports.
 */

import type { JobDispatcher } from "./types";
import { InngestDispatcher } from "./inngest";

export type { JobDispatcher, DispatchResult, JobRunner } from "./types";

let _dispatcher: JobDispatcher | null = null;

export function getDispatcher(): JobDispatcher {
  if (_dispatcher) return _dispatcher;
  _dispatcher = new InngestDispatcher();
  console.log(`[Jobs] Using ${_dispatcher.name} dispatcher`);
  return _dispatcher;
}
