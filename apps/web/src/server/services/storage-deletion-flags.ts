/**
 * Re-export only. The flags have exactly one implementation, in
 * ~/server/storage/deletion-flags — this module exists because several
 * callers already import them from the services path.
 */
export {
  getStorageDeletionFlagState,
  isStorageDeletionLifecycleEnabled,
  isStorageDeletionWorkerEnabled,
} from "~/server/storage/deletion-flags";
