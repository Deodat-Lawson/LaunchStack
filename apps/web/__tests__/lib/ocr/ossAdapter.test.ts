/**
 * Tests for the OSS OCR adapters (backed by docling-serve).
 * Mocks fetch to verify the adapter talks to the worker service correctly
 * and normalizes responses into the canonical NormalizedDocument shape.
 */

import { createMarkerAdapter, createDoclingAdapter } from "@launchstack/core/ocr/adapters/ossAdapter";
import { configureOcr } from "@launchstack/core/ocr/config";

const WORKER_URL = "http://test-worker:8001";

describe("OSS OCR Adapters", () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, OCR_WORKER_URL: WORKER_URL };
    configureOcr({ workerUrl: WORKER_URL });
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    configureOcr({});
    global.fetch = originalFetch;
  });

  function mockWorkerResponse(body: unknown, status = 200) {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response);
  }

  describe("createMarkerAdapter (legacy alias → docling)", () => {
    it("hits /parse/docling with url + filename", async () => {
      mockWorkerResponse({
        pages: [{ pageNumber: 1, textBlocks: ["hello"], tables: [] }],
        metadata: { totalPages: 1, provider: "DOCLING", processingTimeMs: 10, confidenceScore: 90 },
      });

      const adapter = createMarkerAdapter();
      const result = await adapter.uploadDocument("https://example.com/doc.pdf");

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe(`${WORKER_URL}/parse/docling`);
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({ url: "https://example.com/doc.pdf", filename: "doc.pdf" });

      expect(result.metadata.provider).toBe("DOCLING");
      expect(result.pages).toHaveLength(1);
      expect(result.pages[0]!.textBlocks).toEqual(["hello"]);
    });

    it("reports getProviderName=DOCLING", () => {
      expect(createMarkerAdapter().getProviderName()).toBe("DOCLING");
    });

    it("throws a descriptive error when the worker is unreachable", async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error("connect ECONNREFUSED"));
      const adapter = createMarkerAdapter();
      await expect(adapter.uploadDocument("https://example.com/doc.pdf")).rejects.toThrow(
        /OCR worker \(DOCLING\) unreachable.*connect ECONNREFUSED/
      );
    });

    it("throws with worker error body on non-2xx", async () => {
      mockWorkerResponse({ detail: "docling boom" }, 500);
      const adapter = createMarkerAdapter();
      await expect(adapter.uploadDocument("https://example.com/doc.pdf")).rejects.toThrow(
        /OCR worker \(DOCLING\) failed: 500/
      );
    });
  });

  describe("createDoclingAdapter", () => {
    it("hits /parse/docling and preserves tables", async () => {
      mockWorkerResponse({
        pages: [
          {
            pageNumber: 1,
            textBlocks: ["row heading"],
            tables: [
              {
                rows: [["a", "b"], ["1", "2"]],
                markdown: "| a | b |\n|---|---|\n| 1 | 2 |",
                rowCount: 2,
                columnCount: 2,
              },
            ],
          },
        ],
        metadata: { totalPages: 1, provider: "DOCLING", processingTimeMs: 25 },
      });

      const adapter = createDoclingAdapter();
      const result = await adapter.uploadDocument("https://example.com/report.docx");

      const [url] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe(`${WORKER_URL}/parse/docling`);
      expect(result.metadata.provider).toBe("DOCLING");
      expect(result.pages[0]!.tables).toHaveLength(1);
      expect(result.pages[0]!.tables![0]!.rowCount).toBe(2);
    });
  });

  describe("relative URL resolution", () => {
    it("rewrites /api/files/... using APP_PUBLIC_URL", async () => {
      process.env.APP_PUBLIC_URL = "http://app:3000";
      mockWorkerResponse({
        pages: [],
        metadata: { totalPages: 0, provider: "DOCLING", processingTimeMs: 1 },
      });

      await createMarkerAdapter().uploadDocument("/api/files/123");

      const [, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(JSON.parse(init.body).url).toBe("http://app:3000/api/files/123");
    });
  });
});
