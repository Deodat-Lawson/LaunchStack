/**
 * Injectable Vantage context v0 ports.
 *
 * This module deliberately contains no persistence, retrieval, ranking or
 * network implementation.  Joseph and Sophia can replace these ports with
 * their modules without changing the assembler or the v1 wire contract.
 */
import type { GenerationInput, GenerationResult, GenerationRuntime } from "../contract-v1";
import type {
    BusinessRoleContextV0,
    ContextBudgetsV0,
    ContextManifestV0,
    ContextResearchPlanV0,
    ContextResearchResultV0,
    ContextReportWindowV0,
    ContextScopeV0,
    ContextSourceEntryV0,
    ContextSourceRefV0,
    DynamicRetrievalBundleV0,
    DynamicRetrievalInputV0,
    RequiredContextBundleV0,
} from "../proposals/context-v0";
import type { AssembledContextV0, ContextFreezeV0, EvidenceSnapshotV0 } from "./contracts";

export type {
    GenerationInput,
    GenerationPort,
    GenerationResult,
    GenerationRuntime,
} from "../contract-v1";
export type {
    BusinessRoleContextV0,
    ContextBudgetsV0,
    ContextFailureV0,
    ContextManifestV0,
    ContextResearchPlanV0,
    ContextResearchResultV0,
    ContextReportWindowV0,
    ContextScopeV0,
    ContextSourceEntryV0,
    ContextSourceRefV0,
    DynamicRetrievalBundleV0,
    DynamicRetrievalInputV0,
    RequiredContextBundleV0,
} from "../proposals/context-v0";
export type { AssembledContextV0, ContextFreezeV0, EvidenceSnapshotV0 } from "./contracts";

export interface ContextPortIssueV0 {
    code: string;
    message: string;
    status: 400 | 401 | 403 | 404 | 409 | 500 | 503;
    path?: string;
}

/** A typed boundary failure; callers can map status to their HTTP layer. */
export class ContextPortErrorV0 extends Error {
    readonly status: ContextPortIssueV0["status"];
    readonly issues: ContextPortIssueV0[];

    constructor(
        message: string,
        status: ContextPortIssueV0["status"],
        issues?: ContextPortIssueV0[]
    ) {
        super(message);
        this.name = "ContextPortErrorV0";
        this.status = status;
        this.issues = issues ?? [{ code: "context_boundary", message, status }];
    }
}

export interface ContextActorRequestV0 {
    principalRef: string;
    companyId: string;
    reportWindow: ContextReportWindowV0;
    budgets: ContextBudgetsV0;
    signal?: AbortSignal;
}

export interface ResolveBusinessRolesInputV0 extends ContextActorRequestV0 {
    requestedRoleIds?: readonly string[];
}

export interface ResolveRequiredContextInputV0 extends ContextActorRequestV0 {
    roleContext: BusinessRoleContextV0;
}

export interface SourceCatalogInputV0 extends ContextActorRequestV0 {
    roleContext: BusinessRoleContextV0;
}

export interface ResolveAuthenticatedActorInputV0 {
    principalRef: string;
    companyId: string;
    signal?: AbortSignal;
}

export interface CurrentStateInputV0 {
    actor: ContextScopeV0;
    sourceRefs: readonly ContextSourceRefV0[];
    transaction?: ContextTransactionV0;
    signal?: AbortSignal;
}

/** Server-owned values captured before and after generation. */
export interface ContextCurrentStateV0 {
    principalRef: string;
    companyId: string;
    actorAclDigest: string;
    sourceVersions: Record<string, string>;
    /** Content identity is separate from a document version for stores that expose both. */
    sourceFingerprints: Record<string, string>;
    sourceAudiences: Record<string, string>;
    sourceAccess: Record<string, "allowed" | "revoked" | "missing">;
    sourceEntries: ContextSourceEntryV0[];
    roleMapVersion: string;
    roleProfileVersions: Record<string, string>;
    companyArchitectureVersion: string;
    personalStarVersions: Record<string, string>;
}

export interface RoleContextPortV0 {
    resolveBusinessRoles(input: ResolveBusinessRolesInputV0): Promise<BusinessRoleContextV0>;
    resolveRequiredContext(input: ResolveRequiredContextInputV0): Promise<RequiredContextBundleV0>;
}

export interface ServerContextPortV0 {
    /** Resolves the server-owned actor scope; callers must not trust a bundle's actor fields. */
    resolveAuthenticatedActor(input: ResolveAuthenticatedActorInputV0): Promise<ContextScopeV0>;
    sourceCatalog(input: SourceCatalogInputV0): Promise<ContextSourceEntryV0[]>;
    currentState(input: CurrentStateInputV0): Promise<ContextCurrentStateV0>;
}

export interface RetrievalContextPortV0 {
    retrieve(input: DynamicRetrievalInputV0): Promise<DynamicRetrievalBundleV0>;
}

/** Receives only the validated plan projection, never arbitrary user text. */
export interface ResearchContextPortV0 {
    research(plan: ContextResearchPlanV0): Promise<ContextResearchResultV0>;
}

export interface ContextAssemblyInputV0 {
    runId: string;
    inputVersion: string;
    roleContext: BusinessRoleContextV0;
    requiredContext: RequiredContextBundleV0;
    retrieval: DynamicRetrievalBundleV0;
    retrievalInput?: DynamicRetrievalInputV0;
    research: ContextResearchResultV0;
    /** The already validated, sanitized plan that produced `research`. */
    researchPlan?: ContextResearchPlanV0;
    trustedPublicProjections?: readonly {
        projectionId: string;
        query: string;
        approvalToken: string;
    }[];
    reportWindow: ContextReportWindowV0;
    budgets: ContextBudgetsV0;
}

export interface ContextEvidenceItemV0 {
    source: ContextSourceRefV0;
    audience: ContextSourceEntryV0["audience"];
    access: "allowed";
    /** Internal bounded excerpt. Never copied into a public query projection. */
    excerpt?: string;
}

export type ContextAssemblyOutputV0 = AssembledContextV0;

export interface ContextAssemblerPortV0 {
    assemble(
        input: ContextAssemblyInputV0
    ): ContextAssemblyOutputV0 | Promise<ContextAssemblyOutputV0>;
}

export interface ContextGenerationEnvelopeV0 {
    /** This is passed byte-for-byte to the existing v1 port. */
    v1Input: GenerationInput;
    manifest: ContextManifestV0;
    evidenceSnapshot: EvidenceSnapshotV0;
    freeze: ContextFreezeV0;
}

export type ContextModeV0 = "aware-v0" | "ignored-v0";

export interface ContextGenerationResultV0 {
    v1Result: GenerationResult;
    /** Canonical versioned refs, never raw v1 ids. */
    citationRefs: ContextSourceRefV0[];
    manifestFingerprint: string;
    contextMode: ContextModeV0;
}

export type ContextGenerationPortV0 = (
    envelope: ContextGenerationEnvelopeV0,
    runtime: GenerationRuntime
) => Promise<ContextGenerationResultV0>;

/** Persistence is supplied by the owning application. */
export type ContextTransactionV0 = Record<string, unknown>;

export interface GuardedCommitInputV0 {
    envelope: ContextGenerationEnvelopeV0;
    generated: ContextGenerationResultV0;
}

export interface GuardedCommitPortV0<T> {
    run<R>(callback: (transaction: ContextTransactionV0) => Promise<R>): Promise<R>;
    persist(transaction: ContextTransactionV0, input: GuardedCommitInputV0): Promise<T>;
}

export interface ContextPipelinePortsV0 {
    roles: RoleContextPortV0;
    server: ServerContextPortV0;
    retrieval: RetrievalContextPortV0;
    assembler: ContextAssemblerPortV0;
    research?: ResearchContextPortV0;
    /** Optional plan builder. A missing builder is an explicit STOP decision. */
    planResearch?: (
        input: ContextAssemblyInputV0
    ) => ContextResearchPlanV0 | Promise<ContextResearchPlanV0>;
    trustedPublicProjections?: readonly {
        projectionId: string;
        query: string;
        approvalToken: string;
    }[];
}

export interface ContextPipelineInputV0 extends ContextActorRequestV0 {
    runId: string;
    inputVersion: string;
    roleIds?: readonly string[];
}

export interface ContextPipelineOutputV0 extends ContextAssemblyOutputV0 {
    research: ContextResearchResultV0;
    freeze: ContextFreezeV0;
}

export interface PublicProjectionBindingV0 {
    projectionId: string;
    query: string;
    purpose: string;
    approvalToken: string;
    validatedAt: string;
}

export type MaybePromise<T> = T | Promise<T>;
