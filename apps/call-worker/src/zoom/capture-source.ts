import rtms from "@zoom/rtms";
import {
    type CaptureAttemptHandle,
    type CaptureControlInput,
    type CaptureEvent,
    type CaptureEventSink,
    type CaptureSource,
    type StartCaptureInput,
} from "@launchstack/features/call-notes";

import { ZoomCaptureEventNormalizer } from "./normalizer";

export interface ZoomRtmsStartedPayload {
    meeting_uuid: string;
    rtms_stream_id: string;
    server_urls: string;
    [key: string]: unknown;
}

export interface ZoomStartedStreamSource {
    take(occurrenceKey: string): Promise<ZoomRtmsStartedPayload>;
}

export class ZoomControlUnavailableError extends Error {
    constructor(action: "pause" | "resume") {
        super(`Zoom ${action} control is unavailable in the auto-start demo`);
        this.name = "ZoomControlUnavailableError";
    }
}

class SerializedEventSink {
    private pending = Promise.resolve();
    private failure: unknown;

    constructor(private readonly sink: CaptureEventSink) {}

    append(event: CaptureEvent): void {
        this.pending = this.pending
            .then(() => this.sink.append(event))
            .catch((error: unknown) => {
                this.failure ??= error;
            });
    }

    async drain(): Promise<void> {
        await this.pending;
        if (this.failure instanceof Error) throw this.failure;
        if (this.failure) {
            throw new Error("Capture event persistence failed", { cause: this.failure });
        }
    }
}

export class ZoomAutoStartCaptureSource implements CaptureSource {
    readonly capabilities = {
        attributedTranscript: true,
        nativePauseResume: false,
        transportReconnect: false,
        observesCaptureUserReturn: false,
    } as const;

    constructor(private readonly startedStreams: ZoomStartedStreamSource) {}

    async startAttempt(
        input: StartCaptureInput,
        sink: CaptureEventSink
    ): Promise<CaptureAttemptHandle> {
        const payload = await this.startedStreams.take(input.occurrenceKey);
        const normalizer = new ZoomCaptureEventNormalizer({
            occurrenceKey: input.occurrenceKey,
            attemptKey: input.attemptKey,
        });
        const serialized = new SerializedEventSink(sink);
        const client = new rtms.Client();

        client.onJoinConfirm(reason => {
            if (reason === 0) {
                serialized.append(normalizer.connected(payload.rtms_stream_id, new Date()));
                return;
            }
            serialized.append({
                schemaVersion: "call-notes/v1",
                eventId: `zoom_join_failed_${input.attemptKey}_${reason}`,
                kind: "attempt_failed",
                provider: "zoom",
                occurrenceKey: input.occurrenceKey,
                attemptKey: input.attemptKey,
                occurredAt: new Date().toISOString(),
                code: `zoom_join_${reason}`,
                message: "Zoom RTMS join was rejected",
            });
        });

        client.onSessionUpdate(operation => {
            const event = normalizer.sessionState({ operation, occurredAt: new Date() });
            if (event) serialized.append(event);
        });

        client.onUserUpdate((operation, participant) => {
            const kind = operation === rtms.USER_JOIN ? "participant_joined" : "participant_left";
            serialized.append(
                normalizer.participant(
                    kind,
                    {
                        providerParticipantKey: String(participant.id),
                        displayName: participant.name,
                    },
                    new Date()
                )
            );
        });

        client.onTranscriptData((buffer, _size, timestamp, metadata) => {
            serialized.append(
                normalizer.transcript(
                    buffer.toString("utf8"),
                    timestamp,
                    {
                        userId: metadata.userId,
                        userName: metadata.userName,
                        startTs: metadata.startTs,
                        endTs: metadata.endTs,
                    },
                    new Date()
                )
            );
        });

        client.onMediaConnectionInterrupted(timestamp => {
            serialized.append(
                normalizer.interrupted(`media connection interrupted at ${timestamp}`, new Date())
            );
        });

        client.onLeave(reason => {
            serialized.append(normalizer.ended(reason, new Date()));
        });

        client.join(payload);

        return {
            async pause(_control: CaptureControlInput): Promise<void> {
                throw new ZoomControlUnavailableError("pause");
            },
            async resume(_control: CaptureControlInput): Promise<void> {
                throw new ZoomControlUnavailableError("resume");
            },
            async dispose(): Promise<void> {
                client.leave();
                await serialized.drain();
            },
        };
    }
}
