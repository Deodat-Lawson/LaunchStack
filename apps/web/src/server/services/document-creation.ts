/**
 * Moved to the engine: packages/adapters/src/ingestion/source-lifecycle.ts
 * (ADR-003 — the lifecycle now enqueues its `source.version.created` outbox
 * event inside the creating transaction; the post-commit Inngest dispatch is
 * gone, and `eventIds` in the returned shapes is always empty).
 *
 * Kept as a re-export so the existing `~/server/services/document-creation`
 * consumers and tests keep working. New code should import from
 * `@launchstack/orchestration` directly. (Not from the `@launchstack/engine`
 * aggregate: it also re-exports the ingestion pipeline, so importing it here
 * would tie every upload route to ingestion's model calls in the
 * workspace-model scope guard.)
 */
export {
    createDocumentLifecycle,
    createDocumentVersionLifecycle,
    findDocumentByCreationKey,
    type CreateDocumentLifecycleParams,
    type CreateDocumentVersionLifecycleParams,
    type CreatedDocumentLifecycle,
    type CreatedDocumentVersionLifecycle,
    type DocumentCreationProcessing,
    type DocumentLifecycleJob,
} from "@launchstack/orchestration";
