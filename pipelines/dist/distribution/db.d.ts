import type { InferInsertModel } from "drizzle-orm";
import type { ResolvedOrg } from "@launchstack/tools/org-resolver";
import { partnerOrgs, partnerRelationships } from "./schema.js";
import type { AgreementInput, AgreementRecord, DiscoveryPlan, Dossier, EvidenceKind, EvidenceRecord, FitBreakdown, ImportPartnerRow, PartnerKind, PartnerOrgRecord, ProgramInput, ProgramPatch, ProgramRecord, RelationshipEventRecord, RelationshipEventType, RelationshipRecord, RelationshipStage, RunOptions, RunRecord, RunStatus, RunSummary, ScreeningState, Territory } from "./types.js";
export declare function createProgram(args: {
    companyId: bigint;
    userId: string;
    input: ProgramInput;
}): Promise<ProgramRecord>;
export declare function listPrograms(companyId: bigint): Promise<ProgramRecord[]>;
export declare function getProgram(id: string, companyId: bigint): Promise<ProgramRecord | null>;
export declare function updateProgram(id: string, companyId: bigint, patch: ProgramPatch): Promise<ProgramRecord | null>;
export declare function createRun(args: {
    id?: string;
    companyId: bigint;
    programId: string;
    userId: string;
    options: RunOptions;
}): Promise<RunRecord>;
export declare function getRun(id: string, companyId: bigint): Promise<RunRecord | null>;
export declare function listRuns(companyId: bigint, options?: {
    programId?: string;
    limit?: number;
}): Promise<RunRecord[]>;
export declare function updateRun(id: string, companyId: bigint, patch: {
    status?: RunStatus;
    plan?: DiscoveryPlan;
    summary?: RunSummary;
    candidateOrgIds?: string[];
    errorMessage?: string | null;
    startedAt?: Date;
    completedAt?: Date;
}): Promise<RunRecord | null>;
export declare function addRunCredits(id: string, companyId: bigint, amount: number): Promise<void>;
/** Insert new organisations, merge into existing ones by resolve key. Returns rows in input order. */
export declare function upsertOrgs(args: {
    companyId: bigint;
    runId: string | null;
    orgs: readonly ResolvedOrg[];
}): Promise<PartnerOrgRecord[]>;
export declare function getOrg(id: string, companyId: bigint): Promise<PartnerOrgRecord | null>;
export declare function listOrgsByIds(ids: readonly string[], companyId: bigint): Promise<PartnerOrgRecord[]>;
export declare function updateOrg(id: string, companyId: bigint, patch: Partial<Pick<InferInsertModel<typeof partnerOrgs>, "sizeBand" | "description" | "roles" | "categories" | "kgEntityId" | "lastEnrichedAt" | "lat" | "lng" | "city" | "region" | "country">>): Promise<PartnerOrgRecord | null>;
/**
 * "Do we already know them": a knowledge-graph organisation entity whose
 * normalised name matches. Entities are company-scoped, so this is
 * tenant-private by construction.
 */
export declare function findKnownOrgEntity(companyId: bigint, name: string): Promise<{
    id: number;
    displayName: string;
    mentionCount: number;
} | null>;
export declare function insertEvidence(args: {
    companyId: bigint;
    orgId: string;
    runId: string | null;
    kind: EvidenceKind;
    claim: string;
    sourceUrl: string;
    quote?: string | null;
    confidence?: number;
    provenance?: Record<string, unknown> | null;
}): Promise<EvidenceRecord>;
export declare function listEvidenceForOrg(companyId: bigint, orgId: string): Promise<EvidenceRecord[]>;
export declare function listEvidenceByIds(companyId: bigint, ids: readonly number[]): Promise<EvidenceRecord[]>;
/** Create candidate rows; existing (program, org, kind) rows are left untouched. */
export declare function upsertCandidateRelationships(args: {
    companyId: bigint;
    programId: string;
    items: ReadonlyArray<{
        orgId: string;
        kind: PartnerKind;
        territory: Territory | null;
    }>;
}): Promise<RelationshipRecord[]>;
export declare function getRelationship(id: string, companyId: bigint): Promise<RelationshipRecord | null>;
export interface PartnerListFilters {
    programId?: string;
    stage?: RelationshipStage | RelationshipStage[];
    kind?: PartnerKind;
    country?: string;
    minFit?: number;
    /** Only relationships whose last activity is older than this many days (and are in a stale-able stage). */
    staleOnly?: boolean;
    /** Only relationships with a next action due on or before this date. */
    dueBefore?: Date;
    search?: string;
    limit?: number;
    offset?: number;
    orderBy?: "fit" | "activity" | "stage" | "created";
}
export interface PartnerListItem {
    relationship: RelationshipRecord;
    org: PartnerOrgRecord;
    evidenceCount: number;
    stale: boolean;
}
export declare function isStale(relationship: Pick<RelationshipRecord, "stage" | "lastActivityAt" | "stageChangedAt">, now?: Date): boolean;
export declare function listPartners(companyId: bigint, filters?: PartnerListFilters): Promise<PartnerListItem[]>;
export declare function updateRelationship(id: string, companyId: bigint, patch: Partial<Pick<InferInsertModel<typeof partnerRelationships>, "ownerUserId" | "nextAction" | "nextActionAt" | "lastActivityAt" | "dossierDocumentId" | "riskFlags" | "screening" | "territory">>): Promise<RelationshipRecord | null>;
/** Record the enrich/score outcome for a relationship. */
export declare function setResearchResult(id: string, companyId: bigint, result: {
    dossier: Dossier | null;
    fitScore: number;
    fitRationale: string;
    fitBreakdown: FitBreakdown;
    riskFlags: string[];
    screening: ScreeningState;
    stage: RelationshipStage;
}): Promise<RelationshipRecord | null>;
/** Domains and resolve keys this program must never re-discover (design §4.4 exclusion gate). */
export declare function listExclusions(companyId: bigint, programId: string): Promise<{
    domains: string[];
    keys: string[];
}>;
export declare function addEvent(args: {
    companyId: bigint;
    relationshipId: string;
    type: RelationshipEventType;
    payload?: Record<string, unknown>;
    actorUserId?: string | null;
    ref?: string | null;
    occurredAt?: Date;
    /** Update last_activity_at (default true). */
    touch?: boolean;
}): Promise<RelationshipEventRecord>;
export declare function listEvents(companyId: bigint, relationshipId: string): Promise<RelationshipEventRecord[]>;
/**
 * Apply a stage transition through the table in stages.ts and record the
 * event. Throws StageTransitionError (status 409) on an illegal move.
 */
export declare function transitionStage(args: {
    companyId: bigint;
    relationshipId: string;
    to: RelationshipStage;
    actorUserId: string | null;
    /** Field updates applied in the same write, evaluated for the target's requirements. */
    ownerUserId?: string | null;
    nextAction?: string | null;
    nextActionAt?: Date | null;
}): Promise<RelationshipRecord>;
export declare function importPartners(args: {
    companyId: bigint;
    programId: string;
    userId: string;
    rows: readonly ImportPartnerRow[];
}): Promise<{
    created: number;
    existing: number;
    relationships: RelationshipRecord[];
}>;
export declare function createAgreement(args: {
    companyId: bigint;
    relationshipId: string;
    input: AgreementInput;
}): Promise<AgreementRecord>;
export declare function updateAgreement(id: string, companyId: bigint, input: Partial<AgreementInput>): Promise<AgreementRecord | null>;
export declare function listAgreements(companyId: bigint, relationshipId: string): Promise<AgreementRecord[]>;
export interface CoverageCell {
    country: string;
    kind: PartnerKind;
    /** contracted or active */
    covered: number;
    /** contacted … negotiating */
    inPipeline: number;
    candidates: number;
    targeted: boolean;
}
export interface DashboardData {
    programId: string;
    counts: Record<RelationshipStage, number>;
    funnel: Array<{
        stage: RelationshipStage;
        count: number;
    }>;
    inPipeline: number;
    stale: number;
    dueThisWeek: number;
    renewalsDue: number;
    coverage: CoverageCell[];
    coveredCells: number;
    targetedCells: number;
    medianDaysInStage: Partial<Record<RelationshipStage, number>>;
    attention: PartnerListItem[];
}
export declare function getDashboard(companyId: bigint, programId: string): Promise<DashboardData>;
//# sourceMappingURL=db.d.ts.map