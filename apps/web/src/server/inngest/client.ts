import { EventSchemas, Inngest } from "inngest";
import { chatConfigMiddleware } from "./chat-config-middleware";
import type { TrendSearchEventData } from "@launchstack/pipelines/trend-search";
import type { ProspectorEventData } from "@launchstack/pipelines/client-prospector";
import type { DistributionRunEventData } from "@launchstack/pipelines/distribution/types";
import type { DocumentEdit, ReviewAction } from "@launchstack/editing";

// Retired event types (ADR-003): document/process.requested,
// company-metadata/extract.requested and notes-anchors/rehydrate.requested
// became transactional-outbox events consumed by apps/worker
// (source.version.created → … → company.state.projected). The remaining
// events here are the non-ingestion verticals; web sends them, the worker's
// Inngest endpoint executes them.

export type TrendSearchEvent = {
    name: "trend-search/run.requested";
    data: TrendSearchEventData;
};

export type ClientProspectorEvent = {
    name: "client-prospector/run.requested";
    data: ProspectorEventData;
};

export type PredictiveAnalysisEvent = {
    name: "predictive-analysis/run.requested";
    data: {
        documentId: number;
        analysisType: string;
        includeRelatedDocs: boolean;
        timeoutMs?: number;
        jobId: string;
    };
};

export type ReindexCompanyEmbeddingsEvent = {
    name: "company/reindex-embeddings.requested";
    data: {
        companyId: number;
        pendingIndexKey: string;
        triggeredByUserId?: string;
    };
};

export type DocumentModifyEvent = {
    name: "document/modify.requested";
    data: {
        documentId: number;
        documentUrl: string;
        authorName: string;
        edits?: DocumentEdit[];
        actions?: ReviewAction[];
    };
};

export type WebsiteCrawlEvent = {
    name: "website/crawl.requested";
    data: {
        /** Starting URL to crawl */
        url: string;
        userId: string;
        companyId: string;
        category?: string;
        /** Max link-following depth (1-3) */
        maxDepth: number;
        /** Max total pages to crawl */
        maxPages: number;
        /** Unique crawl group identifier */
        crawlGroupId: string;
        /** Base request URL for storage resolution */
        requestUrl: string;
    };
};

export type RepoWorkspaceSyncEvent = {
    name: "repo-workspace/sync.requested";
    data: import("@launchstack/pipelines/repo-workspace").RepoWorkspaceSyncEventData;
};

export type RepoExplainerJobEvent = {
    name: "repo-explainer/job.requested";
    data: import("@launchstack/pipelines/repo-workspace").RepoExplainerJobEventData;
};

/** Drains the founder-weekly-review outbox. Carries no run-specific payload. */
export type FounderWeeklyReviewDispatchEvent = {
    name: "founder-weekly-review/dispatch.requested";
    data: { dispatchId?: string };
};

export type FounderWeeklyReviewGenerationEvent = {
    name: "founder-weekly-review/generation.requested";
    data: {
        runId: string;
        /** Serialized bigint — event payloads must be JSON. */
        companyId: string;
        generationJobId: string;
        generationClaimId: string;
    };
};

export type DistributionRunEvent = {
    name: "distribution/run.requested";
    data: DistributionRunEventData;
};

export type GoogleDriveSyncEvent = {
    name: "google-drive/sync.requested";
    data: {
        /** Serialized bigint — event payloads must be JSON. */
        connectionId: string;
        companyId: string;
        force?: boolean;
    };
};

export type Events =
    | TrendSearchEvent
    | ClientProspectorEvent
    | PredictiveAnalysisEvent
    | ReindexCompanyEmbeddingsEvent
    | DocumentModifyEvent
    | WebsiteCrawlEvent
    | FounderWeeklyReviewDispatchEvent
    | FounderWeeklyReviewGenerationEvent
    | RepoWorkspaceSyncEvent
    | RepoExplainerJobEvent
    | GoogleDriveSyncEvent
    | DistributionRunEvent;

/**
 * Create the Inngest client.
 * INNGEST_EVENT_KEY is required in all environments (validated in env.ts).
 */
function createInngestClient() {
    const eventKey = process.env.INNGEST_EVENT_KEY;

    return new Inngest({
        id: "pdr-ai",
        name: "Launchstack",
        schemas: new EventSchemas().fromUnion<Events>(),
        // Background functions call feature pipelines, which resolve chat models
        // through core directly rather than through `~/lib/models`. Nothing else
        // in a cold Inngest invocation installs that configuration.
        middleware: [chatConfigMiddleware],
        ...(eventKey && { eventKey }),
    });
}

// Inngest client — always available (key is required)
export const inngest = createInngestClient();
