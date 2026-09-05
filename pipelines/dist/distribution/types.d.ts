/**
 * Distribution pipeline — shared types (zod + inferred).
 *
 * The vocabulary of the design doc (§4.3): a *program* is the partner
 * profile to recruit against; a *run* is one discovery job; an *org* is a
 * resolved organisation; *evidence* is a fact with a source; a
 * *relationship* is the tenant's pipeline row for an org in a program.
 */
import { z } from "zod";
export declare const PARTNER_KINDS: readonly ["importer", "distributor", "wholesaler", "retailer", "agent", "reseller", "supplier"];
export declare const PartnerKindSchema: z.ZodEnum<["importer", "distributor", "wholesaler", "retailer", "agent", "reseller", "supplier"]>;
export type PartnerKind = z.infer<typeof PartnerKindSchema>;
export declare const RELATIONSHIP_STAGES: readonly ["candidate", "researched", "contacted", "in_conversation", "qualified", "negotiating", "contracted", "active", "declined", "dormant"];
export declare const RelationshipStageSchema: z.ZodEnum<["candidate", "researched", "contacted", "in_conversation", "qualified", "negotiating", "contracted", "active", "declined", "dormant"]>;
export type RelationshipStage = z.infer<typeof RelationshipStageSchema>;
export declare const TERMINAL_STAGES: ReadonlySet<RelationshipStage>;
export declare const RELATIONSHIP_EVENT_TYPES: readonly ["stage_changed", "outreach_sent", "reply_logged", "meeting", "note", "document_shared", "agreement_signed", "imported", "researched", "owner_changed", "next_action_set"];
export declare const RelationshipEventTypeSchema: z.ZodEnum<["stage_changed", "outreach_sent", "reply_logged", "meeting", "note", "document_shared", "agreement_signed", "imported", "researched", "owner_changed", "next_action_set"]>;
export type RelationshipEventType = z.infer<typeof RelationshipEventTypeSchema>;
export declare const EVIDENCE_KINDS: readonly ["brands_carried", "ships_from", "retail_coverage", "certification", "contact", "firmographic", "news", "place", "territory", "role"];
export declare const EvidenceKindSchema: z.ZodEnum<["brands_carried", "ships_from", "retail_coverage", "certification", "contact", "firmographic", "news", "place", "territory", "role"]>;
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;
export declare const RUN_STATUSES: readonly ["queued", "profiling", "planning", "gathering", "resolving", "enriching", "screening", "scoring", "reporting", "completed", "failed"];
export declare const RunStatusSchema: z.ZodEnum<["queued", "profiling", "planning", "gathering", "resolving", "enriching", "screening", "scoring", "reporting", "completed", "failed"]>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export declare const TerritorySchema: z.ZodObject<{
    /** ISO-3166 alpha-2. */
    country: z.ZodEffects<z.ZodString, string, string>;
    /** Optional sub-national scope (state, region, or a city for place search). */
    region: z.ZodOptional<z.ZodString>;
    /** Optional radius in metres when `region` names a city (place search). */
    radiusMeters: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    country: string;
    region?: string | undefined;
    radiusMeters?: number | undefined;
}, {
    country: string;
    region?: string | undefined;
    radiusMeters?: number | undefined;
}>;
export type Territory = z.infer<typeof TerritorySchema>;
export declare const ProgramInputSchema: z.ZodObject<{
    name: z.ZodString;
    /** What is being distributed, in the tenant's words. */
    offering: z.ZodString;
    categories: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    hsCodes: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    targetTerritories: z.ZodArray<z.ZodObject<{
        /** ISO-3166 alpha-2. */
        country: z.ZodEffects<z.ZodString, string, string>;
        /** Optional sub-national scope (state, region, or a city for place search). */
        region: z.ZodOptional<z.ZodString>;
        /** Optional radius in metres when `region` names a city (place search). */
        radiusMeters: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        country: string;
        region?: string | undefined;
        radiusMeters?: number | undefined;
    }, {
        country: string;
        region?: string | undefined;
        radiusMeters?: number | undefined;
    }>, "many">;
    partnerKinds: z.ZodArray<z.ZodEnum<["importer", "distributor", "wholesaler", "retailer", "agent", "reseller", "supplier"]>, "many">;
    /** Minimums, exclusivity policy, certifications required, price band… */
    constraints: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    /** Domains of partners the tenant already works with — excluded from discovery. */
    knownPartnerDomains: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    name: string;
    categories: string[];
    offering: string;
    hsCodes: string[];
    targetTerritories: {
        country: string;
        region?: string | undefined;
        radiusMeters?: number | undefined;
    }[];
    partnerKinds: ("importer" | "distributor" | "wholesaler" | "retailer" | "agent" | "reseller" | "supplier")[];
    knownPartnerDomains: string[];
    constraints?: string | null | undefined;
}, {
    name: string;
    offering: string;
    targetTerritories: {
        country: string;
        region?: string | undefined;
        radiusMeters?: number | undefined;
    }[];
    partnerKinds: ("importer" | "distributor" | "wholesaler" | "retailer" | "agent" | "reseller" | "supplier")[];
    categories?: string[] | undefined;
    hsCodes?: string[] | undefined;
    constraints?: string | null | undefined;
    knownPartnerDomains?: string[] | undefined;
}>;
export type ProgramInput = z.infer<typeof ProgramInputSchema>;
export declare const ProgramPatchSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    offering: z.ZodOptional<z.ZodString>;
    categories: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodString, "many">>>;
    hsCodes: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodString, "many">>>;
    targetTerritories: z.ZodOptional<z.ZodArray<z.ZodObject<{
        /** ISO-3166 alpha-2. */
        country: z.ZodEffects<z.ZodString, string, string>;
        /** Optional sub-national scope (state, region, or a city for place search). */
        region: z.ZodOptional<z.ZodString>;
        /** Optional radius in metres when `region` names a city (place search). */
        radiusMeters: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        country: string;
        region?: string | undefined;
        radiusMeters?: number | undefined;
    }, {
        country: string;
        region?: string | undefined;
        radiusMeters?: number | undefined;
    }>, "many">>;
    partnerKinds: z.ZodOptional<z.ZodArray<z.ZodEnum<["importer", "distributor", "wholesaler", "retailer", "agent", "reseller", "supplier"]>, "many">>;
    constraints: z.ZodOptional<z.ZodNullable<z.ZodOptional<z.ZodString>>>;
    knownPartnerDomains: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodString, "many">>>;
} & {
    status: z.ZodOptional<z.ZodEnum<["active", "archived"]>>;
}, "strip", z.ZodTypeAny, {
    status?: "active" | "archived" | undefined;
    name?: string | undefined;
    categories?: string[] | undefined;
    offering?: string | undefined;
    hsCodes?: string[] | undefined;
    targetTerritories?: {
        country: string;
        region?: string | undefined;
        radiusMeters?: number | undefined;
    }[] | undefined;
    partnerKinds?: ("importer" | "distributor" | "wholesaler" | "retailer" | "agent" | "reseller" | "supplier")[] | undefined;
    constraints?: string | null | undefined;
    knownPartnerDomains?: string[] | undefined;
}, {
    status?: "active" | "archived" | undefined;
    name?: string | undefined;
    categories?: string[] | undefined;
    offering?: string | undefined;
    hsCodes?: string[] | undefined;
    targetTerritories?: {
        country: string;
        region?: string | undefined;
        radiusMeters?: number | undefined;
    }[] | undefined;
    partnerKinds?: ("importer" | "distributor" | "wholesaler" | "retailer" | "agent" | "reseller" | "supplier")[] | undefined;
    constraints?: string | null | undefined;
    knownPartnerDomains?: string[] | undefined;
}>;
export type ProgramPatch = z.infer<typeof ProgramPatchSchema>;
export interface ProgramRecord {
    id: string;
    companyId: bigint;
    createdByUserId: string;
    name: string;
    offering: string;
    categories: string[];
    hsCodes: string[];
    targetTerritories: Territory[];
    partnerKinds: PartnerKind[];
    constraints: string | null;
    knownPartnerDomains: string[];
    status: "active" | "archived";
    createdAt: Date;
    updatedAt: Date | null;
}
export declare const RunOptionsSchema: z.ZodObject<{
    /** Candidates to enrich with the dossier agent (credits are per candidate). */
    maxCandidates: z.ZodDefault<z.ZodNumber>;
    /** Restrict this run to a subset of the program's territories. */
    territories: z.ZodOptional<z.ZodArray<z.ZodObject<{
        /** ISO-3166 alpha-2. */
        country: z.ZodEffects<z.ZodString, string, string>;
        /** Optional sub-national scope (state, region, or a city for place search). */
        region: z.ZodOptional<z.ZodString>;
        /** Optional radius in metres when `region` names a city (place search). */
        radiusMeters: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        country: string;
        region?: string | undefined;
        radiusMeters?: number | undefined;
    }, {
        country: string;
        region?: string | undefined;
        radiusMeters?: number | undefined;
    }>, "many">>;
    /** Restrict this run to a subset of the program's partner kinds. */
    partnerKinds: z.ZodOptional<z.ZodArray<z.ZodEnum<["importer", "distributor", "wholesaler", "retailer", "agent", "reseller", "supplier"]>, "many">>;
}, "strip", z.ZodTypeAny, {
    maxCandidates: number;
    partnerKinds?: ("importer" | "distributor" | "wholesaler" | "retailer" | "agent" | "reseller" | "supplier")[] | undefined;
    territories?: {
        country: string;
        region?: string | undefined;
        radiusMeters?: number | undefined;
    }[] | undefined;
}, {
    partnerKinds?: ("importer" | "distributor" | "wholesaler" | "retailer" | "agent" | "reseller" | "supplier")[] | undefined;
    maxCandidates?: number | undefined;
    territories?: {
        country: string;
        region?: string | undefined;
        radiusMeters?: number | undefined;
    }[] | undefined;
}>;
export type RunOptions = z.infer<typeof RunOptionsSchema>;
/** One planned query for the gather stage. */
export declare const PlannedSourceQuerySchema: z.ZodObject<{
    kind: z.ZodEnum<["web", "place", "trade"]>;
    territory: z.ZodObject<{
        /** ISO-3166 alpha-2. */
        country: z.ZodEffects<z.ZodString, string, string>;
        /** Optional sub-national scope (state, region, or a city for place search). */
        region: z.ZodOptional<z.ZodString>;
        /** Optional radius in metres when `region` names a city (place search). */
        radiusMeters: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        country: string;
        region?: string | undefined;
        radiusMeters?: number | undefined;
    }, {
        country: string;
        region?: string | undefined;
        radiusMeters?: number | undefined;
    }>;
    partnerKind: z.ZodEnum<["importer", "distributor", "wholesaler", "retailer", "agent", "reseller", "supplier"]>;
    /** For web: a search query. For place: the place search query. For trade: a keyword. */
    query: z.ZodString;
    /** Label the planner gives the query ("distributor-directory", "brand-locator", …). */
    label: z.ZodString;
    rationale: z.ZodString;
    /** For place queries: Foursquare category ids. */
    categoryIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    kind: "place" | "web" | "trade";
    rationale: string;
    label: string;
    query: string;
    territory: {
        country: string;
        region?: string | undefined;
        radiusMeters?: number | undefined;
    };
    partnerKind: "importer" | "distributor" | "wholesaler" | "retailer" | "agent" | "reseller" | "supplier";
    categoryIds?: string[] | undefined;
}, {
    kind: "place" | "web" | "trade";
    rationale: string;
    label: string;
    query: string;
    territory: {
        country: string;
        region?: string | undefined;
        radiusMeters?: number | undefined;
    };
    partnerKind: "importer" | "distributor" | "wholesaler" | "retailer" | "agent" | "reseller" | "supplier";
    categoryIds?: string[] | undefined;
}>;
export type PlannedSourceQuery = z.infer<typeof PlannedSourceQuerySchema>;
export declare const DiscoveryPlanSchema: z.ZodObject<{
    /** Brands whose channels are worth mapping ("brands like mine"). */
    adjacentBrands: z.ZodArray<z.ZodString, "many">;
    queries: z.ZodArray<z.ZodObject<{
        kind: z.ZodEnum<["web", "place", "trade"]>;
        territory: z.ZodObject<{
            /** ISO-3166 alpha-2. */
            country: z.ZodEffects<z.ZodString, string, string>;
            /** Optional sub-national scope (state, region, or a city for place search). */
            region: z.ZodOptional<z.ZodString>;
            /** Optional radius in metres when `region` names a city (place search). */
            radiusMeters: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            country: string;
            region?: string | undefined;
            radiusMeters?: number | undefined;
        }, {
            country: string;
            region?: string | undefined;
            radiusMeters?: number | undefined;
        }>;
        partnerKind: z.ZodEnum<["importer", "distributor", "wholesaler", "retailer", "agent", "reseller", "supplier"]>;
        /** For web: a search query. For place: the place search query. For trade: a keyword. */
        query: z.ZodString;
        /** Label the planner gives the query ("distributor-directory", "brand-locator", …). */
        label: z.ZodString;
        rationale: z.ZodString;
        /** For place queries: Foursquare category ids. */
        categoryIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        kind: "place" | "web" | "trade";
        rationale: string;
        label: string;
        query: string;
        territory: {
            country: string;
            region?: string | undefined;
            radiusMeters?: number | undefined;
        };
        partnerKind: "importer" | "distributor" | "wholesaler" | "retailer" | "agent" | "reseller" | "supplier";
        categoryIds?: string[] | undefined;
    }, {
        kind: "place" | "web" | "trade";
        rationale: string;
        label: string;
        query: string;
        territory: {
            country: string;
            region?: string | undefined;
            radiusMeters?: number | undefined;
        };
        partnerKind: "importer" | "distributor" | "wholesaler" | "retailer" | "agent" | "reseller" | "supplier";
        categoryIds?: string[] | undefined;
    }>, "many">;
    /** The planner's one-paragraph reading of the program. */
    strategy: z.ZodString;
}, "strip", z.ZodTypeAny, {
    adjacentBrands: string[];
    queries: {
        kind: "place" | "web" | "trade";
        rationale: string;
        label: string;
        query: string;
        territory: {
            country: string;
            region?: string | undefined;
            radiusMeters?: number | undefined;
        };
        partnerKind: "importer" | "distributor" | "wholesaler" | "retailer" | "agent" | "reseller" | "supplier";
        categoryIds?: string[] | undefined;
    }[];
    strategy: string;
}, {
    adjacentBrands: string[];
    queries: {
        kind: "place" | "web" | "trade";
        rationale: string;
        label: string;
        query: string;
        territory: {
            country: string;
            region?: string | undefined;
            radiusMeters?: number | undefined;
        };
        partnerKind: "importer" | "distributor" | "wholesaler" | "retailer" | "agent" | "reseller" | "supplier";
        categoryIds?: string[] | undefined;
    }[];
    strategy: string;
}>;
export type DiscoveryPlan = z.infer<typeof DiscoveryPlanSchema>;
export interface SourceCount {
    source: "web" | "place" | "trade";
    queries: number;
    results: number;
    status: "ok" | "degraded" | "skipped" | "failed";
    detail?: string;
}
export interface RunSummary {
    sources: SourceCount[];
    mentions: number;
    resolved: number;
    excluded: number;
    shortlisted: number;
    enriched: number;
    gateRejections: number;
    budgetExhausted: number;
    screened: number;
    flagged: number;
    published: number;
    degraded: boolean;
    warnings: string[];
    tokens: {
        input: number;
        output: number;
        total: number;
    };
    wallMs?: number;
}
export interface RunRecord {
    id: string;
    companyId: bigint;
    programId: string;
    userId: string;
    status: RunStatus;
    options: RunOptions;
    plan: DiscoveryPlan | null;
    summary: RunSummary | null;
    candidateOrgIds: string[] | null;
    creditsUsed: number;
    errorMessage: string | null;
    createdAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
}
/** Inngest payload — bigint serialised as string. */
export declare const DistributionRunEventDataSchema: z.ZodObject<{
    runId: z.ZodString;
    programId: z.ZodString;
    companyId: z.ZodString;
    userId: z.ZodString;
    /** Base URL for storage resolution when publishing dossiers. */
    requestUrl: z.ZodString;
}, "strip", z.ZodTypeAny, {
    companyId: string;
    userId: string;
    runId: string;
    programId: string;
    requestUrl: string;
}, {
    companyId: string;
    userId: string;
    runId: string;
    programId: string;
    requestUrl: string;
}>;
export type DistributionRunEventData = z.infer<typeof DistributionRunEventDataSchema>;
export interface PartnerOrgRecord {
    id: string;
    companyId: bigint;
    resolveKey: string;
    name: string;
    domain: string | null;
    country: string | null;
    region: string | null;
    city: string | null;
    lat: number | null;
    lng: number | null;
    roles: string[];
    categories: string[];
    sizeBand: string | null;
    description: string | null;
    kgEntityId: number | null;
    firstSeenRunId: string | null;
    lastEnrichedAt: Date | null;
    createdAt: Date;
    updatedAt: Date | null;
}
export interface EvidenceRecord {
    id: number;
    companyId: bigint;
    orgId: string;
    runId: string | null;
    kind: EvidenceKind;
    claim: string;
    sourceUrl: string;
    quote: string | null;
    confidence: number;
    capturedAt: Date;
    provenance: Record<string, unknown> | null;
}
/** Every field is a list of evidence ids; the grounding gate checks them. */
export declare const DossierSchema: z.ZodObject<{
    summary: z.ZodString;
    roles: z.ZodArray<z.ZodEnum<["importer", "distributor", "wholesaler", "retailer", "agent", "reseller", "supplier"]>, "many">;
    brandsCarried: z.ZodArray<z.ZodObject<{
        brand: z.ZodString;
        evidenceIds: z.ZodArray<z.ZodNumber, "many">;
    }, "strip", z.ZodTypeAny, {
        brand: string;
        evidenceIds: number[];
    }, {
        brand: string;
        evidenceIds: number[];
    }>, "many">;
    territories: z.ZodArray<z.ZodObject<{
        territory: z.ZodString;
        evidenceIds: z.ZodArray<z.ZodNumber, "many">;
    }, "strip", z.ZodTypeAny, {
        territory: string;
        evidenceIds: number[];
    }, {
        territory: string;
        evidenceIds: number[];
    }>, "many">;
    retailCoverage: z.ZodArray<z.ZodObject<{
        account: z.ZodString;
        evidenceIds: z.ZodArray<z.ZodNumber, "many">;
    }, "strip", z.ZodTypeAny, {
        evidenceIds: number[];
        account: string;
    }, {
        evidenceIds: number[];
        account: string;
    }>, "many">;
    certifications: z.ZodArray<z.ZodObject<{
        certification: z.ZodString;
        evidenceIds: z.ZodArray<z.ZodNumber, "many">;
    }, "strip", z.ZodTypeAny, {
        certification: string;
        evidenceIds: number[];
    }, {
        certification: string;
        evidenceIds: number[];
    }>, "many">;
    decisionMakers: z.ZodArray<z.ZodObject<{
        title: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        evidenceIds: z.ZodArray<z.ZodNumber, "many">;
    }, "strip", z.ZodTypeAny, {
        title: string;
        evidenceIds: number[];
        name?: string | undefined;
    }, {
        title: string;
        evidenceIds: number[];
        name?: string | undefined;
    }>, "many">;
    contactChannels: z.ZodArray<z.ZodObject<{
        channel: z.ZodString;
        value: z.ZodString;
        evidenceIds: z.ZodArray<z.ZodNumber, "many">;
    }, "strip", z.ZodTypeAny, {
        value: string;
        evidenceIds: number[];
        channel: string;
    }, {
        value: string;
        evidenceIds: number[];
        channel: string;
    }>, "many">;
    risks: z.ZodArray<z.ZodObject<{
        risk: z.ZodString;
        evidenceIds: z.ZodArray<z.ZodNumber, "many">;
    }, "strip", z.ZodTypeAny, {
        evidenceIds: number[];
        risk: string;
    }, {
        evidenceIds: number[];
        risk: string;
    }>, "many">;
    sizeBand: z.ZodEnum<["micro", "small", "medium", "large", "unknown"]>;
    openQuestions: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    summary: string;
    territories: {
        territory: string;
        evidenceIds: number[];
    }[];
    roles: ("importer" | "distributor" | "wholesaler" | "retailer" | "agent" | "reseller" | "supplier")[];
    brandsCarried: {
        brand: string;
        evidenceIds: number[];
    }[];
    retailCoverage: {
        evidenceIds: number[];
        account: string;
    }[];
    certifications: {
        certification: string;
        evidenceIds: number[];
    }[];
    decisionMakers: {
        title: string;
        evidenceIds: number[];
        name?: string | undefined;
    }[];
    contactChannels: {
        value: string;
        evidenceIds: number[];
        channel: string;
    }[];
    risks: {
        evidenceIds: number[];
        risk: string;
    }[];
    sizeBand: "unknown" | "medium" | "small" | "micro" | "large";
    openQuestions: string[];
}, {
    summary: string;
    territories: {
        territory: string;
        evidenceIds: number[];
    }[];
    roles: ("importer" | "distributor" | "wholesaler" | "retailer" | "agent" | "reseller" | "supplier")[];
    brandsCarried: {
        brand: string;
        evidenceIds: number[];
    }[];
    retailCoverage: {
        evidenceIds: number[];
        account: string;
    }[];
    certifications: {
        certification: string;
        evidenceIds: number[];
    }[];
    decisionMakers: {
        title: string;
        evidenceIds: number[];
        name?: string | undefined;
    }[];
    contactChannels: {
        value: string;
        evidenceIds: number[];
        channel: string;
    }[];
    risks: {
        evidenceIds: number[];
        risk: string;
    }[];
    sizeBand: "unknown" | "medium" | "small" | "micro" | "large";
    openQuestions: string[];
}>;
export type Dossier = z.infer<typeof DossierSchema>;
export interface ScreeningState {
    status: "not_run" | "clear" | "flagged";
    provider?: string;
    checkedAt?: string;
    flags?: Array<{
        entityId: string;
        matchedName: string;
        score: number;
        topics: string[];
        datasets: string[];
        url?: string;
    }>;
}
export interface FitBreakdown {
    categoryOverlap: number;
    territoryMatch: number;
    roleMatch: number;
    evidenceDepth: number;
    freshness: number;
    sizeFit: number;
    knownSignal: number;
    total: number;
    /** Set when a rule zeroed the score. */
    excludedBecause?: string;
}
export interface RelationshipRecord {
    id: string;
    companyId: bigint;
    programId: string;
    orgId: string;
    kind: PartnerKind;
    territory: Territory | null;
    stage: RelationshipStage;
    fitScore: number | null;
    fitRationale: string | null;
    fitBreakdown: FitBreakdown | null;
    riskFlags: string[];
    screening: ScreeningState | null;
    dossier: Dossier | null;
    ownerUserId: string | null;
    nextAction: string | null;
    nextActionAt: Date | null;
    lastActivityAt: Date | null;
    dossierDocumentId: number | null;
    source: "discovery" | "manual" | "import";
    stageChangedAt: Date;
    createdAt: Date;
    updatedAt: Date | null;
}
export interface RelationshipEventRecord {
    id: number;
    companyId: bigint;
    relationshipId: string;
    type: RelationshipEventType;
    payload: Record<string, unknown>;
    actorUserId: string | null;
    ref: string | null;
    occurredAt: Date;
}
export interface AgreementRecord {
    id: string;
    companyId: bigint;
    relationshipId: string;
    territory: Territory[] | null;
    exclusivity: "none" | "exclusive" | "semi";
    startsOn: string | null;
    endsOn: string | null;
    terms: Record<string, unknown>;
    documentId: number | null;
    renewalReminderAt: Date | null;
    createdAt: Date;
    updatedAt: Date | null;
}
export declare const AgreementInputSchema: z.ZodObject<{
    territory: z.ZodNullable<z.ZodOptional<z.ZodArray<z.ZodObject<{
        /** ISO-3166 alpha-2. */
        country: z.ZodEffects<z.ZodString, string, string>;
        /** Optional sub-national scope (state, region, or a city for place search). */
        region: z.ZodOptional<z.ZodString>;
        /** Optional radius in metres when `region` names a city (place search). */
        radiusMeters: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        country: string;
        region?: string | undefined;
        radiusMeters?: number | undefined;
    }, {
        country: string;
        region?: string | undefined;
        radiusMeters?: number | undefined;
    }>, "many">>>;
    exclusivity: z.ZodDefault<z.ZodEnum<["none", "exclusive", "semi"]>>;
    startsOn: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    endsOn: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    terms: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    documentId: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    renewalReminderAt: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    exclusivity: "none" | "exclusive" | "semi";
    terms: Record<string, unknown>;
    documentId?: number | null | undefined;
    territory?: {
        country: string;
        region?: string | undefined;
        radiusMeters?: number | undefined;
    }[] | null | undefined;
    startsOn?: string | null | undefined;
    endsOn?: string | null | undefined;
    renewalReminderAt?: string | null | undefined;
}, {
    documentId?: number | null | undefined;
    territory?: {
        country: string;
        region?: string | undefined;
        radiusMeters?: number | undefined;
    }[] | null | undefined;
    exclusivity?: "none" | "exclusive" | "semi" | undefined;
    startsOn?: string | null | undefined;
    endsOn?: string | null | undefined;
    terms?: Record<string, unknown> | undefined;
    renewalReminderAt?: string | null | undefined;
}>;
export type AgreementInput = z.infer<typeof AgreementInputSchema>;
export declare const RelationshipPatchSchema: z.ZodEffects<z.ZodObject<{
    stage: z.ZodOptional<z.ZodEnum<["candidate", "researched", "contacted", "in_conversation", "qualified", "negotiating", "contracted", "active", "declined", "dormant"]>>;
    ownerUserId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    nextAction: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    nextActionAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    note: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    note?: string | undefined;
    stage?: "active" | "candidate" | "researched" | "contacted" | "in_conversation" | "qualified" | "negotiating" | "contracted" | "declined" | "dormant" | undefined;
    ownerUserId?: string | null | undefined;
    nextAction?: string | null | undefined;
    nextActionAt?: string | null | undefined;
}, {
    note?: string | undefined;
    stage?: "active" | "candidate" | "researched" | "contacted" | "in_conversation" | "qualified" | "negotiating" | "contracted" | "declined" | "dormant" | undefined;
    ownerUserId?: string | null | undefined;
    nextAction?: string | null | undefined;
    nextActionAt?: string | null | undefined;
}>, {
    note?: string | undefined;
    stage?: "active" | "candidate" | "researched" | "contacted" | "in_conversation" | "qualified" | "negotiating" | "contracted" | "declined" | "dormant" | undefined;
    ownerUserId?: string | null | undefined;
    nextAction?: string | null | undefined;
    nextActionAt?: string | null | undefined;
}, {
    note?: string | undefined;
    stage?: "active" | "candidate" | "researched" | "contacted" | "in_conversation" | "qualified" | "negotiating" | "contracted" | "declined" | "dormant" | undefined;
    ownerUserId?: string | null | undefined;
    nextAction?: string | null | undefined;
    nextActionAt?: string | null | undefined;
}>;
export type RelationshipPatch = z.infer<typeof RelationshipPatchSchema>;
export declare const RelationshipEventInputSchema: z.ZodObject<{
    type: z.ZodEnum<["reply_logged", "meeting", "note", "document_shared"]>;
    payload: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    occurredAt: z.ZodOptional<z.ZodString>;
    ref: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "note" | "reply_logged" | "meeting" | "document_shared";
    payload: Record<string, unknown>;
    ref?: string | undefined;
    occurredAt?: string | undefined;
}, {
    type: "note" | "reply_logged" | "meeting" | "document_shared";
    ref?: string | undefined;
    payload?: Record<string, unknown> | undefined;
    occurredAt?: string | undefined;
}>;
export type RelationshipEventInput = z.infer<typeof RelationshipEventInputSchema>;
export declare const ImportPartnerRowSchema: z.ZodObject<{
    name: z.ZodString;
    domain: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    country: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    kind: z.ZodEnum<["importer", "distributor", "wholesaler", "retailer", "agent", "reseller", "supplier"]>;
    territoryCountry: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    stage: z.ZodDefault<z.ZodEnum<["candidate", "researched", "contacted", "in_conversation", "qualified", "negotiating", "contracted", "active", "declined", "dormant"]>>;
    ownerUserId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    kind: "importer" | "distributor" | "wholesaler" | "retailer" | "agent" | "reseller" | "supplier";
    name: string;
    stage: "active" | "candidate" | "researched" | "contacted" | "in_conversation" | "qualified" | "negotiating" | "contracted" | "declined" | "dormant";
    country?: string | null | undefined;
    ownerUserId?: string | null | undefined;
    domain?: string | null | undefined;
    territoryCountry?: string | null | undefined;
}, {
    kind: "importer" | "distributor" | "wholesaler" | "retailer" | "agent" | "reseller" | "supplier";
    name: string;
    country?: string | null | undefined;
    stage?: "active" | "candidate" | "researched" | "contacted" | "in_conversation" | "qualified" | "negotiating" | "contracted" | "declined" | "dormant" | undefined;
    ownerUserId?: string | null | undefined;
    domain?: string | null | undefined;
    territoryCountry?: string | null | undefined;
}>;
export type ImportPartnerRow = z.infer<typeof ImportPartnerRowSchema>;
export declare const ImportPartnersSchema: z.ZodObject<{
    programId: z.ZodString;
    rows: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        domain: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        country: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        kind: z.ZodEnum<["importer", "distributor", "wholesaler", "retailer", "agent", "reseller", "supplier"]>;
        territoryCountry: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        stage: z.ZodDefault<z.ZodEnum<["candidate", "researched", "contacted", "in_conversation", "qualified", "negotiating", "contracted", "active", "declined", "dormant"]>>;
        ownerUserId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        kind: "importer" | "distributor" | "wholesaler" | "retailer" | "agent" | "reseller" | "supplier";
        name: string;
        stage: "active" | "candidate" | "researched" | "contacted" | "in_conversation" | "qualified" | "negotiating" | "contracted" | "declined" | "dormant";
        country?: string | null | undefined;
        ownerUserId?: string | null | undefined;
        domain?: string | null | undefined;
        territoryCountry?: string | null | undefined;
    }, {
        kind: "importer" | "distributor" | "wholesaler" | "retailer" | "agent" | "reseller" | "supplier";
        name: string;
        country?: string | null | undefined;
        stage?: "active" | "candidate" | "researched" | "contacted" | "in_conversation" | "qualified" | "negotiating" | "contracted" | "declined" | "dormant" | undefined;
        ownerUserId?: string | null | undefined;
        domain?: string | null | undefined;
        territoryCountry?: string | null | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    programId: string;
    rows: {
        kind: "importer" | "distributor" | "wholesaler" | "retailer" | "agent" | "reseller" | "supplier";
        name: string;
        stage: "active" | "candidate" | "researched" | "contacted" | "in_conversation" | "qualified" | "negotiating" | "contracted" | "declined" | "dormant";
        country?: string | null | undefined;
        ownerUserId?: string | null | undefined;
        domain?: string | null | undefined;
        territoryCountry?: string | null | undefined;
    }[];
}, {
    programId: string;
    rows: {
        kind: "importer" | "distributor" | "wholesaler" | "retailer" | "agent" | "reseller" | "supplier";
        name: string;
        country?: string | null | undefined;
        stage?: "active" | "candidate" | "researched" | "contacted" | "in_conversation" | "qualified" | "negotiating" | "contracted" | "declined" | "dormant" | undefined;
        ownerUserId?: string | null | undefined;
        domain?: string | null | undefined;
        territoryCountry?: string | null | undefined;
    }[];
}>;
//# sourceMappingURL=types.d.ts.map