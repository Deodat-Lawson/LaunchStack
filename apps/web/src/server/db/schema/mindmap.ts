import { sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    bigint,
    bigserial,
    boolean,
    index,
    integer,
    jsonb,
    text,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/pg-core";

import { company } from "@launchstack/store/schema";
import { pgTable } from "@launchstack/store/schema/helpers";

/**
 * Mindmap — the diagramming app.
 *
 * A mindmap is one JSON document (`doc`) holding every page, shape and
 * connector. It is stored whole rather than shredded into node/edge tables
 * because the editor always reads and writes the entire file, and because the
 * document schema is versioned client-side (`DOC_SCHEMA_VERSION`) where the
 * parser that has to tolerate old shapes already lives.
 *
 * `revision` is a monotonic counter, not a timestamp: two browsers saving the
 * same document race on wall-clock but not on an integer, so a stale tab gets
 * a 409 instead of silently overwriting the newer version.
 */
export const mindmaps = pgTable(
    "mindmaps",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        /** Auth subject id of the creator. */
        createdByUserId: varchar("created_by_user_id", { length: 256 }).notNull(),
        /** Auth subject id of whoever saved last, for the "edited by" line. */
        updatedByUserId: varchar("updated_by_user_id", { length: 256 }),

        title: varchar("title", { length: 300 }).notNull(),
        description: text("description"),
        /** Template id the document started from, for analytics and re-open. */
        templateId: varchar("template_id", { length: 64 }),
        /** Folder name, mirroring the Sources library's folder column. */
        folder: varchar("folder", { length: 256 }).notNull().default("Unfiled"),

        /** The full `MindmapDoc`. */
        doc: jsonb("doc").notNull(),
        /** Client-side document schema version, for forward migrations. */
        docVersion: integer("doc_version").notNull().default(1),
        /** Optimistic-concurrency counter; bumped on every successful save. */
        revision: integer("revision").notNull().default(1),

        /** Small PNG data URI rendered by the editor on save. */
        thumbnail: text("thumbnail"),
        /** Flattened node/edge text, kept for cheap ILIKE search on the list. */
        searchText: text("search_text"),

        nodeCount: integer("node_count").notNull().default(0),
        edgeCount: integer("edge_count").notNull().default(0),

        starred: boolean("starred").notNull().default(false),
        /** Set when the map has been pushed into the Sources library. */
        publishedDocumentId: bigint("published_document_id", { mode: "bigint" }),
        publishedAt: timestamp("published_at", { withTimezone: true }),
        /**
         * The `revision` that was published. When it trails `revision`, the
         * citable copy is older than the map on screen and the UI says so.
         */
        publishedRevision: integer("published_revision"),

        /** Soft delete — the list hides these, "Trash" restores them. */
        deletedAt: timestamp("deleted_at", { withTimezone: true }),
        openedAt: timestamp("opened_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => ({
        companyIdx: index("mindmaps_company_idx").on(table.companyId),
        companyUpdatedIdx: index("mindmaps_company_updated_idx").on(
            table.companyId,
            table.updatedAt
        ),
        creatorIdx: index("mindmaps_creator_idx").on(table.createdByUserId),
        folderIdx: index("mindmaps_folder_idx").on(table.companyId, table.folder),
        deletedIdx: index("mindmaps_deleted_idx").on(table.deletedAt),
    })
);

/**
 * Point-in-time snapshots. One row per explicit save (throttled by the editor's
 * autosave), so "version history" can restore a document without any
 * server-side replay of edits.
 */
export const mindmapRevisions = pgTable(
    "mindmap_revisions",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        mindmapId: bigint("mindmap_id", { mode: "number" })
            .notNull()
            .references(() => mindmaps.id, { onDelete: "cascade" }),
        revision: integer("revision").notNull(),
        doc: jsonb("doc").notNull(),
        authorUserId: varchar("author_user_id", { length: 256 }),
        /** Optional user-supplied name, e.g. "before the rewrite". */
        label: varchar("label", { length: 200 }),
        nodeCount: integer("node_count").notNull().default(0),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => ({
        mapIdx: index("mindmap_revisions_map_idx").on(table.mindmapId, table.revision),
        createdIdx: index("mindmap_revisions_created_idx").on(table.createdAt),
    })
);

/**
 * Who currently has a mindmap open, and where their cursor is.
 *
 * Presence is *awareness*, not editing: the document itself is still saved
 * whole with an optimistic-concurrency check. This table is what lets two
 * people see each other coming — and lets a stale tab notice a newer revision
 * before it tries to save over it.
 *
 * Rows are upserted on a heartbeat and read back filtered by `last_seen_at`, so
 * a closed tab ages out on its own without needing a reliable "goodbye".
 */
export const mindmapPresence = pgTable(
    "mindmap_presence",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        mindmapId: bigint("mindmap_id", { mode: "number" })
            .notNull()
            .references(() => mindmaps.id, { onDelete: "cascade" }),
        userId: varchar("user_id", { length: 256 }).notNull(),
        displayName: varchar("display_name", { length: 256 }),
        /** Which page of the document they are looking at. */
        pageId: varchar("page_id", { length: 64 }),
        /** Cursor in world coordinates; null when the pointer is off-canvas. */
        cursorX: integer("cursor_x"),
        cursorY: integer("cursor_y"),
        /** Node ids they have selected, so others can see what is being worked on. */
        selection: jsonb("selection"),
        /** Document revision this client last loaded or saved. */
        revisionSeen: integer("revision_seen").notNull().default(0),
        lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => ({
        mapUserUnique: uniqueIndex("mindmap_presence_map_user_idx").on(
            table.mindmapId,
            table.userId
        ),
        seenIdx: index("mindmap_presence_seen_idx").on(table.mindmapId, table.lastSeenAt),
    })
);

export type Mindmap = InferSelectModel<typeof mindmaps>;
export type MindmapRevision = InferSelectModel<typeof mindmapRevisions>;
export type MindmapPresence = InferSelectModel<typeof mindmapPresence>;
