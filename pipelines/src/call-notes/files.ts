import { z } from "zod";

import { NoteVisibilitySchema } from "./contracts";

/**
 * Read-only projection used by the employer workspace file rail. A Call Note
 * remains backed by its call_notes_calls + document_notes rows; this DTO is
 * deliberately metadata-only so listing files never loads transcript rows.
 */
export const WorkspaceCallNoteFileSchema = z
    .object({
        type: z.literal("call-note"),
        callId: z.string().min(1).max(64),
        noteId: z.number().int().positive(),
        title: z.string().max(512),
        visibility: NoteVisibilitySchema,
        revision: z.number().int().nonnegative(),
        updatedAt: z.string().datetime({ offset: true }),
        preview: z.string().max(512),
        /**
         * The indexed document that carries this Call Note's canonical Markdown
         * into ingestion and retrieval; null until the first index completes
         * and for Call Notes the viewer may not retrieve. Chat context and
         * citations use it; opening the file still routes to Calls.
         */
        documentId: z.number().int().positive().nullable(),
    })
    .strict();

export type WorkspaceCallNoteFile = z.infer<typeof WorkspaceCallNoteFileSchema>;

export const WorkspaceCallNoteFilesSchema = WorkspaceCallNoteFileSchema.array();
