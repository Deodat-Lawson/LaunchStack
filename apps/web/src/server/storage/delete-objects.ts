import { deleteObjects as deleteS3Objects } from "./adapters/s3";
import { deleteObjects as deleteDatabaseObjects } from "./adapters/database";
import { deleteObjects as deleteBlobObjects } from "./adapters/vercel-blob";
import { deleteObjects as deleteUploadThingObjects } from "./adapters/uploadthing";
import type { DeleteResult, ObjectRef, StorageAdapter } from "./object-ref";

const adapters = {
    s3: deleteS3Objects,
    database: deleteDatabaseObjects,
    "vercel-blob": deleteBlobObjects,
    uploadthing: deleteUploadThingObjects,
} satisfies Record<StorageAdapter, (refs: readonly ObjectRef[]) => Promise<DeleteResult[]>>;

/** One result per input occurrence, including duplicate references, in input order. */
export async function deleteStoredObjects(refs: readonly ObjectRef[]): Promise<DeleteResult[]> {
    const groups = new Map<StorageAdapter, { refs: ObjectRef[]; indexes: number[] }>();
    refs.forEach((ref, index) => {
        let group = groups.get(ref.adapter);
        if (!group) {
            group = { refs: [], indexes: [] };
            groups.set(ref.adapter, group);
        }
        group.refs.push(ref);
        group.indexes.push(index);
    });
    const results = new Array<DeleteResult>(refs.length);
    await Promise.all(
        Array.from(groups, async ([adapter, group]) => {
            const deleted = await adapters[adapter](group.refs);
            group.indexes.forEach((index, position) => {
                results[index] = deleted[position]!;
            });
        })
    );
    return results;
}
