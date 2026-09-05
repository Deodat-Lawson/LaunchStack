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
];
export const PartnerKindSchema = z.enum(PARTNER_KINDS);
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
];
export const RelationshipStageSchema = z.enum(RELATIONSHIP_STAGES);
export const TERMINAL_STAGES = new Set(["declined", "dormant"]);
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
];
export const RelationshipEventTypeSchema = z.enum(RELATIONSHIP_EVENT_TYPES);
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
];
export const EvidenceKindSchema = z.enum(EVIDENCE_KINDS);
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
];
export const RunStatusSchema = z.enum(RUN_STATUSES);
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
export const ProgramPatchSchema = ProgramInputSchema.partial().extend({
    status: z.enum(["active", "archived"]).optional(),
});
// ─── Run ─────────────────────────────────────────────────────────────────────
export const RunOptionsSchema = z.object({
    /** Candidates to enrich with the dossier agent (credits are per candidate). */
    maxCandidates: z.number().int().min(1).max(100).default(25),
    /** Restrict this run to a subset of the program's territories. */
    territories: z.array(TerritorySchema).optional(),
    /** Restrict this run to a subset of the program's partner kinds. */
    partnerKinds: z.array(PartnerKindSchema).optional(),
});
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
export const DiscoveryPlanSchema = z.object({
    /** Brands whose channels are worth mapping ("brands like mine"). */
    adjacentBrands: z.array(z.string().min(1).max(128)).max(12),
    queries: z.array(PlannedSourceQuerySchema).min(1).max(60),
    /** The planner's one-paragraph reading of the program. */
    strategy: z.string().max(2000),
});
/** Inngest payload — bigint serialised as string. */
export const DistributionRunEventDataSchema = z.object({
    runId: z.string(),
    programId: z.string(),
    companyId: z.string(),
    userId: z.string(),
    /** Base URL for storage resolution when publishing dossiers. */
    requestUrl: z.string().url(),
});
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
        .array(z.object({ brand: z.string().min(1), evidenceIds: z.array(z.number().int()).min(1) }))
        .describe("Brands or product lines it distributes, imports or stocks"),
    territories: z
        .array(z.object({
        territory: z.string().min(1),
        evidenceIds: z.array(z.number().int()).min(1),
    }))
        .describe("Countries or regions it serves"),
    retailCoverage: z
        .array(z.object({ account: z.string().min(1), evidenceIds: z.array(z.number().int()).min(1) }))
        .describe("Retailers or channels it sells into"),
    certifications: z
        .array(z.object({
        certification: z.string().min(1),
        evidenceIds: z.array(z.number().int()).min(1),
    }))
        .describe("Certifications and compliance credentials found"),
    decisionMakers: z
        .array(z.object({
        title: z.string().min(1),
        name: z.string().optional(),
        evidenceIds: z.array(z.number().int()).min(1),
    }))
        .describe("Titles (and names, when public) of people who would decide"),
    contactChannels: z
        .array(z.object({
        channel: z.string().min(1),
        value: z.string().min(1),
        evidenceIds: z.array(z.number().int()).min(1),
    }))
        .describe("Public contact routes: form URL, generic email, phone"),
    risks: z
        .array(z.object({ risk: z.string().min(1), evidenceIds: z.array(z.number().int()).min(1) }))
        .describe("Anything a founder should know before reaching out"),
    sizeBand: z.enum(["micro", "small", "medium", "large", "unknown"]),
    openQuestions: z.array(z.string()).max(6).describe("What could not be established"),
});
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
export const RelationshipEventInputSchema = z.object({
    type: z.enum(["reply_logged", "meeting", "note", "document_shared"]),
    payload: z.record(z.unknown()).default({}),
    occurredAt: z.string().datetime().optional(),
    ref: z.string().max(256).optional(),
});
export const ImportPartnerRowSchema = z.object({
    name: z.string().min(1).max(512),
    domain: z.string().max(256).optional().nullable(),
    country: z.string().max(64).optional().nullable(),
    kind: PartnerKindSchema,
    territoryCountry: z.string().length(2).optional().nullable(),
    stage: RelationshipStageSchema.default("active"),
    ownerUserId: z.string().max(256).optional().nullable(),
});
export const ImportPartnersSchema = z.object({
    programId: z.string().min(1),
    rows: z.array(ImportPartnerRowSchema).min(1).max(2000),
});
//# sourceMappingURL=types.js.map