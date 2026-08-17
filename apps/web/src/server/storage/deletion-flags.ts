/** Intake gate. Default off when unset. */
export function isStorageDeletionLifecycleEnabled(): boolean {
  const value = process.env.STORAGE_DELETION_LIFECYCLE_ENABLED;
  return value === "1" || value === "true";
}

/** Worker-processing gate. Default off when unset. */
export function isStorageDeletionWorkerEnabled(): boolean {
  const value = process.env.STORAGE_DELETION_WORKER_ENABLED;
  return value === "1" || value === "true";
}
