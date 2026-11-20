/**
 * Scenarios contract v2 — the shared shapes of durable, evidence-grounded runs.
 *
 * A v2 run is accepted once (RequestSpec + run + idempotency record + the first
 * unit's credit hold + a dispatch row, in one transaction), then advanced one
 * persisted unit at a time by whichever worker holds its fenced lease:
 *
 *   sources → brief → [ontology → graph:prepare → graph:ingest:NN → graph:freeze]
 *     → cast:plan → actor-context:NN → cast:batch:NN → world:freeze
 *     → round:NN … → report
 *
 * Every unit saves its work before it is applied and commits its progress and
 * its credit settlement in one transaction. Rounds record each turn's reply so a
 * finished run replays from its frozen world with zero model calls.
 *
 * Everything here is plain JSON so it can live in jsonb columns.
 */
import type { AgentDecision, Persona, RoundSummary, Stance, Usage } from "@launchstack/simulation";

import type { EvidenceKind, ScenarioSourcesInput } from "../types";

export const CONTRACT_VERSION = 2 as const;

/** Version strings frozen into every spec. Bump one when its behaviour changes. */
export const V2_VERSIONS = {
    engine: "simulation@1",
    prompts: "scenarios-v2-prompts@1",
    modelPolicy: "scenario-models@1",
    retrievalPolicy: "actor-context@1",
    extractionPolicy: "graphiti-extract@1",
    ontologyPlanner: "ontology-planner@1",
    sourceCollector: "source-collector@1",
} as const;

// ─── Context modes ───────────────────────────────────────────────────────────

/**
 * How an actor's context is assembled. Recorded on the run; a run never mixes
 * representations, so comparisons can trust it.
 *
 * - passage: ranked evidence passages only.
 * - facts:   typed company facts first, then passages to fill the cap.
 * - graph:   facts from the frozen Graphiti graph with their supporting
 *            passages, then passages to fill the cap.
 */
export const CONTEXT_MODES = ["passage", "facts", "graph"] as const;
export type ContextMode = (typeof CONTEXT_MODES)[number];

/** Why a run that asked for graph mode runs in another mode. Shown in provenance. */
export type ContextFallbackReason =
    | "graph_not_configured"
    | "graph_unavailable"
    | "workspace_endpoint"
    | "no_documents";

// ─── Attribution ─────────────────────────────────────────────────────────────

export const BASES = ["source", "inferred", "assumed", "unknown"] as const;
/** Where a generated value comes from. `unknown` values are null. */
export type Basis = (typeof BASES)[number];

export interface Attributed<T> {
    value: T | null;
    basis: Basis;
    /** Evidence ids ("E3") that support it. Required for `source` and `inferred`. */
    evidenceIds: string[];
    /** Short reason, required for `inferred` and `assumed`. */
    explanation?: string;
}

// ─── Request spec (frozen at acceptance) ─────────────────────────────────────

export interface SourceBudget {
    /** Most tokens taken from one document. */
    perDocumentTokens: number;
    /** Most tokens across every source. */
    totalTokens: number;
    /** Most captured sections. */
    maxSections: number;
}

export const DEFAULT_SOURCE_BUDGET: SourceBudget = {
    perDocumentTokens: 4_000,
    totalTokens: 20_000,
    maxSections: 120,
};

export interface RequestSpecV2 {
    contractVersion: typeof CONTRACT_VERSION;
    kind: "scenario";
    title: string;
    subject: string;
    agents: number;
    rounds: number;
    seed: number;
    /** Source selectors as the creator picked them (already scoped to what they can read). */
    sources: ScenarioSourcesInput;
    /** Mode resolved at acceptance; see `fallbackReason` when graph was asked for. */
    contextMode: ContextMode;
    requestedContextMode: ContextMode;
    fallbackReason: ContextFallbackReason | null;
    budget: {
        /** Most credits the whole run may settle. */
        maxCredits: number;
        /** Repair calls a cast batch or the ontology planner may make. */
        repairsPerUnit: number;
    };
    policies: {
        versions: typeof V2_VERSIONS;
        /** Most tokens in one actor's context. */
        actorTokenCap: number;
        sourceBudget: SourceBudget;
        /** Cast slots per cast batch (10 per the design). */
        castBatchSize: number;
        /** Evidence sections per graph ingestion unit. */
        ingestBatchSize: number;
    };
}

// ─── Evidence snapshots ──────────────────────────────────────────────────────

export type SnapshotSourceType =
    | "document"
    | "company_fact"
    | "prospect"
    | "brand_comment"
    | "company_profile"
    | "notes"
    | "search";

/** Where a quote sits in its source. Fields a source can't give stay null. */
export interface EvidenceLocator {
    documentId: number | null;
    versionId: number | null;
    chunkId: number | null;
    page: number | null;
    /** Heading path or section title, when the chunker kept one. */
    section: string | null;
    /** Connector records: the provider's id for the item. */
    providerId: string | null;
}

/** A typed company fact captured alongside the passages (ADR-011 facts). */
export interface TypedFactRef {
    /** Field path in the company profile, e.g. "pricing.plans". */
    key: string;
    label: string;
    value: string;
    /** Files the fact was read from; access dependencies. */
    sourceDocumentIds: number[];
}

/**
 * One captured piece of evidence. Immutable once the `sources` unit commits:
 * later units, replay and reports read this copy, never the live source.
 */
export interface EvidenceSnapshot {
    /** "E1", "E2", … stable within the run. */
    id: string;
    kind: EvidenceKind;
    sourceType: SnapshotSourceType;
    /** Document id, fact key, prospect id, … as a string. */
    sourceId: string;
    /** Document version id, or for connector records provider id + capture time. Null when unknown. */
    versionId: string | null;
    label: string;
    locator: EvidenceLocator;
    /** The exact captured text. */
    quote: string;
    fact: TypedFactRef | null;
    /** sha-256 of `quote`. */
    contentHash: string;
    capturedAt: string;
    /** "unknown" when the source keeps no version history. */
    validity: "versioned" | "unknown";
    /** Files a reader must be able to open to see this item. */
    documentIds: number[];
    href: string | null;
    /** Rough token count of `quote`. */
    tokens: number;
}

export const OMISSION_REASONS = [
    "budget",
    "not_ready",
    "no_access",
    "empty",
    "unsupported",
] as const;
export type OmissionReason = (typeof OMISSION_REASONS)[number];

/** Something selected that the run does not read, and why. Makes partial coverage visible. */
export interface SourceOmission {
    sourceType: SnapshotSourceType;
    sourceId: string;
    label: string;
    reason: OmissionReason;
    /** Tokens left out, when known. */
    tokens: number | null;
}

/** The output of the `sources` unit. */
export interface SourceManifest {
    version: 1;
    collector: string;
    items: EvidenceSnapshot[];
    omissions: SourceOmission[];
    budget: SourceBudget;
    usedTokens: number;
    /** Union of every item's `documentIds`; a reader needs all of them. */
    documentIds: number[];
    /** sha-256 over the canonical items (ids, hashes, locators). */
    manifestHash: string;
}

// ─── Ontology ────────────────────────────────────────────────────────────────

export type OntologyAttributeType = "string" | "number" | "boolean";

export interface OntologyAttribute {
    /** snake_case. */
    name: string;
    type: OntologyAttributeType;
    description: string;
}

export interface OntologyEntityType {
    /** PascalCase, e.g. "Organization". */
    name: string;
    description: string;
    attributes: OntologyAttribute[];
    origin: "base" | "extension";
    /** Required for extensions: the passage that motivated it. */
    motivatingEvidenceId: string | null;
}

export interface OntologyEdgeType {
    /** SCREAMING_SNAKE, e.g. "WORKS_FOR". */
    name: string;
    description: string;
    attributes: OntologyAttribute[];
    /** Allowed (source → target) entity type pairs. */
    endpoints: Array<{ source: string; target: string }>;
    origin: "base" | "extension";
    motivatingEvidenceId: string | null;
}

export interface OntologySchema {
    entities: OntologyEntityType[];
    edges: OntologyEdgeType[];
}

export const ONTOLOGY_LIMITS = {
    entityTypes: 12,
    edgeTypes: 16,
    attributesPerType: 6,
    endpointsPerEdge: 8,
    nameMax: 40,
    descriptionMax: 300,
} as const;

/** Names Graphiti or Neo4j already use; a generated type or attribute may not take them. */
export const RESERVED_ONTOLOGY_NAMES: readonly string[] = [
    "Entity",
    "Episodic",
    "Community",
    "EntityEdge",
    "EpisodicEdge",
    "CommunityEdge",
    "Saga",
    "RELATES_TO",
    "MENTIONS",
    "HAS_MEMBER",
    "uuid",
    "name",
    "group_id",
    "labels",
    "created_at",
    "summary",
    "attributes",
    "name_embedding",
    "fact",
    "fact_embedding",
    "episodes",
    "valid_at",
    "invalid_at",
    "expired_at",
    "source_node_uuid",
    "target_node_uuid",
    "reference_time",
    "HAS_EPISODE",
    "NEXT_EPISODE",
];

/** The business schema every ontology starts from (design §3.3.2). */
export const BASE_ONTOLOGY: OntologySchema = {
    entities: [
        {
            name: "Organization",
            description: "A company, team or institution named in the evidence.",
            attributes: [
                { name: "industry", type: "string", description: "What the organization does." },
                { name: "size", type: "string", description: "Headcount or size band, as stated." },
            ],
            origin: "base",
            motivatingEvidenceId: null,
        },
        {
            name: "Person",
            description: "A named or described individual and their role.",
            attributes: [
                { name: "title", type: "string", description: "Job title or role, as stated." },
            ],
            origin: "base",
            motivatingEvidenceId: null,
        },
        {
            name: "Product",
            description: "A product, tool or service someone uses, sells or evaluates.",
            attributes: [
                { name: "category", type: "string", description: "What kind of product it is." },
            ],
            origin: "base",
            motivatingEvidenceId: null,
        },
        {
            name: "PurchaseDecision",
            description: "A buying, renewal or switching decision under way or described.",
            attributes: [
                { name: "status", type: "string", description: "Where the decision stands." },
            ],
            origin: "base",
            motivatingEvidenceId: null,
        },
    ],
    edges: [
        {
            name: "WORKS_FOR",
            description: "A person is employed by or works at an organization.",
            attributes: [],
            endpoints: [{ source: "Person", target: "Organization" }],
            origin: "base",
            motivatingEvidenceId: null,
        },
        {
            name: "USES",
            description: "An organization or person uses a product today.",
            attributes: [],
            endpoints: [
                { source: "Organization", target: "Product" },
                { source: "Person", target: "Product" },
            ],
            origin: "base",
            motivatingEvidenceId: null,
        },
        {
            name: "INFLUENCES",
            description: "A person sways a purchase decision without making it.",
            attributes: [],
            endpoints: [{ source: "Person", target: "PurchaseDecision" }],
            origin: "base",
            motivatingEvidenceId: null,
        },
        {
            name: "APPROVES",
            description: "A person signs off on a purchase decision.",
            attributes: [],
            endpoints: [{ source: "Person", target: "PurchaseDecision" }],
            origin: "base",
            motivatingEvidenceId: null,
        },
        {
            name: "DECIDES_ON",
            description: "An organization is the buyer in a purchase decision.",
            attributes: [],
            endpoints: [{ source: "Organization", target: "PurchaseDecision" }],
            origin: "base",
            motivatingEvidenceId: null,
        },
    ],
};

export interface OntologySpec {
    version: 1;
    schema: OntologySchema;
    sourceManifestHash: string;
    plannerPromptVersion: string;
    /** The model id the planner ran on, when the host reports it; else the route. */
    plannerModel: string;
    validation: { ok: boolean; errors: string[]; repairs: number };
    ontologyHash: string;
}

// ─── Graph (Graphiti + Neo4j behind a port) ──────────────────────────────────

/** One evidence section as a Graphiti episode. `uuid` is deterministic per build + evidence id. */
export interface GraphEpisodeInput {
    uuid: string;
    name: string;
    body: string;
    sourceDescription: string;
    /** ISO time; the snapshot's capture time. */
    referenceTime: string;
    /** The evidence id this episode carries (kept in our records, not trusted from Graphiti). */
    evidenceId: string;
}

export interface GraphIngestOutcome {
    uuid: string;
    status: "done" | "failed";
    error?: string;
}

export interface GraphNode {
    uuid: string;
    name: string;
    /** Entity type labels, e.g. ["Entity", "Person"]. */
    labels: string[];
    summary: string;
    attributes: Record<string, unknown>;
}

export interface GraphEdge {
    uuid: string;
    /** Edge type, e.g. "WORKS_FOR"; "RELATES_TO" when untyped. */
    name: string;
    fact: string;
    sourceUuid: string;
    targetUuid: string;
    /** Episodes the fact was extracted from. */
    episodeUuids: string[];
    validAt: string | null;
    invalidAt: string | null;
    attributes: Record<string, unknown>;
}

export interface GraphExport {
    nodes: GraphNode[];
    edges: GraphEdge[];
    episodeUuids: string[];
}

/** Tokens the graph service spent on its own provider calls (extraction LLM and embeddings). */
export interface GraphUsage {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    embeddingTokens: number;
}

/** A search hit: an edge (fact) with the service's relevance score. */
export interface GraphSearchHit {
    edge: GraphEdge;
    score: number;
}

/** The graph is unreachable or refused the call; units that need it wait and retry. */
export class GraphUnavailableError extends Error {
    constructor(message = "The scenario graph service is unavailable") {
        super(message);
        this.name = "GraphUnavailableError";
    }
}

/**
 * Graph operations. The worker holds this port; only the private Python
 * service imports Graphiti or talks to Neo4j. Every call is pinned to one
 * build's group, chosen after authorization — a group id is not a permission
 * check.
 */
export interface ScenarioGraphPort {
    health(): Promise<{ ok: boolean; graphiti: string | null; neo4j: string | null }>;
    /** Add episodes in order. Reports the graph-processing tokens it spent, so they settle with the unit. */
    ingest(input: {
        groupId: string;
        ontology: OntologySchema;
        episodes: GraphEpisodeInput[];
    }): Promise<{ outcomes: GraphIngestOutcome[]; usage: GraphUsage }>;
    /** Episode uuids already stored in the group (to reconcile before resubmitting). */
    listEpisodes(groupId: string): Promise<string[]>;
    search(input: { groupId: string; query: string; limit: number }): Promise<GraphSearchHit[]>;
    exportGroup(groupId: string): Promise<GraphExport>;
    deleteGroup(groupId: string): Promise<void>;
}

/** An edge as frozen into a snapshot, with the evidence it came from and whether that evidence supports it. */
export interface SnapshotEdge extends GraphEdge {
    evidenceIds: string[];
    /** True when both endpoints are found in a supporting passage; unsupported edges stay inspectable but never reach an actor. */
    supported: boolean;
}

export interface GraphSnapshotData {
    nodes: GraphNode[];
    edges: SnapshotEdge[];
    /** Episode uuid → evidence id. */
    episodes: Record<string, string>;
    coverage: { ingested: string[]; failed: string[] };
    /** Same-name nodes left separate rather than merged by name. */
    unresolvedIdentities: Array<{ name: string; uuids: string[] }>;
    graphHash: string;
}

export type GraphBuildState = "preparing" | "ingesting" | "frozen" | "failed";

// ─── Cast plan, actor contexts, cast ─────────────────────────────────────────

/** A stable role slot PlanCast defines; the cast fills each slot once. */
export interface CastSlot {
    /** "s01", "s02", … */
    slotId: string;
    /** Who this is, e.g. "operations lead at a mid-size customer". */
    segment: string;
    /** The stance this slot starts at (the realistic mix stays an explicit assumption). */
    stanceTarget: Stance;
    /** What to retrieve for this slot. */
    query: string;
}

export interface CastPlan {
    slots: CastSlot[];
    /** The starting stance mix the slots were drawn to. */
    mix: { against: number; undecided: number; inFavour: number };
}

export interface ContextFact {
    /** Graph edge uuid, or "fact:<key>" for a typed fact. */
    id: string;
    text: string;
    evidenceIds: string[];
}

export interface ContextPassage {
    evidenceId: string;
    text: string;
}

/** What one slot's cast call may read. Saved with a hash; rounds never re-retrieve. */
export interface ActorContext {
    slotId: string;
    segment: string;
    mode: ContextMode;
    graphSnapshotId: number | null;
    selected: { nodeIds: string[]; edgeIds: string[]; evidenceIds: string[] };
    facts: ContextFact[];
    passages: ContextPassage[];
    retrievalPolicyVersion: string;
    tokens: number;
    contextHash: string;
}

/** Fields a v2 cast member carries with basis and evidence. */
export const ATTRIBUTED_FIELDS = [
    "role",
    "currentSolution",
    "budget",
    "buyingRole",
    "switchingCost",
    "objection",
] as const;
export type AttributedField = (typeof ATTRIBUTED_FIELDS)[number];

/** One filled slot. `persona` is what the engine runs; `attributes` say where each field came from. */
export interface CastMember {
    slotId: string;
    persona: Persona;
    attributes: Record<AttributedField, Attributed<string>>;
}

/** Output of a `cast:batch:NN` unit. */
export interface CastBatchOutput {
    members: CastMember[];
    /** Slots that stayed invalid after the repair allowance. */
    unfilled: string[];
    repairs: number;
}

// ─── World spec, checkpoints, replay ─────────────────────────────────────────

export interface WorldSpecV2 {
    version: 1;
    requestSpecHash: string;
    manifestHash: string;
    ontologyHash: string | null;
    graphHash: string | null;
    contextMode: ContextMode;
    /** slotId → contextHash. */
    contextHashes: Record<string, string>;
    /** slotId → agent id in the world. */
    cast: Array<{ slotId: string; agentId: string }>;
    /** The starting follow graph is seeded by the engine; no observed follow relation is claimed. */
    network: { basis: "engine_seeded"; follows: number };
    initialStateHash: string;
    versions: typeof V2_VERSIONS;
    seeds: { run: number };
    specHash: string;
}

/** One turn as it happened, so replay can serve it back without a model. */
export interface RecordedTurn {
    agentId: string;
    /** sha-256 of the canonical decision request. */
    requestHash: string;
    reply: { text: string; usage?: { inputTokens: number; outputTokens: number } } | null;
    /** Set when the turn failed (the agent did nothing that round). */
    error: string | null;
}

export interface RoundCheckpoint {
    round: number;
    stateHash: string;
    engineVersion: string;
    turns: RecordedTurn[];
    interventions: Array<{ id: number; text: string }>;
    /** Agents whose turn failed. */
    skipped: string[];
    summary: RoundSummary;
    /** More than a third of active turns failed: excluded from default comparisons. */
    degraded: boolean;
}

export interface ReplayResult {
    available: boolean;
    /** Why replay is not possible, when it isn't. */
    reason: "replay_unavailable" | "not_finished" | "unsupported_version" | null;
    matches: boolean;
    modelCalls: 0;
    rounds: Array<{ round: number; expected: string; actual: string; matches: boolean }>;
}

// ─── Units ───────────────────────────────────────────────────────────────────

export const UNIT_KINDS = [
    "sources",
    "brief",
    "ontology",
    "graph_prepare",
    "graph_ingest",
    "graph_freeze",
    "cast_plan",
    "actor_context",
    "cast_batch",
    "world_freeze",
    "round",
    "report",
] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

export const UNIT_STATUSES = ["pending", "running", "committed", "failed", "skipped"] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

/**
 * A unit in a run's work plan. `dependsOn` lists unit keys; an entry ending in
 * "*" waits for every unit whose key starts with the prefix (graph:ingest:*).
 */
export interface UnitPlanEntry {
    key: string;
    kind: UnitKind;
    /** Execution order among ready units. */
    seq: number;
    dependsOn: string[];
    /** Unit-specific input (slot ids, evidence ids, round number). */
    input: Record<string, unknown>;
    /** Most credits this unit may settle; reserved before it starts. */
    maxCredits: number;
}

export interface UnitRecord extends UnitPlanEntry {
    id: number;
    runId: number;
    generation: number;
    status: UnitStatus;
    attempts: number;
    inputHash: string;
    output: unknown;
    usage: Usage;
    credits: number;
    startedAt: Date | null;
    committedAt: Date | null;
    error: string | null;
}

// ─── Call journal ────────────────────────────────────────────────────────────

export type AttemptStatus = "started" | "succeeded" | "failed" | "unknown";

export interface CallAttemptRecord {
    id: number;
    callId: number;
    attempt: number;
    status: AttemptStatus;
    providerRequestId: string | null;
    model: string | null;
    rawText: string | null;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number | null;
    error: string | null;
    startedAt: Date;
    finishedAt: Date | null;
}

// ─── Run flags, provenance view ──────────────────────────────────────────────

/** What a v2 run reports about its own completeness. */
export interface RunFlagsV2 {
    contextMode: ContextMode;
    fallbackReason: ContextFallbackReason | null;
    /** Sources selected but not read. */
    omittedSources: number;
    degradedRounds: number[];
    skippedTurns: number;
    unfilledSlots: number;
    /** Model calls whose outcome is unknown (a lost reply); their expense is not zero. */
    unknownAttempts: number;
    /** Set while the run waits on the graph service. */
    waitingSince: string | null;
}

export const EMPTY_FLAGS: RunFlagsV2 = {
    contextMode: "passage",
    fallbackReason: null,
    omittedSources: 0,
    degradedRounds: [],
    skippedTurns: 0,
    unfilledSlots: 0,
    unknownAttempts: 0,
    waitingSince: null,
};

/** A turn's decision as the recorded model serves it back (re-exported for stages). */
export type { AgentDecision };
