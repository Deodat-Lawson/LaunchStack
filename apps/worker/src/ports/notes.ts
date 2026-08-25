/**
 * Note-related ports. Rehydration runs as part of the
 * `evidence.version.indexed` handler — chunks are already persisted by
 * then, so the old 3-minute `waitForVersionChunks` poll is unnecessary.
 * Embedding consumes `note.embedding.requested`, replacing the
 * fire-and-forget `void embedNote(...)` calls in web request handlers.
 */
import type { NoteEmbeddingPort, NoteRehydrationPort } from "@launchstack/orchestration";
import type { LoggerPort } from "@launchstack/runtime";

import { rehydrateNotesForDocument } from "~/server/notes/rehydrate-anchors";
import { embedNote } from "~/server/notes/embed-note";

export function createNoteRehydrationPort(logger: LoggerPort): NoteRehydrationPort {
    return {
        async rehydrateForSourceVersion({ sourceId, sourceVersionId, traceId }) {
            const result = await rehydrateNotesForDocument(sourceId, sourceVersionId);
            logger.info(
                { traceId, sourceId, sourceVersionId, ...result },
                "note anchors rehydrated"
            );
        },
    };
}

export function createNoteEmbeddingPort(logger: LoggerPort): NoteEmbeddingPort {
    return {
        async embedNote({ noteId, traceId }) {
            await embedNote(noteId);
            logger.info({ traceId, noteId }, "note embedded");
        },
    };
}
