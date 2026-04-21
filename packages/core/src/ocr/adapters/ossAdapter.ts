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

type OssProvider = Extract<OCRProvider, "MARKER" | "DOCLING">;

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
   */
  private toWorkerReachableUrl(url: string): string {
    if (/^https?:\/\//i.test(url)) return url;
    const base = getOcrConfig().appPublicUrl ?? "http://app:3000";
    return new URL(url, base).toString();
  }
}

export function createMarkerAdapter(workerUrl?: string): OssOCRAdapter {
  return new OssOCRAdapter("DOCLING", workerUrl);
}

export function createDoclingAdapter(workerUrl?: string): OssOCRAdapter {
  return new OssOCRAdapter("DOCLING", workerUrl);
}

export { OssOCRAdapter };
