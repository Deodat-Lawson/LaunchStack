/**
 * The seam between the durable engine and the generation stages.
 *
 * The engine (engine.ts) owns everything durable: the fenced lease, the
 * unit's credit hold, the call journal behind `ctx.model`, cancellation, and
 * the commit transaction that applies a stage's result together with its
 * settlement. A stage owns only its unit's work: read committed artifacts,
 * call the model and the graph, and return what to persist.
 *
 * A stage must be safe to run again after a crash: the same committed inputs
 * produce the same requests, so the journal serves accepted replies back
 * instead of paying twice; graph side effects reconcile before resubmitting.
 */
import type { Brief, ScenarioReport, SimulationModel, World } from "@launchstack/simulation";

import type { ScenarioRunRecord } from "../types";
import type {
    ActorContext,
    ContextMode,
    GraphBuildState,
    GraphSnapshotData,
    OntologySpec,
    RequestSpecV2,
    RoundCheckpoint,
    RunFlagsV2,
    ScenarioGraphPort,
    SourceManifest,
    SourceOmission,
    TypedFactRef,
    UnitPlanEntry,
    UnitRecord,
    WorldSpecV2,
} from "./contracts";
import type { StoredEvidence } from "../types";

// ─── Records the reader returns ──────────────────────────────────────────────

export interface GraphBuildRecord {
    id: number;
    companyId: bigint;
    buildKey: string;
    groupId: string;
    state: GraphBuildState;
    ownerRunId: number | null;
    ownerEpoch: number;
    manifestHash: string;
    ontologyHash: string;
    policyVersion: string;
    snapshotId: number | null;
    error: string | null;
}

export interface GraphIngestionRecord {
    id: number;
    buildId: number;
    unitKey: string;
    evidenceIds: string[];
    episodeUuids: string[];
    status: "pending" | "done" | "failed";
    attempts: number;
    error: string | null;
}

export interface GraphSnapshotRecord {
    id: number;
    buildId: number;
    data: GraphSnapshotData;
}

export interface WorldSpecRecord {
    id: number;
    spec: WorldSpecV2;
    initialWorld: World;
}

/** Committed artifacts of the run (and, for graph builds, of the company). */
export interface ArtifactReader {
    /** A committed unit's saved output. */
    unitOutput<T>(key: string): Promise<T | undefined>;
    /** Committed outputs of every unit whose key starts with `prefix`, in key order. */
    unitOutputs<T>(prefix: string): Promise<Array<{ key: string; output: T }>>;
    sourceManifest(): Promise<SourceManifest | undefined>;
    ontologySpec(): Promise<(OntologySpec & { id: number }) | undefined>;
    /** A build of this company by key. */
    graphBuild(buildKey: string): Promise<GraphBuildRecord | undefined>;
    graphBuildById(id: number): Promise<GraphBuildRecord | undefined>;
    graphIngestions(buildId: number): Promise<GraphIngestionRecord[]>;
    graphSnapshot(buildId: number): Promise<GraphSnapshotRecord | undefined>;
    actorContexts(): Promise<ActorContext[]>;
    worldSpec(): Promise<WorldSpecRecord | undefined>;
    checkpoints(): Promise<RoundCheckpoint[]>;
    /** Events the creator added that no round has applied yet. */
    pendingInjections(): Promise<Array<{ id: number; text: string }>>;
}

// ─── What a stage returns ────────────────────────────────────────────────────

/** Persisted with the unit's commit, in the same transaction. */
export type ArtifactWrite =
    | { type: "source_manifest"; manifest: SourceManifest }
    | { type: "ontology_spec"; spec: OntologySpec }
    /** Create a build (unique per company + key) or update one this run owns. */
    | {
          type: "graph_build";
          buildKey: string;
          groupId: string;
          manifestHash: string;
          ontologyHash: string;
          policyVersion: string;
          state: GraphBuildState;
          /** Take ownership when the previous owner run is finished. */
          takeOver?: boolean;
          error?: string | null;
      }
    | {
          type: "graph_ingestion";
          buildKey: string;
          unitKey: string;
          evidenceIds: string[];
          episodeUuids: string[];
          status: "done" | "failed";
          error?: string | null;
      }
    | { type: "graph_snapshot"; buildKey: string; data: GraphSnapshotData }
    | { type: "actor_contexts"; contexts: ActorContext[] }
    | { type: "world_spec"; spec: WorldSpecV2; initialWorld: World }
    | { type: "checkpoint"; checkpoint: RoundCheckpoint; appliedInjectionIds: number[] };

/** Fields of the run row a stage may set (kept for v1 views: evidence, brief, world, report). */
export interface RunPatchV2 {
    evidence?: StoredEvidence[];
    brief?: Brief;
    world?: World;
    report?: ScenarioReport;
    flags?: Partial<RunFlagsV2>;
    /** Only the report stage sets "done". */
    status?: "running" | "done";
    finishedAt?: Date;
    /** Set when the final round starts so no event is accepted and dropped. */
    closeEvents?: boolean;
}

export interface StageResult {
    /** Saved as the unit's output (jsonb). Keep it small; big artifacts go in `writes`. */
    output: unknown;
    writes?: ArtifactWrite[];
    run?: RunPatchV2;
    /** Units to add to the plan in the same commit (graph:ingest:NN after graph:prepare). */
    followUps?: UnitPlanEntry[];
    /**
     * Provider tokens spent outside `ctx.model` (the graph service's own
     * extraction calls). Added to the unit's usage and settled with it.
     */
    extraUsage?: { calls: number; inputTokens: number; outputTokens: number };
}

/**
 * Raised by a stage when its unit cannot go ahead yet (the graph build is
 * owned by another live run, the graph service is down). The engine releases
 * the lease without counting a failed attempt and the run waits.
 */
export class RetryLaterError extends Error {
    constructor(
        message: string,
        readonly afterMs = 60_000
    ) {
        super(message);
        this.name = "RetryLaterError";
    }
}

// ─── Ports a stage may use ───────────────────────────────────────────────────

/** A source's captured content before the `sources` stage numbers and hashes it. */
export interface SourceSectionDraft {
    kind: StoredEvidence["kind"];
    sourceType: SourceManifest["items"][number]["sourceType"];
    sourceId: string;
    versionId: string | null;
    label: string;
    locator: SourceManifest["items"][number]["locator"];
    text: string;
    fact: TypedFactRef | null;
    validity: "versioned" | "unknown";
    documentIds: number[];
    href: string | null;
    /** Relevance to the subject, 0–1; the collector already ranked within a document. */
    score: number;
}

export interface SourceCollection {
    sections: SourceSectionDraft[];
    omissions: SourceOmission[];
}

export interface StagePorts {
    /** Capture the run's selected sources as the creator may read them, within the budget. */
    collectSources(run: ScenarioRunRecord, spec: RequestSpecV2): Promise<SourceCollection>;
    /** Null when no graph service is configured. */
    graph: ScenarioGraphPort | null;
    now(): Date;
    log?(message: string, meta?: Record<string, unknown>): void;
}

export interface StageContext {
    run: ScenarioRunRecord;
    spec: RequestSpecV2;
    /** The run's resolved context mode (the spec's, or a recorded fallback). */
    mode: ContextMode;
    unit: UnitRecord;
    /** Journaled, metered model: identical requests in a retry are served from the journal. */
    model: SimulationModel;
    artifacts: ArtifactReader;
    ports: StagePorts;
    /** Parallel model calls inside the unit. */
    concurrency: number;
}

export type Stage = (ctx: StageContext) => Promise<StageResult>;
