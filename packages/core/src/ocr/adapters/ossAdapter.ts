/**
 * OSS OCR Adapter — calls the self-hosted ocr-worker FastAPI service
 * which wraps Marker (PDFs) and Docling (Office + broad formats).
 *
 * Deployment: services/ocr-worker/ (Docker), default URL http://localhost:8001.
 * Zero per-page cost — runs on user's own infrastructure.
 */

import type {
  OCRAdapter,
  OCRAdapterOptions,
  NormalizedDocument,
  PageContent,
  OCRProvider,
} from "../types";
import { getOcrConfig } from "../config";
import {
  FILE_ACCESS_TOKEN_PARAM,
  signFileAccessToken,
} from "../../crypto/file-access-token";

type OssProvider = Extract<OCRProvider, "MARKER" | "DOCLING">;

const FILE_ROUTE_ID_PATTERN = /^\/api\/files\/(\d+)$/;

interface WorkerParseResponse {
  pages: PageContent[];
  metadata: {
    totalPages: number;
    provider: OssProvider;
    processingTimeMs: number;
    confidenceScore?: number;
  };
}

const DEFAULT_WORKER_URL = "http://localhost:8001";
// Marker/Docling on CPU can be slow on first run (model download + inference).
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

class OssOCRAdapter implements OCRAdapter {
  private readonly workerUrl: string;
  private readonly provider: OssProvider;
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(provider: OssProvider, workerUrl?: string, timeoutMs?: number) {
    this.provider = provider;
    this.workerUrl = (workerUrl ?? getOcrConfig().workerUrl ?? DEFAULT_WORKER_URL).replace(/\/$/, "");
    this.endpoint = provider === "MARKER" ? "/parse/marker" : "/parse/docling";
    this.timeoutMs = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  getProviderName(): OCRProvider {
    return this.provider;
  }

  async uploadDocument(
    documentUrl: string,
    _options?: OCRAdapterOptions
  ): Promise<NormalizedDocument> {
    // Minted here rather than by the caller: the token is short-lived, so it
    // has to be created on the way into this fetch and not reused by a later
    // retry or a second pass over the same document.
    const absoluteUrl = this.toWorkerReachableUrl(documentUrl);
    const filename = documentUrl.split("/").pop()?.split("?")[0];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.workerUrl}${this.endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: absoluteUrl, filename }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      throw new Error(
        `OCR worker (${this.provider}) unreachable at ${this.workerUrl}: ${(err as Error).message}`
      );
    }
    clearTimeout(timer);

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `OCR worker (${this.provider}) failed: ${response.status} ${response.statusText} — ${body.slice(0, 500)}`
      );
    }

    const data = (await response.json()) as WorkerParseResponse;

    return {
      pages: data.pages,
      metadata: {
        totalPages: data.metadata.totalPages,
        provider: this.provider,
        processingTimeMs: data.metadata.processingTimeMs,
        confidenceScore: data.metadata.confidenceScore,
      },
    };
  }

  async extractPage(documentUrl: string, pageNumber: number): Promise<PageContent> {
    const doc = await this.uploadDocument(documentUrl);
    const page = doc.pages.find((p) => p.pageNumber === pageNumber);
    if (!page) throw new Error(`Page ${pageNumber} not found in document`);
    return page;
  }

  /**
   * The worker runs in a separate container and cannot resolve Next.js
   * internal routes like /api/files/123. Rewrite relative URLs so the worker
   * can fetch them via the app's public origin.
   *
   * /api/files/{id} additionally requires auth, and the worker has no Clerk
   * session, so we attach a short-lived token scoped to that one file. The
   * reference is recognized by pathname, so a URL that was already made
   * absolute upstream still gets signed — otherwise the worker would fetch
   * it without a token and receive a 401.
   */
  private toWorkerReachableUrl(url: string): string {
    const cfg = getOcrConfig();
    const isAbsolute = /^https?:\/\//i.test(url);
    const absolute = new URL(
      url,
      isAbsolute ? undefined : (cfg.appPublicUrl ?? "http://app:3000")
    );

    const fileId = FILE_ROUTE_ID_PATTERN.exec(absolute.pathname)?.[1];
    if (!fileId) return absolute.toString();

    const token = signFileAccessToken(fileId, cfg.fileAccessTokenSecret);
    if (token) {
      absolute.searchParams.set(FILE_ACCESS_TOKEN_PARAM, token);
    } else {
      console.warn(
        "[OssOCRAdapter] FILE_ACCESS_TOKEN_SECRET is not configured; the OCR worker cannot read database-backed documents."
      );
    }

    return absolute.toString();
  }
}

export function createMarkerAdapter(workerUrl?: string): OssOCRAdapter {
  return new OssOCRAdapter("DOCLING", workerUrl);
}

export function createDoclingAdapter(workerUrl?: string): OssOCRAdapter {
  return new OssOCRAdapter("DOCLING", workerUrl);
}

export { OssOCRAdapter };
