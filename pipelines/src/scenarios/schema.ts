/**
 * Drizzle schema for the scenarios vertical: simulated social networks and
 * Brand post tests.
 *
 * Four tables, company-scoped with cascade delete, prefixed `pdr_ai_v2_` by
 * the shared helper. The whole simulation state of a run is one JSON world
 * (`@launchstack/simulation` keeps it plain JSON), rewritten once per round.
 * Columns added by later migrations must be declared LAST.
 */
import { sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    bigint,
    boolean,
    index,
    integer,
    jsonb,
    serial,
    text,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/pg-core";

import type {
    Brief,
    PostReception,
    RoundSummary,
    ScenarioReport,
    Usage,
    World,
} from "@launchstack/simulation";
import { company } from "@launchstack/store/schema";
import { pgTable } from "@launchstack/store/schema/helpers";

import type {
    ActorContext,
    GraphBuildState,
    GraphSnapshotData,
    OntologySchema,
    RecordedTurn,
    RequestSpecV2,
    RunFlagsV2,
    SourceManifest,
    UnitKind,
    UnitStatus,
    WorldSpecV2,
} from "./v2/contracts";
import type {
    PostTestDraft,
    RunEstimateStored,
    RunUsage,
    ScenarioSourcesInput,
    StoredEvidence,
} from "./types";
import { SCENARIO_KINDS, SCENARIO_STATUSES } from "./types";

export const scenarioRuns = pgTable(
    "scenario_runs",
    {
        id: serial("id").primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        createdByUserId: varchar("created_by_user_id", { length: 256 }).notNull(),
        kind: varchar("kind", { length: 16, enum: SCENARIO_KINDS }).notNull(),
        title: varchar("title", { length: 200 }).notNull(),
        subject: text("subject").notNull(),
        status: varchar("status", { length: 16, enum: SCENARIO_STATUSES })
            .notNull()
            .default("queued"),
        /** Units completed; every unit commits with a compare-and-set on this. */
        step: integer("step").notNull().default(0),
        agentCount: integer("agent_count").notNull(),
        roundCount: integer("round_count").notNull(),
        seed: integer("seed").notNull(),
        sources: jsonb("sources").$type<ScenarioSourcesInput>().notNull(),
        evidence: jsonb("evidence").$type<StoredEvidence[]>(),
        brief: jsonb("brief").$type<Brief>(),
        world: jsonb("world").$type<World>(),
        report: jsonb("report").$type<ScenarioReport>(),
        reception: jsonb("reception").$type<PostReception>(),
        estimate: jsonb("estimate").$type<RunEstimateStored>().notNull(),
        usage: jsonb("usage").$type<RunUsage>().notNull(),
        /** Post tests: the tested draft and sha-256 of its normalized text. */
        draft: jsonb("draft").$type<PostTestDraft>(),
        draftHash: varchar("draft_hash", { length: 64 }),
        error: text("error"),
        /** Set when the creator shares the run with the whole workspace. */
        sharedAt: timestamp("shared_at", { withTimezone: true }),
        cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
        /** The in-process executor's claim; a stale lease lets a poll resume the run. */
        leaseUntil: timestamp("lease_until", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
        startedAt: timestamp("started_at", { withTimezone: true }),
        finishedAt: timestamp("finished_at", { withTimezone: true }),
        /**
         * Set when the final round starts, before it reads pending events.
         * Adding an event checks this under the same row lock, so an event is
         * either applied in a round or refused, never accepted and dropped.
         */
        eventsClosedAt: timestamp("events_closed_at", { withTimezone: true }),
        // ── Contract v2 (scenario_durable_generation). Declared last: the
        // migration appends them and the parity gate diffs column order. ──
        /** 1 = the original unit loop; 2 = durable, evidence-grounded runs. */
        contractVersion: integer("contract_version").notNull().default(1),
        requestSpecId: integer("request_spec_id"),
        worldSpecId: integer("world_spec_id"),
        /** Bumped when a run is re-executed from scratch; every unit, call and settlement key carries it. */
        generation: integer("generation").notNull().default(1),
        /** The fenced lease: only the holder of (owner, epoch) may commit, settle or fail the run. */
        leaseOwner: varchar("lease_owner", { length: 64 }),
        leaseEpoch: integer("lease_epoch").notNull().default(0),
        /** passage | facts | graph, fixed at acceptance (v2). */
        contextMode: varchar("context_mode", { length: 16 }),
        flags: jsonb("flags").$type<RunFlagsV2>(),
    },
    table => [
        index("scenario_runs_company_creator_idx").on(
            table.companyId,
            table.createdByUserId,
            table.createdAt
        ),
        index("scenario_runs_company_kind_idx").on(table.companyId, table.kind, table.createdAt),
        index("scenario_runs_status_idx").on(table.status),
    ]
);
export type ScenarioRunRow = InferSelectModel<typeof scenarioRuns>;

/** Events the creator adds while a run is going; applied at the start of the next round. */
export const scenarioInjections = pgTable(
    "scenario_injections",
    {
        id: serial("id").primaryKey(),
        runId: integer("run_id")
            .notNull()
            .references(() => scenarioRuns.id, { onDelete: "cascade" }),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        createdByUserId: varchar("created_by_user_id", { length: 256 }).notNull(),
        text: text("text").notNull(),
        /** The round it appeared in; null while waiting. */
        appliedRound: integer("applied_round"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => [index("scenario_injections_run_idx").on(table.runId, table.appliedRound)]
);
export type ScenarioInjectionRow = InferSelectModel<typeof scenarioInjections>;

/** Questions put to a simulated person or the analyst. Private to whoever asked. */
export const scenarioInterviews = pgTable(
    "scenario_interviews",
    {
        id: serial("id").primaryKey(),
        runId: integer("run_id")
            .notNull()
            .references(() => scenarioRuns.id, { onDelete: "cascade" }),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        askedByUserId: varchar("asked_by_user_id", { length: 256 }).notNull(),
        /** A person's id ("a3") or "analyst". */
        agentId: varchar("agent_id", { length: 32 }).notNull(),
        question: text("question").notNull(),
        answer: text("answer").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => [
        index("scenario_interviews_run_asker_idx").on(
            table.runId,
            table.askedByUserId,
            table.createdAt
        ),
    ]
);
export type ScenarioInterviewRow = InferSelectModel<typeof scenarioInterviews>;

/**
 * Which post test predicted which Brand post. One test per post; testing the
 * same text again re-points the link. `brand_post_id` has no foreign key —
 * a post deleted from the calendar just drops out of the track record.
 */
export const scenarioPostLinks = pgTable(
    "scenario_post_links",
    {
        id: serial("id").primaryKey(),
        runId: integer("run_id")
            .notNull()
            .references(() => scenarioRuns.id, { onDelete: "cascade" }),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        brandPostId: varchar("brand_post_id", { length: 64 }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => [
        uniqueIndex("scenario_post_links_post_unique").on(table.brandPostId),
        index("scenario_post_links_company_idx").on(table.companyId),
    ]
);
export type ScenarioPostLinkRow = InferSelectModel<typeof scenarioPostLinks>;

// ═══ Contract v2: durable execution and evidence-grounded generation ═════════
//
// Specifications are immutable; journals (units, calls, attempts, checkpoints)
// are append-only apart from their status columns. Everything is scoped by
// company and cascades with the run (graph builds outlive a run: they are
// reused by key within the company).

const createdAt = () =>
    timestamp("created_at", { withTimezone: true })
        .default(sql`CURRENT_TIMESTAMP`)
        .notNull();
const companyRef = () =>
    bigint("company_id", { mode: "bigint" })
        .notNull()
        .references(() => company.id, { onDelete: "cascade" });
const runRef = () =>
    integer("run_id")
        .notNull()
        .references(() => scenarioRuns.id, { onDelete: "cascade" });

/** RequestSpec, frozen at acceptance. The idempotency record lives here too. */
export const scenarioRequestSpecs = pgTable(
    "scenario_request_specs",
    {
        id: serial("id").primaryKey(),
        companyId: companyRef(),
        createdByUserId: varchar("created_by_user_id", { length: 256 }).notNull(),
        /** The client's Idempotency-Key; null when none was sent. */
        idempotencyKey: varchar("idempotency_key", { length: 200 }),
        /** sha-256 of the normalized create payload: same key + other payload is a 409. */
        payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
        spec: jsonb("spec").$type<RequestSpecV2>().notNull(),
        specHash: varchar("spec_hash", { length: 64 }).notNull(),
        createdAt: createdAt(),
    },
    table => [
        uniqueIndex("scenario_request_specs_idempotency_unique").on(
            table.companyId,
            table.createdByUserId,
            table.idempotencyKey
        ),
    ]
);
export type ScenarioRequestSpecRow = InferSelectModel<typeof scenarioRequestSpecs>;

/**
 * The outbox for run dispatch: inserted with the run, delivered after commit,
 * retried by the reconciler until Inngest has it. Duplicate delivery converges
 * (Inngest dedupes on event_id; the lease fences a second driver).
 */
export const scenarioDispatches = pgTable(
    "scenario_dispatches",
    {
        id: serial("id").primaryKey(),
        companyId: companyRef(),
        runId: runRef(),
        generation: integer("generation").notNull(),
        eventId: varchar("event_id", { length: 128 }).notNull(),
        /** pending → sent; failed rows go back to pending with a later next_attempt_at. */
        status: varchar("status", { length: 16 }).notNull().default("pending"),
        attempts: integer("attempts").notNull().default(0),
        nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        lastError: text("last_error"),
        sentAt: timestamp("sent_at", { withTimezone: true }),
        createdAt: createdAt(),
    },
    table => [
        uniqueIndex("scenario_dispatches_event_unique").on(table.eventId),
        index("scenario_dispatches_due_idx").on(table.status, table.nextAttemptAt),
        index("scenario_dispatches_run_idx").on(table.runId, table.generation),
    ]
);
export type ScenarioDispatchRow = InferSelectModel<typeof scenarioDispatches>;

/** The run's work plan: one row per unit, committed exactly once. */
export const scenarioUnits = pgTable(
    "scenario_units",
    {
        id: serial("id").primaryKey(),
        companyId: companyRef(),
        runId: runRef(),
        generation: integer("generation").notNull(),
        unitKey: varchar("unit_key", { length: 64 }).notNull(),
        kind: varchar("kind", { length: 24 }).$type<UnitKind>().notNull(),
        seq: integer("seq").notNull(),
        dependsOn: jsonb("depends_on").$type<string[]>().notNull(),
        input: jsonb("input").$type<Record<string, unknown>>().notNull(),
        /** sha-256 of the unit's resolved inputs, set when it first runs. */
        inputHash: varchar("input_hash", { length: 64 }),
        maxCredits: integer("max_credits").notNull(),
        status: varchar("status", { length: 16 }).$type<UnitStatus>().notNull().default("pending"),
        attempts: integer("attempts").notNull().default(0),
        output: jsonb("output"),
        usage: jsonb("usage").$type<Usage>(),
        credits: integer("credits").notNull().default(0),
        error: text("error"),
        startedAt: timestamp("started_at", { withTimezone: true }),
        committedAt: timestamp("committed_at", { withTimezone: true }),
        /** Wall time of the committed attempt, for the stage timing breakdown. */
        durationMs: integer("duration_ms"),
        createdAt: createdAt(),
    },
    table => [
        uniqueIndex("scenario_units_run_unit_unique").on(
            table.runId,
            table.generation,
            table.unitKey
        ),
        index("scenario_units_run_seq_idx").on(table.runId, table.generation, table.seq),
    ]
);
export type ScenarioUnitRow = InferSelectModel<typeof scenarioUnits>;

/**
 * A unit's credit hold. The settlement key (company/run/generation/unit) is
 * unique, so a unit is settled once however often it is retried or delivered.
 */
export const scenarioCreditReservations = pgTable(
    "scenario_credit_reservations",
    {
        id: serial("id").primaryKey(),
        companyId: companyRef(),
        runId: runRef(),
        generation: integer("generation").notNull(),
        unitKey: varchar("unit_key", { length: 64 }).notNull(),
        settlementKey: varchar("settlement_key", { length: 160 }).notNull(),
        /** Credits held against the balance (0 where balances aren't enforced). */
        reserved: integer("reserved").notNull(),
        /** Credits charged at settlement. */
        settled: integer("settled"),
        /** held → settled | released. */
        status: varchar("status", { length: 16 }).notNull().default("held"),
        createdAt: createdAt(),
        closedAt: timestamp("closed_at", { withTimezone: true }),
    },
    table => [
        uniqueIndex("scenario_credit_reservations_key_unique").on(table.settlementKey),
        index("scenario_credit_reservations_run_idx").on(table.runId, table.status),
    ]
);
export type ScenarioCreditReservationRow = InferSelectModel<typeof scenarioCreditReservations>;

/** One logical model call. Retries with the exact same request reuse its accepted attempt. */
export const scenarioCalls = pgTable(
    "scenario_calls",
    {
        id: serial("id").primaryKey(),
        companyId: companyRef(),
        runId: runRef(),
        generation: integer("generation").notNull(),
        unitKey: varchar("unit_key", { length: 64 }).notNull(),
        /** sha-256 of run, generation, unit, purpose and request hash. */
        logicalKey: varchar("logical_key", { length: 64 }).notNull(),
        /** sha-256 of the full canonical request plus model-policy and prompt versions. */
        requestHash: varchar("request_hash", { length: 64 }).notNull(),
        purpose: varchar("purpose", { length: 24 }).notNull(),
        /** Agent id for turns; null otherwise. */
        actorId: varchar("actor_id", { length: 32 }),
        round: integer("round"),
        acceptedAttemptId: integer("accepted_attempt_id"),
        createdAt: createdAt(),
    },
    table => [
        uniqueIndex("scenario_calls_logical_unique").on(table.logicalKey),
        index("scenario_calls_run_unit_idx").on(table.runId, table.generation, table.unitKey),
    ]
);
export type ScenarioCallRow = InferSelectModel<typeof scenarioCalls>;

/** Every physical attempt, kept even when it failed or its outcome is unknown. */
export const scenarioCallAttempts = pgTable(
    "scenario_call_attempts",
    {
        id: serial("id").primaryKey(),
        companyId: companyRef(),
        callId: integer("call_id")
            .notNull()
            .references(() => scenarioCalls.id, { onDelete: "cascade" }),
        attempt: integer("attempt").notNull(),
        /** started → succeeded | failed | unknown (a lost reply may still have cost money). */
        status: varchar("status", { length: 16 }).notNull(),
        providerRequestId: varchar("provider_request_id", { length: 128 }),
        model: varchar("model", { length: 128 }),
        /** Raw reply; purged after the retention window (replay then reads checkpoints). */
        rawText: text("raw_text"),
        inputTokens: integer("input_tokens").notNull().default(0),
        outputTokens: integer("output_tokens").notNull().default(0),
        latencyMs: integer("latency_ms"),
        error: text("error"),
        startedAt: timestamp("started_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        finishedAt: timestamp("finished_at", { withTimezone: true }),
    },
    table => [
        uniqueIndex("scenario_call_attempts_call_attempt_unique").on(table.callId, table.attempt),
        index("scenario_call_attempts_started_idx").on(table.startedAt),
    ]
);
export type ScenarioCallAttemptRow = InferSelectModel<typeof scenarioCallAttempts>;

/** The `sources` unit's captured evidence, immutable once committed. */
export const scenarioSourceManifests = pgTable(
    "scenario_source_manifests",
    {
        id: serial("id").primaryKey(),
        companyId: companyRef(),
        runId: runRef(),
        generation: integer("generation").notNull(),
        manifest: jsonb("manifest").$type<SourceManifest>().notNull(),
        manifestHash: varchar("manifest_hash", { length: 64 }).notNull(),
        /** Every file a reader needs to open to see this run's evidence. */
        documentIds: jsonb("document_ids").$type<number[]>().notNull(),
        createdAt: createdAt(),
    },
    table => [uniqueIndex("scenario_source_manifests_run_unique").on(table.runId, table.generation)]
);
export type ScenarioSourceManifestRow = InferSelectModel<typeof scenarioSourceManifests>;

export const scenarioOntologySpecs = pgTable(
    "scenario_ontology_specs",
    {
        id: serial("id").primaryKey(),
        companyId: companyRef(),
        runId: runRef(),
        requestSpecId: integer("request_spec_id")
            .notNull()
            .references(() => scenarioRequestSpecs.id, { onDelete: "cascade" }),
        schema: jsonb("schema").$type<OntologySchema>().notNull(),
        sourceManifestHash: varchar("source_manifest_hash", { length: 64 }).notNull(),
        plannerPromptVersion: varchar("planner_prompt_version", { length: 64 }).notNull(),
        plannerModel: varchar("planner_model", { length: 128 }).notNull(),
        validation: jsonb("validation")
            .$type<{ ok: boolean; errors: string[]; repairs: number }>()
            .notNull(),
        ontologyHash: varchar("ontology_hash", { length: 64 }).notNull(),
        createdAt: createdAt(),
    },
    table => [uniqueIndex("scenario_ontology_specs_run_unique").on(table.runId)]
);
export type ScenarioOntologySpecRow = InferSelectModel<typeof scenarioOntologySpecs>;

/**
 * A Graphiti build: one group in Neo4j per (company, manifest, ontology,
 * extraction policy). Reused by key across runs of the same company; only the
 * owner run mutates it.
 */
export const scenarioGraphBuilds = pgTable(
    "scenario_graph_builds",
    {
        id: serial("id").primaryKey(),
        companyId: companyRef(),
        buildKey: varchar("build_key", { length: 64 }).notNull(),
        /** Graphiti group_id; every graph call is pinned to it after authorization. */
        groupId: varchar("group_id", { length: 128 }).notNull(),
        manifestHash: varchar("manifest_hash", { length: 64 }).notNull(),
        ontologyHash: varchar("ontology_hash", { length: 64 }).notNull(),
        policyVersion: varchar("policy_version", { length: 64 }).notNull(),
        state: varchar("state", { length: 16 }).$type<GraphBuildState>().notNull(),
        ownerRunId: integer("owner_run_id"),
        ownerEpoch: integer("owner_epoch").notNull().default(1),
        snapshotId: integer("snapshot_id"),
        error: text("error"),
        createdAt: createdAt(),
        frozenAt: timestamp("frozen_at", { withTimezone: true }),
        /** Set when the group was deleted from Neo4j (retention or source deletion). */
        deletedAt: timestamp("deleted_at", { withTimezone: true }),
    },
    table => [
        uniqueIndex("scenario_graph_builds_company_key_unique").on(table.companyId, table.buildKey),
        uniqueIndex("scenario_graph_builds_group_unique").on(table.groupId),
    ]
);
export type ScenarioGraphBuildRow = InferSelectModel<typeof scenarioGraphBuilds>;

/** Which evidence went into which episodes, per ingestion unit. */
export const scenarioGraphIngestions = pgTable(
    "scenario_graph_ingestions",
    {
        id: serial("id").primaryKey(),
        companyId: companyRef(),
        buildId: integer("build_id")
            .notNull()
            .references(() => scenarioGraphBuilds.id, { onDelete: "cascade" }),
        unitKey: varchar("unit_key", { length: 64 }).notNull(),
        evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull(),
        episodeUuids: jsonb("episode_uuids").$type<string[]>().notNull(),
        status: varchar("status", { length: 16 }).notNull(),
        attempts: integer("attempts").notNull().default(1),
        error: text("error"),
        createdAt: createdAt(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => [
        uniqueIndex("scenario_graph_ingestions_build_unit_unique").on(table.buildId, table.unitKey),
    ]
);
export type ScenarioGraphIngestionRow = InferSelectModel<typeof scenarioGraphIngestions>;

/** The frozen graph: what actors may be grounded in, hashed. */
export const scenarioGraphSnapshots = pgTable(
    "scenario_graph_snapshots",
    {
        id: serial("id").primaryKey(),
        companyId: companyRef(),
        buildId: integer("build_id")
            .notNull()
            .references(() => scenarioGraphBuilds.id, { onDelete: "cascade" }),
        data: jsonb("data").$type<GraphSnapshotData>().notNull(),
        graphHash: varchar("graph_hash", { length: 64 }).notNull(),
        createdAt: createdAt(),
    },
    table => [uniqueIndex("scenario_graph_snapshots_build_unique").on(table.buildId)]
);
export type ScenarioGraphSnapshotRow = InferSelectModel<typeof scenarioGraphSnapshots>;

/** One slot's compiled context. Rounds and replay read this, never the graph. */
export const scenarioActorContexts = pgTable(
    "scenario_actor_contexts",
    {
        id: serial("id").primaryKey(),
        companyId: companyRef(),
        runId: runRef(),
        generation: integer("generation").notNull(),
        slotId: varchar("slot_id", { length: 16 }).notNull(),
        context: jsonb("context").$type<ActorContext>().notNull(),
        contextHash: varchar("context_hash", { length: 64 }).notNull(),
        createdAt: createdAt(),
    },
    table => [
        uniqueIndex("scenario_actor_contexts_run_slot_unique").on(
            table.runId,
            table.generation,
            table.slotId
        ),
    ]
);
export type ScenarioActorContextRow = InferSelectModel<typeof scenarioActorContexts>;

/** WorldSpec: finalized once, before round one. */
export const scenarioWorldSpecs = pgTable(
    "scenario_world_specs",
    {
        id: serial("id").primaryKey(),
        companyId: companyRef(),
        runId: runRef(),
        generation: integer("generation").notNull(),
        spec: jsonb("spec").$type<WorldSpecV2>().notNull(),
        /** The starting world; replay begins here. */
        initialWorld: jsonb("initial_world").$type<World>().notNull(),
        specHash: varchar("spec_hash", { length: 64 }).notNull(),
        createdAt: createdAt(),
    },
    table => [uniqueIndex("scenario_world_specs_run_unique").on(table.runId, table.generation)]
);
export type ScenarioWorldSpecRow = InferSelectModel<typeof scenarioWorldSpecs>;

/** One row per committed round: the turns as they happened and the state hash they produce. */
export const scenarioCheckpoints = pgTable(
    "scenario_checkpoints",
    {
        id: serial("id").primaryKey(),
        companyId: companyRef(),
        runId: runRef(),
        generation: integer("generation").notNull(),
        round: integer("round").notNull(),
        stateHash: varchar("state_hash", { length: 64 }).notNull(),
        engineVersion: varchar("engine_version", { length: 64 }).notNull(),
        turns: jsonb("turns").$type<RecordedTurn[]>().notNull(),
        interventions: jsonb("interventions")
            .$type<Array<{ id: number; text: string }>>()
            .notNull(),
        skipped: jsonb("skipped").$type<string[]>().notNull(),
        summary: jsonb("summary").$type<RoundSummary>().notNull(),
        degraded: boolean("degraded").notNull().default(false),
        createdAt: createdAt(),
    },
    table => [
        uniqueIndex("scenario_checkpoints_run_round_unique").on(
            table.runId,
            table.generation,
            table.round
        ),
    ]
);
export type ScenarioCheckpointRow = InferSelectModel<typeof scenarioCheckpoints>;
