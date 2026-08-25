/**
 * Conversion's ports — the interfaces this feature offers the pipeline
 * (ADR-004). Implementations live beside them: the HTTP clients in
 * `document-converter/client.ts` and `audio-transcription/client.ts`.
 */
import type {
    ConvertRequest,
    RenderPagesRequest,
    RenderPagesResponse,
    RouteRequest,
    RouteResponse,
} from "./document-converter/wire";
import type { EvidenceDocument } from "./evidence-document";
import type { TranscribeResponse } from "./audio-transcription/wire";
import type {
    VideoTranscribeRequest,
    VideoTranscribeResponse,
} from "./video-transcription/wire";

export interface DocumentConverterPort {
    route(req: RouteRequest): Promise<RouteResponse>;
    convert(req: ConvertRequest): Promise<EvidenceDocument>;
    renderPages(req: RenderPagesRequest): Promise<RenderPagesResponse>;
}

export interface TranscriptionPort {
    transcribeFile(input: {
        bytes: Uint8Array;
        filename: string;
        traceId: string;
    }): Promise<TranscribeResponse>;
    transcribeUrl(
        req: VideoTranscribeRequest & { traceId: string }
    ): Promise<VideoTranscribeResponse>;
}
