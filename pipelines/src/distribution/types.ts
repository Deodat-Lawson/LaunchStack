/**
 * Distribution pipeline — shared types (zod + inferred).
 *
 * The vocabulary of the design doc (§4.3): a *program* is the partner
 * profile to recruit against; a *run* is one discovery job; an *org* is a
 * resolved organisation; *evidence* is a fact with a source; a
 * *relationship* is the tenant's pipeline row for an org in a program.
 */
import { z } from "zod";

// ─── Vocabulary ──────────────────────────────────────────────────────────────

export const PARTNER_KINDS = [
    "importer",
    "distributor",
    "wholesaler",
    "retailer",
    "agent",
    "reseller",
    "supplier",
] as const;
export const PartnerKindSchema = z.enum(PARTNER_KINDS);
export type PartnerKind = z.infer<typeof PartnerKindSchema>;

export const RELATIONSHIP_STAGES = [
    "candidate",
    "researched",
    "contacted",
    "in_conversation",
    "qualified",
    "negotiating",
    "contracted",
    "active",
    "declined",
    "dormant",
] as const;
export const RelationshipStageSchema = z.enum(RELATIONSHIP_STAGES);
export type RelationshipStage = z.infer<typeof RelationshipStageSchema>;

export const TERMINAL_STAGES: ReadonlySet<RelationshipStage> = new Set(["declined", "dormant"]);

export const RELATIONSHIP_EVENT_TYPES = [
    "stage_changed",
    "outreach_sent",
    "reply_logged",
    "meeting",
    "note",
    "document_shared",
    "agreement_signed",
    "imported",
    "researched",
    "owner_changed",
    "next_action_set",
] as const;
export const RelationshipEventTypeSchema = z.enum(RELATIONSHIP_EVENT_TYPES);
export type RelationshipEventType = z.infer<typeof RelationshipEventTypeSchema>;

export const EVIDENCE_KINDS = [
    "brands_carried",
    "ships_from",
    "retail_coverage",
    "certification",
    "contact",
    "firmographic",
    "news",
    "place",
    "territory",
    "role",
] as const;
export const EvidenceKindSchema = z.enum(EVIDENCE_KINDS);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

export const RUN_STATUSES = [
    "queued",
    "profiling",
    "planning",
    "gathering",
    "resolving",
    "enriching",
    "screening",
    "scoring",
    "reporting",
    "completed",
    "failed",
] as const;
export const RunStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const TerritorySchema = z.object({
    /** ISO-3166 alpha-2. */
    country: z
        .string()
        .length(2)
        .transform(s => s.toUpperCase()),
    /** Optional sub-national scope (state, region, or a city for place search). */
    region: z.string().min(1).max(128).optional(),
    /** Optional radius in metres when `region` names a city (place search). */
    radiusMeters: z.number().int().min(100).max(50_000).optional(),
});
export type Territory = z.infer<typeof TerritorySchema>;

// ─── Program ─────────────────────────────────────────────────────────────────

export const ProgramInputSchema = z.object({
    name: z.string().min(1).max(256),
    /** What is being distributed, in the tenant's words. */
    offering: z.string().min(1).max(4000),
    categories: z.array(z.string().min(1).max(128)).max(20).default([]),
    hsCodes: z
        .array(z.string().regex(/^\d{2,10}$/))
        .max(20)
        .default([]),
    targetTerritories: z.array(TerritorySchema).min(1).max(20),
    partnerKinds: z.array(PartnerKindSchema).min(1),
    /** Minimums, exclusivity policy, certifications required, price band… */
    constraints: z.string().max(4000).optional().nullable(),
    /** Domains of partners the tenant already works with — excluded from discovery. */
    knownPartnerDomains: z.array(z.string().min(3).max(256)).max(500).default([]),
});
export type ProgramInput = z.infer<typeof ProgramInputSchema>;

export const ProgramPatchSchema = ProgramInputSchema.partial().extend({
    status: z.enum(["active", "archived"]).optional(),
});
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

// ─── Run ─────────────────────────────────────────────────────────────────────

export const RunOptionsSchema = z.object({
    /** Candidates to enrich with the dossier agent (credits are per candidate). */
    maxCandidates: z.number().int().min(1).max(100).default(25),
    /** Restrict this run to a subset of the program's territories. */
    territories: z.array(TerritorySchema).optional(),
    /** Restrict this run to a subset of the program's partner kinds. */
    partnerKinds: z.array(PartnerKindSchema).optional(),
});
export type RunOptions = z.infer<typeof RunOptionsSchema>;

/** One planned query for the gather stage. */
export const PlannedSourceQuerySchema = z.object({
    kind: z.enum(["web", "place", "trade"]),
    territory: TerritorySchema,
    partnerKind: PartnerKindSchema,
    /** For web: a search query. For place: the place search query. For trade: a keyword. */
    query: z.string().min(1).max(300),
    /** Label the planner gives the query ("distributor-directory", "brand-locator", …). */
    label: z.string().min(1).max(64),
    rationale: z.string().max(400),
    /** For place queries: Foursquare category ids. */
    categoryIds: z.array(z.string()).optional(),
});
export type PlannedSourceQuery = z.infer<typeof PlannedSourceQuerySchema>;

export const DiscoveryPlanSchema = z.object({
    /** Brands whose channels are worth mapping ("brands like mine"). */
    adjacentBrands: z.array(z.string().min(1).max(128)).max(12),
    queries: z.array(PlannedSourceQuerySchema).min(1).max(60),
    /** The planner's one-paragraph reading of the program. */
    strategy: z.string().max(2000),
});
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
    tokens: { input: number; output: number; total: number };
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
export const DistributionRunEventDataSchema = z.object({
    runId: z.string(),
    programId: z.string(),
    companyId: z.string(),
    userId: z.string(),
    /** Base URL for storage resolution when publishing dossiers. */
    requestUrl: z.string().url(),
});
export type DistributionRunEventData = z.infer<typeof DistributionRunEventDataSchema>;

// ─── Organisations and evidence ──────────────────────────────────────────────

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

// ─── Dossier (the agent's forced-final result) ──────────────────────────────

/** Every field is a list of evidence ids; the grounding gate checks them. */
export const DossierSchema = z.object({
    summary: z
        .string()
        .min(40)
        .max(1500)
        .describe("Three to six sentences on who this organisation is and why it matters"),
    roles: z.array(PartnerKindSchema).describe("Partner roles this organisation plays"),
    brandsCarried: z
        .array(
            z.object({ brand: z.string().min(1), evidenceIds: z.array(z.number().int()).min(1) })
        )
        .describe("Brands or product lines it distributes, imports or stocks"),
    territories: z
        .array(
            z.object({
                territory: z.string().min(1),
                evidenceIds: z.array(z.number().int()).min(1),
            })
        )
        .describe("Countries or regions it serves"),
    retailCoverage: z
        .array(
            z.object({ account: z.string().min(1), evidenceIds: z.array(z.number().int()).min(1) })
        )
        .describe("Retailers or channels it sells into"),
    certifications: z
        .array(
            z.object({
                certification: z.string().min(1),
                evidenceIds: z.array(z.number().int()).min(1),
            })
        )
        .describe("Certifications and compliance credentials found"),
    decisionMakers: z
        .array(
            z.object({
                title: z.string().min(1),
                name: z.string().optional(),
                evidenceIds: z.array(z.number().int()).min(1),
            })
        )
        .describe("Titles (and names, when public) of people who would decide"),
    contactChannels: z
        .array(
            z.object({
                channel: z.string().min(1),
                value: z.string().min(1),
                evidenceIds: z.array(z.number().int()).min(1),
            })
        )
        .describe("Public contact routes: form URL, generic email, phone"),
    risks: z
        .array(z.object({ risk: z.string().min(1), evidenceIds: z.array(z.number().int()).min(1) }))
        .describe("Anything a founder should know before reaching out"),
    sizeBand: z.enum(["micro", "small", "medium", "large", "unknown"]),
    openQuestions: z.array(z.string()).max(6).describe("What could not be established"),
});
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

export const AgreementInputSchema = z.object({
    territory: z.array(TerritorySchema).optional().nullable(),
    exclusivity: z.enum(["none", "exclusive", "semi"]).default("none"),
    startsOn: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .nullable(),
    endsOn: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .nullable(),
    terms: z.record(z.unknown()).default({}),
    documentId: z.number().int().positive().optional().nullable(),
    renewalReminderAt: z.string().datetime().optional().nullable(),
});
export type AgreementInput = z.infer<typeof AgreementInputSchema>;

// ─── Public API payloads ─────────────────────────────────────────────────────

export const RelationshipPatchSchema = z
    .object({
        stage: RelationshipStageSchema.optional(),
        ownerUserId: z.string().min(1).max(256).nullable().optional(),
        nextAction: z.string().max(1000).nullable().optional(),
        nextActionAt: z.string().datetime().nullable().optional(),
        note: z.string().max(4000).optional(),
    })
    .refine(v => Object.keys(v).length > 0, { message: "Nothing to update" });
export type RelationshipPatch = z.infer<typeof RelationshipPatchSchema>;

export const RelationshipEventInputSchema = z.object({
    type: z.enum(["reply_logged", "meeting", "note", "document_shared"]),
    payload: z.record(z.unknown()).default({}),
    occurredAt: z.string().datetime().optional(),
    ref: z.string().max(256).optional(),
});
export type RelationshipEventInput = z.infer<typeof RelationshipEventInputSchema>;

export const ImportPartnerRowSchema = z.object({
    name: z.string().min(1).max(512),
    domain: z.string().max(256).optional().nullable(),
    country: z.string().max(64).optional().nullable(),
    kind: PartnerKindSchema,
    territoryCountry: z.string().length(2).optional().nullable(),
    stage: RelationshipStageSchema.default("active"),
    ownerUserId: z.string().max(256).optional().nullable(),
});
export type ImportPartnerRow = z.infer<typeof ImportPartnerRowSchema>;

export const ImportPartnersSchema = z.object({
    programId: z.string().min(1),
    rows: z.array(ImportPartnerRowSchema).min(1).max(2000),
});
