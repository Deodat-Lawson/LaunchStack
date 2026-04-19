/**
 * Property-based tests for Adeu TypeScript adapter request/response round-trip.
 * Feature: adeu-integration, Property 11: TypeScript adapter request/response round-trip
 *
 * For any valid DOCX Buffer and valid parameters, the TypeScript adapter should
 * correctly construct a multipart FormData request, send it to the service URL,
 * and parse the response into the correct typed object.
 */

import * as fc from "fast-check";
import {
  readDocx,
  processDocumentBatch,
  acceptAllChanges,
  applyEditsAsMarkdown,
  diffDocxFiles,
} from "~/lib/adeu/client";

import type {
  ReadDocxResponse,
  BatchSummary,
  ApplyEditsMarkdownResponse,
  DiffResponse,
} from "~/lib/adeu/types";

const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ADEU_SERVICE_URL = "http://localhost:8000";
});

afterEach(() => {
  delete process.env.ADEU_SERVICE_URL;
});

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generates random Buffers representing DOCX files */
const docxBufferArb = fc
  .uint8Array({ minLength: 4, maxLength: 1024 })
  .map((arr) => Buffer.from(arr));

/** Generates valid filenames */
const filenameArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length > 0)
  .map((s) => s.replace(/[^a-zA-Z0-9.-]/g, "_") + ".docx");

/** Generates document text content */
const textContentArb = fc
  .string({ minLength: 1, maxLength: 500 })
  .filter((s) => s.trim().length > 0);

/** Generates a valid ReadDocxResponse */
const readResponseArb = fc.record({
  text: textContentArb,
  filename: filenameArb,
});

/** Generates a valid BatchSummary */
const batchSummaryArb: fc.Arbitrary<BatchSummary> = fc.record({
  applied_edits: fc.nat({ max: 100 }),
  skipped_edits: fc.nat({ max: 100 }),
  applied_actions: fc.nat({ max: 100 }),
  skipped_actions: fc.nat({ max: 100 }),
});

/** Generates valid edit objects */
const editArb = fc.record({
  target_text: textContentArb,
  new_text: textContentArb,
  comment: fc.option(textContentArb, { nil: undefined }),
});

/** Generates valid author names */
const authorNameArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length > 0);

/** Generates a markdown response */
const markdownResponseArb: fc.Arbitrary<ApplyEditsMarkdownResponse> = fc.record({
  markdown: textContentArb,
});

/** Generates a diff response */
const diffResponseArb: fc.Arbitrary<DiffResponse> = fc.record({
  diff: fc.string(),
  has_differences: fc.boolean(),
});

// ---------------------------------------------------------------------------
// Property 11: Round-trip tests
// ---------------------------------------------------------------------------
describe("Feature: adeu-integration, Property 11: TypeScript adapter request/response round-trip", () => {
  it("readDocx: for any buffer and clean_view, correctly constructs FormData and parses response", async () => {
    await fc.assert(
      fc.asyncProperty(
        docxBufferArb,
        fc.boolean(),
        readResponseArb,
        async (buffer, cleanView, expectedResponse) => {
          mockFetch.mockResolvedValueOnce(
            new Response(JSON.stringify(expectedResponse), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );

          const result = await readDocx(buffer, { cleanView });

          // Verify request
          expect(mockFetch).toHaveBeenCalledTimes(1);
          const [url, opts] = mockFetch.mock.calls[0];
          expect(url).toBe("http://localhost:8000/adeu/read");
          expect(opts.method).toBe("POST");

          const formData: FormData = opts.body;
          expect(formData).toBeInstanceOf(FormData);
          expect(formData.get("file")).toBeTruthy();
          expect(formData.get("clean_view")).toBe(String(cleanView));

          // Verify response parsing
          expect(result.text).toBe(expectedResponse.text);
          expect(result.filename).toBe(expectedResponse.filename);

          mockFetch.mockClear();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("processDocumentBatch: for any buffer, author, and edits, correctly constructs request and parses summary", async () => {
    await fc.assert(
      fc.asyncProperty(
        docxBufferArb,
        authorNameArb,
        fc.array(editArb, { minLength: 0, maxLength: 5 }),
        batchSummaryArb,
        async (buffer, authorName, edits, expectedSummary) => {
          mockFetch.mockResolvedValueOnce(
            new Response("modified-docx-bytes", {
              status: 200,
              headers: {
                "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "x-batch-summary": JSON.stringify(expectedSummary),
              },
            }),
          );

          const result = await processDocumentBatch(buffer, {
            author_name: authorName,
            edits: edits.length > 0 ? edits : undefined,
          });

          // Verify request
          const [url, opts] = mockFetch.mock.calls[0];
          expect(url).toBe("http://localhost:8000/adeu/process-batch");

          const formData: FormData = opts.body;
          expect(formData.get("file")).toBeTruthy();

          const bodyJson = JSON.parse(formData.get("body") as string);
          expect(bodyJson.author_name).toBe(authorName);

          // Verify response
          expect(result.summary).toEqual(expectedSummary);
          expect(result.file).toBeInstanceOf(Blob);

          mockFetch.mockClear();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("acceptAllChanges: for any buffer, returns a Blob response", async () => {
    await fc.assert(
      fc.asyncProperty(docxBufferArb, async (buffer) => {
        mockFetch.mockResolvedValueOnce(
          new Response("clean-docx", {
            status: 200,
            headers: {
              "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            },
          }),
        );

        const result = await acceptAllChanges(buffer);

        // Verify request
        const [url, opts] = mockFetch.mock.calls[0];
        expect(url).toBe("http://localhost:8000/adeu/accept-all");
        expect(opts.method).toBe("POST");

        const formData: FormData = opts.body;
        expect(formData.get("file")).toBeTruthy();

        // Verify response
        expect(result).toBeInstanceOf(Blob);

        mockFetch.mockClear();
      }),
      { numRuns: 100 },
    );
  });

  it("applyEditsAsMarkdown: for any buffer, edits, and options, parses markdown response", async () => {
    await fc.assert(
      fc.asyncProperty(
        docxBufferArb,
        fc.array(editArb, { minLength: 1, maxLength: 5 }),
        fc.boolean(),
        fc.boolean(),
        markdownResponseArb,
        async (buffer, edits, highlightOnly, includeIndex, expectedResponse) => {
          mockFetch.mockResolvedValueOnce(
            new Response(JSON.stringify(expectedResponse), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );

          const result = await applyEditsAsMarkdown(buffer, {
            edits,
            highlight_only: highlightOnly,
            include_index: includeIndex,
          });

          // Verify request
          const [url] = mockFetch.mock.calls[0];
          expect(url).toBe("http://localhost:8000/adeu/apply-edits-markdown");

          const formData: FormData = mockFetch.mock.calls[0][1].body;
          const bodyJson = JSON.parse(formData.get("body") as string);
          expect(bodyJson.edits).toHaveLength(edits.length);
          expect(bodyJson.highlight_only).toBe(highlightOnly);
          expect(bodyJson.include_index).toBe(includeIndex);

          // Verify response
          expect(result.markdown).toBe(expectedResponse.markdown);

          mockFetch.mockClear();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("diffDocxFiles: for any two buffers and compare_clean, parses diff response", async () => {
    await fc.assert(
      fc.asyncProperty(
        docxBufferArb,
        docxBufferArb,
        fc.boolean(),
        diffResponseArb,
        async (original, modified, compareClean, expectedResponse) => {
          mockFetch.mockResolvedValueOnce(
            new Response(JSON.stringify(expectedResponse), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );

          const result = await diffDocxFiles(original, modified, { compareClean });

          // Verify request
          const [url] = mockFetch.mock.calls[0];
          expect(url).toBe("http://localhost:8000/adeu/diff");

          const formData: FormData = mockFetch.mock.calls[0][1].body;
          expect(formData.get("original")).toBeTruthy();
          expect(formData.get("modified")).toBeTruthy();
          expect(formData.get("compare_clean")).toBe(String(compareClean));

          // Verify response
          expect(result.diff).toBe(expectedResponse.diff);
          expect(result.has_differences).toBe(expectedResponse.has_differences);

          mockFetch.mockClear();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("all adapters use the correct base URL from environment", async () => {
    const urlArb = fc.webUrl({ withFragments: false, withQueryParameters: false });

    await fc.assert(
      fc.asyncProperty(urlArb, async (baseUrl) => {
        process.env.ADEU_SERVICE_URL = baseUrl;

        // Test readDocx
        mockFetch.mockResolvedValueOnce(
          new Response(JSON.stringify({ text: "t", filename: "f.docx" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
        await readDocx(makeBuffer());
        expect(mockFetch.mock.calls[0][0]).toBe(`${baseUrl}/adeu/read`);

        mockFetch.mockClear();
      }),
      { numRuns: 50 },
    );
  });
});

function makeBuffer(): Buffer {
  return Buffer.from("test");
}
