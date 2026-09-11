/**
 * Repo-workspace product tables (design §4). Product migration set — the
 * drizzle config in apps/web globs this file; engine tables are referenced,
 * never defined here.
 *
 * Four tables, four jobs:
 * - repo_workspaces        the connected repository and its sync state
 * - repo_sync_requests     the coalescing sync queue (one pending per
 *                          workspace, enforced by a partial unique index)
 * - repo_context_bundles   the deterministic per-SHA derived context
 * - repo_explainer_jobs    explanation runs (job-vertical shape, like
 *                          trend_search_jobs) + the published-source link
 */

import { sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    bigint,
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

import type { ContextBundle } from "./types";
import {
    DIAGRAM_TYPES,
    REPO_EXPLAINER_JOB_STATUSES,
    REPO_WORKSPACE_STATUSES,
    SYNC_REASONS,
    SYNC_REQUEST_STATUSES,
} from "./types";

export const repoWorkspaces = pgTable(
    "repo_workspaces",
    {
        id: varchar("id", { length: 256 }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        createdByUserId: varchar("created_by_user_id", { length: 256 }).notNull(),
        provider: varchar("provider", { length: 32, enum: ["github"] })
            .notNull()
            .default("github"),
        owner: varchar("owner", { length: 256 }).notNull(),
        repo: varchar("repo", { length: 256 }).notNull(),
        status: varchar("status", { length: 32, enum: REPO_WORKSPACE_STATUSES })
            .notNull()
            .default("pending"),
        /** Head of the default branch as of the last completed sync. */
        headSha: varchar("head_sha", { length: 64 }),
        /** Absolute mirror path on the worker volume — operational metadata,
         * recomputed on connect; never trusted as a security boundary. */
        mirrorPath: text("mirror_path"),
        diskBytes: bigint("disk_bytes", { mode: "number" }),
        lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
        lastErrorMessage: text("last_error_message"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => ({
        repoUnique: uniqueIndex("repo_workspaces_company_repo_unique").on(
            table.companyId,
            table.provider,
            table.owner,
            table.repo
        ),
        companyIdx: index("repo_workspaces_company_id_idx").on(table.companyId),
        statusIdx: index("repo_workspaces_status_idx").on(table.status),
    })
);

export const repoSyncRequests = pgTable(
    "repo_sync_requests",
    {
        id: varchar("id", { length: 256 }).primaryKey(),
        workspaceId: varchar("workspace_id", { length: 256 })
            .notNull()
            .references(() => repoWorkspaces.id, { onDelete: "cascade" }),
        status: varchar("status", { length: 32, enum: SYNC_REQUEST_STATUSES })
            .notNull()
            .default("pending"),
        reason: varchar("reason", { length: 32, enum: SYNC_REASONS }).notNull(),
        /** Set by the winning claimant; mutations are gated on it. */
        claimId: varchar("claim_id", { length: 256 }),
        errorMessage: text("error_message"),
        requestedAt: timestamp("requested_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        startedAt: timestamp("started_at", { withTimezone: true }),
        completedAt: timestamp("completed_at", { withTimezone: true }),
    },
    table => ({
        /** The coalescing rule: push bursts collapse into the one pending
         * request instead of queueing one row per webhook delivery. */
        pendingUnique: uniqueIndex("repo_sync_requests_pending_unique")
            .on(table.workspaceId)
            .where(sql`${table.status} = 'pending'`),
        workspaceIdx: index("repo_sync_requests_workspace_idx").on(table.workspaceId),
        statusIdx: index("repo_sync_requests_status_idx").on(table.status),
    })
);

export const repoContextBundles = pgTable(
    "repo_context_bundles",
    {
        id: varchar("id", { length: 256 }).primaryKey(),
        workspaceId: varchar("workspace_id", { length: 256 })
            .notNull()
            .references(() => repoWorkspaces.id, { onDelete: "cascade" }),
        sha: varchar("sha", { length: 64 }).notNull(),
        bundle: jsonb("bundle").$type<ContextBundle>().notNull(),
        computeMs: integer("compute_ms"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => ({
        shaUnique: uniqueIndex("repo_context_bundles_workspace_sha_unique").on(
            table.workspaceId,
            table.sha
        ),
        workspaceIdx: index("repo_context_bundles_workspace_idx").on(table.workspaceId),
    })
);

/** The persisted result of one explanation run. */
export interface RepoExplanationJobResult {
    summary: string;
    mermaidCode: string;
    filesRead: string[];
    path: "loop" | "fast";
    turns: number;
    provenance: {
        sha: string;
        skillVersion: string;
        skillHash: string;
        modelId?: string;
        promptVersion: string;
    };
    tokenUsage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
    };
}

export const repoExplainerJobs = pgTable(
    "repo_explainer_jobs",
    {
        id: varchar("id", { length: 256 }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        workspaceId: varchar("workspace_id", { length: 256 })
            .notNull()
            .references(() => repoWorkspaces.id, { onDelete: "cascade" }),
        userId: varchar("user_id", { length: 256 }).notNull(),
        status: varchar("status", { length: 32, enum: REPO_EXPLAINER_JOB_STATUSES })
            .notNull()
            .default("queued"),
        diagramType: varchar("diagram_type", { length: 32, enum: DIAGRAM_TYPES }).notNull(),
        instructions: text("instructions"),
        /** The commit the run actually explained; set when the job starts. */
        sha: varchar("sha", { length: 64 }),
        claimId: varchar("claim_id", { length: 256 }),
        result: jsonb("result").$type<RepoExplanationJobResult>(),
        errorMessage: text("error_message"),
        /** Sources-library link once published (design §3.5). */
        publishedDocumentId: bigint("published_document_id", { mode: "bigint" }),
        /** Set when a later sync makes the published explanation outdated. */
        staleAt: timestamp("stale_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        startedAt: timestamp("started_at", { withTimezone: true }),
        completedAt: timestamp("completed_at", { withTimezone: true }),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => ({
        companyIdx: index("repo_explainer_jobs_company_idx").on(table.companyId),
        workspaceIdx: index("repo_explainer_jobs_workspace_idx").on(table.workspaceId),
        statusIdx: index("repo_explainer_jobs_status_idx").on(table.status),
    })
);

export type RepoWorkspaceRow = InferSelectModel<typeof repoWorkspaces>;
export type RepoSyncRequestRow = InferSelectModel<typeof repoSyncRequests>;
export type RepoContextBundleRow = InferSelectModel<typeof repoContextBundles>;
export type RepoExplainerJobRow = InferSelectModel<typeof repoExplainerJobs>;
