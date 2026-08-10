import { sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    bigint,
    bigserial,
    boolean,
    doublePrecision,
    index,
    jsonb,
    text,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/pg-core";
import { pgTable } from "@launchstack/core/db/schema/helpers";

/**
 * The internal document workspace — a page tree the user authors in, as
 * opposed to `documents` (uploaded files we only read) or `documentNotes`
 * (annotations pinned to those files). This is the write side of the product:
 * pages own a rich block document, nest arbitrarily deep, and can act as rows
 * inside a database.
 *
 * A page's body is stored as a ProseMirror/Tiptap JSON tree in `content`.
 * Blocks are not rows: keeping the whole document in one JSONB column makes a
 * page load a single read and lets the editor own its own transaction model.
 * `contentText` is the flattened projection used for search and embeddings.
 */
export const workspacePages = pgTable(
    "workspace_pages",
    {
        /** Client-generatable UUID so a new page can be routed to before it saves. */
        id: varchar("id", { length: 36 }).primaryKey(),
        userId: varchar("user_id", { length: 256 }).notNull(),
        companyId: varchar("company_id", { length: 256 }),

        /** Null for a top-level page. Self-referential tree. */
        parentPageId: varchar("parent_page_id", { length: 36 }),
        /** `workspace` | `page` | `database` — mirrors Notion's parent discriminator. */
        parentType: varchar("parent_type", { length: 16 })
            .notNull()
            .default("workspace"),
        /** Set when this page is a row of a database rather than a plain child. */
        databaseId: varchar("database_id", { length: 36 }),

        title: text("title").notNull().default(""),
        /** `{ type: "emoji" | "image", value: string }` */
        icon: jsonb("icon"),
        /** `{ type: "gradient" | "image", value: string, position: number }` */
        cover: jsonb("cover"),

        /** Tiptap JSON document — source of truth for the page body. */
        content: jsonb("content"),
        /** Flattened text projection of `content`, for search. */
        contentText: text("content_text"),
        /** Property values when this page is a database row: `{ [propId]: value }`. */
        properties: jsonb("properties"),

        // -- Page display settings (Notion's ••• → Style / Font / Width) ------
        /** `default` | `serif` | `mono` */
        font: varchar("font", { length: 16 }).notNull().default("default"),
        smallText: boolean("small_text").notNull().default(false),
        fullWidth: boolean("full_width").notNull().default(false),
        locked: boolean("locked").notNull().default(false),

        isFavorite: boolean("is_favorite").notNull().default(false),
        isTemplate: boolean("is_template").notNull().default(false),

        /**
         * Trash is a flag, not a delete: Notion keeps trashed pages browsable
         * and restorable with their subtree intact. Only "delete permanently"
         * removes the row.
         */
        inTrash: boolean("in_trash").notNull().default(false),
        trashedAt: timestamp("trashed_at", { withTimezone: true }),

        /**
         * Sort key among siblings. Fractional so a drag between two neighbours
         * is a single-row write instead of a reindex of the whole level.
         */
        position: doublePrecision("position").notNull().default(0),

        /** Slug set when the page is published to the web; null otherwise. */
        publicSlug: varchar("public_slug", { length: 64 }),

        createdBy: varchar("created_by", { length: 256 }),
        lastEditedBy: varchar("last_edited_by", { length: 256 }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    (table) => ({
        pagesUserIdx: index("workspace_pages_user_idx").on(table.userId),
        pagesParentIdx: index("workspace_pages_parent_idx").on(table.parentPageId),
        pagesCompanyIdx: index("workspace_pages_company_idx").on(table.companyId),
        pagesDatabaseIdx: index("workspace_pages_database_idx").on(table.databaseId),
        pagesTrashIdx: index("workspace_pages_trash_idx").on(
            table.userId,
            table.inTrash
        ),
        pagesUpdatedIdx: index("workspace_pages_updated_idx").on(table.updatedAt),
        pagesPublicSlugIdx: uniqueIndex("workspace_pages_public_slug_idx").on(
            table.publicSlug
        ),
    })
);

/**
 * A database block: the schema (property definitions) and the saved views that
 * render its rows. The rows themselves are `workspacePages` with
 * `databaseId` set — same as Notion, where every row is a page.
 *
 * `pageId` is the page holding the database. An inline database lives in the
 * body of that page; a full-page database *is* that page.
 */
export const workspaceDatabases = pgTable(
    "workspace_databases",
    {
        id: varchar("id", { length: 36 }).primaryKey(),
        userId: varchar("user_id", { length: 256 }).notNull(),
        companyId: varchar("company_id", { length: 256 }),
        pageId: varchar("page_id", { length: 36 }).notNull(),

        title: text("title").notNull().default(""),
        description: text("description"),
        icon: jsonb("icon"),

        /** `DatabaseProperty[]` — ordered column definitions. */
        properties: jsonb("properties").notNull().default(sql`'[]'::jsonb`),
        /** `DatabaseView[]` — table / board / list / gallery / calendar / timeline. */
        views: jsonb("views").notNull().default(sql`'[]'::jsonb`),

        /** False when the database occupies its own page. */
        isInline: boolean("is_inline").notNull().default(true),

        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    (table) => ({
        dbUserIdx: index("workspace_databases_user_idx").on(table.userId),
        dbPageIdx: index("workspace_databases_page_idx").on(table.pageId),
    })
);

/**
 * Point-in-time snapshots of a page body, written on a debounce while editing
 * and on demand. Powers "Page history" and restore.
 */
export const workspacePageVersions = pgTable(
    "workspace_page_versions",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        pageId: varchar("page_id", { length: 36 }).notNull(),
        userId: varchar("user_id", { length: 256 }).notNull(),
        title: text("title"),
        icon: jsonb("icon"),
        content: jsonb("content"),
        /** Optional human label, e.g. the name given to a manual snapshot. */
        label: text("label"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    (table) => ({
        versionsPageIdx: index("workspace_page_versions_page_idx").on(
            table.pageId,
            table.createdAt
        ),
    })
);

/**
 * Comment threads. A `blockId` scopes the thread to one block (Notion's
 * inline comment); a null `blockId` is a page-level comment. Replies point at
 * the thread root through `parentCommentId`.
 */
export const workspaceComments = pgTable(
    "workspace_comments",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        pageId: varchar("page_id", { length: 36 }).notNull(),
        userId: varchar("user_id", { length: 256 }).notNull(),
        authorName: text("author_name"),
        authorAvatar: text("author_avatar"),

        /** The `data-id` of the commented block; null for a page comment. */
        blockId: varchar("block_id", { length: 36 }),
        /** The exact text the comment was attached to, for orphan detection. */
        anchorText: text("anchor_text"),
        parentCommentId: bigint("parent_comment_id", { mode: "number" }),

        body: text("body").notNull(),
        resolved: boolean("resolved").notNull().default(false),
        resolvedAt: timestamp("resolved_at", { withTimezone: true }),
        resolvedBy: varchar("resolved_by", { length: 256 }),

        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }),
    },
    (table) => ({
        commentsPageIdx: index("workspace_comments_page_idx").on(table.pageId),
        commentsBlockIdx: index("workspace_comments_block_idx").on(table.blockId),
        commentsThreadIdx: index("workspace_comments_thread_idx").on(
            table.parentCommentId
        ),
    })
);

/**
 * Page → page mention graph, rebuilt on every save from the `pageLink` and
 * `mention` nodes in the body. Drives the Backlinks section.
 */
export const workspacePageLinks = pgTable(
    "workspace_page_links",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        sourcePageId: varchar("source_page_id", { length: 36 }).notNull(),
        targetPageId: varchar("target_page_id", { length: 36 }).notNull(),
        userId: varchar("user_id", { length: 256 }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    (table) => ({
        linksSourceIdx: index("workspace_page_links_source_idx").on(
            table.sourcePageId
        ),
        linksTargetIdx: index("workspace_page_links_target_idx").on(
            table.targetPageId
        ),
        linksPairIdx: uniqueIndex("workspace_page_links_pair_idx").on(
            table.sourcePageId,
            table.targetPageId
        ),
    })
);

export type WorkspacePage = InferSelectModel<typeof workspacePages>;
export type WorkspaceDatabase = InferSelectModel<typeof workspaceDatabases>;
export type WorkspacePageVersion = InferSelectModel<typeof workspacePageVersions>;
export type WorkspaceComment = InferSelectModel<typeof workspaceComments>;
export type WorkspacePageLink = InferSelectModel<typeof workspacePageLinks>;

// ---------------------------------------------------------------------------
// JSONB payload shapes.
// ---------------------------------------------------------------------------

export type PageIcon =
    | { type: "emoji"; value: string }
    | { type: "image"; value: string };

export interface PageCover {
    type: "gradient" | "image";
    value: string;
    /** 0–100, the vertical focal point chosen by "Reposition". */
    position: number;
}

/** Every property type Notion offers on a database column. */
export type DatabasePropertyType =
    | "title"
    | "text"
    | "number"
    | "select"
    | "multi_select"
    | "status"
    | "date"
    | "person"
    | "files"
    | "checkbox"
    | "url"
    | "email"
    | "phone"
    | "formula"
    | "relation"
    | "rollup"
    | "created_time"
    | "created_by"
    | "last_edited_time"
    | "last_edited_by";

export interface SelectOption {
    id: string;
    name: string;
    color: string;
    /** Status properties bucket their options into groups. */
    group?: "todo" | "in_progress" | "complete";
}

export interface DatabaseProperty {
    id: string;
    name: string;
    type: DatabasePropertyType;
    options?: SelectOption[];
    /** `number` formatting: `number` | `percent` | `dollar` | `euro` | … */
    format?: string;
    /** `formula` expression source. */
    formula?: string;
    /** `relation` target database id. */
    relationDatabaseId?: string;
    /** `rollup` configuration. */
    rollup?: {
        relationPropertyId: string;
        targetPropertyId: string;
        function: string;
    };
    width?: number;
    hidden?: boolean;
    /** `true` for the single non-deletable title column. */
    isTitle?: boolean;
}

export type FilterOperator =
    | "is"
    | "is_not"
    | "contains"
    | "does_not_contain"
    | "starts_with"
    | "ends_with"
    | "is_empty"
    | "is_not_empty"
    | "greater_than"
    | "less_than"
    | "greater_than_or_equal"
    | "less_than_or_equal"
    | "is_before"
    | "is_after"
    | "is_on_or_before"
    | "is_on_or_after";

export interface DatabaseFilter {
    id: string;
    propertyId: string;
    operator: FilterOperator;
    value?: string | number | boolean | string[] | null;
}

export interface DatabaseSort {
    id: string;
    propertyId: string;
    direction: "asc" | "desc";
}

export type DatabaseViewType =
    | "table"
    | "board"
    | "list"
    | "gallery"
    | "calendar"
    | "timeline";

export interface DatabaseView {
    id: string;
    name: string;
    type: DatabaseViewType;
    filters: DatabaseFilter[];
    /** `and` | `or` across `filters`. */
    filterConjunction?: "and" | "or";
    sorts: DatabaseSort[];
    /** Property the board/gallery groups by. */
    groupByPropertyId?: string;
    /** Date property a calendar/timeline lays out on. */
    datePropertyId?: string;
    /** Ordered visible property ids; absent means "all". */
    visiblePropertyIds?: string[];
    /** Gallery card preview source. */
    cardPreview?: "cover" | "content" | "none";
    cardSize?: "small" | "medium" | "large";
    wrapCells?: boolean;
}

/** A database row's property values, keyed by `DatabaseProperty.id`. */
export type PagePropertyValues = Record<string, unknown>;
