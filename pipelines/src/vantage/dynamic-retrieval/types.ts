import type {
    ContextReportWindowV0,
    ContextScopeV0,
    ContextSourceRefV0,
    DynamicRetrievalBundleV0,
} from "../proposals/context-v0";

/** Server-owned metadata for an exact authorized source version, never user input. */
export interface RetrievalMetadataV0 {
    source: ContextSourceRefV0;
    title?: string;
    topics?: string[];
    roleIds?: string[];
    ownerPrincipalRefs?: string[];
    /** Version/event time, not a date mentioned inside a document. */
    changedAt?: string;
    /** Must describe the state at reportWindow.asOf, not today's state. */
    state?: { asOf: string; value: "open" | "resolved" };
    trust?: number;
    /** Only authoritative connector identity proves that two records are copies. */
    origin?: { connector: string; id: string; revision: string };
}

export type RetrievalLaneV0 = "role" | "recent";

export interface RetrievalSearchRequestV0 {
    lane: RetrievalLaneV0;
    actor: ContextScopeV0;
    reportWindow: ContextReportWindowV0;
    /** All roles are searched in one bounded operation, including older open work. */
    roles: { roleId: string; terms: string[] }[];
    allowedSources: ContextSourceRefV0[];
    limit: number;
    signal: AbortSignal;
}

/** Inject an ACL-aware RAG/database adapter. Hits cannot introduce new sources. */
export interface RetrievalSearchPortV0 {
    search(request: RetrievalSearchRequestV0): Promise<{
        hits: RetrievalMetadataV0[];
        truncated: boolean;
    }>;
}

export interface RetrievalDiagnosticsV0 {
    queries: number;
    candidates: number;
    selected: number;
    excerptChars: number;
    /** UTF-8 bytes are a conservative token ceiling; no model call is needed. */
    tokenUpperBound: number;
    scores: {
        source: ContextSourceRefV0;
        relevance: number;
        trust: number;
        recent: boolean;
        olderOpen: boolean;
        lanes: RetrievalLaneV0[];
    }[];
}

export interface RankedRetrievalBundleV0 extends DynamicRetrievalBundleV0 {
    diagnostics: RetrievalDiagnosticsV0;
}
