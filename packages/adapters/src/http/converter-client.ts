/**
 * HTTP client for services/document-converter, implementing
 * DocumentConverterPort (ADR-004 §1). Conversion runs long OCR jobs, so its
 * timeout is separate from the short routing/rendering calls.
 */
import {
  convertResponseSchema,
  renderPagesResponseSchema,
  routeResponseSchema,
  type ConvertRequest,
  type EvidenceDocument,
  type RenderPagesRequest,
  type RenderPagesResponse,
  type RouteRequest,
  type RouteResponse,
} from "@launchstack/protocol";
import type { DocumentConverterPort } from "@launchstack/application";

import { postJson, type ServiceClientConfig } from "./service-client";

export interface ConverterClientConfig extends ServiceClientConfig {
  /** Timeout for /convert (docling can take minutes). Default 10 min. */
  convertTimeoutMs?: number;
}

export class HttpDocumentConverterClient implements DocumentConverterPort {
  constructor(private readonly config: ConverterClientConfig) {}

  route(req: RouteRequest): Promise<RouteResponse> {
    return postJson(
      "document-converter",
      this.config,
      "/route",
      req,
      routeResponseSchema,
      req.traceId ?? "untraced",
    );
  }

  convert(req: ConvertRequest): Promise<EvidenceDocument> {
    return postJson(
      "document-converter",
      this.config,
      "/convert",
      req,
      convertResponseSchema,
      req.traceId ?? "untraced",
      this.config.convertTimeoutMs ?? 600_000,
    );
  }

  renderPages(req: RenderPagesRequest): Promise<RenderPagesResponse> {
    return postJson(
      "document-converter",
      this.config,
      "/render-pages",
      req,
      renderPagesResponseSchema,
      req.traceId ?? "untraced",
    );
  }
}
