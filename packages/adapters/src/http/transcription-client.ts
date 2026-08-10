/**
 * HTTP client for services/transcription, implementing TranscriptionPort
 * (ADR-004 §2). /transcribe is multipart (the boundary comes from FormData —
 * never set Content-Type manually); /download-and-transcribe is JSON.
 */
import {
  transcribeResponseSchema,
  videoTranscribeResponseSchema,
  type TranscribeResponse,
  type VideoTranscribeRequest,
  type VideoTranscribeResponse,
} from "@launchstack/protocol";
import type { TranscriptionPort } from "@launchstack/application";

import {
  ComputeServiceError,
  postJson,
  type ServiceClientConfig,
} from "./service-client";

export interface TranscriptionClientConfig extends ServiceClientConfig {
  /** Whisper on long media takes minutes. Default 20 min. */
  transcribeTimeoutMs?: number;
}

export class HttpTranscriptionClient implements TranscriptionPort {
  constructor(private readonly config: TranscriptionClientConfig) {}

  async transcribeFile(input: {
    bytes: Uint8Array;
    filename: string;
    traceId: string;
  }): Promise<TranscribeResponse> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const timeout = this.config.transcribeTimeoutMs ?? 1_200_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const url = `${this.config.baseUrl.replace(/\/$/, "")}/transcribe`;

    const form = new FormData();
    // Copy into a plain ArrayBuffer-backed view: Uint8Array<ArrayBufferLike>
    // is not assignable to BlobPart under the DOM lib types.
    const bytes = new Uint8Array(input.bytes.byteLength);
    bytes.set(input.bytes);
    form.append("file", new Blob([bytes.buffer]), input.filename);

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "X-API-Key": this.config.apiKey,
          "X-Trace-Id": input.traceId,
        },
        body: form,
        signal: controller.signal,
      });
    } catch (error) {
      throw new ComputeServiceError(
        controller.signal.aborted
          ? `transcription /transcribe timed out after ${timeout}ms`
          : `transcription /transcribe unreachable: ${
              error instanceof Error ? error.message : String(error)
            }`,
        {
          service: "transcription",
          path: "/transcribe",
          traceId: input.traceId,
          retryable: true,
        },
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new ComputeServiceError(
        `transcription /transcribe returned ${response.status}`,
        {
          service: "transcription",
          path: "/transcribe",
          status: response.status,
          traceId: input.traceId,
          retryable: response.status >= 500,
        },
      );
    }

    const parsed = transcribeResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new ComputeServiceError(
        `transcription /transcribe response failed contract validation: ${parsed.error.message}`,
        {
          service: "transcription",
          path: "/transcribe",
          traceId: input.traceId,
          retryable: false,
        },
      );
    }
    return parsed.data;
  }

  transcribeUrl(
    req: VideoTranscribeRequest & { traceId: string },
  ): Promise<VideoTranscribeResponse> {
    const { traceId, ...body } = req;
    return postJson(
      "transcription",
      this.config,
      "/download-and-transcribe",
      body,
      videoTranscribeResponseSchema,
      traceId,
      this.config.transcribeTimeoutMs ?? 1_200_000,
    );
  }
}
