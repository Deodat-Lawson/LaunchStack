import { createHash } from "node:crypto";

import {
    CALL_NOTES_SCHEMA_VERSION,
    CaptureEventSchema,
    type CaptureEvent,
    type ParticipantIdentity,
} from "@launchstack/features/call-notes";

export interface ZoomAttemptContext {
    occurrenceKey: string;
    attemptKey: string;
}

export interface ZoomTranscriptMetadata {
    userId: number | string;
    userName: string;
    startTs?: number;
    endTs?: number;
    language?: string;
}

export interface ZoomSessionState {
    operation: number;
    occurredAt: Date;
}

type StripProviderEnvelope<T> = T extends CaptureEvent
    ? Omit<T, "schemaVersion" | "eventId" | "provider" | "occurrenceKey">
    : never;
type NormalizedCaptureEventInput = StripProviderEnvelope<CaptureEvent>;

function sha256(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

function providerKey(value: number | string): string {
    return String(value);
}

export class ZoomCaptureEventNormalizer {
    private receiveOrder = 0;

    constructor(private readonly context: ZoomAttemptContext) {}

    connected(streamKey: string, occurredAt: Date): CaptureEvent {
        return this.event({
            kind: "attempt_connected",
            attemptKey: this.context.attemptKey,
            streamKey,
            occurredAt: occurredAt.toISOString(),
        });
    }

    sessionState(input: ZoomSessionState): CaptureEvent | null {
        if (input.operation !== 3 && input.operation !== 4) return null;
        return this.event({
            kind: input.operation === 3 ? "attempt_paused" : "attempt_resumed",
            attemptKey: this.context.attemptKey,
            occurredAt: input.occurredAt.toISOString(),
        });
    }

    interrupted(reason: string | undefined, occurredAt: Date): CaptureEvent {
        return this.event({
            kind: "transport_interrupted",
            attemptKey: this.context.attemptKey,
            occurredAt: occurredAt.toISOString(),
            ...(reason ? { reason } : {}),
        });
    }

    reconnected(occurredAt: Date): CaptureEvent {
        return this.event({
            kind: "transport_reconnected",
            attemptKey: this.context.attemptKey,
            occurredAt: occurredAt.toISOString(),
        });
    }

    participant(
        kind: "participant_joined" | "participant_left" | "participant_returned",
        participant: ParticipantIdentity,
        occurredAt: Date
    ): CaptureEvent {
        return this.event({
            kind,
            attemptKey: this.context.attemptKey,
            participant,
            occurredAt: occurredAt.toISOString(),
        });
    }

    transcript(
        text: string,
        providerTimestamp: number,
        metadata: ZoomTranscriptMetadata,
        receivedAt: Date
    ): CaptureEvent {
        const normalizedText = text.trim();
        if (!normalizedText) throw new Error("Zoom transcript text must not be empty");

        const packet = JSON.stringify({
            attemptKey: this.context.attemptKey,
            providerTimestamp,
            userId: providerKey(metadata.userId),
            userName: metadata.userName,
            startTs: metadata.startTs ?? null,
            endTs: metadata.endTs ?? null,
            language: metadata.language ?? null,
            text: normalizedText,
        });
        const sourcePacketHash = sha256(packet);
        const receiveOrder = this.receiveOrder++;

        return this.event({
            kind: "transcript_segment",
            attemptKey: this.context.attemptKey,
            providerEventKey: sourcePacketHash,
            sourcePacketHash,
            sourceKind: "provider_transcript",
            participant: {
                providerParticipantKey: providerKey(metadata.userId),
                displayName: metadata.userName,
            },
            ...(metadata.startTs === undefined ? {} : { providerStartMs: metadata.startTs }),
            ...(metadata.endTs === undefined ? {} : { providerEndMs: metadata.endTs }),
            receivedAt: receivedAt.toISOString(),
            receiveOrder,
            text: normalizedText,
            ...(metadata.language ? { language: metadata.language } : {}),
            occurredAt: receivedAt.toISOString(),
        });
    }

    ended(reasonCode: number, occurredAt: Date): CaptureEvent {
        const reason =
            reasonCode === 3
                ? "capture_user_left"
                : reasonCode === 6
                  ? "meeting_ended"
                  : "provider_stopped";
        return this.event({
            kind: "attempt_ended",
            attemptKey: this.context.attemptKey,
            reason,
            occurredAt: occurredAt.toISOString(),
        });
    }

    occurrenceEnded(reason: string | undefined, occurredAt: Date): CaptureEvent {
        return this.event({
            kind: "occurrence_ended",
            occurredAt: occurredAt.toISOString(),
            ...(reason ? { reason } : {}),
        });
    }

    private event(input: NormalizedCaptureEventInput): CaptureEvent {
        const identity = JSON.stringify({
            occurrenceKey: this.context.occurrenceKey,
            attemptKey: "attemptKey" in input ? input.attemptKey : null,
            kind: input.kind,
            occurredAt: input.occurredAt,
            input,
        });
        return CaptureEventSchema.parse({
            ...input,
            schemaVersion: CALL_NOTES_SCHEMA_VERSION,
            eventId: sha256(identity),
            provider: "zoom",
            occurrenceKey: this.context.occurrenceKey,
        });
    }
}
