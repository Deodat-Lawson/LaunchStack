import { sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    bigint,
    boolean,
    index,
    integer,
    jsonb,
    text,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/pg-core";

import { company } from "@launchstack/core/db/schema";
import { pgTable } from "@launchstack/core/db/schema/helpers";

import type { EnrichedNoteProposal, ModelMetadata } from "./contracts";

export const callNotesCallStatusEnum = ["active", "finalizing", "completed", "failed"] as const;
export const callNotesCaptureDesiredModeEnum = ["running", "paused"] as const;
export const callNotesCaptureLifecycleEnum = [
    "connecting",
    "live",
    "interrupted",
    "finalizing",
    "completed",
    "failed",
] as const;
export const callNotesCaptureOutcomeEnum = ["complete", "partial", "failed"] as const;
export const callNotesAttemptLifecycleEnum = [
    "connecting",
    "live",
    "reconnecting",
    "ended",
    "failed",
] as const;
export const callNotesGapKindEnum = [
    "user_paused",
    "capture_user_absent",
    "transport_interruption",
    "worker_unavailable",
    "provider_unknown",
] as const;
export const callNotesNoteVisibilityEnum = ["company", "private"] as const;
export const callNotesEnrichmentStatusEnum = [
    "queued",
    "generating",
    "ready",
    "rejected",
    "accepted",
    "failed",
] as const;
export const callNotesWorkItemKindEnum = [
    "start",
    "pause",
    "resume",
    "provider_event",
    "finalize",
    "enrich",
    "reindex",
] as const;
export const callNotesWorkItemStatusEnum = ["pending", "claimed", "completed", "failed"] as const;

export const callNotesZoomConnections = pgTable(
    "call_notes_zoom_connections",
    {
        id: varchar("id", { length: 64 }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        userId: varchar("user_id", { length: 256 }).notNull(),
        zoomAccountId: varchar("zoom_account_id", { length: 256 }).notNull(),
        zoomUserId: varchar("zoom_user_id", { length: 256 }).notNull(),
        encryptedAccessToken: text("encrypted_access_token").notNull(),
        encryptedRefreshToken: text("encrypted_refresh_token"),
        tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
        scopes: text("scopes").array().notNull().default([]),
        status: varchar("status", {
            length: 24,
            enum: ["active", "revoked", "disconnected"],
        })
            .notNull()
            .default("active"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => ({
        companyUserUnique: uniqueIndex("call_notes_zoom_connections_company_user_unique").on(
            table.companyId,
            table.userId
        ),
        companyZoomUserUnique: uniqueIndex(
            "call_notes_zoom_connections_company_zoom_user_unique"
        ).on(table.companyId, table.zoomUserId),
    })
);

export const callNotesCalls = pgTable(
    "call_notes_calls",
    {
        id: varchar("id", { length: 64 }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        provider: varchar("provider", { length: 32, enum: ["zoom"] }).notNull(),
        providerOccurrenceKey: varchar("provider_occurrence_key", { length: 256 }).notNull(),
        title: varchar("title", { length: 512 }).notNull(),
        status: varchar("status", { length: 32, enum: callNotesCallStatusEnum })
            .notNull()
            .default("active"),
        documentNoteId: bigint("document_note_id", { mode: "number" }),
        noteOwnerUserId: varchar("note_owner_user_id", { length: 256 }),
        noteVisibility: varchar("note_visibility", {
            length: 16,
            enum: callNotesNoteVisibilityEnum,
        })
            .notNull()
            .default("company"),
        knowledgeIncluded: boolean("knowledge_included").notNull().default(false),
        currentNoteRevision: integer("current_note_revision").notNull().default(0),
        failureCode: varchar("failure_code", { length: 128 }),
        failureMessage: varchar("failure_message", { length: 1024 }),
        startedAt: timestamp("started_at", { withTimezone: true }),
        finalizedAt: timestamp("finalized_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => ({
        occurrenceUnique: uniqueIndex("call_notes_calls_company_occurrence_unique").on(
            table.companyId,
            table.provider,
            table.providerOccurrenceKey
        ),
        companyCreatedIdx: index("call_notes_calls_company_created_at_idx").on(
            table.companyId,
            table.createdAt
        ),
        companyStatusIdx: index("call_notes_calls_company_status_idx").on(
            table.companyId,
            table.status
        ),
        documentNoteUnique: uniqueIndex("call_notes_calls_document_note_unique").on(
            table.documentNoteId
        ),
    })
);

export const callNotesCaptures = pgTable(
    "call_notes_captures",
    {
        id: varchar("id", { length: 64 }).primaryKey(),
        callId: varchar("call_id", { length: 64 })
            .notNull()
            .references(() => callNotesCalls.id, { onDelete: "cascade" }),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        captureUserConnectionId: varchar("capture_user_connection_id", { length: 64 })
            .notNull()
            .references(() => callNotesZoomConnections.id, { onDelete: "restrict" }),
        captureUserProviderKey: varchar("capture_user_provider_key", { length: 256 }).notNull(),
        desiredMode: varchar("desired_mode", {
            length: 16,
            enum: callNotesCaptureDesiredModeEnum,
        })
            .notNull()
            .default("running"),
        lifecycle: varchar("lifecycle", {
            length: 32,
            enum: callNotesCaptureLifecycleEnum,
        })
            .notNull()
            .default("connecting"),
        outcome: varchar("outcome", { length: 16, enum: callNotesCaptureOutcomeEnum }),
        activeAttemptId: varchar("active_attempt_id", { length: 64 }),
        startedAt: timestamp("started_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        endedAt: timestamp("ended_at", { withTimezone: true }),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => ({
        callUnique: uniqueIndex("call_notes_captures_call_unique").on(table.callId),
        companyLifecycleIdx: index("call_notes_captures_company_lifecycle_idx").on(
            table.companyId,
            table.lifecycle
        ),
    })
);

export const callNotesCaptureAttempts = pgTable(
    "call_notes_capture_attempts",
    {
        id: varchar("id", { length: 64 }).primaryKey(),
        captureId: varchar("capture_id", { length: 64 })
            .notNull()
            .references(() => callNotesCaptures.id, { onDelete: "cascade" }),
        callId: varchar("call_id", { length: 64 })
            .notNull()
            .references(() => callNotesCalls.id, { onDelete: "cascade" }),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        providerAttemptKey: varchar("provider_attempt_key", { length: 256 }).notNull(),
        providerStreamKey: varchar("provider_stream_key", { length: 256 }),
        lifecycle: varchar("lifecycle", {
            length: 24,
            enum: callNotesAttemptLifecycleEnum,
        })
            .notNull()
            .default("connecting"),
        leaseToken: varchar("lease_token", { length: 128 }),
        leaseOwner: varchar("lease_owner", { length: 256 }),
        leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
        startedAt: timestamp("started_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        endedAt: timestamp("ended_at", { withTimezone: true }),
        failureCode: varchar("failure_code", { length: 128 }),
        failureMessage: varchar("failure_message", { length: 1024 }),
    },
    table => ({
        providerAttemptUnique: uniqueIndex(
            "call_notes_capture_attempts_capture_provider_key_unique"
        ).on(table.captureId, table.providerAttemptKey),
        oneActiveAttemptUnique: uniqueIndex("call_notes_capture_attempts_one_active_unique")
            .on(table.captureId)
            .where(sql`${table.lifecycle} in ('connecting', 'live', 'reconnecting')`),
        captureStartedIdx: index("call_notes_capture_attempts_capture_started_idx").on(
            table.captureId,
            table.startedAt
        ),
        leaseIdx: index("call_notes_capture_attempts_lease_idx").on(
            table.lifecycle,
            table.leaseExpiresAt
        ),
    })
);

export const callNotesParticipants = pgTable(
    "call_notes_participants",
    {
        id: varchar("id", { length: 64 }).primaryKey(),
        callId: varchar("call_id", { length: 64 })
            .notNull()
            .references(() => callNotesCalls.id, { onDelete: "cascade" }),
        attemptId: varchar("attempt_id", { length: 64 })
            .notNull()
            .references(() => callNotesCaptureAttempts.id, { onDelete: "cascade" }),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        providerParticipantKey: varchar("provider_participant_key", { length: 256 }).notNull(),
        providerSessionKey: varchar("provider_session_key", { length: 256 }),
        displayName: varchar("display_name", { length: 512 }).notNull(),
        observedAt: timestamp("observed_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        leftAt: timestamp("left_at", { withTimezone: true }),
    },
    table => ({
        attemptParticipantIdx: index("call_notes_participants_attempt_key_idx").on(
            table.attemptId,
            table.providerParticipantKey
        ),
        callObservedIdx: index("call_notes_participants_call_observed_idx").on(
            table.callId,
            table.observedAt
        ),
    })
);

export const callNotesTranscriptSegments = pgTable(
    "call_notes_transcript_segments",
    {
        id: varchar("id", { length: 64 }).primaryKey(),
        callId: varchar("call_id", { length: 64 })
            .notNull()
            .references(() => callNotesCalls.id, { onDelete: "cascade" }),
        attemptId: varchar("attempt_id", { length: 64 })
            .notNull()
            .references(() => callNotesCaptureAttempts.id, { onDelete: "cascade" }),
        participantId: varchar("participant_id", { length: 64 }).references(
            () => callNotesParticipants.id,
            { onDelete: "set null" }
        ),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        providerEventKey: varchar("provider_event_key", { length: 256 }),
        sourcePacketHash: varchar("source_packet_hash", { length: 64 }).notNull(),
        sourceKind: varchar("source_kind", {
            length: 32,
            enum: ["provider_transcript", "derived_asr"],
        }).notNull(),
        speakerName: varchar("speaker_name", { length: 512 }),
        providerStartMs: bigint("provider_start_ms", { mode: "number" }),
        providerEndMs: bigint("provider_end_ms", { mode: "number" }),
        receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
        receiveOrder: integer("receive_order").notNull(),
        text: text("text").notNull(),
        language: varchar("language", { length: 32 }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => ({
        packetUnique: uniqueIndex("call_notes_segments_attempt_packet_unique").on(
            table.attemptId,
            table.sourcePacketHash
        ),
        callOrderIdx: index("call_notes_segments_call_order_idx").on(
            table.callId,
            table.providerStartMs,
            table.receiveOrder
        ),
        companyReceivedIdx: index("call_notes_segments_company_received_idx").on(
            table.companyId,
            table.receivedAt
        ),
    })
);

export const callNotesGaps = pgTable(
    "call_notes_gaps",
    {
        id: varchar("id", { length: 64 }).primaryKey(),
        callId: varchar("call_id", { length: 64 })
            .notNull()
            .references(() => callNotesCalls.id, { onDelete: "cascade" }),
        captureId: varchar("capture_id", { length: 64 })
            .notNull()
            .references(() => callNotesCaptures.id, { onDelete: "cascade" }),
        attemptId: varchar("attempt_id", { length: 64 }).references(
            () => callNotesCaptureAttempts.id,
            { onDelete: "set null" }
        ),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        kind: varchar("kind", { length: 32, enum: callNotesGapKindEnum }).notNull(),
        startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
        endedAt: timestamp("ended_at", { withTimezone: true }),
        details: jsonb("details").$type<Record<string, unknown> | null>(),
    },
    table => ({
        callStartedIdx: index("call_notes_gaps_call_started_idx").on(table.callId, table.startedAt),
    })
);

export const callNotesBookmarks = pgTable(
    "call_notes_bookmarks",
    {
        id: varchar("id", { length: 64 }).primaryKey(),
        callId: varchar("call_id", { length: 64 })
            .notNull()
            .references(() => callNotesCalls.id, { onDelete: "cascade" }),
        segmentId: varchar("segment_id", { length: 64 })
            .notNull()
            .references(() => callNotesTranscriptSegments.id, { onDelete: "cascade" }),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        createdByUserId: varchar("created_by_user_id", { length: 256 }).notNull(),
        comment: text("comment"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => ({
        callCreatedIdx: index("call_notes_bookmarks_call_created_idx").on(
            table.callId,
            table.createdAt
        ),
    })
);

export const callNotesEnrichmentRuns = pgTable(
    "call_notes_enrichment_runs",
    {
        id: varchar("id", { length: 64 }).primaryKey(),
        callId: varchar("call_id", { length: 64 })
            .notNull()
            .references(() => callNotesCalls.id, { onDelete: "cascade" }),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        requestedByUserId: varchar("requested_by_user_id", { length: 256 }).notNull(),
        baseNoteRevision: integer("base_note_revision").notNull(),
        transcriptFingerprint: varchar("transcript_fingerprint", { length: 64 }).notNull(),
        status: varchar("status", {
            length: 24,
            enum: callNotesEnrichmentStatusEnum,
        })
            .notNull()
            .default("queued"),
        originalOutput: jsonb("original_output").$type<EnrichedNoteProposal | null>(),
        editableProposal: jsonb("editable_proposal").$type<EnrichedNoteProposal | null>(),
        modelMetadata: jsonb("model_metadata").$type<ModelMetadata | null>(),
        errorCode: varchar("error_code", { length: 128 }),
        errorMessage: varchar("error_message", { length: 1024 }),
        resolvedByUserId: varchar("resolved_by_user_id", { length: 256 }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        generatedAt: timestamp("generated_at", { withTimezone: true }),
        resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    },
    table => ({
        callCreatedIdx: index("call_notes_enrichment_runs_call_created_idx").on(
            table.callId,
            table.createdAt
        ),
        companyStatusIdx: index("call_notes_enrichment_runs_company_status_idx").on(
            table.companyId,
            table.status
        ),
        oneActiveProposalUnique: uniqueIndex("call_notes_enrichment_runs_one_active_unique")
            .on(table.callId)
            .where(sql`${table.status} in ('queued', 'generating', 'ready')`),
    })
);

export const callNotesNoteRevisions = pgTable(
    "call_notes_note_revisions",
    {
        id: varchar("id", { length: 64 }).primaryKey(),
        callId: varchar("call_id", { length: 64 })
            .notNull()
            .references(() => callNotesCalls.id, { onDelete: "cascade" }),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        documentNoteId: bigint("document_note_id", { mode: "number" }).notNull(),
        revision: integer("revision").notNull(),
        origin: varchar("origin", { length: 24, enum: ["manual", "enrichment"] }).notNull(),
        enrichmentRunId: varchar("enrichment_run_id", { length: 64 }).references(
            () => callNotesEnrichmentRuns.id,
            { onDelete: "set null" }
        ),
        title: text("title"),
        contentMarkdown: text("content_markdown").notNull(),
        contentRich: jsonb("content_rich").$type<Record<string, unknown>>().notNull(),
        createdByUserId: varchar("created_by_user_id", { length: 256 }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => ({
        callRevisionUnique: uniqueIndex("call_notes_note_revisions_call_revision_unique").on(
            table.callId,
            table.revision
        ),
        documentNoteIdx: index("call_notes_note_revisions_document_note_idx").on(
            table.documentNoteId
        ),
    })
);

export const callNotesWorkItems = pgTable(
    "call_notes_work_items",
    {
        id: varchar("id", { length: 64 }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        callId: varchar("call_id", { length: 64 }).references(() => callNotesCalls.id, {
            onDelete: "cascade",
        }),
        captureId: varchar("capture_id", { length: 64 }).references(() => callNotesCaptures.id, {
            onDelete: "cascade",
        }),
        kind: varchar("kind", { length: 32, enum: callNotesWorkItemKindEnum }).notNull(),
        idempotencyKey: varchar("idempotency_key", { length: 256 }).notNull(),
        payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
        status: varchar("status", {
            length: 24,
            enum: callNotesWorkItemStatusEnum,
        })
            .notNull()
            .default("pending"),
        leaseToken: varchar("lease_token", { length: 128 }),
        leaseOwner: varchar("lease_owner", { length: 256 }),
        leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
        attempts: integer("attempts").notNull().default(0),
        errorCode: varchar("error_code", { length: 128 }),
        errorMessage: varchar("error_message", { length: 1024 }),
        availableAt: timestamp("available_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        completedAt: timestamp("completed_at", { withTimezone: true }),
    },
    table => ({
        idempotencyUnique: uniqueIndex("call_notes_work_items_company_kind_key_unique").on(
            table.companyId,
            table.kind,
            table.idempotencyKey
        ),
        claimIdx: index("call_notes_work_items_claim_idx").on(
            table.status,
            table.availableAt,
            table.leaseExpiresAt
        ),
        callCreatedIdx: index("call_notes_work_items_call_created_idx").on(
            table.callId,
            table.createdAt
        ),
    })
);

export type CallNotesCallRow = InferSelectModel<typeof callNotesCalls>;
export type CallNotesCaptureRow = InferSelectModel<typeof callNotesCaptures>;
export type CallNotesCaptureAttemptRow = InferSelectModel<typeof callNotesCaptureAttempts>;
export type CallNotesParticipantRow = InferSelectModel<typeof callNotesParticipants>;
export type CallNotesTranscriptSegmentRow = InferSelectModel<typeof callNotesTranscriptSegments>;
export type CallNotesGapRow = InferSelectModel<typeof callNotesGaps>;
export type CallNotesBookmarkRow = InferSelectModel<typeof callNotesBookmarks>;
export type CallNotesEnrichmentRunRow = InferSelectModel<typeof callNotesEnrichmentRuns>;
export type CallNotesNoteRevisionRow = InferSelectModel<typeof callNotesNoteRevisions>;
export type CallNotesWorkItemRow = InferSelectModel<typeof callNotesWorkItems>;
export type CallNotesZoomConnectionRow = InferSelectModel<typeof callNotesZoomConnections>;
