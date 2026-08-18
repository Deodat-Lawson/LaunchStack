/**
 * The two storage-deletion env flags (Decision 7) — and the only place that
 * reads them. Both default OFF; flag-off never falls back to the old direct
 * delete path, it refuses.
 *
 * Read from process.env on every call rather than from the validated `env`
 * object on purpose: `env` is parsed once at import, and the deletion test
 * scripts toggle these flags at runtime to exercise the flag-off branches.
 * `env.ts` still declares and validates both, so a malformed value is caught
 * at boot.
 */

function isEnabled(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

/** Intake gate (routes/coordinator). Default off when unset. */
export function isStorageDeletionLifecycleEnabled(): boolean {
  return isEnabled(process.env.STORAGE_DELETION_LIFECYCLE_ENABLED);
}

/** Worker-processing gate. Default off when unset. */
export function isStorageDeletionWorkerEnabled(): boolean {
  return isEnabled(process.env.STORAGE_DELETION_WORKER_ENABLED);
}

/** Both flags at once, for the observability/metrics endpoint. */
export function getStorageDeletionFlagState(): {
  lifecycleEnabled: boolean;
  workerEnabled: boolean;
} {
  return {
    lifecycleEnabled: isStorageDeletionLifecycleEnabled(),
    workerEnabled: isStorageDeletionWorkerEnabled(),
  };
}
