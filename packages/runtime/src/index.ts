/**
 * @launchstack/runtime — what a host process wires in. The clock and logger
 * ports, the actor/workspace context, the typed error taxonomy, the storage
 * and job-dispatcher slots, and the singleton slot they are all built on.
 * Depends on nothing; reads nothing from the environment.
 */
export type { ClockPort, LoggerPort } from "./ports";
export type { ActorContext, TraceContext } from "./actor-context";
export * from "./errors";
export { createSlot } from "./singleton-slot";
export type { StoragePort, UploadInput, UploadResult } from "./storage-port/types";
export { configureStorage, getStoragePort } from "./storage-port/slot";
export type { JobDispatcherPort, DispatchEvent, DispatchResult } from "./job-dispatcher-port/types";
export { configureJobDispatcher, getJobDispatcher } from "./job-dispatcher-port/slot";
export { PROTOCOL_VERSION, type ProtocolVersion } from "./wire-version";
