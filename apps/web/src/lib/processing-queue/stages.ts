/**
 * Where one ingestion job is, as the Processing queue tab draws it — worked
 * out from database rows by pure functions, so every rule here is unit-tested
 * without a database.
 *
 * Three sources of truth, in the order they are trusted:
 *
 * 1. **The job** (`ocr_jobs.status`). `completed` means searchable, `failed`
 *    means out of attempts; nothing below overrides those.
 * 2. **The job's two outbox events.** `source.version.created:<job>` runs the
 *    extraction (route + read → the `reading` stage) and, when it is
 *    processed, enqueues `evidence.version.extracted:<job>`, which runs
 *    chunking, embedding and finalising (`splitting`, `indexing`, `ready`).
 *    Which event is live says which half of the trip the job is in; a
 *    pending event with failed attempts behind it is `retrying` — the job
 *    row stays `processing` with no error while that happens.
 * 3. **The stage rows** (`ocr_processing_steps`, one per job and stage,
 *    overwritten on each attempt), when the worker writes them. They refine
 *    the half the events point at: which of splitting / indexing is running,
 *    the embed done/total, the provider and page count. A row is ignored when
 *    it predates the run its event is on (a re-upload revived the event, or a
 *    later stage's row survived from an earlier attempt).
 *
 * Without stage rows (a worker that predates them) the stages are inferred
 * from 1 and 2 alone, and `stageSource` says so. One ambiguity remains there:
 * while `evidence.version.extracted` runs, chunking and embedding cannot be
 * told apart, so the item reads as `indexing` (with `splitting` done, no
 * done/total) — embedding is nearly all of that handler's time.
 */

import { normalizeFolderPath, UNFILED_FOLDER } from "~/lib/folders/path";

import { friendlyProcessingError, GENERIC_PROCESSING_ERROR } from "./errors";
import {
    QUEUE_STAGE_IDS,
    type ProcessingQueueItem,
    type ProcessingQueueSummary,
    type QueueItemError,
    type QueueItemState,
    type QueueStage,
    type QueueStageId,
    type QueueStageStatus,
} from "./types";

// ---------------------------------------------------------------------------
// Input rows (the columns the service selects)
// ---------------------------------------------------------------------------

export interface QueueJobRow {
    id: string;
    documentId: number | bigint | null;
    userId: string;
    /** queued | processing | completed | failed | needs_review */
    status: string;
    documentName: string;
    pageCount: number | null;
    actualProvider: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
    errorMessage: string | null;
    createdAt: Date;
    updatedAt: Date | null;
}

export interface QueueDocumentRow {
    id: number;
    title: string;
    category: string | null;
    mimeType: string | null;
}

export type StepType = "route" | "read" | "chunk" | "embed" | "finalize";

export interface QueueStepRow {
    /** A `StepType`; rows of other types (an older worker's) are ignored. */
    stepType: string;
    /** pending | in_progress | completed | failed */
    status: string;
    output: unknown;
    errorMessage: string | null;
    durationMs: number | null;
    /** When this attempt at the stage started. */
    createdAt: Date;
}

export interface QueueEventRow {
    eventId: string;
    /** pending | processing | processed | dead */
    status: string;
    /** Failed attempts so far (a reclaimed stale claim counts as one). */
    attemptCount: number;
    /** Not-before time of the next claim. */
    availableAt: Date | null;
    /** When the current (or last) attempt was claimed; null after a failure reschedules it. */
    claimedAt: Date | null;
    processedAt: Date | null;
    lastError: string | null;
}

export interface BuildQueueItemInput {
    job: QueueJobRow;
    document: QueueDocumentRow | null;
    steps: readonly QueueStepRow[];
    events: readonly QueueEventRow[];
    /** The viewer's auth user id. */
    viewerUserId: string;
    /** Whether the viewer may Retry this job if it has failed (edit access + documents.upload). */
    canRetry: boolean;
    /** Attempts after which an event goes dead (DEFAULT_RETRY_POLICY.maxAttempts). */
    maxAttempts: number;
    now: Date;
}

// ---------------------------------------------------------------------------
// Event ids and the stage map
// ---------------------------------------------------------------------------

export const EXTRACTION_EVENT_TYPE = "source.version.created";
export const INDEXING_EVENT_TYPE = "evidence.version.extracted";

/** The two outbox event ids a job's trip runs on (protocol `eventIds`). */
export function queueEventIds(jobId: string): { extraction: string; indexing: string } {
    return {
        extraction: `${EXTRACTION_EVENT_TYPE}:${jobId}`,
        indexing: `${INDEXING_EVENT_TYPE}:${jobId}`,
    };
}

const STEP_ORDER: readonly StepType[] = ["route", "read", "chunk", "embed", "finalize"];

const STAGE_OF_STEP: Record<StepType, QueueStageId> = {
    route: "reading",
    read: "reading",
    chunk: "splitting",
    embed: "indexing",
    finalize: "ready",
};

/** The stages each event's handler runs. */
const EXTRACTION_STAGES: readonly QueueStageId[] = ["reading"];
const INDEXING_STAGES: readonly QueueStageId[] = ["splitting", "indexing", "ready"];

/** The step types from a stage onward — what a Retry from that stage clears. */
export function stepTypesFrom(stage: QueueStageId): StepType[] {
    const at = QUEUE_STAGE_IDS.indexOf(stage);
    return STEP_ORDER.filter(step => QUEUE_STAGE_IDS.indexOf(STAGE_OF_STEP[step]) >= at);
}

/**
 * A worker writing its row with its own clock can land a little before the
 * outbox's `claimed_at` (the database's clock). Rows older than the claim by
 * more than this belong to an earlier attempt.
 */
const CLOCK_SKEW_MS = 5_000;

const PROVIDER_LABELS: Record<string, string> = {
    AZURE: "Azure",
    LANDING_AI: "Landing AI",
    NATIVE_PDF: "Native PDF",
    DATALAB: "Datalab",
    INGESTION: "Text extraction",
    DOCLING: "Docling",
};

/** "Docling" for `DOCLING`; unknown codes are title-cased. */
export function providerLabel(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const known = PROVIDER_LABELS[raw.toUpperCase()];
    if (known) return known;
    return raw
        .toLowerCase()
        .split(/[_\s-]+/)
        .filter(Boolean)
        .map(word => word[0]!.toUpperCase() + word.slice(1))
        .join(" ");
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function iso(value: Date | null | undefined): string | null {
    return value ? value.toISOString() : null;
}

function isStepType(value: string): value is StepType {
    return (STEP_ORDER as readonly string[]).includes(value);
}

function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function count(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= 0
        ? Math.floor(value)
        : undefined;
}

function stepEnd(step: QueueStepRow): Date | null {
    if (step.status !== "completed" && step.status !== "failed") return null;
    return step.durationMs != null
        ? new Date(step.createdAt.getTime() + step.durationMs)
        : step.createdAt;
}

function plural(n: number, one: string, many: string): string {
    return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** A retried (pending, attempts behind it) event: the worker will try again. */
function isRetrying(event: QueueEventRow, maxAttempts: number): boolean {
    return (
        event.status === "pending" && event.attemptCount >= 1 && event.attemptCount < maxAttempts
    );
}

/**
 * A new or revived event that has not been claimed since. An operator replay
 * (`DrizzleOutboxStore.replay`) returns a dead row to pending without
 * resetting its count, so a pending row out of attempts is a fresh run too.
 */
function notStarted(event: QueueEventRow | null, maxAttempts: number): boolean {
    return (
        event?.status === "pending" &&
        (event.attemptCount === 0 || event.attemptCount >= maxAttempts)
    );
}

// ---------------------------------------------------------------------------
// Which stage rows describe the current run
// ---------------------------------------------------------------------------

type ValidSteps = Map<StepType, QueueStepRow>;

/**
 * May rows written for `event`'s stages be trusted for the run it is on?
 * `false` drops them all; a number is the earliest a row may have started.
 */
type Gate = false | number;

function eventRunGate(event: QueueEventRow | null, maxAttempts: number): Gate {
    if (!event) return -Infinity;
    if (notStarted(event, maxAttempts)) return false;
    if (event.status === "processing" && event.claimedAt) {
        return event.claimedAt.getTime() - CLOCK_SKEW_MS;
    }
    return -Infinity;
}

function validSteps(
    steps: readonly QueueStepRow[],
    extractionGate: Gate,
    indexingGate: Gate
): ValidSteps {
    // The latest row per step type (ids are `<job>:<step>`, but be tolerant).
    const latest = new Map<StepType, QueueStepRow>();
    for (const step of steps) {
        if (!isStepType(step.stepType)) continue;
        const seen = latest.get(step.stepType);
        if (!seen || seen.createdAt.getTime() <= step.createdAt.getTime()) {
            latest.set(step.stepType, step);
        }
    }

    const out: ValidSteps = new Map();
    // Stages run in order, so a later stage's row that started before an
    // earlier stage's (valid) row is left over from an earlier attempt.
    let floor = -Infinity;
    for (const type of STEP_ORDER) {
        const step = latest.get(type);
        if (!step) continue;
        const gate = STAGE_OF_STEP[type] === "reading" ? extractionGate : indexingGate;
        if (gate === false) continue;
        const startedAt = step.createdAt.getTime();
        if (startedAt < gate || startedAt < floor) continue;
        out.set(type, step);
        floor = startedAt;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Recorded stage facts
// ---------------------------------------------------------------------------

interface StageFacts {
    status: QueueStageStatus | null;
    startedAt: Date | null;
    endedAt: Date | null;
    done?: number;
    total?: number;
    detail?: string;
    error: string | null;
}

function factsFor(stage: QueueStageId, steps: ValidSteps): StageFacts {
    const rows = STEP_ORDER.filter(t => STAGE_OF_STEP[t] === stage)
        .map(t => steps.get(t))
        .filter((s): s is QueueStepRow => s !== undefined);
    if (rows.length === 0) return { status: null, startedAt: null, endedAt: null, error: null };

    const failed = rows.find(r => r.status === "failed");
    const running = rows.find(r => r.status === "in_progress" || r.status === "pending");
    const last = rows[rows.length - 1]!;
    const first = rows[0]!;

    let status: QueueStageStatus;
    if (failed) status = "failed";
    else if (running) status = "active";
    // Reading is done when `read` is; `route` alone means read is next.
    else if (stage === "reading" && !steps.has("read")) status = "active";
    else status = "done";

    const facts: StageFacts = {
        status,
        startedAt: first.createdAt,
        endedAt: status === "done" || status === "failed" ? stepEnd(failed ?? last) : null,
        error: failed?.errorMessage ?? null,
    };

    const output = record(last.output);
    if (stage === "reading") {
        const read = record(steps.get("read")?.output);
        const provider = providerLabel(typeof read?.provider === "string" ? read.provider : null);
        const pages = count(read?.pages);
        const parts = [provider, pages !== undefined ? plural(pages, "page", "pages") : null];
        const detail = parts.filter(Boolean).join(" · ");
        if (detail) facts.detail = detail;
    } else if (stage === "splitting") {
        const chunks = count(output?.chunks);
        if (chunks !== undefined) facts.detail = plural(chunks, "chunk", "chunks");
    } else if (stage === "indexing") {
        const done = count(output?.done);
        const total = count(output?.total);
        if (total !== undefined) {
            facts.total = total;
            facts.done = Math.min(done ?? (status === "done" ? total : 0), total);
        }
    }
    return facts;
}

// ---------------------------------------------------------------------------
// The item
// ---------------------------------------------------------------------------

interface Position {
    state: QueueItemState;
    stage: QueueStageId;
    /** Status of `stage` itself; stages before it are done, after it pending. */
    stageStatus: QueueStageStatus;
    /** The event the current stage runs on, when known. */
    event: QueueEventRow | null;
    errorRaw: string | null;
}

function firstNotDone(
    stages: readonly QueueStageId[],
    facts: ReadonlyMap<QueueStageId, StageFacts>
): QueueStageId | null {
    for (const stage of stages) {
        if (facts.get(stage)?.status !== "done") return stage;
    }
    return null;
}

/** The stage in `stages` the recorded rows say is running or failed, else the first not done. */
function recordedStageIn(
    stages: readonly QueueStageId[],
    facts: ReadonlyMap<QueueStageId, StageFacts>
): QueueStageId | null {
    const hasRows = stages.some(s => facts.get(s)?.status != null);
    if (!hasRows) return null;
    const failed = stages.find(s => facts.get(s)?.status === "failed");
    if (failed) return failed;
    const active = stages.find(s => facts.get(s)?.status === "active");
    return active ?? firstNotDone(stages, facts);
}

interface Trip {
    job: QueueJobRow;
    extraction: QueueEventRow | null;
    indexing: QueueEventRow | null;
    /** Extraction has finished, so the indexing half is the live one. */
    indexingIsCurrent: boolean;
    facts: ReadonlyMap<QueueStageId, StageFacts>;
    /** Whether any stage row describes the current run (a recording worker). */
    recording: boolean;
    maxAttempts: number;
}

/** Stages from `reading` on — the ones stage rows describe. */
const WORK_STAGES = QUEUE_STAGE_IDS.slice(2);

function locate(trip: Trip): Position {
    const { job, extraction, indexing, indexingIsCurrent, facts, recording, maxAttempts } = trip;
    const stepError = (stage: QueueStageId) => facts.get(stage)?.error ?? null;
    // With no indexing row yet, a recording worker is at the handler's first
    // stage; an older worker's chunking and embedding can't be told apart, and
    // embedding is nearly all of that time.
    const indexingFallback: QueueStageId = recording ? "splitting" : "indexing";

    if (job.status === "completed" || job.status === "needs_review") {
        return {
            state: "done",
            stage: "ready",
            stageStatus: "done",
            event: indexing ?? extraction,
            errorRaw: null,
        };
    }

    if (job.status === "failed") {
        // The half that died: indexing when extraction finished, else extraction.
        let stage: QueueStageId;
        let event: QueueEventRow | null;
        if (indexingIsCurrent) {
            event = indexing;
            stage = recordedStageIn(INDEXING_STAGES, facts) ?? indexingFallback;
        } else if (extraction) {
            event = extraction;
            stage = recordedStageIn(EXTRACTION_STAGES, facts) ?? "reading";
        } else {
            event = null;
            stage = recordedStageIn(WORK_STAGES, facts) ?? "reading";
        }
        return {
            state: "failed",
            stage,
            stageStatus: "failed",
            event,
            errorRaw: job.errorMessage ?? event?.lastError ?? stepError(stage),
        };
    }

    // queued / processing (or an unknown status): follow the events.
    if (!extraction && !indexing) {
        // No outbox rows: rows alone, or the job status.
        const recorded = recordedStageIn(WORK_STAGES, facts);
        if (recorded) {
            return {
                state: "running",
                stage: recorded,
                stageStatus: "active",
                event: null,
                errorRaw: null,
            };
        }
        return job.status === "processing"
            ? {
                  state: "running",
                  stage: "reading",
                  stageStatus: "active",
                  event: null,
                  errorRaw: null,
              }
            : {
                  state: "waiting",
                  stage: "waiting",
                  stageStatus: "active",
                  event: null,
                  errorRaw: null,
              };
    }

    if (!indexingIsCurrent) {
        // Not current and not both missing: extraction has a row.
        const event = extraction!;
        if (event.status === "dead") {
            return {
                state: "failed",
                stage: "reading",
                stageStatus: "failed",
                event,
                errorRaw: event.lastError ?? stepError("reading"),
            };
        }
        if (isRetrying(event, maxAttempts)) {
            return {
                state: "retrying",
                stage: "reading",
                stageStatus: "active",
                event,
                errorRaw: event.lastError ?? stepError("reading"),
            };
        }
        if (event.status === "processing") {
            return {
                state: "running",
                stage: "reading",
                stageStatus: "active",
                event,
                errorRaw: null,
            };
        }
        return { state: "waiting", stage: "waiting", stageStatus: "active", event, errorRaw: null };
    }

    // Extraction is done: the indexing half.
    const event = indexing;
    if (!event || notStarted(event, maxAttempts)) {
        // Between the two halves: the indexing event is queued behind others.
        return {
            state: "waiting",
            stage: "splitting",
            stageStatus: "pending",
            event,
            errorRaw: null,
        };
    }
    const recorded = recordedStageIn(INDEXING_STAGES, facts);
    if (event.status === "dead") {
        const stage = recorded ?? indexingFallback;
        return {
            state: "failed",
            stage,
            stageStatus: "failed",
            event,
            errorRaw: event.lastError ?? stepError(stage),
        };
    }
    if (isRetrying(event, maxAttempts)) {
        const stage = recorded ?? indexingFallback;
        return {
            state: "retrying",
            stage,
            stageStatus: "active",
            event,
            errorRaw: event.lastError ?? stepError(stage),
        };
    }
    if (event.status === "processed") {
        // The handler finished but the job row has not caught up: finalising.
        return { state: "running", stage: "ready", stageStatus: "active", event, errorRaw: null };
    }
    return {
        state: "running",
        stage: recorded ?? indexingFallback,
        stageStatus: "active",
        event,
        errorRaw: null,
    };
}

/** Attempts made at the current stage (1-based once started; 0 = not started). */
function attemptOf(position: Position, maxAttempts: number): number {
    const event = position.event;
    // A processed or running row has failed `attemptCount` times before this
    // attempt; a pending or dead one has failed every attempt it made.
    const made = (() => {
        switch (position.state) {
            case "waiting":
                return 0;
            case "running":
            case "done":
                return (event?.attemptCount ?? 0) + 1;
            case "retrying":
            case "failed":
                return Math.max(1, event?.attemptCount ?? 1);
        }
    })();
    // An operator replay keeps the old count; never claim more than the budget.
    return Math.min(made, maxAttempts);
}

function stageTimes(
    stage: QueueStageId,
    trip: Trip
): { startedAt: Date | null; endedAt: Date | null } {
    const { job, extraction, indexing, indexingIsCurrent, facts } = trip;
    const recorded = facts.get(stage);
    const claimed = (event: QueueEventRow | null) =>
        event && event.status !== "pending" ? event.claimedAt : null;
    const extractionStart = facts.get("reading")?.startedAt ?? claimed(extraction);
    const indexingEvent = indexingIsCurrent ? indexing : null;
    const indexingStart =
        facts.get("splitting")?.startedAt ??
        facts.get("indexing")?.startedAt ??
        claimed(indexingEvent);
    switch (stage) {
        case "added":
            return { startedAt: job.createdAt, endedAt: job.createdAt };
        case "waiting": {
            // A job put back in line (Retry, a re-upload) waits from then, not
            // from when it was first added: its revived event is due now.
            const requeuedAt =
                extraction?.status === "pending" &&
                extraction.attemptCount === 0 &&
                extraction.availableAt !== null &&
                extraction.availableAt > job.createdAt
                    ? extraction.availableAt
                    : null;
            return {
                startedAt: requeuedAt ?? job.createdAt,
                endedAt: extractionStart ?? job.startedAt,
            };
        }
        case "reading":
            return {
                startedAt: extractionStart ?? job.startedAt,
                endedAt: recorded?.endedAt ?? extraction?.processedAt ?? job.completedAt,
            };
        case "splitting":
            return {
                startedAt: recorded?.startedAt ?? indexingStart,
                endedAt: recorded?.endedAt ?? null,
            };
        case "indexing":
            return {
                startedAt: recorded?.startedAt ?? indexingStart,
                endedAt: recorded?.endedAt ?? indexingEvent?.processedAt ?? job.completedAt,
            };
        case "ready":
            return {
                startedAt: recorded?.startedAt ?? null,
                endedAt: recorded?.endedAt ?? job.completedAt,
            };
    }
}

export function buildQueueItem(input: BuildQueueItemInput): ProcessingQueueItem {
    const { job, document, viewerUserId, maxAttempts } = input;
    const ids = queueEventIds(job.id);
    const extraction = input.events.find(e => e.eventId === ids.extraction) ?? null;
    const indexing = input.events.find(e => e.eventId === ids.indexing) ?? null;
    // The indexing half is the live one only once extraction has finished —
    // an indexing row next to a re-queued extraction is from an earlier run.
    const indexingIsCurrent =
        extraction === null ? indexing !== null : extraction.status === "processed";

    const noEvents = extraction === null && indexing === null;
    const steps = validSteps(
        input.steps,
        eventRunGate(extraction, maxAttempts),
        // Without outbox rows only the stage order can date a row.
        noEvents ? -Infinity : indexingIsCurrent ? eventRunGate(indexing, maxAttempts) : false
    );
    const facts = new Map<QueueStageId, StageFacts>();
    for (const stage of QUEUE_STAGE_IDS) facts.set(stage, factsFor(stage, steps));

    const trip: Trip = {
        job,
        extraction,
        indexing,
        indexingIsCurrent,
        facts,
        recording: steps.size > 0,
        maxAttempts,
    };
    const position = locate(trip);
    const attempt = attemptOf(position, maxAttempts);
    const at = QUEUE_STAGE_IDS.indexOf(position.stage);

    const stages: QueueStage[] = QUEUE_STAGE_IDS.map((id, index) => {
        let status: QueueStageStatus;
        if (position.state === "done") status = "done";
        else if (index < at) status = "done";
        else if (index === at) status = position.stageStatus;
        else status = "pending";

        const recorded = facts.get(id)!;
        const times = stageTimes(id, trip);
        const stage: QueueStage = {
            id,
            status,
            startedAt: status === "pending" ? null : iso(times.startedAt),
            endedAt: status === "done" || status === "failed" ? iso(times.endedAt) : null,
        };
        if (id === "indexing" && recorded.total !== undefined && status !== "pending") {
            stage.total = recorded.total;
            stage.done = status === "done" ? recorded.total : (recorded.done ?? 0);
        }
        if (recorded.detail && status !== "pending") stage.detail = recorded.detail;
        // The attempt in progress, or the one the worker is waiting to make.
        if (index === at && position.state === "retrying") {
            stage.detail = `attempt ${Math.min(attempt + 1, maxAttempts)} of ${maxAttempts}`;
        } else if (index === at && position.state === "running" && attempt > 1) {
            stage.detail = `attempt ${attempt} of ${maxAttempts}`;
        }
        return stage;
    });

    const error: QueueItemError | null =
        position.state === "failed"
            ? (friendlyProcessingError(position.errorRaw) ?? {
                  message: GENERIC_PROCESSING_ERROR,
                  detail: null,
              })
            : position.state === "retrying"
              ? friendlyProcessingError(position.errorRaw)
              : null;

    const readOutput = record(steps.get("read")?.output);
    const recordedProvider = typeof readOutput?.provider === "string" ? readOutput.provider : null;
    const recordedPages = count(readOutput?.pages);

    const folder = normalizeFolderPath(document?.category);
    const finished = position.state === "done" || position.state === "failed";
    const readingStart = stages.find(s => s.id === "reading")?.startedAt ?? null;

    return {
        jobId: job.id,
        documentId: job.documentId == null ? null : Number(job.documentId),
        name: document?.title ?? job.documentName,
        folder: folder === UNFILED_FOLDER ? "" : folder,
        mimeType: document?.mimeType ?? null,
        addedById: job.userId,
        mine: job.userId === viewerUserId,
        state: position.state,
        stage: position.stage,
        stages,
        attempt,
        maxAttempts,
        nextAttemptAt: position.state === "retrying" ? iso(position.event?.availableAt) : null,
        error,
        pageCount: job.pageCount ?? recordedPages ?? null,
        provider: providerLabel(job.actualProvider ?? recordedProvider),
        createdAt: job.createdAt.toISOString(),
        startedAt: iso(job.startedAt) ?? readingStart,
        completedAt: finished
            ? iso(job.completedAt ?? (position.state === "done" ? job.updatedAt : null))
            : null,
        canRetry: position.state === "failed" && input.canRetry,
        stageSource: input.steps.some(s => isStepType(s.stepType)) ? "recorded" : "inferred",
    };
}

export function summarize(items: readonly ProcessingQueueItem[]): ProcessingQueueSummary {
    const summary: ProcessingQueueSummary = {
        running: 0,
        waiting: 0,
        retrying: 0,
        failed: 0,
        done: 0,
    };
    for (const item of items) summary[item.state] += 1;
    return summary;
}
