import type {
    CompanyArchitectureRefV0,
    ContextReportWindowV0,
    ContextScopeV0,
    ContextSourceEntryV0,
    ContextSourceRefV0,
    RequiredContextCoverageV0,
} from "../proposals/context-v0";
import type { ServerContextPortV0 } from "../context-v0/ports";

export interface PersonalStarV0 {
    documentId: string;
    lastKnownRef: ContextSourceRefV0;
    starredAt: string;
    updatedAt: string;
}
/** Versioned personal state shared by the PostgreSQL adapter and isolated fixtures. */
export interface PersonalContextStateV0 {
    version: "joseph-personal-context-v0";
    companyId: string;
    principalRef: string;
    module: "vantage";
    revision: number;
    roles: { roleIds: string[]; primaryRoleId?: string; confirmedAt: string } | null;
    stars: PersonalStarV0[];
}
export interface PersonalContextStoreV0 {
    read(actor: ContextScopeV0): Promise<PersonalContextStateV0>;
    /** Atomic full scoped compare-and-swap; false means no write, caller must reload. */
    compareAndSwap(
        actor: ContextScopeV0,
        expectedRevision: number,
        next: PersonalContextStateV0
    ): Promise<boolean>;
}
export type SourceReadV0 =
    | { status: "allowed"; entry: ContextSourceEntryV0; constraints: string[] }
    | { status: "missing" | "revoked" | "unavailable" };
export interface RequiredSourceInventoryV0 {
    companyArchitecture: CompanyArchitectureRefV0 | null;
    workspaceMandatoryDocuments: ContextSourceRefV0[];
}
/** All methods are trusted server adapters, never supplied by request JSON or a model. */
export interface PersonalContextDependenciesV0 {
    resolveAuthenticatedActor: ServerContextPortV0["resolveAuthenticatedActor"];
    store: PersonalContextStoreV0;
    readProfileTitle(actor: ContextScopeV0): Promise<string | null>;
    requiredSources(
        actor: ContextScopeV0,
        window: ContextReportWindowV0,
        signal?: AbortSignal
    ): Promise<RequiredSourceInventoryV0>;
    readSource(
        actor: ContextScopeV0,
        ref: ContextSourceRefV0,
        window: ContextReportWindowV0,
        signal?: AbortSignal
    ): Promise<SourceReadV0>;
    /** Current authorized canonical document version at asOf, not a cached star excerpt. */
    readDocument(
        actor: ContextScopeV0,
        documentId: string,
        window: ContextReportWindowV0,
        signal?: AbortSignal
    ): Promise<SourceReadV0>;
    now(): string;
}
export interface SourceCoverageDiagnosticV0 {
    lane: "company" | "mandatory" | "star";
    source?: ContextSourceRefV0;
    companyId: string;
    principalRef: string;
    module: "vantage";
    status: "used" | "missing" | "revoked" | "unavailable" | "omitted";
    checkedAt: string;
    sourceDate?: string;
    excerptOffsets?: ContextSourceEntryV0["excerptOffsets"];
    reason?: string;
}
export interface RequiredContextDiagnosticsV0 {
    coverage: RequiredContextCoverageV0;
    sources: SourceCoverageDiagnosticV0[];
}
export function emptyPersonalContextV0(actor: ContextScopeV0): PersonalContextStateV0 {
    return {
        version: "joseph-personal-context-v0",
        companyId: actor.companyId,
        principalRef: actor.principalRef,
        module: "vantage",
        revision: 0,
        roles: null,
        stars: [],
    };
}
