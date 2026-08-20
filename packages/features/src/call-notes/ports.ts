import type {
    CallListQuery,
    CallNotesCommand,
    CallQuery,
    CallSnapshot,
    CaptureControlInput,
    CaptureEvent,
    CaptureSourceCapabilities,
    CompleteEnrichmentInput,
    DetectedCallCandidate,
    EnrichmentInput,
    EnrichmentResult,
    KnowledgeNote,
    StartCaptureInput,
    TranscriptSearchQuery,
    TranscriptSegment,
} from "./contracts";

export interface CaptureEventSink {
    append(event: CaptureEvent): Promise<void>;
}

export interface CaptureAttemptHandle {
    pause(input: CaptureControlInput): Promise<void>;
    resume(input: CaptureControlInput): Promise<void>;
    /** Releases local resources. It is not a provider Stop command. */
    dispose(): Promise<void>;
}

export interface CaptureSource {
    readonly capabilities: CaptureSourceCapabilities;
    startAttempt(input: StartCaptureInput, sink: CaptureEventSink): Promise<CaptureAttemptHandle>;
}

/** Public application boundary consumed by API handlers and contract tests. */
export interface CallNotesApplication {
    execute(command: CallNotesCommand): Promise<CallSnapshot | null>;
    ingestCaptureEvent(companyId: string, event: CaptureEvent): Promise<void>;
    completeEnrichment(input: CompleteEnrichmentInput): Promise<void>;
    getCall(query: CallQuery): Promise<CallSnapshot>;
    listCalls(query: CallListQuery): Promise<readonly CallSnapshot[]>;
    listDetectedCalls(query: CallListQuery): Promise<readonly DetectedCallCandidate[]>;
    searchTranscript(query: TranscriptSearchQuery): Promise<readonly TranscriptSegment[]>;
}

export interface EnrichmentModel {
    generate(input: EnrichmentInput): Promise<EnrichmentResult>;
}

export interface KnowledgeNoteSink {
    upsert(note: KnowledgeNote): Promise<void>;
    remove(companyId: string, callId: string): Promise<void>;
}

export interface CallNotesClock {
    now(): Date;
}

export interface CallNotesIdSource {
    next(prefix: string): string;
}
