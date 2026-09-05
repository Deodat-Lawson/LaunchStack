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
import type { InferSelectModel } from "drizzle-orm";
import type { ContextBundle } from "./types.js";
export declare const repoWorkspaces: import("drizzle-orm/pg-core").PgTableWithColumns<{
    name: "repo_workspaces";
    schema: undefined;
    columns: {
        id: import("drizzle-orm/pg-core").PgColumn<{
            name: "id";
            tableName: "repo_workspaces";
            dataType: "string";
            columnType: "PgVarchar";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: true;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            length: 256;
        }>;
        companyId: import("drizzle-orm/pg-core").PgColumn<{
            name: "company_id";
            tableName: "repo_workspaces";
            dataType: "bigint";
            columnType: "PgBigInt64";
            data: bigint;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        createdByUserId: import("drizzle-orm/pg-core").PgColumn<{
            name: "created_by_user_id";
            tableName: "repo_workspaces";
            dataType: "string";
            columnType: "PgVarchar";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            length: 256;
        }>;
        provider: import("drizzle-orm/pg-core").PgColumn<{
            name: "provider";
            tableName: "repo_workspaces";
            dataType: "string";
            columnType: "PgVarchar";
            data: "github";
            driverParam: string;
            notNull: true;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: ["github"];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            length: 32;
        }>;
        owner: import("drizzle-orm/pg-core").PgColumn<{
            name: "owner";
            tableName: "repo_workspaces";
            dataType: "string";
            columnType: "PgVarchar";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            length: 256;
        }>;
        repo: import("drizzle-orm/pg-core").PgColumn<{
            name: "repo";
            tableName: "repo_workspaces";
            dataType: "string";
            columnType: "PgVarchar";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            length: 256;
        }>;
        status: import("drizzle-orm/pg-core").PgColumn<{
            name: "status";
            tableName: "repo_workspaces";
            dataType: "string";
            columnType: "PgVarchar";
            data: "pending" | "error" | "active" | "disconnected";
            driverParam: string;
            notNull: true;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: ["pending", "active", "error", "disconnected"];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            length: 32;
        }>;
        headSha: import("drizzle-orm/pg-core").PgColumn<{
            name: "head_sha";
            tableName: "repo_workspaces";
            dataType: "string";
            columnType: "PgVarchar";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            length: 64;
        }>;
        mirrorPath: import("drizzle-orm/pg-core").PgColumn<{
            name: "mirror_path";
            tableName: "repo_workspaces";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        diskBytes: import("drizzle-orm/pg-core").PgColumn<{
            name: "disk_bytes";
            tableName: "repo_workspaces";
            dataType: "number";
            columnType: "PgBigInt53";
            data: number;
            driverParam: string | number;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        lastSyncedAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "last_synced_at";
            tableName: "repo_workspaces";
            dataType: "date";
            columnType: "PgTimestamp";
            data: Date;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        lastErrorMessage: import("drizzle-orm/pg-core").PgColumn<{
            name: "last_error_message";
            tableName: "repo_workspaces";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        createdAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "created_at";
            tableName: "repo_workspaces";
            dataType: "date";
            columnType: "PgTimestamp";
            data: Date;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        updatedAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "updated_at";
            tableName: "repo_workspaces";
            dataType: "date";
            columnType: "PgTimestamp";
            data: Date;
            driverParam: string;
            notNull: false;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
    };
    dialect: "pg";
}>;
export declare const repoSyncRequests: import("drizzle-orm/pg-core").PgTableWithColumns<{
    name: "repo_sync_requests";
    schema: undefined;
    columns: {
        id: import("drizzle-orm/pg-core").PgColumn<{
            name: "id";
            tableName: "repo_sync_requests";
            dataType: "string";
            columnType: "PgVarchar";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: true;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            length: 256;
        }>;
        workspaceId: import("drizzle-orm/pg-core").PgColumn<{
            name: "workspace_id";
            tableName: "repo_sync_requests";
            dataType: "string";
            columnType: "PgVarchar";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            length: 256;
        }>;
        status: import("drizzle-orm/pg-core").PgColumn<{
            name: "status";
            tableName: "repo_sync_requests";
            dataType: "string";
            columnType: "PgVarchar";
            data: "failed" | "completed" | "pending" | "running";
            driverParam: string;
            notNull: true;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: ["pending", "running", "completed", "failed"];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            length: 32;
        }>;
        reason: import("drizzle-orm/pg-core").PgColumn<{
            name: "reason";
            tableName: "repo_sync_requests";
            dataType: "string";
            columnType: "PgVarchar";
            data: "webhook" | "manual" | "connect" | "poll";
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: ["connect", "webhook", "poll", "manual"];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            length: 32;
        }>;
        claimId: import("drizzle-orm/pg-core").PgColumn<{
            name: "claim_id";
            tableName: "repo_sync_requests";
            dataType: "string";
            columnType: "PgVarchar";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            length: 256;
        }>;
        errorMessage: import("drizzle-orm/pg-core").PgColumn<{
            name: "error_message";
            tableName: "repo_sync_requests";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        requestedAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "requested_at";
            tableName: "repo_sync_requests";
            dataType: "date";
            columnType: "PgTimestamp";
            data: Date;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        startedAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "started_at";
            tableName: "repo_sync_requests";
            dataType: "date";
            columnType: "PgTimestamp";
            data: Date;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        completedAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "completed_at";
            tableName: "repo_sync_requests";
            dataType: "date";
            columnType: "PgTimestamp";
            data: Date;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
    };
    dialect: "pg";
}>;
export declare const repoContextBundles: import("drizzle-orm/pg-core").PgTableWithColumns<{
    name: "repo_context_bundles";
    schema: undefined;
    columns: {
        id: import("drizzle-orm/pg-core").PgColumn<{
            name: "id";
            tableName: "repo_context_bundles";
            dataType: "string";
            columnType: "PgVarchar";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: true;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            length: 256;
        }>;
        workspaceId: import("drizzle-orm/pg-core").PgColumn<{
            name: "workspace_id";
            tableName: "repo_context_bundles";
            dataType: "string";
            columnType: "PgVarchar";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            length: 256;
        }>;
        sha: import("drizzle-orm/pg-core").PgColumn<{
            name: "sha";
            tableName: "repo_context_bundles";
            dataType: "string";
            columnType: "PgVarchar";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            length: 64;
        }>;
        bundle: import("drizzle-orm/pg-core").PgColumn<{
            name: "bundle";
            tableName: "repo_context_bundles";
            dataType: "json";
            columnType: "PgJsonb";
            data: ContextBundle;
            driverParam: unknown;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            $type: ContextBundle;
        }>;
        computeMs: import("drizzle-orm/pg-core").PgColumn<{
            name: "compute_ms";
            tableName: "repo_context_bundles";
            dataType: "number";
            columnType: "PgInteger";
            data: number;
            driverParam: string | number;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        createdAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "created_at";
            tableName: "repo_context_bundles";
            dataType: "date";
            columnType: "PgTimestamp";
            data: Date;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
    };
    dialect: "pg";
}>;
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
export declare const repoExplainerJobs: import("drizzle-orm/pg-core").PgTableWithColumns<{
    name: "repo_explainer_jobs";
    schema: undefined;
    columns: {
        id: import("drizzle-orm/pg-core").PgColumn<{
            name: "id";
            tableName: "repo_explainer_jobs";
            dataType: "string";
            columnType: "PgVarchar";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: true;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            length: 256;
        }>;
        companyId: import("drizzle-orm/pg-core").PgColumn<{
            name: "company_id";
            tableName: "repo_explainer_jobs";
            dataType: "bigint";
            columnType: "PgBigInt64";
            data: bigint;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        workspaceId: import("drizzle-orm/pg-core").PgColumn<{
            name: "workspace_id";
            tableName: "repo_explainer_jobs";
            dataType: "string";
            columnType: "PgVarchar";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            length: 256;
        }>;
        userId: import("drizzle-orm/pg-core").PgColumn<{
            name: "user_id";
            tableName: "repo_explainer_jobs";
            dataType: "string";
            columnType: "PgVarchar";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            length: 256;
        }>;
        status: import("drizzle-orm/pg-core").PgColumn<{
            name: "status";
            tableName: "repo_explainer_jobs";
            dataType: "string";
            columnType: "PgVarchar";
            data: "queued" | "failed" | "completed" | "running";
            driverParam: string;
            notNull: true;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: ["queued", "running", "completed", "failed"];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            length: 32;
        }>;
        diagramType: import("drizzle-orm/pg-core").PgColumn<{
            name: "diagram_type";
            tableName: "repo_explainer_jobs";
            dataType: "string";
            columnType: "PgVarchar";
            data: "architecture" | "sequence" | "class" | "er" | "component";
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: ["architecture", "sequence", "class", "er", "component"];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            length: 32;
        }>;
        instructions: import("drizzle-orm/pg-core").PgColumn<{
            name: "instructions";
            tableName: "repo_explainer_jobs";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        sha: import("drizzle-orm/pg-core").PgColumn<{
            name: "sha";
            tableName: "repo_explainer_jobs";
            dataType: "string";
            columnType: "PgVarchar";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            length: 64;
        }>;
        claimId: import("drizzle-orm/pg-core").PgColumn<{
            name: "claim_id";
            tableName: "repo_explainer_jobs";
            dataType: "string";
            columnType: "PgVarchar";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            length: 256;
        }>;
        result: import("drizzle-orm/pg-core").PgColumn<{
            name: "result";
            tableName: "repo_explainer_jobs";
            dataType: "json";
            columnType: "PgJsonb";
            data: RepoExplanationJobResult;
            driverParam: unknown;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            $type: RepoExplanationJobResult;
        }>;
        errorMessage: import("drizzle-orm/pg-core").PgColumn<{
            name: "error_message";
            tableName: "repo_explainer_jobs";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        publishedDocumentId: import("drizzle-orm/pg-core").PgColumn<{
            name: "published_document_id";
            tableName: "repo_explainer_jobs";
            dataType: "bigint";
            columnType: "PgBigInt64";
            data: bigint;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        staleAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "stale_at";
            tableName: "repo_explainer_jobs";
            dataType: "date";
            columnType: "PgTimestamp";
            data: Date;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        createdAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "created_at";
            tableName: "repo_explainer_jobs";
            dataType: "date";
            columnType: "PgTimestamp";
            data: Date;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        startedAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "started_at";
            tableName: "repo_explainer_jobs";
            dataType: "date";
            columnType: "PgTimestamp";
            data: Date;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        completedAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "completed_at";
            tableName: "repo_explainer_jobs";
            dataType: "date";
            columnType: "PgTimestamp";
            data: Date;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        updatedAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "updated_at";
            tableName: "repo_explainer_jobs";
            dataType: "date";
            columnType: "PgTimestamp";
            data: Date;
            driverParam: string;
            notNull: false;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
    };
    dialect: "pg";
}>;
export type RepoWorkspaceRow = InferSelectModel<typeof repoWorkspaces>;
export type RepoSyncRequestRow = InferSelectModel<typeof repoSyncRequests>;
export type RepoContextBundleRow = InferSelectModel<typeof repoContextBundles>;
export type RepoExplainerJobRow = InferSelectModel<typeof repoExplainerJobs>;
//# sourceMappingURL=schema.d.ts.map