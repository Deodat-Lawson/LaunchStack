/**
 * Job Dispatcher Factory
 *
 * Returns the configured job dispatcher based on the JOB_RUNNER env var.
 * Default: Inngest (the core job runner).
 */

import type { JobDispatcher, JobRunner } from "./types";

export type { JobDispatcher, DispatchResult, JobRunner } from "./types";

/** Shape of the inngest module (for require() type assertion) */
interface InngestModuleShape {
  InngestDispatcher: new () => JobDispatcher;
}

/** Singleton dispatcher instance */
let _dispatcher: JobDispatcher | null = null;

/**
 * Read the configured job runner from the environment.
 * Falls back to "inngest" if not set.
 */
function getJobRunner(): JobRunner {
  const value = process.env.JOB_RUNNER?.toLowerCase().trim();
  if (value === "inngest") return "inngest";
  return "inngest";
}

/**
 * Get or create the singleton job dispatcher.
 * The dispatcher is lazily created on first call.
 */
export function getDispatcher(): JobDispatcher {
  if (_dispatcher) return _dispatcher;

  const runner = getJobRunner();
  let dispatcher: JobDispatcher;

  switch (runner) {
    case "inngest":
    default: {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { InngestDispatcher } = require("./inngest") as InngestModuleShape;
      dispatcher = new InngestDispatcher();
      break;
    }
  }

  _dispatcher = dispatcher;
  console.log(`[Jobs] Using ${_dispatcher.name} dispatcher (JOB_RUNNER=${runner})`);
  return _dispatcher;
}
