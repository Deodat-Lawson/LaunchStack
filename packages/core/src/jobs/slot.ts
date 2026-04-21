/**
 * Module-level JobDispatcherPort slot. createEngine calls
 * configureJobDispatcher with the port the host provided, so any subsystem
 * inside core can reach it via getJobDispatcher() without being passed the
 * port explicitly.
 *
 * Throws a clear error if getJobDispatcher() is called before
 * configureJobDispatcher() has registered a port — same failure mode as
 * getStoragePort() / getDb().
 */

import type { JobDispatcherPort } from "./types";

let _port: JobDispatcherPort | null = null;

export function configureJobDispatcher(port: JobDispatcherPort): void {
  _port = port;
}

export function getJobDispatcher(): JobDispatcherPort {
  if (!_port) {
    throw new Error(
      "[@launchstack/core/jobs] No JobDispatcherPort registered. The host must call createEngine(config) (or configureJobDispatcher(port) directly) before any subsystem that enqueues background work.",
    );
  }
  return _port;
}
