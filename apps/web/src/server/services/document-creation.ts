/**
 * Moved to the engine: packages/adapters/src/ingestion/source-lifecycle.ts
 * (ADR-003 — the lifecycle now enqueues its `source.version.created` outbox
 * event inside the creating transaction; the post-commit Inngest dispatch is
 * gone, and `eventIds` in the returned shapes is always empty).
 *
 * Kept as the app's entry point so the existing
 * `~/server/services/document-creation` consumers and tests keep working —
 * and because it is the one place every app ingestion path passes through
 * (uploads, batch commits, Drive and Gmail imports, connectors, new
 * versions), it is where a document with no explicit processing choice gets
 * its workspace's (or destination folder's) default method. New code should
 * import from here rather than `@launchstack/orchestration` directly, or it
 * skips that default. (Not from the `@launchstack/engine` aggregate: it also
 * re-exports the ingestion pipeline, so importing it here would tie every
 * upload route to ingestion's model calls in the workspace-model scope guard.)
 */
import {
    createDocumentLifecycle as createDocumentLifecycleCore,
    createDocumentVersionLifecycle as createDocumentVersionLifecycleCore,
    type CreateDocumentLifecycleParams,
    type CreateDocumentVersionLifecycleParams,
    type CreatedDocumentLifecycle,
    type CreatedDocumentVersionLifecycle,
} from "@launchstack/orchestration";

import { defaultProviderFor } from "~/server/settings/processing-method";

export {
    findDocumentByCreationKey,
    type CreateDocumentLifecycleParams,
    type CreateDocumentVersionLifecycleParams,
    type CreatedDocumentLifecycle,
    type CreatedDocumentVersionLifecycle,
    type DocumentCreationProcessing,
    type DocumentLifecycleJob,
} from "@launchstack/orchestration";

/** Create a document; a PDF with no explicit provider gets the folder's or workspace's method. */
export async function createDocumentLifecycle(
    params: CreateDocumentLifecycleParams
): Promise<CreatedDocumentLifecycle> {
    const processing = params.processing;
    if (!processing || processing.preferredProvider) {
        return createDocumentLifecycleCore(params);
    }
    const preferredProvider = await defaultProviderFor({
        companyId: params.companyId,
        category: params.category,
        mimeType: params.mimeType,
        filename: processing.originalFilename ?? params.title,
    });
    return createDocumentLifecycleCore(
        preferredProvider ? { ...params, processing: { ...processing, preferredProvider } } : params
    );
}

/** Create a version; with no explicit provider it gets the method of the folder the document is in. */
export async function createDocumentVersionLifecycle(
    params: CreateDocumentVersionLifecycleParams
): Promise<CreatedDocumentVersionLifecycle> {
    if (params.preferredProvider) return createDocumentVersionLifecycleCore(params);
    const preferredProvider = await defaultProviderFor({
        companyId: params.companyId,
        category: params.category,
        mimeType: params.mimeType,
        filename: params.originalFilename ?? params.title,
    });
    return createDocumentVersionLifecycleCore(
        preferredProvider ? { ...params, preferredProvider } : params
    );
}
