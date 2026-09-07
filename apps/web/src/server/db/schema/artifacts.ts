import { sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    bigint,
    bigserial,
    boolean,
    index,
    integer,
    text,
    timestamp,
    varchar,
} from "drizzle-orm/pg-core";

import { company } from "@launchstack/store/schema";
import { pgTable } from "@launchstack/store/schema/helpers";

/**
 * Claude artifacts — pages, diagrams, and snippets built in Claude and
 * imported into the workspace so they outlive the conversation they came from.
 *
 * The body is stored inline (`content`) rather than through the storage layer:
 * an artifact is a single self-contained text file capped at 10 MB, the viewer
 * always reads it whole, and an inline column works identically on both the
 * S3 and database storage backends with zero configuration. List queries must
 * never select `content` — that is what `searchText` and the summary
 * serializer exist for.
 *
 * `sourceUrl` is provenance, not a live link: claude.ai share pages render
 * their content client-side behind bot protection, so re-fetching is not
 * assumed to work. The imported copy is the artifact.
 */
export const claudeArtifacts = pgTable(
    "claude_artifacts",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        /** Auth subject id of whoever imported it. */
        createdByUserId: varchar("created_by_user_id", { length: 256 }).notNull(),
        /** Auth subject id of whoever changed it last, for the "edited by" line. */
        updatedByUserId: varchar("updated_by_user_id", { length: 256 }),

        title: varchar("title", { length: 300 }).notNull(),
        description: text("description"),
        /** Folder name, mirroring the Sources library's folder column. */
        folder: varchar("folder", { length: 256 }).notNull().default("Unfiled"),

        /** One of `ARTIFACT_TYPES` (~/lib/artifact-content): html, svg, markdown, mermaid, react, code. */
        artifactType: varchar("artifact_type", { length: 32 }).notNull().default("html"),
        /** Where it came from — a claude.ai share link or any other page. */
        sourceUrl: varchar("source_url", { length: 2048 }),
        /** How it arrived: paste, upload, or url. */
        importMethod: varchar("import_method", { length: 32 }).notNull().default("paste"),

        /** The artifact body itself (HTML, SVG, Markdown, Mermaid, or code). */
        content: text("content").notNull(),
        sizeBytes: integer("size_bytes").notNull().default(0),
        /** SHA-256 of `content`, for spotting duplicate imports. */
        contentHash: varchar("content_hash", { length: 64 }).notNull().default(""),
        /** Tag-stripped body text, kept for cheap ILIKE search on the list. */
        searchText: text("search_text"),

        starred: boolean("starred").notNull().default(false),

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
        companyIdx: index("claude_artifacts_company_idx").on(table.companyId),
        companyUpdatedIdx: index("claude_artifacts_company_updated_idx").on(
            table.companyId,
            table.updatedAt
        ),
        creatorIdx: index("claude_artifacts_creator_idx").on(table.createdByUserId),
        folderIdx: index("claude_artifacts_folder_idx").on(table.companyId, table.folder),
        deletedIdx: index("claude_artifacts_deleted_idx").on(table.deletedAt),
    })
);

export type ClaudeArtifact = InferSelectModel<typeof claudeArtifacts>;
