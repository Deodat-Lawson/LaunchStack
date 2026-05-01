/**
 * Module-level StoragePort slot. createEngine calls configureStorage with
 * the port the host provided, so any subsystem inside core can reach it
 * via getStoragePort() without being passed the port explicitly.
 *
 * Throws a clear error if getStoragePort() is called before
 * configureStorage() has registered a port — same failure mode as getDb().
 */

import type { StoragePort } from "./types";
import { createSlot } from "../internal/slot";

const portSlot = createSlot<StoragePort>("storage/port");

export function configureStorage(port: StoragePort): void {
  portSlot.set(port);
}

export function getStoragePort(): StoragePort {
  const port = portSlot.get();
  if (!port) {
    throw new Error(
      "[@launchstack/core/storage] No StoragePort registered. The host must call createEngine(config) (or configureStorage(port) directly) before any subsystem that uses getStoragePort().",
    );
  }
  return port;
}
