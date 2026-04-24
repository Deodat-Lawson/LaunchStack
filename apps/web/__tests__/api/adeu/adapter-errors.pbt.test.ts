/**
 * Property-based tests for Adeu TypeScript adapter error propagation.
 * Feature: adeu-integration, Property 12: TypeScript adapter error propagation
 *
 * For any HTTP error response from the Adeu service (status 4xx or 5xx),
 * the TypeScript adapter should throw an AdeuServiceError containing
 * the exact status code and the detail field from the response body.
 */

import * as fc from "fast-check";
import {
  readDocx,
  processDocumentBatch,
  acceptAllChanges,
  applyEditsAsMarkdown,
  diffDocxFiles,
  AdeuServiceError,
} from "@launchstack/features/adeu";

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

/** Generates HTTP error status codes (400-599) */
const httpErrorStatusArb = fc.oneof(
  fc.integer({ min: 400, max: 499 }), // 4xx
  fc.integer({ min: 500, max: 599 }), // 5xx
);

/** Generates non-empty detail strings */
const detailArb = fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0);

/** Generates error response bodies with a detail field */
const errorBodyArb = fc.record({
  detail: detailArb,
  errors: fc.option(fc.array(fc.string(), { minLength: 0, maxLength: 5 }), { nil: undefined }),
});

function makeDocxBuffer(): Buffer {
  return Buffer.from("PK\x03\x04fake-docx");
}

function makeErrorResponse(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Mirrors the adapter's `handleErrorResponse` formatting: appends joined
 * errors to `detail` when the `errors` array is non-empty.
 */
function expectedDetail(body: { detail: string; errors?: string[] | null }): string {
  const errors = body.errors;
  return errors && errors.length > 0
    ? `${body.detail}: ${errors.join("; ")}`
    : body.detail;
}

// ---------------------------------------------------------------------------
// Property 12: Error propagation across all adapter functions
// ---------------------------------------------------------------------------
describe("Feature: adeu-integration, Property 12: TypeScript adapter error propagation", () => {
  it("readDocx propagates status code and detail for any HTTP error", async () => {
    await fc.assert(
      fc.asyncProperty(httpErrorStatusArb, errorBodyArb, async (status, body) => {
        mockFetch.mockResolvedValueOnce(makeErrorResponse(status, body));

        try {
          await readDocx(makeDocxBuffer());
          throw new Error("should have thrown");
        } catch (e) {
          expect(e).toBeInstanceOf(AdeuServiceError);
          const err = e as AdeuServiceError;
          expect(err.statusCode).toBe(status);
          expect(err.detail).toBe(expectedDetail(body));
        }
      }),
      { numRuns: 100 },
    );
  });

  it("processDocumentBatch propagates status code and detail for any HTTP error", async () => {
    await fc.assert(
      fc.asyncProperty(httpErrorStatusArb, errorBodyArb, async (status, body) => {
        mockFetch.mockResolvedValueOnce(makeErrorResponse(status, body));

        try {
          await processDocumentBatch(makeDocxBuffer(), { author_name: "Test" });
          throw new Error("should have thrown");
        } catch (e) {
          expect(e).toBeInstanceOf(AdeuServiceError);
          const err = e as AdeuServiceError;
          expect(err.statusCode).toBe(status);
          expect(err.detail).toBe(expectedDetail(body));
        }
      }),
      { numRuns: 100 },
    );
  });

  it("acceptAllChanges propagates status code and detail for any HTTP error", async () => {
    await fc.assert(
      fc.asyncProperty(httpErrorStatusArb, errorBodyArb, async (status, body) => {
        mockFetch.mockResolvedValueOnce(makeErrorResponse(status, body));

        try {
          await acceptAllChanges(makeDocxBuffer());
          throw new Error("should have thrown");
        } catch (e) {
          expect(e).toBeInstanceOf(AdeuServiceError);
          const err = e as AdeuServiceError;
          expect(err.statusCode).toBe(status);
          expect(err.detail).toBe(expectedDetail(body));
        }
      }),
      { numRuns: 100 },
    );
  });

  it("applyEditsAsMarkdown propagates status code and detail for any HTTP error", async () => {
    await fc.assert(
      fc.asyncProperty(httpErrorStatusArb, errorBodyArb, async (status, body) => {
        mockFetch.mockResolvedValueOnce(makeErrorResponse(status, body));

        try {
          await applyEditsAsMarkdown(makeDocxBuffer(), {
            edits: [{ target_text: "x", new_text: "y" }],
          });
          throw new Error("should have thrown");
        } catch (e) {
          expect(e).toBeInstanceOf(AdeuServiceError);
          const err = e as AdeuServiceError;
          expect(err.statusCode).toBe(status);
          expect(err.detail).toBe(expectedDetail(body));
        }
      }),
      { numRuns: 100 },
    );
  });

  it("diffDocxFiles propagates status code and detail for any HTTP error", async () => {
    await fc.assert(
      fc.asyncProperty(httpErrorStatusArb, errorBodyArb, async (status, body) => {
        mockFetch.mockResolvedValueOnce(makeErrorResponse(status, body));

        try {
          await diffDocxFiles(makeDocxBuffer(), makeDocxBuffer());
          throw new Error("should have thrown");
        } catch (e) {
          expect(e).toBeInstanceOf(AdeuServiceError);
          const err = e as AdeuServiceError;
          expect(err.statusCode).toBe(status);
          expect(err.detail).toBe(expectedDetail(body));
        }
      }),
      { numRuns: 100 },
    );
  });

  it("all adapters throw AdeuServiceError with statusCode 0 on network failure", async () => {
    const errorMessageArb = fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0);

    await fc.assert(
      fc.asyncProperty(errorMessageArb, async (errorMessage) => {
        const adapters = [
          () => readDocx(makeDocxBuffer()),
          () => processDocumentBatch(makeDocxBuffer(), { author_name: "A" }),
          () => acceptAllChanges(makeDocxBuffer()),
          () => applyEditsAsMarkdown(makeDocxBuffer(), { edits: [{ target_text: "x", new_text: "y" }] }),
          () => diffDocxFiles(makeDocxBuffer(), makeDocxBuffer()),
        ];

        for (const adapter of adapters) {
          mockFetch.mockRejectedValueOnce(new Error(errorMessage));

          try {
            await adapter();
            throw new Error("should have thrown");
          } catch (e) {
            expect(e).toBeInstanceOf(AdeuServiceError);
            const err = e as AdeuServiceError;
            expect(err.statusCode).toBe(0);
            expect(err.detail).toBe(errorMessage);
          }
        }
      }),
      { numRuns: 20 }, // 20 runs × 5 adapters = 100 checks
    );
  });
});
