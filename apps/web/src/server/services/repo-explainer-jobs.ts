/**
 * Serialization shared by the repo-explainer job routes (route files may
 * only export handlers, so this lives here).
 */

import type { RepoExplainerJobRow } from "@launchstack/pipelines/repo-workspace/schema";

export function serializeExplainerJob(row: RepoExplainerJobRow) {
    return {
        id: row.id,
        workspaceId: row.workspaceId,
        status: row.status,
        diagramType: row.diagramType,
        instructions: row.instructions,
        sha: row.sha,
        result: row.result,
        errorMessage: row.errorMessage,
        publishedDocumentId: row.publishedDocumentId?.toString() ?? null,
        staleAt: row.staleAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        startedAt: row.startedAt?.toISOString() ?? null,
        completedAt: row.completedAt?.toISOString() ?? null,
    };
}
