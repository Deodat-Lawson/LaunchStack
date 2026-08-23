import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";

import type { DbClient } from "@launchstack/core/db";

import {
    CALL_NOTES_SCHEMA_VERSION,
    CallListQuerySchema,
    CallNotesCommandSchema,
    CallQuerySchema,
    CallSnapshotSchema,
    CaptureEventSchema,
    CompleteEnrichmentInputSchema,
    DetectedCallCandidateSchema,
    TranscriptSearchQuerySchema,
    type Bookmark,
    type CallListQuery,
    type CallNotesCommand,
    type CallQuery,
    type CallSnapshot,
    type CallStatus,
    type CaptureEvent,
    type CompleteEnrichmentInput,
    type DetectedCallCandidate,
    type EnrichmentInput,
    type EnrichmentResult,
    type Gap,
    type GapKind,
    type KnowledgeNote,
    type NoteVisibility,
    type ParticipantIdentity,
    type TranscriptSearchQuery,
    type TranscriptSegment,
} from "./contracts";
import type {
    CallNotesApplication,
    CallNotesClock,
    CallNotesIdSource,
    KnowledgeNoteSink,
} from "./ports";
import {
    callNotesBookmarks,
    callNotesCalls,
    callNotesCaptureAttempts,
    callNotesCaptures,
    callNotesEnrichmentRuns,
    callNotesGaps,
    callNotesNoteRevisions,
    callNotesParticipants,
    callNotesTranscriptSegments,
    callNotesWorkItems,
    callNotesZoomConnections,
    type CallNotesBookmarkRow,
    type CallNotesCallRow,
    type CallNotesCaptureRow,
    type CallNotesGapRow,
    type CallNotesParticipantRow,
    type CallNotesTranscriptSegmentRow,
} from "./schema";
import { CallNotesWorkItems, type CallNotesWorkItemKind } from "./work-items";

export type CallNotesMembershipRole = "owner" | "admin" | "editor";

export interface CallNotesMembershipStore {
    getRole(companyId: string, actorUserId: string): Promise<CallNotesMembershipRole | null>;
}

export interface CallNotesDocumentNoteRecord {
    id: number;
    title: string;
    contentMarkdown: string;
    contentRich: Record<string, unknown>;
}

export interface CallNotesDocumentNoteInput {
    companyId: string;
    userId: string;
    title: string;
    contentMarkdown: string;
    contentRich: Record<string, unknown>;
}

export interface CallNotesDocumentNoteUpdate {
    title: string;
    contentMarkdown: string;
    contentRich: Record<string, unknown>;
}

export type CallNotesDocumentNoteExecutor = Pick<
    DbClient,
    "select" | "insert" | "update" | "delete"
>;

export interface CallNotesDocumentNoteStore {
    create(
        input: CallNotesDocumentNoteInput,
        executor?: CallNotesDocumentNoteExecutor
    ): Promise<CallNotesDocumentNoteRecord>;
    get(
        id: number,
        executor?: CallNotesDocumentNoteExecutor
    ): Promise<CallNotesDocumentNoteRecord | null>;
    update(
        id: number,
        input: CallNotesDocumentNoteUpdate,
        executor?: CallNotesDocumentNoteExecutor
    ): Promise<CallNotesDocumentNoteRecord>;
    delete(id: number, executor?: CallNotesDocumentNoteExecutor): Promise<void>;
}

export interface DetectedCallSource {
    list(query: CallListQuery): Promise<readonly DetectedCallCandidate[]>;
}

export type CallNotesApplicationErrorCode =
    | "not_found"
    | "forbidden"
    | "conflict"
    | "invalid_transition"
    | "unavailable";

export class CallNotesApplicationError extends Error {
    readonly code: CallNotesApplicationErrorCode;

    constructor(code: CallNotesApplicationErrorCode, message: string) {
        super(message);
        this.name = "CallNotesApplicationError";
        this.code = code;
    }
}

export interface CallNotesApplicationOptions {
    db: DbClient;
    memberships: CallNotesMembershipStore;
    documentNotes: CallNotesDocumentNoteStore;
    knowledgeSink: KnowledgeNoteSink;
    detectedCalls: DetectedCallSource;
    clock?: CallNotesClock;
    ids?: CallNotesIdSource;
    callDeepLink?: (companyId: string, callId: string) => string;
}
type ParticipantCaptureEvent = Exclude<
    Extract<CaptureEvent, { participant: ParticipantIdentity }>,
    Extract<CaptureEvent, { kind: "transcript_segment" }>
>;

const defaultClock: CallNotesClock = { now: () => new Date() };
const defaultIds: CallNotesIdSource = {
    next(prefix: string) {
        return `${prefix}_${randomUUID().replace(/-/g, "")}`;
    },
};

const EMPTY_RICH_TEXT: Record<string, unknown> = { type: "doc", content: [] };

function companyNumber(companyId: string): bigint {
    if (!/^\d+$/.test(companyId)) {
        throw new CallNotesApplicationError(
            "invalid_transition",
            `Invalid company id ${companyId}`
        );
    }
    return BigInt(companyId);
}

function asDate(value: Date | string): Date {
    return value instanceof Date ? value : new Date(value);
}

function iso(value: Date | string): string {
    return asDate(value).toISOString();
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isApplicationError(error: unknown): error is CallNotesApplicationError {
    return error instanceof CallNotesApplicationError;
}

function providerTime(value: number | null): number {
    return value === null ? Number.POSITIVE_INFINITY : value;
}

function sortTranscriptRows<
    T extends {
        providerStartMs: number | null;
        receiveOrder: number;
        receivedAt: Date;
        id: string;
    },
>(rows: T[]): T[] {
    return rows.sort((left, right) => {
        const start = providerTime(left.providerStartMs) - providerTime(right.providerStartMs);
        if (start !== 0) return start;
        if (left.receiveOrder !== right.receiveOrder) return left.receiveOrder - right.receiveOrder;
        const received = asDate(left.receivedAt).getTime() - asDate(right.receivedAt).getTime();
        if (received !== 0) return received;
        return left.id.localeCompare(right.id);
    });
}

function normalizeNote(record: CallNotesDocumentNoteRecord): CallNotesDocumentNoteRecord {
    if (!Number.isInteger(record.id) || record.id <= 0) {
        throw new CallNotesApplicationError(
            "unavailable",
            "Document note adapter returned an invalid id"
        );
    }
    return {
        id: record.id,
        title: record.title ?? "",
        contentMarkdown: record.contentMarkdown ?? "",
        contentRich: record.contentRich ?? {},
    };
}

function toTranscriptSegments(
    rows: readonly CallNotesTranscriptSegmentRow[],
    participants: readonly CallNotesParticipantRow[]
): TranscriptSegment[] {
    const participantById = new Map(
        participants.map(participant => [participant.id, participant] as const)
    );
    return sortTranscriptRows([...rows]).map(row => {
        const participant = row.participantId ? participantById.get(row.participantId) : undefined;
        return {
            id: row.id,
            attemptId: row.attemptId,
            participantId: row.participantId,
            speakerName: row.speakerName ?? participant?.displayName ?? null,
            providerStartMs: row.providerStartMs ?? null,
            providerEndMs: row.providerEndMs ?? null,
            receivedAt: iso(row.receivedAt),
            receiveOrder: row.receiveOrder,
            text: row.text,
            language: row.language ?? null,
        };
    });
}

function toGaps(rows: readonly CallNotesGapRow[]): Gap[] {
    return rows.map(gap => ({
        id: gap.id,
        attemptId: gap.attemptId,
        kind: gap.kind,
        startedAt: iso(gap.startedAt),
        endedAt: gap.endedAt ? iso(gap.endedAt) : null,
    }));
}

function toBookmarks(rows: readonly CallNotesBookmarkRow[]): Bookmark[] {
    return rows.map(bookmark => ({
        id: bookmark.id,
        segmentId: bookmark.segmentId,
        comment: bookmark.comment,
        createdAt: iso(bookmark.createdAt),
    }));
}

function toCallNote(
    call: Pick<
        CallNotesCallRow,
        | "documentNoteId"
        | "noteOwnerUserId"
        | "noteVisibility"
        | "knowledgeIncluded"
        | "currentNoteRevision"
    >,
    record: CallNotesDocumentNoteRecord
): NonNullable<CallSnapshot["note"]> {
    const normalized = normalizeNote(record);
    return {
        documentNoteId: normalized.id,
        ownerUserId: call.noteOwnerUserId,
        visibility: call.noteVisibility as NoteVisibility,
        knowledgeIncluded: call.knowledgeIncluded,
        revision: call.currentNoteRevision,
        title: normalized.title,
        contentMarkdown: normalized.contentMarkdown,
        contentRich: normalized.contentRich,
        saveState: "saved",
    };
}

type EnrichmentFingerprintInput = Pick<
    EnrichmentInput,
    "transcript" | "gaps" | "bookmarks" | "note"
>;

function enrichmentFingerprint(input: EnrichmentFingerprintInput): string {
    return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function commandWorkKind(command: CallNotesCommand): CallNotesWorkItemKind {
    switch (command.kind) {
        case "start_capture":
        case "dismiss_detected_occurrence":
            return "start";
        case "pause_capture":
            return "pause";
        case "resume_capture":
            return "resume";
        case "request_enrichment":
        case "reject_enrichment":
        case "accept_enrichment":
            return "enrich";
        case "set_knowledge_inclusion":
            return "reindex";
        default:
            return "finalize";
    }
}

function commandCallId(command: CallNotesCommand): string | null {
    return "callId" in command ? command.callId : null;
}

function isActiveAttemptLifecycle(value: string): boolean {
    return value === "connecting" || value === "live" || value === "reconnecting";
}

/** PostgreSQL-backed Call Notes policy, state machine, and snapshot boundary. */
export class PostgresCallNotesApplication implements CallNotesApplication {
    private readonly clock: CallNotesClock;
    private readonly ids: CallNotesIdSource;
    private readonly workItems: CallNotesWorkItems;
    private readonly deepLink: (companyId: string, callId: string) => string;

    constructor(private readonly options: CallNotesApplicationOptions) {
        this.clock = options.clock ?? defaultClock;
        this.ids = options.ids ?? defaultIds;
        this.workItems = new CallNotesWorkItems(options.db, {
            clock: this.clock,
            ids: this.ids,
        });
        this.deepLink =
            options.callDeepLink ??
            ((companyId, callId) => `/companies/${companyId}/call-notes/${callId}`);
    }

    async execute(command: CallNotesCommand): Promise<CallSnapshot | null> {
        const parsed = CallNotesCommandSchema.parse(command);
        await this.requireMembership(parsed.companyId, parsed.actorUserId);
        const kind = commandWorkKind(parsed);
        const key =
            parsed.kind === "dismiss_detected_occurrence"
                ? `dismiss:${parsed.actorUserId}:${parsed.provider}:${parsed.occurrenceKey}`
                : parsed.requestId;
        const receipt = await this.workItems.enqueue({
            companyId: parsed.companyId,
            callId: parsed.kind === "delete_call" ? null : commandCallId(parsed),
            kind,
            idempotencyKey: key,
            payload: { command: parsed },
        });
        if (receipt.status === "completed") {
            const resultActorUserId =
                typeof receipt.payload.resultActorUserId === "string"
                    ? receipt.payload.resultActorUserId
                    : null;
            if (resultActorUserId !== parsed.actorUserId) {
                throw new CallNotesApplicationError(
                    "forbidden",
                    "A completed Call Notes receipt belongs to another actor"
                );
            }
            const resultCallId = receipt.payload.resultCallId;
            if (typeof resultCallId === "string") {
                await this.requireCallAccess(parsed.companyId, parsed.actorUserId, resultCallId);
            }
            return this.resultFromReceipt(receipt.payload, parsed.actorUserId);
        }
        if (commandCallId(parsed)) {
            await this.requireCallAccess(
                parsed.companyId,
                parsed.actorUserId,
                commandCallId(parsed)!
            );
        }
        if (receipt.status === "failed") await this.workItems.reopenReceipt(receipt.id);

        try {
            let result: CallSnapshot | null;
            const retried = await this.retryCommittedReindex(parsed);
            if (retried !== undefined) {
                result = retried;
            } else {
                switch (parsed.kind) {
                    case "start_capture":
                        result = await this.startCapture(parsed);
                        break;
                    case "dismiss_detected_occurrence":
                        result = null;
                        break;
                    case "pause_capture":
                        result = await this.controlCapture(parsed, "paused");
                        break;
                    case "resume_capture":
                        result = await this.controlCapture(parsed, "running");
                        break;
                    case "update_note":
                        result = await this.updateNote(parsed);
                        break;
                    case "add_bookmark":
                        result = await this.addBookmark(parsed);
                        break;
                    case "set_note_visibility":
                        result = await this.setNoteVisibility(parsed);
                        break;
                    case "request_enrichment":
                        result = await this.requestEnrichment(parsed);
                        break;
                    case "reject_enrichment":
                        result = await this.rejectEnrichment(parsed);
                        break;
                    case "accept_enrichment":
                        result = await this.acceptEnrichment(parsed);
                        break;
                    case "set_knowledge_inclusion":
                        result = await this.setKnowledgeInclusion(parsed);
                        break;
                    case "delete_call":
                        result = await this.deleteCall(parsed);
                        break;
                    default:
                        throw new CallNotesApplicationError(
                            "invalid_transition",
                            "Unsupported Call Notes command"
                        );
                }
            }
            await this.workItems.completeReceipt(receipt.id, {
                resultCallId: result?.id ?? null,
                resultActorUserId: parsed.actorUserId,
            });
            return result;
        } catch (error) {
            await this.markReceiptFailed(receipt.id, error);
            throw error;
        }
    }

    async ingestCaptureEvent(companyId: string, event: CaptureEvent): Promise<void> {
        const parsed = CaptureEventSchema.parse(event);
        const company = companyNumber(companyId);
        const receipt = await this.workItems.enqueue({
            companyId,
            kind: "provider_event",
            idempotencyKey: parsed.eventId,
            payload: { event: parsed },
        });
        if (receipt.status === "completed") return;
        if (receipt.status === "failed") await this.workItems.reopenReceipt(receipt.id);
        const claim = await this.workItems.claimById(
            receipt.id,
            this.ids.next(`provider_event_${parsed.eventId}`),
            {
                companyId,
                kind: "provider_event",
                leaseMs: 5 * 60_000,
            }
        );
        if (!claim) return;
        try {
            const [call] = await this.options.db
                .select()
                .from(callNotesCalls)
                .where(
                    and(
                        eq(callNotesCalls.companyId, company),
                        eq(callNotesCalls.provider, parsed.provider),
                        eq(callNotesCalls.providerOccurrenceKey, parsed.occurrenceKey)
                    )
                )
                .limit(1);
            if (!call) {
                throw new CallNotesApplicationError("not_found", "Call occurrence not found");
            }
            await this.applyCaptureEvent(call.id, company, parsed);
            await this.workItems.complete(claim.id, claim.leaseToken);
        } catch (error) {
            try {
                await this.workItems.fail(claim.id, claim.leaseToken, {
                    code: isApplicationError(error) ? error.code : "unavailable",
                    message: errorMessage(error).slice(0, 1024),
                });
            } catch {
                // A stale claimant cannot overwrite a newer retry.
            }
            throw error;
        }
    }

    async completeEnrichment(input: CompleteEnrichmentInput): Promise<void> {
        const parsed = CompleteEnrichmentInputSchema.parse(input);
        const company = companyNumber(parsed.companyId);
        const result = parsed.result as EnrichmentResult;
        const [call] = await this.options.db
            .select()
            .from(callNotesCalls)
            .where(and(eq(callNotesCalls.id, parsed.callId), eq(callNotesCalls.companyId, company)))
            .limit(1);
        if (!call) throw new CallNotesApplicationError("not_found", "Call not found");
        const [run] = await this.options.db
            .select()
            .from(callNotesEnrichmentRuns)
            .where(
                and(
                    eq(callNotesEnrichmentRuns.id, parsed.enrichmentRunId),
                    eq(callNotesEnrichmentRuns.callId, parsed.callId),
                    eq(callNotesEnrichmentRuns.companyId, company)
                )
            )
            .limit(1);
        if (!run) throw new CallNotesApplicationError("not_found", "Enrichment run not found");
        if (run.status === "accepted" || run.status === "rejected" || run.status === "ready")
            return;
        try {
            await this.options.db
                .update(callNotesEnrichmentRuns)
                .set({
                    status: "ready",
                    originalOutput: result.proposal,
                    editableProposal: result.proposal,
                    modelMetadata: result.modelMetadata,
                    generatedAt: this.clock.now(),
                    errorCode: null,
                    errorMessage: null,
                })
                .where(eq(callNotesEnrichmentRuns.id, parsed.enrichmentRunId));
        } catch (error) {
            throw new CallNotesApplicationError(
                "unavailable",
                `Unable to complete enrichment: ${errorMessage(error)}`
            );
        }
    }
    async getCall(query: CallQuery): Promise<CallSnapshot> {
        const parsed = CallQuerySchema.parse(query);
        const [call] = await this.options.db
            .select()
            .from(callNotesCalls)
            .where(
                and(
                    eq(callNotesCalls.id, parsed.callId),
                    eq(callNotesCalls.companyId, companyNumber(parsed.companyId))
                )
            )
            .limit(1);
        if (!call) throw new CallNotesApplicationError("not_found", "Call not found");
        await this.requireMembership(parsed.companyId, parsed.actorUserId);
        return this.snapshot(call.id, parsed.actorUserId);
    }

    async listCalls(query: CallListQuery): Promise<readonly CallSnapshot[]> {
        const parsed = CallListQuerySchema.parse(query);
        await this.requireMembership(parsed.companyId, parsed.actorUserId);
        const rows = await this.options.db
            .select({ id: callNotesCalls.id })
            .from(callNotesCalls)
            .where(eq(callNotesCalls.companyId, companyNumber(parsed.companyId)))
            .orderBy(desc(callNotesCalls.createdAt), desc(callNotesCalls.id))
            .limit(parsed.limit);
        const snapshots: CallSnapshot[] = [];
        for (const row of rows) snapshots.push(await this.snapshot(row.id, parsed.actorUserId));
        return snapshots;
    }

    async listDetectedCalls(query: CallListQuery): Promise<readonly DetectedCallCandidate[]> {
        const parsed = CallListQuerySchema.parse(query);
        await this.requireMembership(parsed.companyId, parsed.actorUserId);
        let candidates: readonly DetectedCallCandidate[];
        try {
            candidates = await this.options.detectedCalls.list(parsed);
        } catch (error) {
            throw new CallNotesApplicationError(
                "unavailable",
                `Detected calls unavailable: ${errorMessage(error)}`
            );
        }
        const output: DetectedCallCandidate[] = [];
        for (const candidate of candidates) {
            const parsedCandidate = DetectedCallCandidateSchema.parse(candidate);
            const [dismissed] = await this.options.db
                .select({ id: callNotesWorkItems.id })
                .from(callNotesWorkItems)
                .where(
                    and(
                        eq(callNotesWorkItems.companyId, companyNumber(parsed.companyId)),
                        eq(callNotesWorkItems.kind, "start"),
                        eq(
                            callNotesWorkItems.idempotencyKey,
                            `dismiss:${parsed.actorUserId}:${parsedCandidate.provider}:${parsedCandidate.occurrenceKey}`
                        ),
                        eq(callNotesWorkItems.status, "completed")
                    )
                )
                .limit(1);
            if (!dismissed) output.push(Object.freeze(parsedCandidate));
            if (output.length >= parsed.limit) break;
        }
        return output;
    }

    async searchTranscript(query: TranscriptSearchQuery): Promise<readonly TranscriptSegment[]> {
        const parsed = TranscriptSearchQuerySchema.parse(query);
        const call = await this.getCall(parsed);
        const needle = parsed.query.toLocaleLowerCase();
        return call.transcript.filter(segment => segment.text.toLocaleLowerCase().includes(needle));
    }

    private async requireMembership(
        companyId: string,
        actorUserId: string
    ): Promise<CallNotesMembershipRole> {
        let role: CallNotesMembershipRole | null;
        try {
            role = await this.options.memberships.getRole(companyId, actorUserId);
        } catch (error) {
            throw new CallNotesApplicationError(
                "unavailable",
                `Membership unavailable: ${errorMessage(error)}`
            );
        }
        if (!role)
            throw new CallNotesApplicationError("forbidden", "Company membership is required");
        return role;
    }

    private async requireCallAccess(
        companyId: string,
        actorUserId: string,
        callId: string
    ): Promise<CallNotesMembershipRole> {
        const [call] = await this.options.db
            .select({ id: callNotesCalls.id })
            .from(callNotesCalls)
            .where(
                and(
                    eq(callNotesCalls.id, callId),
                    eq(callNotesCalls.companyId, companyNumber(companyId))
                )
            )
            .limit(1);
        if (!call) throw new CallNotesApplicationError("not_found", "Call not found");
        return this.requireMembership(companyId, actorUserId);
    }

    private async resultFromReceipt(
        payload: Record<string, unknown>,
        actorUserId: string
    ): Promise<CallSnapshot | null> {
        const resultCallId = payload.resultCallId;
        if (typeof resultCallId !== "string") return null;
        return this.snapshot(resultCallId, actorUserId);
    }

    private async markReceiptFailed(id: string, error: unknown): Promise<void> {
        try {
            await this.options.db
                .update(callNotesWorkItems)
                .set({
                    status: "failed",
                    errorCode: isApplicationError(error) ? error.code : "unavailable",
                    errorMessage: errorMessage(error).slice(0, 1024),
                })
                .where(eq(callNotesWorkItems.id, id));
        } catch {
            // Preserve the domain error; the durable receipt can be retried by a worker.
        }
    }
    private async retryCommittedReindex(
        command: CallNotesCommand
    ): Promise<CallSnapshot | null | undefined> {
        if (command.kind !== "update_note" && command.kind !== "accept_enrichment") {
            return undefined;
        }
        let callId: string = command.callId;
        let revision: number | null = null;
        if (command.kind === "update_note") {
            revision = command.baseRevision + 1;
        } else {
            const [run] = await this.options.db
                .select({ baseNoteRevision: callNotesEnrichmentRuns.baseNoteRevision })
                .from(callNotesEnrichmentRuns)
                .where(
                    and(
                        eq(callNotesEnrichmentRuns.id, command.enrichmentRunId),
                        eq(callNotesEnrichmentRuns.callId, command.callId),
                        eq(callNotesEnrichmentRuns.companyId, companyNumber(command.companyId))
                    )
                )
                .limit(1);
            revision = run ? run.baseNoteRevision + 1 : null;
        }
        if (revision === null) return undefined;
        const company = companyNumber(command.companyId);
        const [revisionRow] = await this.options.db
            .select()
            .from(callNotesNoteRevisions)
            .where(
                and(
                    eq(callNotesNoteRevisions.callId, callId),
                    eq(callNotesNoteRevisions.companyId, company),
                    eq(callNotesNoteRevisions.revision, revision)
                )
            )
            .limit(1);
        if (!revisionRow) return undefined;
        const sameContent =
            revisionRow.contentMarkdown === command.contentMarkdown &&
            JSON.stringify(revisionRow.contentRich) === JSON.stringify(command.contentRich);
        const matchesCommand =
            revisionRow.createdByUserId === command.actorUserId &&
            sameContent &&
            (command.kind === "update_note"
                ? revisionRow.origin === "manual" && revisionRow.title === command.title
                : revisionRow.origin === "enrichment" &&
                  revisionRow.enrichmentRunId === command.enrichmentRunId);
        if (!matchesCommand) return undefined;
        const [work] = await this.options.db
            .select()
            .from(callNotesWorkItems)
            .where(
                and(
                    eq(callNotesWorkItems.companyId, companyNumber(command.companyId)),
                    eq(callNotesWorkItems.kind, "reindex"),
                    eq(callNotesWorkItems.idempotencyKey, `reindex:${callId}:${revision}`)
                )
            )
            .limit(1);
        if (!work) return undefined;
        await this.processReindexWorkItem(work.id);
        return this.snapshot(callId, command.actorUserId);
    }

    private async processReindexWorkItem(id: string): Promise<void> {
        let work = await this.workItems.get(id);
        if (!work || work.status === "completed") return;
        if (work.status === "failed") work = await this.workItems.reopenReceipt(id);
        const claim = await this.workItems.claimById(id, this.ids.next("reindex_worker"), {
            kind: "reindex",
            leaseMs: 5 * 60_000,
        });
        if (!claim) {
            const current = await this.workItems.get(id);
            if (current?.status === "completed") return;
            throw new CallNotesApplicationError(
                "unavailable",
                "Knowledge reindex is already being processed"
            );
        }
        try {
            const callId =
                typeof claim.payload.callId === "string" ? claim.payload.callId : claim.callId;
            const revision =
                typeof claim.payload.revision === "number" ? claim.payload.revision : null;
            if (!callId || revision === null) {
                throw new CallNotesApplicationError(
                    "invalid_transition",
                    "Reindex work item is missing its Call revision"
                );
            }
            const [call] = await this.options.db
                .select()
                .from(callNotesCalls)
                .where(eq(callNotesCalls.id, callId))
                .limit(1);
            if (!call) {
                await this.workItems.complete(claim.id, claim.leaseToken);
                return;
            }
            if (call.currentNoteRevision > revision) {
                await this.workItems.complete(claim.id, claim.leaseToken);
                return;
            }
            if (call.noteVisibility === "private" || !call.knowledgeIncluded) {
                try {
                    await this.options.knowledgeSink.remove(call.companyId.toString(), callId);
                } catch (error) {
                    throw new CallNotesApplicationError(
                        "unavailable",
                        `Unable to remove knowledge Note: ${errorMessage(error)}`
                    );
                }
            } else {
                const [revisionRow] = await this.options.db
                    .select()
                    .from(callNotesNoteRevisions)
                    .where(
                        and(
                            eq(callNotesNoteRevisions.callId, callId),
                            eq(callNotesNoteRevisions.revision, revision)
                        )
                    )
                    .limit(1);
                if (!revisionRow) {
                    throw new CallNotesApplicationError(
                        "unavailable",
                        "Committed Call Note revision is missing"
                    );
                }
                await this.upsertKnowledge(
                    call.companyId.toString(),
                    callId,
                    call,
                    normalizeNote({
                        id: revisionRow.documentNoteId,
                        title: revisionRow.title ?? call.title,
                        contentMarkdown: revisionRow.contentMarkdown,
                        contentRich: revisionRow.contentRich,
                    }),
                    revision
                );
            }
            await this.workItems.complete(claim.id, claim.leaseToken);
        } catch (error) {
            try {
                await this.workItems.fail(claim.id, claim.leaseToken, {
                    code: isApplicationError(error) ? error.code : "unavailable",
                    message: errorMessage(error).slice(0, 1024),
                });
            } catch {
                // Preserve the operation error if this lease was fenced.
            }
            throw error;
        }
    }

    private async startCapture(
        command: Extract<CallNotesCommand, { kind: "start_capture" }>
    ): Promise<CallSnapshot> {
        const company = companyNumber(command.companyId);
        const [connection] = await this.options.db
            .select({
                id: callNotesZoomConnections.id,
                zoomUserId: callNotesZoomConnections.zoomUserId,
            })
            .from(callNotesZoomConnections)
            .where(
                and(
                    eq(callNotesZoomConnections.id, command.authorizationRef),
                    eq(callNotesZoomConnections.companyId, company),
                    eq(callNotesZoomConnections.userId, command.actorUserId),
                    eq(callNotesZoomConnections.status, "active")
                )
            )
            .limit(1);
        if (!connection) {
            throw new CallNotesApplicationError(
                "forbidden",
                "Authorization is not an active company Zoom connection"
            );
        }
        const [existing] = await this.options.db
            .select()
            .from(callNotesCalls)
            .where(
                and(
                    eq(callNotesCalls.companyId, company),
                    eq(callNotesCalls.provider, command.provider),
                    eq(callNotesCalls.providerOccurrenceKey, command.occurrenceKey)
                )
            )
            .limit(1);
        if (existing) return this.snapshot(existing.id, command.actorUserId);

        const title = command.title ?? "Zoom call";
        let documentNote: CallNotesDocumentNoteRecord;
        try {
            documentNote = normalizeNote(
                await this.options.documentNotes.create({
                    companyId: command.companyId,
                    userId: command.actorUserId,
                    title,
                    contentMarkdown: "",
                    contentRich: { ...EMPTY_RICH_TEXT },
                })
            );
        } catch (error) {
            throw new CallNotesApplicationError(
                "unavailable",
                `Unable to create Call Note: ${errorMessage(error)}`
            );
        }

        const callId = this.ids.next("call");
        const captureId = this.ids.next("capture");
        const now = this.clock.now();
        try {
            await this.options.db.transaction(async tx => {
                await tx.insert(callNotesCalls).values({
                    id: callId,
                    companyId: company,
                    provider: command.provider,
                    providerOccurrenceKey: command.occurrenceKey,
                    title,
                    status: "active",
                    documentNoteId: documentNote.id,
                    noteOwnerUserId: command.actorUserId,
                    noteVisibility: "company",
                    knowledgeIncluded: false,
                    currentNoteRevision: 0,
                    startedAt: now,
                    createdAt: now,
                    updatedAt: now,
                });
                await tx.insert(callNotesCaptures).values({
                    id: captureId,
                    callId,
                    companyId: company,
                    captureUserConnectionId: connection.id,
                    captureUserProviderKey: connection.zoomUserId,
                    desiredMode: "running",
                    lifecycle: "connecting",
                    startedAt: now,
                    updatedAt: now,
                });
                await tx.insert(callNotesNoteRevisions).values({
                    id: this.ids.next("note_revision"),
                    callId,
                    companyId: company,
                    documentNoteId: documentNote.id,
                    revision: 0,
                    origin: "manual",
                    enrichmentRunId: null,
                    title,
                    contentMarkdown: "",
                    contentRich: { ...EMPTY_RICH_TEXT },
                    createdByUserId: command.actorUserId,
                    createdAt: now,
                });
            });
        } catch (error) {
            try {
                await this.options.documentNotes.delete(documentNote.id);
            } catch {
                // Preserve the original Call transaction failure.
            }
            const [converged] = await this.options.db
                .select()
                .from(callNotesCalls)
                .where(
                    and(
                        eq(callNotesCalls.companyId, company),
                        eq(callNotesCalls.provider, command.provider),
                        eq(callNotesCalls.providerOccurrenceKey, command.occurrenceKey)
                    )
                )
                .limit(1);
            if (converged) return this.snapshot(converged.id, command.actorUserId);
            throw new CallNotesApplicationError(
                "unavailable",
                `Unable to persist Call: ${errorMessage(error)}`
            );
        }
        return this.snapshot(callId, command.actorUserId);
    }

    private async controlCapture(
        command: Extract<CallNotesCommand, { kind: "pause_capture" | "resume_capture" }>,
        desiredMode: "paused" | "running"
    ): Promise<CallSnapshot> {
        const company = companyNumber(command.companyId);
        const [capture] = await this.options.db
            .select()
            .from(callNotesCaptures)
            .where(
                and(
                    eq(callNotesCaptures.callId, command.callId),
                    eq(callNotesCaptures.companyId, company)
                )
            )
            .limit(1);
        if (!capture) throw new CallNotesApplicationError("not_found", "Capture not found");
        if (capture.lifecycle === "completed" || capture.lifecycle === "failed") {
            throw new CallNotesApplicationError("invalid_transition", "Capture has already ended");
        }
        await this.options.db
            .update(callNotesCaptures)
            .set({ desiredMode, updatedAt: this.clock.now() })
            .where(eq(callNotesCaptures.id, capture.id));
        return this.snapshot(command.callId, command.actorUserId);
    }

    private async updateNote(
        command: Extract<CallNotesCommand, { kind: "update_note" }>
    ): Promise<CallSnapshot> {
        const company = companyNumber(command.companyId);
        const committed = await this.options.db.transaction(async tx => {
            const executor = tx as unknown as CallNotesDocumentNoteExecutor;
            const [call] = await tx
                .select()
                .from(callNotesCalls)
                .where(
                    and(
                        eq(callNotesCalls.id, command.callId),
                        eq(callNotesCalls.companyId, company)
                    )
                )
                .for("update")
                .limit(1);
            if (!call) throw new CallNotesApplicationError("not_found", "Call not found");
            if (call.noteOwnerUserId !== command.actorUserId) {
                throw new CallNotesApplicationError(
                    "forbidden",
                    "Only the Call Note owner may edit it"
                );
            }
            if (call.documentNoteId === null)
                throw new CallNotesApplicationError("invalid_transition", "Call has no Note");
            if (call.currentNoteRevision !== command.baseRevision) {
                throw new CallNotesApplicationError("conflict", "Call Note revision is stale");
            }
            let updatedNote: CallNotesDocumentNoteRecord;
            try {
                const existing = await this.options.documentNotes.get(
                    call.documentNoteId,
                    executor
                );
                if (!existing)
                    throw new CallNotesApplicationError("not_found", "Document Note not found");
                updatedNote = normalizeNote(
                    await this.options.documentNotes.update(
                        call.documentNoteId,
                        {
                            title: command.title,
                            contentMarkdown: command.contentMarkdown,
                            contentRich: command.contentRich,
                        },
                        executor
                    )
                );
            } catch (error) {
                if (isApplicationError(error)) throw error;
                throw new CallNotesApplicationError(
                    "unavailable",
                    `Unable to update Call Note: ${errorMessage(error)}`
                );
            }
            const revision = command.baseRevision + 1;
            const now = this.clock.now();
            const [updated] = await tx
                .update(callNotesCalls)
                .set({ currentNoteRevision: revision, updatedAt: now })
                .where(
                    and(
                        eq(callNotesCalls.id, command.callId),
                        eq(callNotesCalls.companyId, company),
                        eq(callNotesCalls.currentNoteRevision, command.baseRevision)
                    )
                )
                .returning();
            if (!updated)
                throw new CallNotesApplicationError("conflict", "Call Note revision is stale");
            await tx.insert(callNotesNoteRevisions).values({
                id: this.ids.next("note_revision"),
                callId: command.callId,
                companyId: company,
                documentNoteId: call.documentNoteId,
                revision,
                origin: "manual",
                enrichmentRunId: null,
                title: command.title,
                contentMarkdown: command.contentMarkdown,
                contentRich: command.contentRich,
                createdByUserId: command.actorUserId,
                createdAt: now,
            });
            const reindex =
                call.knowledgeIncluded && call.noteVisibility === "company"
                    ? await this.workItems.enqueue(
                          {
                              companyId: command.companyId,
                              callId: command.callId,
                              kind: "reindex",
                              idempotencyKey: `reindex:${command.callId}:${revision}`,
                              payload: {
                                  callId: command.callId,
                                  revision,
                              },
                          },
                          tx as unknown as DbClient
                      )
                    : null;
            return { call: updated, note: updatedNote, revision, reindexId: reindex?.id ?? null };
        });
        if (committed.reindexId) await this.processReindexWorkItem(committed.reindexId);
        return this.snapshot(command.callId, command.actorUserId);
    }

    private async addBookmark(
        command: Extract<CallNotesCommand, { kind: "add_bookmark" }>
    ): Promise<CallSnapshot> {
        const company = companyNumber(command.companyId);
        const [call] = await this.options.db
            .select({ noteOwnerUserId: callNotesCalls.noteOwnerUserId })
            .from(callNotesCalls)
            .where(
                and(eq(callNotesCalls.id, command.callId), eq(callNotesCalls.companyId, company))
            )
            .limit(1);
        if (!call) throw new CallNotesApplicationError("not_found", "Call not found");
        if (call.noteOwnerUserId !== command.actorUserId) {
            throw new CallNotesApplicationError(
                "forbidden",
                "Only the Call Note owner may add bookmarks"
            );
        }
        const [segment] = await this.options.db
            .select({ id: callNotesTranscriptSegments.id })
            .from(callNotesTranscriptSegments)
            .where(
                and(
                    eq(callNotesTranscriptSegments.id, command.segmentId),
                    eq(callNotesTranscriptSegments.callId, command.callId),
                    eq(callNotesTranscriptSegments.companyId, company)
                )
            )
            .limit(1);
        if (!segment)
            throw new CallNotesApplicationError("not_found", "Transcript segment not found");
        await this.options.db.insert(callNotesBookmarks).values({
            id: this.ids.next("bookmark"),
            callId: command.callId,
            segmentId: command.segmentId,
            companyId: company,
            createdByUserId: command.actorUserId,
            comment: command.comment,
            createdAt: this.clock.now(),
        });
        return this.snapshot(command.callId, command.actorUserId);
    }

    private async setNoteVisibility(
        command: Extract<CallNotesCommand, { kind: "set_note_visibility" }>
    ): Promise<CallSnapshot> {
        const company = companyNumber(command.companyId);
        const [call] = await this.options.db
            .select()
            .from(callNotesCalls)
            .where(
                and(eq(callNotesCalls.id, command.callId), eq(callNotesCalls.companyId, company))
            )
            .limit(1);
        if (!call) throw new CallNotesApplicationError("not_found", "Call not found");
        if (call.noteOwnerUserId !== command.actorUserId) {
            throw new CallNotesApplicationError(
                "forbidden",
                "Only the Call Note owner may change visibility"
            );
        }
        await this.options.db
            .update(callNotesCalls)
            .set({
                noteVisibility: command.visibility,
                knowledgeIncluded:
                    command.visibility === "private" ? false : call.knowledgeIncluded,
                updatedAt: this.clock.now(),
            })
            .where(
                and(eq(callNotesCalls.id, command.callId), eq(callNotesCalls.companyId, company))
            );
        if (command.visibility === "private") {
            try {
                await this.options.knowledgeSink.remove(command.companyId, command.callId);
            } catch (error) {
                throw new CallNotesApplicationError(
                    "unavailable",
                    `Unable to remove knowledge Note: ${errorMessage(error)}`
                );
            }
        }
        return this.snapshot(command.callId, command.actorUserId);
    }

    private async requestEnrichment(
        command: Extract<CallNotesCommand, { kind: "request_enrichment" }>
    ): Promise<CallSnapshot> {
        const company = companyNumber(command.companyId);
        const [call] = await this.options.db
            .select()
            .from(callNotesCalls)
            .where(
                and(eq(callNotesCalls.id, command.callId), eq(callNotesCalls.companyId, company))
            )
            .limit(1);
        if (!call) throw new CallNotesApplicationError("not_found", "Call not found");
        if (call.noteOwnerUserId !== command.actorUserId) {
            throw new CallNotesApplicationError(
                "forbidden",
                "Only the Call Note owner may request enrichment"
            );
        }
        if (call.documentNoteId === null)
            throw new CallNotesApplicationError("invalid_transition", "Call has no Note");
        const [active] = await this.options.db
            .select({ id: callNotesEnrichmentRuns.id })
            .from(callNotesEnrichmentRuns)
            .where(
                and(
                    eq(callNotesEnrichmentRuns.callId, command.callId),
                    sql`${callNotesEnrichmentRuns.status} in ('queued', 'generating', 'ready')`
                )
            )
            .orderBy(desc(callNotesEnrichmentRuns.createdAt))
            .limit(1);
        if (active) return this.snapshot(command.callId, command.actorUserId);
        const transcriptRows = await this.transcriptRows(command.callId, company);
        const participants = await this.options.db
            .select()
            .from(callNotesParticipants)
            .where(eq(callNotesParticipants.callId, command.callId));
        const transcript = toTranscriptSegments(transcriptRows, participants);
        const gapRows = await this.options.db
            .select()
            .from(callNotesGaps)
            .where(eq(callNotesGaps.callId, command.callId))
            .orderBy(asc(callNotesGaps.startedAt), asc(callNotesGaps.id));
        const bookmarkRows = await this.options.db
            .select()
            .from(callNotesBookmarks)
            .where(eq(callNotesBookmarks.callId, command.callId))
            .orderBy(asc(callNotesBookmarks.createdAt), asc(callNotesBookmarks.id));
        const documentNote = await this.options.documentNotes.get(call.documentNoteId);
        if (!documentNote)
            throw new CallNotesApplicationError("not_found", "Document Note not found");
        const fingerprint = enrichmentFingerprint({
            transcript,
            gaps: toGaps(gapRows),
            bookmarks: toBookmarks(bookmarkRows),
            note: toCallNote(call, documentNote),
        });
        await this.options.db.insert(callNotesEnrichmentRuns).values({
            id: this.ids.next("enrichment"),
            callId: command.callId,
            companyId: company,
            requestedByUserId: command.actorUserId,
            baseNoteRevision: call.currentNoteRevision,
            transcriptFingerprint: fingerprint,
            status: "queued",
            originalOutput: null,
            editableProposal: null,
            modelMetadata: null,
            createdAt: this.clock.now(),
        });
        return this.snapshot(command.callId, command.actorUserId);
    }

    private async rejectEnrichment(
        command: Extract<CallNotesCommand, { kind: "reject_enrichment" }>
    ): Promise<CallSnapshot> {
        const company = companyNumber(command.companyId);
        await this.options.db.transaction(async tx => {
            const [call] = await tx
                .select()
                .from(callNotesCalls)
                .where(
                    and(
                        eq(callNotesCalls.id, command.callId),
                        eq(callNotesCalls.companyId, company)
                    )
                )
                .for("update")
                .limit(1);
            if (!call) throw new CallNotesApplicationError("not_found", "Call not found");
            if (call.noteOwnerUserId !== command.actorUserId) {
                throw new CallNotesApplicationError(
                    "forbidden",
                    "Only the Call Note owner may reject enrichment"
                );
            }
            const [run] = await tx
                .select()
                .from(callNotesEnrichmentRuns)
                .where(
                    and(
                        eq(callNotesEnrichmentRuns.id, command.enrichmentRunId),
                        eq(callNotesEnrichmentRuns.callId, command.callId),
                        eq(callNotesEnrichmentRuns.companyId, company)
                    )
                )
                .for("update")
                .limit(1);
            if (!run) throw new CallNotesApplicationError("not_found", "Enrichment run not found");
            if (run.status !== "ready") {
                throw new CallNotesApplicationError(
                    run.status === "accepted" || run.status === "rejected"
                        ? "conflict"
                        : "invalid_transition",
                    "Enrichment is not reviewable"
                );
            }
            const [resolved] = await tx
                .update(callNotesEnrichmentRuns)
                .set({
                    status: "rejected",
                    resolvedByUserId: command.actorUserId,
                    resolvedAt: this.clock.now(),
                })
                .where(
                    and(
                        eq(callNotesEnrichmentRuns.id, command.enrichmentRunId),
                        eq(callNotesEnrichmentRuns.status, "ready")
                    )
                )
                .returning();
            if (!resolved)
                throw new CallNotesApplicationError(
                    "conflict",
                    "Enrichment was resolved by another request"
                );
        });
        return this.snapshot(command.callId, command.actorUserId);
    }

    private async acceptEnrichment(
        command: Extract<CallNotesCommand, { kind: "accept_enrichment" }>
    ): Promise<CallSnapshot> {
        const company = companyNumber(command.companyId);
        const committed = await this.options.db.transaction(async tx => {
            const executor = tx as unknown as CallNotesDocumentNoteExecutor;
            const [call] = await tx
                .select()
                .from(callNotesCalls)
                .where(
                    and(
                        eq(callNotesCalls.id, command.callId),
                        eq(callNotesCalls.companyId, company)
                    )
                )
                .for("update")
                .limit(1);
            if (!call) throw new CallNotesApplicationError("not_found", "Call not found");
            if (call.noteOwnerUserId !== command.actorUserId) {
                throw new CallNotesApplicationError(
                    "forbidden",
                    "Only the Call Note owner may accept enrichment"
                );
            }
            const [run] = await tx
                .select()
                .from(callNotesEnrichmentRuns)
                .where(
                    and(
                        eq(callNotesEnrichmentRuns.id, command.enrichmentRunId),
                        eq(callNotesEnrichmentRuns.callId, command.callId),
                        eq(callNotesEnrichmentRuns.companyId, company)
                    )
                )
                .for("update")
                .limit(1);
            if (!run) throw new CallNotesApplicationError("not_found", "Enrichment run not found");
            if (run.status !== "ready") {
                throw new CallNotesApplicationError(
                    run.status === "accepted" || run.status === "rejected"
                        ? "conflict"
                        : "invalid_transition",
                    "Enrichment is not reviewable"
                );
            }
            if (call.documentNoteId === null)
                throw new CallNotesApplicationError("not_found", "Call Note not found");
            if (run.baseNoteRevision !== call.currentNoteRevision) {
                throw new CallNotesApplicationError(
                    "conflict",
                    "Enrichment was generated from a stale Note revision"
                );
            }
            let note: CallNotesDocumentNoteRecord;
            try {
                const existing = await this.options.documentNotes.get(
                    call.documentNoteId,
                    executor
                );
                if (!existing)
                    throw new CallNotesApplicationError("not_found", "Document Note not found");
                note = normalizeNote(
                    await this.options.documentNotes.update(
                        call.documentNoteId,
                        {
                            title: existing.title,
                            contentMarkdown: command.contentMarkdown,
                            contentRich: command.contentRich,
                        },
                        executor
                    )
                );
            } catch (error) {
                if (isApplicationError(error)) throw error;
                throw new CallNotesApplicationError(
                    "unavailable",
                    `Unable to update Call Note: ${errorMessage(error)}`
                );
            }
            const revision = call.currentNoteRevision + 1;
            const now = this.clock.now();
            const [updated] = await tx
                .update(callNotesCalls)
                .set({ currentNoteRevision: revision, updatedAt: now })
                .where(
                    and(
                        eq(callNotesCalls.id, command.callId),
                        eq(callNotesCalls.companyId, company),
                        eq(callNotesCalls.currentNoteRevision, call.currentNoteRevision)
                    )
                )
                .returning();
            if (!updated)
                throw new CallNotesApplicationError("conflict", "Call Note revision is stale");
            await tx.insert(callNotesNoteRevisions).values({
                id: this.ids.next("note_revision"),
                callId: command.callId,
                companyId: company,
                documentNoteId: call.documentNoteId,
                revision,
                origin: "enrichment",
                enrichmentRunId: run.id,
                title: note.title,
                contentMarkdown: command.contentMarkdown,
                contentRich: command.contentRich,
                createdByUserId: command.actorUserId,
                createdAt: now,
            });
            const [resolved] = await tx
                .update(callNotesEnrichmentRuns)
                .set({
                    status: "accepted",
                    resolvedByUserId: command.actorUserId,
                    resolvedAt: now,
                })
                .where(
                    and(
                        eq(callNotesEnrichmentRuns.id, run.id),
                        eq(callNotesEnrichmentRuns.status, "ready")
                    )
                )
                .returning();
            if (!resolved)
                throw new CallNotesApplicationError(
                    "conflict",
                    "Enrichment was resolved by another request"
                );
            const reindex =
                call.knowledgeIncluded && call.noteVisibility === "company"
                    ? await this.workItems.enqueue(
                          {
                              companyId: command.companyId,
                              callId: command.callId,
                              kind: "reindex",
                              idempotencyKey: `reindex:${command.callId}:${revision}`,
                              payload: {
                                  callId: command.callId,
                                  revision,
                              },
                          },
                          tx as unknown as DbClient
                      )
                    : null;
            return { reindexId: reindex?.id ?? null };
        });
        if (committed.reindexId) await this.processReindexWorkItem(committed.reindexId);
        return this.snapshot(command.callId, command.actorUserId);
    }

    private async setKnowledgeInclusion(
        command: Extract<CallNotesCommand, { kind: "set_knowledge_inclusion" }>
    ): Promise<CallSnapshot> {
        const company = companyNumber(command.companyId);
        const [call] = await this.options.db
            .select()
            .from(callNotesCalls)
            .where(
                and(eq(callNotesCalls.id, command.callId), eq(callNotesCalls.companyId, company))
            )
            .limit(1);
        if (!call) throw new CallNotesApplicationError("not_found", "Call not found");
        if (call.noteOwnerUserId !== command.actorUserId) {
            throw new CallNotesApplicationError(
                "forbidden",
                "Only the Call Note owner may change knowledge inclusion"
            );
        }
        if (command.included && call.noteVisibility === "private") {
            throw new CallNotesApplicationError(
                "forbidden",
                "Private Call Notes cannot enter company knowledge"
            );
        }
        if (call.documentNoteId === null || !call.noteOwnerUserId) {
            throw new CallNotesApplicationError("invalid_transition", "Call has no indexable Note");
        }
        const note = await this.options.documentNotes.get(call.documentNoteId);
        if (!note) throw new CallNotesApplicationError("not_found", "Document Note not found");
        if (command.included && call.currentNoteRevision <= 0) {
            throw new CallNotesApplicationError(
                "invalid_transition",
                "A saved Note revision is required before indexing"
            );
        }
        await this.options.db
            .update(callNotesCalls)
            .set({ knowledgeIncluded: command.included, updatedAt: this.clock.now() })
            .where(eq(callNotesCalls.id, command.callId));
        if (command.included) {
            await this.upsertKnowledge(
                command.companyId,
                command.callId,
                call,
                normalizeNote(note),
                call.currentNoteRevision
            );
        } else {
            try {
                await this.options.knowledgeSink.remove(command.companyId, command.callId);
            } catch (error) {
                throw new CallNotesApplicationError(
                    "unavailable",
                    `Unable to remove knowledge Note: ${errorMessage(error)}`
                );
            }
        }
        return this.snapshot(command.callId, command.actorUserId);
    }

    private async upsertKnowledge(
        companyId: string,
        callId: string,
        call: CallNotesCallRow,
        note: CallNotesDocumentNoteRecord,
        revision: number
    ): Promise<void> {
        if (call.documentNoteId === null || !call.noteOwnerUserId) {
            throw new CallNotesApplicationError("invalid_transition", "Call has no indexable Note");
        }
        try {
            await this.options.knowledgeSink.upsert({
                companyId,
                callId,
                documentNoteId: call.documentNoteId,
                ownerUserId: call.noteOwnerUserId,
                revision,
                title: note.title,
                contentMarkdown: note.contentMarkdown,
                deepLink: this.deepLink(companyId, callId),
            });
        } catch (error) {
            throw new CallNotesApplicationError(
                "unavailable",
                `Unable to update knowledge Note: ${errorMessage(error)}`
            );
        }
    }

    private async deleteCall(
        command: Extract<CallNotesCommand, { kind: "delete_call" }>
    ): Promise<null> {
        const company = companyNumber(command.companyId);
        const role = await this.requireMembership(command.companyId, command.actorUserId);
        const [call] = await this.options.db
            .select()
            .from(callNotesCalls)
            .where(
                and(eq(callNotesCalls.id, command.callId), eq(callNotesCalls.companyId, company))
            )
            .limit(1);
        if (!call) {
            try {
                await this.options.knowledgeSink.remove(command.companyId, command.callId);
            } catch (error) {
                throw new CallNotesApplicationError(
                    "unavailable",
                    `Unable to remove knowledge Note: ${errorMessage(error)}`
                );
            }
            return null;
        }
        const transcript = await this.options.db
            .select({ id: callNotesTranscriptSegments.id })
            .from(callNotesTranscriptSegments)
            .where(eq(callNotesTranscriptSegments.callId, command.callId))
            .limit(1);
        if (
            role !== "admin" &&
            (role !== "owner" || call.status !== "failed" || transcript.length > 0)
        ) {
            throw new CallNotesApplicationError("forbidden", "Only admins may delete this Call");
        }
        try {
            await this.options.knowledgeSink.remove(command.companyId, command.callId);
        } catch (error) {
            throw new CallNotesApplicationError(
                "unavailable",
                `Unable to remove knowledge Note: ${errorMessage(error)}`
            );
        }
        if (call.documentNoteId !== null) {
            try {
                await this.options.documentNotes.delete(call.documentNoteId);
            } catch (error) {
                throw new CallNotesApplicationError(
                    "unavailable",
                    `Unable to delete Call Note: ${errorMessage(error)}`
                );
            }
        }
        await this.options.db
            .delete(callNotesCalls)
            .where(
                and(eq(callNotesCalls.id, command.callId), eq(callNotesCalls.companyId, company))
            );
        return null;
    }

    private async applyCaptureEvent(
        callId: string,
        company: bigint,
        event: CaptureEvent
    ): Promise<void> {
        const [capture] = await this.options.db
            .select()
            .from(callNotesCaptures)
            .where(
                and(eq(callNotesCaptures.callId, callId), eq(callNotesCaptures.companyId, company))
            )
            .limit(1);
        if (!capture) {
            throw new CallNotesApplicationError("unavailable", "Call capture is missing");
        }
        if (
            (capture.lifecycle === "completed" || capture.lifecycle === "failed") &&
            event.kind !== "transcript_segment" &&
            event.kind !== "occurrence_ended"
        ) {
            return;
        }
        const occurredAt = asDate(event.occurredAt);
        switch (event.kind) {
            case "attempt_connected":
                await this.attemptConnected(callId, company, capture, event, occurredAt);
                return;
            case "attempt_paused":
                await this.openGap(
                    callId,
                    company,
                    capture.id,
                    event.attemptKey,
                    "user_paused",
                    occurredAt
                );
                await this.options.db
                    .update(callNotesCaptures)
                    .set({ desiredMode: "paused", lifecycle: "interrupted", updatedAt: occurredAt })
                    .where(eq(callNotesCaptures.id, capture.id));
                return;
            case "attempt_resumed":
                await this.closeGap(callId, "user_paused", event.attemptKey, occurredAt);
                await this.options.db
                    .update(callNotesCaptures)
                    .set({ desiredMode: "running", lifecycle: "live", updatedAt: occurredAt })
                    .where(eq(callNotesCaptures.id, capture.id));
                return;
            case "transport_interrupted":
                await this.openGap(
                    callId,
                    company,
                    capture.id,
                    event.attemptKey,
                    "transport_interruption",
                    occurredAt
                );
                await this.options.db
                    .update(callNotesCaptureAttempts)
                    .set({ lifecycle: "reconnecting" })
                    .where(
                        and(
                            eq(callNotesCaptureAttempts.captureId, capture.id),
                            eq(callNotesCaptureAttempts.providerAttemptKey, event.attemptKey)
                        )
                    );
                await this.options.db
                    .update(callNotesCaptures)
                    .set({ lifecycle: "interrupted", updatedAt: occurredAt })
                    .where(eq(callNotesCaptures.id, capture.id));
                return;
            case "transport_reconnected":
                await this.closeGap(callId, "transport_interruption", event.attemptKey, occurredAt);
                await this.options.db
                    .update(callNotesCaptureAttempts)
                    .set({ lifecycle: "live" })
                    .where(
                        and(
                            eq(callNotesCaptureAttempts.captureId, capture.id),
                            eq(callNotesCaptureAttempts.providerAttemptKey, event.attemptKey)
                        )
                    );
                await this.options.db
                    .update(callNotesCaptures)
                    .set({ lifecycle: "live", updatedAt: occurredAt })
                    .where(eq(callNotesCaptures.id, capture.id));
                return;
            case "attempt_ended":
                await this.options.db
                    .update(callNotesCaptureAttempts)
                    .set({ lifecycle: "ended", endedAt: occurredAt })
                    .where(
                        and(
                            eq(callNotesCaptureAttempts.captureId, capture.id),
                            eq(callNotesCaptureAttempts.providerAttemptKey, event.attemptKey)
                        )
                    );
                if (event.reason === "capture_user_left") {
                    await this.openGap(
                        callId,
                        company,
                        capture.id,
                        event.attemptKey,
                        "capture_user_absent",
                        occurredAt
                    );
                }
                await this.options.db
                    .update(callNotesCaptures)
                    .set({ activeAttemptId: null, lifecycle: "interrupted", updatedAt: occurredAt })
                    .where(eq(callNotesCaptures.id, capture.id));
                return;
            case "attempt_failed":
                await this.options.db
                    .update(callNotesCaptureAttempts)
                    .set({
                        lifecycle: "failed",
                        endedAt: occurredAt,
                        failureCode: event.code,
                        failureMessage: event.message,
                    })
                    .where(
                        and(
                            eq(callNotesCaptureAttempts.captureId, capture.id),
                            eq(callNotesCaptureAttempts.providerAttemptKey, event.attemptKey)
                        )
                    );
                await this.openGap(
                    callId,
                    company,
                    capture.id,
                    event.attemptKey,
                    "provider_unknown",
                    occurredAt
                );
                await this.options.db
                    .update(callNotesCaptures)
                    .set({ activeAttemptId: null, lifecycle: "failed", updatedAt: occurredAt })
                    .where(eq(callNotesCaptures.id, capture.id));
                return;
            case "participant_joined":
            case "participant_returned":
                await this.participantObserved(callId, company, capture.id, event, occurredAt);
                if (
                    event.kind === "participant_returned" &&
                    event.participant.providerParticipantKey === capture.captureUserProviderKey
                ) {
                    await this.closeGap(
                        callId,
                        "capture_user_absent",
                        event.attemptKey,
                        occurredAt
                    );
                }
                return;
            case "participant_left":
                await this.participantLeft(capture.id, event, occurredAt);
                if (event.participant.providerParticipantKey === capture.captureUserProviderKey) {
                    await this.openGap(
                        callId,
                        company,
                        capture.id,
                        event.attemptKey,
                        "capture_user_absent",
                        occurredAt
                    );
                }
                return;
            case "transcript_segment":
                await this.transcriptSegment(callId, company, capture, event);
                return;
            case "occurrence_ended":
                await this.finalizeOccurrence(callId, company, capture, occurredAt);
                return;
            default:
                throw new CallNotesApplicationError(
                    "invalid_transition",
                    "Unsupported capture event"
                );
        }
    }

    private async attemptConnected(
        callId: string,
        company: bigint,
        capture: CallNotesCaptureRow,
        event: Extract<CaptureEvent, { kind: "attempt_connected" }>,
        occurredAt: Date
    ): Promise<void> {
        const [existing] = await this.options.db
            .select()
            .from(callNotesCaptureAttempts)
            .where(
                and(
                    eq(callNotesCaptureAttempts.captureId, capture.id),
                    eq(callNotesCaptureAttempts.providerAttemptKey, event.attemptKey)
                )
            )
            .limit(1);
        if (existing) {
            if (!isActiveAttemptLifecycle(existing.lifecycle)) return;
            await this.options.db
                .update(callNotesCaptures)
                .set({ activeAttemptId: existing.id, lifecycle: "live", updatedAt: occurredAt })
                .where(eq(callNotesCaptures.id, capture.id));
            return;
        }
        const [active] = await this.options.db
            .select()
            .from(callNotesCaptureAttempts)
            .where(
                and(
                    eq(callNotesCaptureAttempts.captureId, capture.id),
                    sql`${callNotesCaptureAttempts.lifecycle} in ('connecting', 'live', 'reconnecting')`
                )
            )
            .limit(1);
        if (active) {
            await this.options.db
                .update(callNotesCaptureAttempts)
                .set({ lifecycle: "ended", endedAt: occurredAt })
                .where(eq(callNotesCaptureAttempts.id, active.id));
        }
        const attemptId = this.ids.next("attempt");
        await this.options.db.insert(callNotesCaptureAttempts).values({
            id: attemptId,
            captureId: capture.id,
            callId,
            companyId: company,
            providerAttemptKey: event.attemptKey,
            providerStreamKey: event.streamKey,
            lifecycle: "live",
            startedAt: occurredAt,
        });
        await this.closeGap(callId, "capture_user_absent", event.attemptKey, occurredAt);
        await this.options.db
            .update(callNotesCaptures)
            .set({ activeAttemptId: attemptId, lifecycle: "live", updatedAt: occurredAt })
            .where(eq(callNotesCaptures.id, capture.id));
    }

    private async participantObserved(
        callId: string,
        company: bigint,
        captureId: string,
        event: ParticipantCaptureEvent,
        occurredAt: Date
    ): Promise<void> {
        const [attempt] = await this.options.db
            .select({ id: callNotesCaptureAttempts.id })
            .from(callNotesCaptureAttempts)
            .where(
                and(
                    eq(callNotesCaptureAttempts.captureId, captureId),
                    eq(callNotesCaptureAttempts.providerAttemptKey, event.attemptKey)
                )
            )
            .limit(1);
        if (!attempt) return;
        const [existing] = await this.options.db
            .select({ id: callNotesParticipants.id })
            .from(callNotesParticipants)
            .where(
                and(
                    eq(callNotesParticipants.attemptId, attempt.id),
                    eq(
                        callNotesParticipants.providerParticipantKey,
                        event.participant.providerParticipantKey
                    ),
                    ...(event.participant.providerSessionKey
                        ? [
                              eq(
                                  callNotesParticipants.providerSessionKey,
                                  event.participant.providerSessionKey
                              ),
                          ]
                        : []),
                    eq(callNotesParticipants.observedAt, occurredAt)
                )
            )
            .limit(1);
        if (existing) return;
        await this.options.db.insert(callNotesParticipants).values({
            id: this.ids.next("participant"),
            callId,
            attemptId: attempt.id,
            companyId: company,
            providerParticipantKey: event.participant.providerParticipantKey,
            providerSessionKey: event.participant.providerSessionKey,
            displayName: event.participant.displayName,
            observedAt: occurredAt,
            leftAt: null,
        });
    }

    private async participantLeft(
        captureId: string,
        event: ParticipantCaptureEvent,
        occurredAt: Date
    ): Promise<void> {
        const [attempt] = await this.options.db
            .select({ id: callNotesCaptureAttempts.id })
            .from(callNotesCaptureAttempts)
            .where(
                and(
                    eq(callNotesCaptureAttempts.captureId, captureId),
                    eq(callNotesCaptureAttempts.providerAttemptKey, event.attemptKey)
                )
            )
            .limit(1);
        if (!attempt) return;
        const [participant] = await this.options.db
            .select({ id: callNotesParticipants.id })
            .from(callNotesParticipants)
            .where(
                and(
                    eq(callNotesParticipants.attemptId, attempt.id),
                    eq(
                        callNotesParticipants.providerParticipantKey,
                        event.participant.providerParticipantKey
                    ),
                    ...(event.participant.providerSessionKey
                        ? [
                              eq(
                                  callNotesParticipants.providerSessionKey,
                                  event.participant.providerSessionKey
                              ),
                          ]
                        : []),
                    isNull(callNotesParticipants.leftAt)
                )
            )
            .orderBy(desc(callNotesParticipants.observedAt))
            .limit(1);
        if (participant) {
            await this.options.db
                .update(callNotesParticipants)
                .set({ leftAt: occurredAt })
                .where(eq(callNotesParticipants.id, participant.id));
        }
    }

    private async transcriptSegment(
        callId: string,
        company: bigint,
        capture: CallNotesCaptureRow,
        event: Extract<CaptureEvent, { kind: "transcript_segment" }>
    ): Promise<void> {
        let [attempt] = await this.options.db
            .select()
            .from(callNotesCaptureAttempts)
            .where(
                and(
                    eq(callNotesCaptureAttempts.captureId, capture.id),
                    eq(callNotesCaptureAttempts.providerAttemptKey, event.attemptKey)
                )
            )
            .limit(1);
        if (!attempt) {
            const attemptId = this.ids.next("attempt");
            [attempt] = await this.options.db
                .insert(callNotesCaptureAttempts)
                .values({
                    id: attemptId,
                    captureId: capture.id,
                    callId,
                    companyId: company,
                    providerAttemptKey: event.attemptKey,
                    providerStreamKey: null,
                    lifecycle: "live",
                    startedAt: asDate(event.occurredAt),
                })
                .returning();
        }
        if (!attempt)
            throw new CallNotesApplicationError("unavailable", "Unable to create capture attempt");
        let participantId: string | null = null;
        if (event.participant) {
            const [participant] = await this.options.db
                .select({ id: callNotesParticipants.id })
                .from(callNotesParticipants)
                .where(
                    and(
                        eq(callNotesParticipants.attemptId, attempt.id),
                        eq(
                            callNotesParticipants.providerParticipantKey,
                            event.participant.providerParticipantKey
                        ),
                        ...(event.participant.providerSessionKey
                            ? [
                                  eq(
                                      callNotesParticipants.providerSessionKey,
                                      event.participant.providerSessionKey
                                  ),
                              ]
                            : [])
                    )
                )
                .orderBy(desc(callNotesParticipants.observedAt))
                .limit(1);
            if (participant) participantId = participant.id;
            else {
                const createdId = this.ids.next("participant");
                await this.options.db.insert(callNotesParticipants).values({
                    id: createdId,
                    callId,
                    attemptId: attempt.id,
                    companyId: company,
                    providerParticipantKey: event.participant.providerParticipantKey,
                    providerSessionKey: event.participant.providerSessionKey,
                    displayName: event.participant.displayName,
                    observedAt: asDate(event.occurredAt),
                    leftAt: null,
                });
                participantId = createdId;
            }
        }
        const [inserted] = await this.options.db
            .insert(callNotesTranscriptSegments)
            .values({
                id: this.ids.next("segment"),
                callId,
                attemptId: attempt.id,
                participantId,
                companyId: company,
                providerEventKey: event.providerEventKey,
                sourcePacketHash: event.sourcePacketHash,
                sourceKind: event.sourceKind,
                speakerName: event.participant?.displayName ?? null,
                providerStartMs: event.providerStartMs ?? null,
                providerEndMs: event.providerEndMs ?? null,
                receivedAt: asDate(event.receivedAt),
                receiveOrder: event.receiveOrder,
                text: event.text,
                language: event.language ?? null,
                createdAt: this.clock.now(),
            })
            .onConflictDoNothing({
                target: [
                    callNotesTranscriptSegments.attemptId,
                    callNotesTranscriptSegments.sourcePacketHash,
                ],
            })
            .returning({ id: callNotesTranscriptSegments.id });
        if (inserted && (capture.lifecycle === "completed" || capture.lifecycle === "failed")) {
            await this.finalizeOccurrence(
                callId,
                company,
                capture,
                capture.endedAt ?? asDate(event.occurredAt)
            );
        }
    }

    private async openGap(
        callId: string,
        company: bigint,
        captureId: string,
        attemptKey: string | undefined,
        kind: GapKind,
        startedAt: Date
    ): Promise<void> {
        let attemptId: string | null = null;
        if (attemptKey) {
            const [attempt] = await this.options.db
                .select({ id: callNotesCaptureAttempts.id })
                .from(callNotesCaptureAttempts)
                .where(
                    and(
                        eq(callNotesCaptureAttempts.captureId, captureId),
                        eq(callNotesCaptureAttempts.providerAttemptKey, attemptKey)
                    )
                )
                .limit(1);
            attemptId = attempt?.id ?? null;
        }
        const [open] = await this.options.db
            .select({ id: callNotesGaps.id })
            .from(callNotesGaps)
            .where(
                and(
                    eq(callNotesGaps.callId, callId),
                    eq(callNotesGaps.kind, kind),
                    isNull(callNotesGaps.endedAt),
                    attemptId ? eq(callNotesGaps.attemptId, attemptId) : sql`true`
                )
            )
            .limit(1);
        if (open) return;
        await this.options.db.insert(callNotesGaps).values({
            id: this.ids.next("gap"),
            callId,
            captureId,
            attemptId,
            companyId: company,
            kind,
            startedAt,
            endedAt: null,
            details: null,
        });
    }

    private async closeGap(
        callId: string,
        kind: GapKind,
        attemptKey: string | undefined,
        endedAt: Date
    ): Promise<void> {
        const predicates = [
            eq(callNotesGaps.callId, callId),
            eq(callNotesGaps.kind, kind),
            isNull(callNotesGaps.endedAt),
        ];
        if (attemptKey) {
            const [attempt] = await this.options.db
                .select({ id: callNotesCaptureAttempts.id })
                .from(callNotesCaptureAttempts)
                .where(
                    and(
                        eq(callNotesCaptureAttempts.callId, callId),
                        eq(callNotesCaptureAttempts.providerAttemptKey, attemptKey)
                    )
                )
                .limit(1);
            if (!attempt) return;
            predicates.push(eq(callNotesGaps.attemptId, attempt.id));
        }
        await this.options.db
            .update(callNotesGaps)
            .set({ endedAt })
            .where(and(...predicates));
    }

    private async finalizeOccurrence(
        callId: string,
        company: bigint,
        capture: CallNotesCaptureRow,
        endedAt: Date
    ): Promise<void> {
        const gaps = await this.options.db
            .select()
            .from(callNotesGaps)
            .where(eq(callNotesGaps.callId, callId));
        await this.options.db
            .update(callNotesGaps)
            .set({ endedAt })
            .where(and(eq(callNotesGaps.callId, callId), isNull(callNotesGaps.endedAt)));
        const attempts = await this.options.db
            .select()
            .from(callNotesCaptureAttempts)
            .where(eq(callNotesCaptureAttempts.captureId, capture.id));
        const segments = await this.options.db
            .select({ id: callNotesTranscriptSegments.id })
            .from(callNotesTranscriptSegments)
            .where(eq(callNotesTranscriptSegments.callId, callId));
        const hasGap = gaps.length > 0;
        const allAttemptsFailed =
            attempts.length > 0 && attempts.every(attempt => attempt.lifecycle === "failed");
        const outcome =
            allAttemptsFailed && segments.length === 0 ? "failed" : hasGap ? "partial" : "complete";
        const status: CallStatus = outcome === "failed" ? "failed" : "completed";
        await this.options.db
            .update(callNotesCaptureAttempts)
            .set({
                lifecycle: "ended",
                endedAt,
            })
            .where(
                and(
                    eq(callNotesCaptureAttempts.captureId, capture.id),
                    sql`${callNotesCaptureAttempts.lifecycle} in ('connecting', 'live', 'reconnecting')`
                )
            );
        await this.options.db
            .update(callNotesCaptures)
            .set({
                activeAttemptId: null,
                lifecycle: outcome === "failed" ? "failed" : "completed",
                outcome,
                endedAt,
                updatedAt: endedAt,
            })
            .where(eq(callNotesCaptures.id, capture.id));
        await this.options.db
            .update(callNotesCalls)
            .set({ status, finalizedAt: endedAt, updatedAt: endedAt })
            .where(and(eq(callNotesCalls.id, callId), eq(callNotesCalls.companyId, company)));
        if (segments.length === 0 && outcome === "complete") {
            await this.options.db
                .update(callNotesCalls)
                .set({
                    status: "failed",
                    failureCode: "empty_capture",
                    failureMessage: "No transcript evidence",
                    updatedAt: endedAt,
                })
                .where(eq(callNotesCalls.id, callId));
            await this.options.db
                .update(callNotesCaptures)
                .set({ lifecycle: "failed", outcome: "failed" })
                .where(eq(callNotesCaptures.id, capture.id));
        }
    }

    private async transcriptRows(callId: string, company: bigint) {
        const rows = await this.options.db
            .select()
            .from(callNotesTranscriptSegments)
            .where(
                and(
                    eq(callNotesTranscriptSegments.callId, callId),
                    eq(callNotesTranscriptSegments.companyId, company)
                )
            );
        return sortTranscriptRows(rows);
    }

    private async snapshot(callId: string, actorUserId: string): Promise<CallSnapshot> {
        const [call] = await this.options.db
            .select()
            .from(callNotesCalls)
            .where(eq(callNotesCalls.id, callId))
            .limit(1);
        if (!call) throw new CallNotesApplicationError("not_found", "Call not found");
        const [capture] = await this.options.db
            .select()
            .from(callNotesCaptures)
            .where(eq(callNotesCaptures.callId, call.id))
            .limit(1);
        if (!capture) throw new CallNotesApplicationError("unavailable", "Call capture is missing");
        const attempts = await this.options.db
            .select({ id: callNotesCaptureAttempts.id })
            .from(callNotesCaptureAttempts)
            .where(eq(callNotesCaptureAttempts.captureId, capture.id));
        const rows = await this.transcriptRows(call.id, call.companyId);
        const participants = await this.options.db
            .select()
            .from(callNotesParticipants)
            .where(eq(callNotesParticipants.callId, call.id));
        const transcript = toTranscriptSegments(rows, participants);
        const gapRows = await this.options.db
            .select()
            .from(callNotesGaps)
            .where(eq(callNotesGaps.callId, call.id))
            .orderBy(asc(callNotesGaps.startedAt), asc(callNotesGaps.id));
        const bookmarkRows = await this.options.db
            .select()
            .from(callNotesBookmarks)
            .where(eq(callNotesBookmarks.callId, call.id))
            .orderBy(asc(callNotesBookmarks.createdAt), asc(callNotesBookmarks.id));
        const runRows = await this.options.db
            .select()
            .from(callNotesEnrichmentRuns)
            .where(eq(callNotesEnrichmentRuns.callId, call.id))
            .orderBy(desc(callNotesEnrichmentRuns.createdAt), desc(callNotesEnrichmentRuns.id))
            .limit(1);
        let note: CallSnapshot["note"] = null;
        if (
            call.documentNoteId !== null &&
            call.noteOwnerUserId &&
            (call.noteVisibility === "company" || call.noteOwnerUserId === actorUserId)
        ) {
            const documentNote = await this.options.documentNotes.get(call.documentNoteId);
            if (documentNote) {
                note = toCallNote(call, documentNote);
            }
        }
        const run = runRows[0];
        const canViewEnrichment =
            call.noteVisibility === "company" || call.noteOwnerUserId === actorUserId;
        const enrichment =
            run && canViewEnrichment
                ? {
                      id: run.id,
                      status: run.status,
                      baseNoteRevision: run.baseNoteRevision,
                      transcriptFingerprint: run.transcriptFingerprint,
                      proposal: run.editableProposal ?? run.originalOutput,
                      modelMetadata: run.modelMetadata,
                      createdAt: iso(run.createdAt),
                      resolvedAt: run.resolvedAt ? iso(run.resolvedAt) : null,
                  }
                : null;
        return CallSnapshotSchema.parse({
            schemaVersion: CALL_NOTES_SCHEMA_VERSION,
            id: call.id,
            companyId: call.companyId.toString(),
            provider: call.provider,
            occurrenceKey: call.providerOccurrenceKey,
            title: call.title,
            status: call.status,
            capture: {
                id: capture.id,
                desiredMode: capture.desiredMode,
                lifecycle: capture.lifecycle,
                outcome: capture.outcome,
                activeAttemptId: capture.activeAttemptId,
                attemptCount: attempts.length,
            },
            transcript,
            gaps: toGaps(gapRows),
            bookmarks: toBookmarks(bookmarkRows),
            note,
            enrichment,
            createdAt: iso(call.createdAt),
            updatedAt: iso(call.updatedAt ?? call.createdAt),
        });
    }
}

export function createPostgresCallNotesApplication(
    options: CallNotesApplicationOptions
): CallNotesApplication {
    return new PostgresCallNotesApplication(options);
}
