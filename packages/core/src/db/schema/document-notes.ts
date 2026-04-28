import { sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    bigint,
    index,
    integer,
    jsonb,
    serial,
    text,
    timestamp,
    varchar,
} from "drizzle-orm/pg-core";
import { pgVector } from "../pgVector";
import { pgTable } from "./helpers";

/**
 * Sticky-note style annotations attached to a document.
 *
 * Anchor payload follows a W3C Web Annotation–inspired shape: a format-native
 * `primary` selector (PDF quads, media fragment, etc.) plus a durable
 * `quote` (exact text + prefix/suffix) that lets the anchor survive re-upload
 * and re-OCR via fuzzy matching. `anchorStatus` records the outcome of the
 * last rehydration attempt: a fresh note is `resolved`; if a later version
 * shifts the quoted span it moves to `drifted`; if the span vanishes it
 * becomes `orphaned` — the note is kept, just unanchored.
 */
export const documentNotes = pgTable(
    "document_notes",
    {
        id: serial("id").primaryKey(),
        userId: varchar("user_id", { length: 256 }).notNull(),
        companyId: varchar("company_id", { length: 256 }),
        documentId: varchar("document_id", { length: 256 }),

        /** Version of the document this note was originally anchored against. */
        versionId: bigint("version_id", { mode: "bigint" }),

        title: text("title"),

        /**
         * Legacy plain-text body. Retained for backward compatibility with
         * existing rows; new writes prefer `contentRich` (Tiptap JSON) as the
         * source of truth and `contentMarkdown` as the embedding input.
         */
        content: text("content"),

        /** Tiptap JSON document — source of truth for rich editing. */
        contentRich: jsonb("content_rich"),

        /** Markdown projection of `contentRich`, used for search + embedding. */
        contentMarkdown: text("content_markdown"),

        /**
         * Anchor payload. See `NoteAnchor` in TS-land for the shape.
         * `null` for free-floating notes not tied to a specific span.
         */
        anchor: jsonb("anchor"),

        /** `resolved` | `drifted` | `orphaned`. */
        anchorStatus: varchar("anchor_status", { length: 24 }).default("resolved"),

        tags: text("tags").array().default([]),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
            () => new Date()
        ),
    },
    (table) => ({
        notesUserIdx: index("document_notes_user_idx").on(table.userId),
        notesDocIdx: index("document_notes_document_idx").on(table.documentId),
        notesCompanyIdx: index("document_notes_company_idx").on(table.companyId),
        notesVersionIdx: index("document_notes_version_idx").on(table.versionId),
        notesAnchorStatusIdx: index("document_notes_anchor_status_idx").on(
            table.anchorStatus
        ),
    })
);

/**
 * Per-note vector embeddings, mirroring `documentRetrievalChunks` so the
 * existing hybrid retriever can union notes into candidate pools. One row per
 * note (notes are short) — on update we re-insert with the same id.
 */
export const documentNoteEmbeddings = pgTable(
    "document_note_embeddings",
    {
        id: serial("id").primaryKey(),
        noteId: integer("note_id").notNull(),
        /**
         * Denormalized owner — JOIN-free filtering for "Ask My Notes" / Notebook
         * search. Backfilled from `documentNotes.userId` and kept in sync on
         * every embed write.
         */
        userId: varchar("user_id", { length: 256 }),
        documentId: varchar("document_id", { length: 256 }),
        companyId: varchar("company_id", { length: 256 }),
        versionId: bigint("version_id", { mode: "bigint" }),

        /** The exact text that was embedded (title + body + quote). */
        content: text("content").notNull(),
        tokenCount: integer("token_count").notNull().default(0),

        embedding: pgVector({ dimension: 1536 })("embedding"),
        embeddingShort: pgVector({ dimension: 512 })("embedding_short"),

        modelVersion: varchar("model_version", { length: 64 }),

        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    (table) => ({
        noteIdIdx: index("doc_note_emb_note_id_idx").on(table.noteId),
        userIdIdx: index("doc_note_emb_user_id_idx").on(table.userId),
        documentIdIdx: index("doc_note_emb_document_id_idx").on(table.documentId),
        companyIdIdx: index("doc_note_emb_company_id_idx").on(table.companyId),
        embeddingShortIdx: index("doc_note_emb_embedding_short_idx").using(
            "hnsw",
            table.embeddingShort.op("vector_cosine_ops")
        ),
    })
);

/**
 * Bidirectional link graph between notes and notes/documents. Populated at
 * note write-time by parsing `[[Wiki Link]]` mentions out of the Tiptap JSON
 * tree. Used to render clickable chips and the Backlinks panel.
 *
 * Resolution is best-effort: a row with null `targetNoteId` / `targetDocumentId`
 * represents a "broken link" — the literal `[[Title]]` was typed but no match
 * exists in the user's company scope. Renames re-resolve via `targetTitle`.
 */
export const noteLinks = pgTable(
    "note_links",
    {
        id: serial("id").primaryKey(),
        sourceNoteId: integer("source_note_id").notNull(),
        targetType: varchar("target_type", { length: 8 }).notNull(),
        targetNoteId: integer("target_note_id"),
        targetDocumentId: varchar("target_document_id", { length: 256 }),
        targetTitle: text("target_title").notNull(),
        resolvedAt: timestamp("resolved_at", { withTimezone: true }),
        companyId: varchar("company_id", { length: 256 }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    (table) => ({
        sourceIdx: index("note_links_source_idx").on(table.sourceNoteId),
        targetNoteIdx: index("note_links_target_note_idx").on(table.targetNoteId),
        targetDocumentIdx: index("note_links_target_document_idx").on(
            table.targetDocumentId
        ),
        companyTitleIdx: index("note_links_company_title_idx").on(
            table.companyId,
            table.targetTitle
        ),
    })
);

export type NoteLink = InferSelectModel<typeof noteLinks>;
export type NoteLinkTargetType = "note" | "document";

export type DocumentNote = InferSelectModel<typeof documentNotes>;
export type DocumentNoteEmbedding = InferSelectModel<typeof documentNoteEmbeddings>;

// ---------------------------------------------------------------------------
// Anchor payload shape — stored in `documentNotes.anchor` as JSONB.
// ---------------------------------------------------------------------------

export type AnchorKind =
    | "pdf"
    | "docx"
    | "media"
    | "image"
    | "code"
    | "markdown"
    | "text";

export interface PdfQuadAnchor {
    kind: "pdf";
    page: number;
    /** Each quad: [x1, y1, x2, y2] in PDF user-space (0–1 normalized). */
    quads: Array<[number, number, number, number]>;
}

export interface MediaFragmentAnchor {
    kind: "media";
    /** Seconds from start of media. */
    start: number;
    end: number;
}

export interface CodeRangeAnchor {
    kind: "code";
    path: string;
    startLine: number;
    endLine: number;
    commitSha?: string;
}

export interface BlockIdAnchor {
    kind: "markdown" | "docx";
    blockId?: string;
    headingPath?: string[];
    paragraphIndex?: number;
}

export interface ImageBoxAnchor {
    kind: "image";
    /** Pixel-space in the original image. */
    box: [number, number, number, number];
}

export type PrimaryAnchor =
    | PdfQuadAnchor
    | MediaFragmentAnchor
    | CodeRangeAnchor
    | BlockIdAnchor
    | ImageBoxAnchor;

/** TextQuoteSelector — the durable fallback that survives reflow/re-OCR. */
export interface QuoteSelector {
    exact: string;
    prefix?: string;
    suffix?: string;
}

export interface NoteAnchor {
    type: AnchorKind;
    primary?: PrimaryAnchor;
    quote: QuoteSelector;
    /** Back-reference to the chunk that was anchored at creation time. */
    chunkIdAtCreate?: number;
}

export type AnchorStatus = "resolved" | "drifted" | "orphaned";
