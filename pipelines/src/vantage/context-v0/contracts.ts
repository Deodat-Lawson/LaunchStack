/**
 * TL-owned V0 assembly contracts.
 *
 * These contracts deliberately sit beside (rather than inside) the proposal
 * validators.  A source registry is the permission boundary: values supplied
 * by retrievers are selections, while the registry is built from the
 * server-resolved catalog and is the only source of canonical content.
 */

import type {
    BusinessRoleContextV0,
    ContextBudgetsV0,
    ContextFailureV0,
    ContextManifestV0,
    ContextOmissionV0,
    ContextReportWindowV0,
    ContextResearchPlanV0,
    ContextResearchResultV0,
    ContextScopeV0,
    ContextSourceEntryV0,
    ContextSourceRefV0,
    DynamicRetrievalBundleV0,
    DynamicRetrievalInputV0,
    RequiredContextBundleV0,
} from "../proposals/context-v0";

export const CONTEXT_V0_ASSEMBLY_VERSION = "v0-assembly-1" as const;

export interface ContextCitationMetadataV0 {
    title: string;
    url: string;
    sourceDate: string;
    accessedAt: string;
    provenance: string;
}

export interface ContextSourceProvenanceV0 {
    connector: string;
    locator?: string;
    retrievedAt?: string;
    reason?: string;
}

/** Server-resolved source record used to construct a registry. */
export interface TrustedContextSourceV0 extends ContextSourceEntryV0 {
    /** Canonical content. If omitted, the bounded excerpt is canonical content. */
    content?: string;
    contentHash?: string;
    provenance?: ContextSourceProvenanceV0;
    citation?: ContextCitationMetadataV0;
}

export interface RegisteredContextSourceV0 extends ContextSourceEntryV0 {
    /** Hash of the exact server-resolved content for this source version. */
    contentHash: string;
    provenance?: Readonly<ContextSourceProvenanceV0>;
    citation?: Readonly<ContextCitationMetadataV0>;
}

export interface SourceRegistryScopeV0 {
    actor: ContextScopeV0;
    reportWindow: ContextReportWindowV0;
}

export interface SourceRegistrySelectionV0 {
    ok: true;
    source: RegisteredContextSourceV0;
}

export interface SourceRegistrySelectionFailureV0 {
    ok: false;
    issues: readonly SourceRegistryIssueV0[];
}

export type SourceRegistrySelectionResultV0 =
    | SourceRegistrySelectionV0
    | SourceRegistrySelectionFailureV0;

export interface SourceRegistryIssueV0 {
    path: string;
    code:
        | "invalid_catalog"
        | "duplicate_source_ref"
        | "conflicting_source_metadata"
        | "source_not_found"
        | "source_version_conflict"
        | "source_revoked"
        | "cross_company"
        | "cross_actor"
        | "public_relabel"
        | "future_source"
        | "invalid_excerpt"
        | "invalid_content_hash"
        | "selection_metadata_mismatch";
    message: string;
    status: 400 | 403 | 404 | 409;
}

/**
 * Immutable, server-scoped source registry. Implementations must resolve
 * selections against these records and never treat a payload aclDigest as an
 * authorization decision.
 */
export interface SourceRegistryV0 {
    readonly scope: Readonly<SourceRegistryScopeV0>;
    readonly entries: readonly RegisteredContextSourceV0[];
    get(ref: ContextSourceRefV0): RegisteredContextSourceV0 | undefined;
    resolve(selection: ContextSourceRefV0 | ContextSourceEntryV0): SourceRegistrySelectionResultV0;
    has(ref: ContextSourceRefV0): boolean;
}

export interface SourceRegistryInputV0 extends SourceRegistryScopeV0 {
    /** Trusted, server-resolved records; this is the permission source. */
    trustedCatalog: readonly TrustedContextSourceV0[];
}

export type SourceRegistryBuildResultV0 =
    | { ok: true; registry: SourceRegistryV0; issues: readonly [] }
    | { ok: false; registry?: undefined; issues: readonly SourceRegistryIssueV0[] };

export interface EvidenceSnapshotEntryV0 {
    source: ContextSourceRefV0;
    contentHash: string;
    excerpt: string;
    provenance?: Readonly<ContextSourceProvenanceV0>;
    citation?: Readonly<ContextCitationMetadataV0>;
}

export interface EvidenceSnapshotV0 {
    contractVersion: typeof CONTEXT_V0_ASSEMBLY_VERSION;
    asOf: string;
    entries: readonly EvidenceSnapshotEntryV0[];
    totalExcerptChars: number;
    contentFingerprint: string;
    /** Binds the evidence bytes to the exact manifest consumed downstream. */
    manifestFingerprint?: string;
}

export interface ContextVersionHashV0 {
    ref: ContextSourceRefV0;
    contentHash: string;
    aclDigest: string;
    audience: ContextSourceEntryV0["audience"];
    access: ContextSourceEntryV0["access"];
}

export interface ContextFreezeV0 {
    contractVersion: typeof CONTEXT_V0_ASSEMBLY_VERSION;
    actorACL: {
        principalRef: string;
        companyId: string;
        audience: { kind: "actor"; principalRef: string };
        aclDigest: string;
    };
    roleMapVersion: string;
    roleProfileVersions: Readonly<Record<string, string>>;
    companyArchitecture: ContextVersionHashV0;
    personalStars: readonly ContextVersionHashV0[];
    sources: readonly ContextVersionHashV0[];
    contentFingerprint: string;
}

export interface ContextRetrievalStateV0 {
    status: "not-run" | DynamicRetrievalBundleV0["status"];
    selectedRefs: readonly ContextSourceRefV0[];
    omissions: readonly ContextOmissionV0[];
    failures: readonly ContextFailureV0[];
    laneProvenance: readonly {
        source: ContextSourceRefV0;
        lanes: readonly ("roleMatches" | "recentChanges" | "unresolvedOlderItems")[];
        reasons: readonly string[];
    }[];
}

export interface AssembledContextManifestV0 extends ContextManifestV0 {
    /** Sources accepted after registry resolution, in canonical order. */
    selectedRefs: readonly ContextSourceRefV0[];
    /** Retrieval state is independent from required-context and research state. */
    retrievalState: ContextRetrievalStateV0;
}

export interface AssembledContextV0 {
    manifest: AssembledContextManifestV0;
    evidenceSnapshot: EvidenceSnapshotV0;
    freeze: ContextFreezeV0;
}

export interface AssembleContextManifestInputV0 {
    runId: string;
    actor: ContextScopeV0;
    reportWindow: ContextReportWindowV0;
    roleContext: BusinessRoleContextV0;
    roleProfileVersions: Readonly<Record<string, string>>;
    required: RequiredContextBundleV0;
    retrievalInput: DynamicRetrievalInputV0;
    retrieval?: DynamicRetrievalBundleV0;
    researchPlan?: ContextResearchPlanV0;
    researchResult?: ContextResearchResultV0;
    registry: SourceRegistryV0;
    budgets: ContextBudgetsV0;
    trustedPublicProjections?: readonly {
        approvalToken: string;
        projectionId: string;
        query: string;
    }[];
    inputVersion?: string;
}

export interface ContextAssemblyIssueV0 {
    path: string;
    code: string;
    message: string;
    status: 400 | 403 | 404 | 409 | 503;
}

export type AssembleContextManifestResultV0 =
    | { ok: true; status: "complete" | "partial"; value: AssembledContextV0; issues: readonly [] }
    | {
          ok: false;
          status: "blocked";
          issues: readonly ContextAssemblyIssueV0[];
          /** Audit-only manifest; no evidence snapshot is returned on failure. */
          manifest?: AssembledContextManifestV0;
      };

export type { ContextSourceEntryV0, ContextSourceRefV0 };
export type { ContextBudgetsV0 };
