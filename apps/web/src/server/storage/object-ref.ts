export const STORAGE_ADAPTERS = ["s3", "database", "vercel-blob", "uploadthing"] as const;

export type StorageAdapter = (typeof STORAGE_ADAPTERS)[number];

export interface ObjectRef {
    readonly adapter: StorageAdapter;
    readonly storageLocationId: string;
    readonly key: string;
}

export type DeleteOutcome = "deleted" | "not_found" | "blocked" | "retryable";

export interface DeleteResult {
    readonly ref: ObjectRef;
    readonly outcome: DeleteOutcome;
    readonly errorCode?: string;
    readonly message?: string;
}

export function refIdentity(ref: Pick<ObjectRef, "adapter" | "storageLocationId" | "key">): string {
    return `${ref.adapter}\0${ref.storageLocationId}\0${ref.key}`;
}
