/**
 * Tests for the OSS OCR adapter (backed by services/document-converter).
 * Mocks fetch to verify the adapter speaks the frozen /convert wire contract
 * (schemaVersion 1, X-API-Key auth) and maps the returned EvidenceDocument
 * into the canonical NormalizedDocument shape — with confidence passed
 * through ONLY when the provider reported one.
 */

import { createDoclingAdapter, parseMarkdownTable } from "@launchstack/core/ocr/adapters/ossAdapter";
import { configureOcr } from "@launchstack/core/ocr/config";

const CONVERTER_URL = "http://test-converter:8002";
const API_KEY = "test-converter-key";

/** A valid EvidenceDocument per packages/protocol/src/evidence-document.ts. */
function evidenceFixture(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    provider: "docling",
    source: { filename: "doc.pdf", mimeType: "application/pdf", pageCount: 2 },
    pages: [
      {
        pageNumber: 1,
        text: "Intro\n\nhello world",
        blocks: [
          { type: "heading", text: "Intro" },
          { type: "paragraph", text: "hello world" },
          {
            type: "table",
            text: "| a | b |\n| --- | --- |\n| 1 | 2 |",
          },
        ],
      },
      {
        pageNumber: 2,
        text: "plain page text without blocks",
      },
    ],
    markdown: "# Intro\n\nhello world",
    warnings: [],
    ...overrides,
  };
}

describe("OSS OCR Adapter (document-converter /convert)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    configureOcr({ converter: { url: CONVERTER_URL, apiKey: API_KEY } });
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    configureOcr({});
    global.fetch = originalFetch;
  });

  function mockConverterResponse(body: unknown, status = 200) {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response);
  }

  it("POSTs the ConvertRequest wire shape with the X-API-Key header", async () => {
    mockConverterResponse(evidenceFixture());

    const adapter = createDoclingAdapter();
    await adapter.uploadDocument("https://example.com/doc.pdf");

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`${CONVERTER_URL}/convert`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe(API_KEY);
    expect(JSON.parse(init.body as string)).toEqual({
      schemaVersion: 1,
      url: "https://example.com/doc.pdf",
      filename: "doc.pdf",
    });
  });

  it("maps EvidenceDocument pages into textBlocks and parsed tables", async () => {
    mockConverterResponse(evidenceFixture());

    const result = await createDoclingAdapter().uploadDocument(
      "https://example.com/doc.pdf"
    );

    expect(result.metadata.provider).toBe("DOCLING");
    expect(result.metadata.totalPages).toBe(2);
    expect(result.pages).toHaveLength(2);

    // Page 1: non-table blocks become textBlocks; table blocks become tables.
    expect(result.pages[0]!.textBlocks).toEqual(["Intro", "hello world"]);
    expect(result.pages[0]!.tables).toHaveLength(1);
    const table = result.pages[0]!.tables[0]!;
    expect(table.rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(table.rowCount).toBe(2);
    expect(table.columnCount).toBe(2);
    expect(table.markdown).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |");

    // Page 2 has no blocks: the full page text is the single text block.
    expect(result.pages[1]!.textBlocks).toEqual([
      "plain page text without blocks",
    ]);
    expect(result.pages[1]!.tables).toEqual([]);
  });

  it("omits confidenceScore when the EvidenceDocument reports no confidence", async () => {
    mockConverterResponse(evidenceFixture());

    const result = await createDoclingAdapter().uploadDocument(
      "https://example.com/doc.pdf"
    );

    expect(result.metadata.confidenceScore).toBeUndefined();
    expect("confidenceScore" in result.metadata).toBe(false);
  });

  it("passes through a provider-reported [0,1] confidence unscaled", async () => {
    mockConverterResponse(evidenceFixture({ confidence: 0.42 }));

    const result = await createDoclingAdapter().uploadDocument(
      "https://example.com/doc.pdf"
    );

    expect(result.metadata.confidenceScore).toBe(0.42);
  });

  it("reports getProviderName=DOCLING", () => {
    expect(createDoclingAdapter().getProviderName()).toBe("DOCLING");
  });

  it("throws a descriptive error when the converter is unreachable", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(
      new Error("connect ECONNREFUSED")
    );
    await expect(
      createDoclingAdapter().uploadDocument("https://example.com/doc.pdf")
    ).rejects.toThrow(/Document converter unreachable.*connect ECONNREFUSED/);
  });

  it("throws with the converter error body on non-2xx", async () => {
    mockConverterResponse(
      { error: { code: "docling-not-configured", message: "boom" } },
      503
    );
    await expect(
      createDoclingAdapter().uploadDocument("https://example.com/doc.pdf")
    ).rejects.toThrow(/Document converter \/convert failed: 503/);
  });

  it("throws when no converter is configured", async () => {
    configureOcr({});
    await expect(
      createDoclingAdapter().uploadDocument("https://example.com/doc.pdf")
    ).rejects.toThrow(/DOCUMENT_CONVERTER_URL/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a response that fails EvidenceDocument validation", async () => {
    mockConverterResponse({ schemaVersion: 1, pages: "nope" });
    await expect(
      createDoclingAdapter().uploadDocument("https://example.com/doc.pdf")
    ).rejects.toThrow();
  });

  describe("relative URL resolution", () => {
    it("rewrites /api/files/... using the configured appPublicUrl", async () => {
      configureOcr({
        converter: { url: CONVERTER_URL, apiKey: API_KEY },
        appPublicUrl: "http://app:3000",
      });
      mockConverterResponse(evidenceFixture({ pages: [], source: {} }));

      await createDoclingAdapter().uploadDocument("/api/files/123");

      const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(JSON.parse(init.body as string).url).toBe(
        "http://app:3000/api/files/123"
      );
    });
  });

  describe("parseMarkdownTable", () => {
    it("drops the alignment separator row and keeps headers + data", () => {
      const table = parseMarkdownTable(
        "| h1 | h2 | h3 |\n| :--- | ---: | :---: |\n| a | b | c |"
      );
      expect(table.rows).toEqual([
        ["h1", "h2", "h3"],
        ["a", "b", "c"],
      ]);
      expect(table.rowCount).toBe(2);
      expect(table.columnCount).toBe(3);
    });

    it("ignores non-pipe lines and handles ragged rows", () => {
      const table = parseMarkdownTable("intro text\n| a | b |\n| c |");
      expect(table.rows).toEqual([["a", "b"], ["c"]]);
      expect(table.columnCount).toBe(2);
    });
  });
});
