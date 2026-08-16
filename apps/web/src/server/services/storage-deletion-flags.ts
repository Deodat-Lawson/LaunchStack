export function isStorageDeletionLifecycleEnabled(): boolean {
    return isEnabled(process.env.STORAGE_DELETION_LIFECYCLE_ENABLED);
}

export function isStorageDeletionWorkerEnabled(): boolean {
    return isEnabled(process.env.STORAGE_DELETION_WORKER_ENABLED);
}

export function getStorageDeletionFlagState(): {
    lifecycleEnabled: boolean;
    workerEnabled: boolean;
} {
    return {
        lifecycleEnabled: isStorageDeletionLifecycleEnabled(),
        workerEnabled: isStorageDeletionWorkerEnabled(),
    };
}

function isEnabled(value: string | undefined): boolean {
    return value === "true" || value === "1";
}
