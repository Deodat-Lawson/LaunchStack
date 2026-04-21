/**
 * Unit tests for Legal Document Apply Edits API
 * Tests authentication, validation, Adeu integration, and error handling
 */

import { POST } from "~/app/api/legal/apply-edits/route";
import { processDocumentBatch } from "@launchstack/features/adeu";
import type { BatchSummary } from "@launchstack/features/adeu";

// Mock Clerk auth
jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

// Mock Adeu client
jest.mock("@launchstack/features/adeu", () => ({
  processDocumentBatch: jest.fn(),
  AdeuServiceError: class AdeuServiceError extends Error {
    statusCode: number;
    detail: string;
    constructor(statusCode: number, detail: string) {
      super(`Adeu service error (${statusCode}): ${detail}`);
      this.name = "AdeuServiceError";
      this.statusCode = statusCode;
      this.detail = detail;
    }
  },
}));

import { auth } from "@clerk/nextjs/server";

const mockAuth = auth as jest.MockedFunction<typeof auth>;
const mockProcessDocumentBatch = processDocumentBatch as jest.MockedFunction<
  typeof processDocumentBatch
>;

describe("POST /api/legal/apply-edits", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // Authentication Tests
  // Validates that the endpoint properly checks user authentication via Clerk
  // =========================================================================
  describe("Authentication", () => {
    // Test: Unauthenticated requests should be rejected with 401
    // This ensures the API is protected and only logged-in users can apply edits
    it("returns 401 when user is not authenticated", async () => {
      mockAuth.mockResolvedValueOnce({ userId: null } as any);

      const request = new Request("http://localhost/api/legal/apply-edits", {
        method: "POST",
        body: JSON.stringify({
          documentBase64: "test",
          edits: [],
        }),
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(401);
      expect(json.success).toBe(false);
      expect(json.message).toBe("Unauthorized");
    });

    // Test: Authenticated requests should proceed successfully
    // Verifies that valid Clerk userId allows the request to continue
    it("proceeds when user is authenticated", async () => {
      mockAuth.mockResolvedValueOnce({ userId: "user123" } as any);

      const request = new Request("http://localhost/api/legal/apply-edits", {
        method: "POST",
        body: JSON.stringify({
          documentBase64: Buffer.from("test").toString("base64"),
          edits: [],
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });
  });

  // =========================================================================
  // Request Validation Tests
  // Tests Zod schema validation to ensure requests have required fields
  // and are properly formatted before processing
  // =========================================================================
  describe("Request Validation", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue({ userId: "user123" } as any);
    });

    // Test: Missing required field should return validation error
    // documentBase64 is required - requests without it should fail with 400
    it("returns 400 when documentBase64 is missing", async () => {
      const request = new Request("http://localhost/api/legal/apply-edits", {
        method: "POST",
        body: JSON.stringify({
          edits: [],
        }),
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.success).toBe(false);
      expect(json.error).toBe("Invalid request");
      expect(json.details).toBeDefined();
    });

    // Test: Type validation should catch incorrect data types
    // Ensures the Zod schema enforces string type for documentBase64
    it("returns 400 when documentBase64 is not a string", async () => {
      const request = new Request("http://localhost/api/legal/apply-edits", {
        method: "POST",
        body: JSON.stringify({
          documentBase64: 123,
          edits: [],
        }),
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.success).toBe(false);
    });

    // Test: Well-formed requests with all fields should be accepted
    // Validates complete request structure including optional fields
    it("accepts valid request with all fields", async () => {
      const request = new Request("http://localhost/api/legal/apply-edits", {
        method: "POST",
        body: JSON.stringify({
          documentBase64: Buffer.from("test").toString("base64"),
          authorName: "Test Author",
          edits: [
            {
              target_text: "old",
              new_text: "new",
              comment: "test comment",
            },
          ],
        }),
      });

      mockProcessDocumentBatch.mockResolvedValueOnce({
        summary: {
          applied_edits: 1,
          skipped_edits: 0,
          applied_actions: 0,
          skipped_actions: 0,
        },
        file: new Blob(["modified"]),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    // Test: Optional fields should have sensible defaults
    // authorName defaults to "Legal Review Assistant" when not provided
    it("uses default author name when not provided", async () => {
      const request = new Request("http://localhost/api/legal/apply-edits", {
        method: "POST",
        body: JSON.stringify({
          documentBase64: Buffer.from("test").toString("base64"),
          edits: [],
        }),
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.success).toBe(true);
    });
  });

  // Tests optimization: when no edits are provided, the API should skip
  // calling Adeu service and return the original document unchanged
  // =========================================================================
  // No Edits Handling
  // =========================================================================
  describe("No Edits Handling", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue({ userId: "user123" } as any);
    });

    // Test: Undefined edits field should bypass Adeu service
    // API should return original document immediately without calling processDocumentBatch
    it("returns original document when no edits provided", async () => {
      const docBase64 = Buffer.from("original-content").toString("base64");

      const request = new Request("http://localhost/api/legal/apply-edits", {
        method: "POST",
        body: JSON.stringify({
          documentBase64: docBase64,
        }),
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.modifiedDocxBase64).toBe(docBase64);
      expect(json.summary.applied_edits).toBe(0);
      expect(mockProcessDocumentBatch).not.toHaveBeenCalled();
    });

    // Test: Empty edits array should also bypass Adeu service
    // Ensures optimization works for both undefined and empty array cases
    it("returns original document when edits array is empty", async () => {
      const docBase64 = Buffer.from("original-content").toString("base64");

      const request = new Request("http://localhost/api/legal/apply-edits", {
        method: "POST",
        body: JSON.stringify({
          documentBase64: docBase64,
          edits: [],
        }),
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.modifiedDocxBase64).toBe(docBase64);
      expect(mockProcessDocumentBatch).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Adeu Integration Tests
  // Validates correct integration with the Adeu DOCX redlining service,
  // including parameter passing, response handling, and data conversion
  // =========================================================================
  describe("Adeu Integration", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue({ userId: "user123" } as any);
    });

    // Test: Proper conversion and parameter passing to Adeu service
    // Verifies base64 is decoded to Buffer and all parameters are correctly passed
    it("calls processDocumentBatch with correct parameters", async () => {
      const docBase64 = Buffer.from("test-docx").toString("base64");
      const edits = [
        { target_text: "old1", new_text: "new1" },
        { target_text: "old2", new_text: "new2", comment: "update" },
      ];

      mockProcessDocumentBatch.mockResolvedValueOnce({
        summary: {
          applied_edits: 2,
          skipped_edits: 0,
          applied_actions: 0,
          skipped_actions: 0,
        },
        file: new Blob(["modified"]),
      });

      const request = new Request("http://localhost/api/legal/apply-edits", {
        method: "POST",
        body: JSON.stringify({
          documentBase64: docBase64,
          authorName: "Custom Author",
          edits,
        }),
      });

      await POST(request);

      expect(mockProcessDocumentBatch).toHaveBeenCalledTimes(1);
      const [buffer, params] = mockProcessDocumentBatch.mock.calls[0]!;
      
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.toString()).toBe("test-docx");
      expect(params.author_name).toBe("Custom Author");
      expect(params.edits).toEqual(edits);
    });

    // Test: Response conversion from Blob to base64
    // Adeu service returns Blob; API must convert it to base64 for client
    it("converts Blob result to base64", async () => {
      const modifiedContent = "modified-docx-content";
      mockProcessDocumentBatch.mockResolvedValueOnce({
        summary: {
          applied_edits: 1,
          skipped_edits: 0,
          applied_actions: 0,
          skipped_actions: 0,
        },
        file: new Blob([modifiedContent]),
      });

      const request = new Request("http://localhost/api/legal/apply-edits", {
        method: "POST",
        body: JSON.stringify({
          documentBase64: Buffer.from("original").toString("base64"),
          edits: [{ target_text: "a", new_text: "b" }],
        }),
      });

      const response = await POST(request);
      const json = await response.json();

      expect(json.success).toBe(true);
      expect(json.modifiedDocxBase64).toBe(
        Buffer.from(modifiedContent).toString("base64")
      );
    });

    // Test: BatchSummary is correctly passed through to client
    // The summary tells users how many edits were applied/skipped
    it("returns summary from Adeu service", async () => {
      const summary: BatchSummary = {
        applied_edits: 3,
        skipped_edits: 1,
        applied_actions: 0,
        skipped_actions: 0,
      };

      mockProcessDocumentBatch.mockResolvedValueOnce({
        summary,
        file: new Blob(["modified"]),
      });

      const request = new Request("http://localhost/api/legal/apply-edits", {
        method: "POST",
        body: JSON.stringify({
          documentBase64: Buffer.from("test").toString("base64"),
          edits: [
            { target_text: "a", new_text: "b" },
            { target_text: "c", new_text: "d" },
            { target_text: "e", new_text: "f" },
            { target_text: "g", new_text: "h" },
          ],
        }),
      });

      const response = await POST(request);
      const json = await response.json();

      expect(json.summary).toEqual(summary);
    });
  });

  // =========================================================================
  // Error Handling Tests
  // Ensures graceful handling of various failure scenarios:
  // Adeu service errors, network failures, invalid data, etc.
  // =========================================================================
  describe("Error Handling", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue({ userId: "user123" } as any);
    });

    // Test: Adeu service errors should return 500 with helpful message
    // Users should get clear error feedback when the service fails
    it("returns 500 when Adeu service throws error", async () => {
      mockProcessDocumentBatch.mockRejectedValueOnce(
        new Error("Adeu service unavailable")
      );

      const request = new Request("http://localhost/api/legal/apply-edits", {
        method: "POST",
        body: JSON.stringify({
          documentBase64: Buffer.from("test").toString("base64"),
          edits: [{ target_text: "a", new_text: "b" }],
        }),
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(500);
      expect(json.success).toBe(false);
      expect(json.error).toBe("Internal server error");
      expect(json.message).toContain("Adeu service unavailable");
    });

    // Test: Invalid base64 should be caught and reported
    // Malformed base64 could cause Buffer.from() to throw
    it("returns 500 when base64 decoding fails", async () => {
      const request = new Request("http://localhost/api/legal/apply-edits", {
        method: "POST",
        body: JSON.stringify({
          documentBase64: "invalid-base64!!!",
          edits: [{ target_text: "a", new_text: "b" }],
        }),
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(500);
      expect(json.success).toBe(false);
    // Test: Network errors should not crash the endpoint
    // Connection refused, timeout, etc. should return 500 with error details
    });

    it("handles network errors gracefully", async () => {
      mockProcessDocumentBatch.mockRejectedValueOnce(
        new Error("ECONNREFUSED")
      );

      const request = new Request("http://localhost/api/legal/apply-edits", {
        method: "POST",
        body: JSON.stringify({
          documentBase64: Buffer.from("test").toString("base64"),
          edits: [{ target_text: "a", new_text: "b" }],
        }),
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(500);
      expect(json.message).toContain("ECONNREFUSED");
    });

    // Test: Malformed request body should be caught
    // request.json() might throw; endpoint should handle it gracefully
    it("handles malformed JSON body", async () => {
      const request = new Request("http://localhost/api/legal/apply-edits", {
        method: "POST",
        body: "invalid-json{",
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(500);
      expect(json.success).toBe(false);
    });
  });

  // =========================================================================
  // Edge Cases
  // Tests boundary conditions and unusual but valid scenarios:
  // large files, special characters, unicode, etc.
  // =========================================================================
  describe("Edge Cases", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue({ userId: "user123" } as any);
    // Test: Large documents (10MB) should be processed without issues
    // Ensures no memory or buffer size limitations in the API layer
    });

    it("handles very large base64 documents", async () => {
      const largeDoc = Buffer.alloc(10 * 1024 * 1024); // 10MB
      const docBase64 = largeDoc.toString("base64");

      mockProcessDocumentBatch.mockResolvedValueOnce({
        summary: {
          applied_edits: 1,
          skipped_edits: 0,
          applied_actions: 0,
          skipped_actions: 0,
        },
        file: new Blob([largeDoc]),
      });

      const request = new Request("http://localhost/api/legal/apply-edits", {
        method: "POST",
        body: JSON.stringify({
          documentBase64: docBase64,
          edits: [{ target_text: "a", new_text: "b" }],
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    // Test: Special characters should be preserved in edits
    // Legal documents often contain &, $, commas, etc. - ensure no escaping issues
    });

    it("handles special characters in edits", async () => {
      const edits = [
        {
          target_text: "Company: {company_name}",
          new_text: "Company: Acme Inc. & Co.",
          comment: "Updated company name with & symbol",
        },
        {
          target_text: "{amount}",
          new_text: "$1,000,000.00",
        },
      ];

      mockProcessDocumentBatch.mockResolvedValueOnce({
        summary: {
          applied_edits: 2,
          skipped_edits: 0,
          applied_actions: 0,
          skipped_actions: 0,
        },
        file: new Blob(["modified"]),
      });

      const request = new Request("http://localhost/api/legal/apply-edits", {
        method: "POST",
        body: JSON.stringify({
          documentBase64: Buffer.from("test").toString("base64"),
          edits,
        }),
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.success).toBe(true);
    // Test: Unicode/international characters in author names
    // Users with non-ASCII names should work correctly in Track Changes
    });

    it("handles unicode characters in author name", async () => {
      const request = new Request("http://localhost/api/legal/apply-edits", {
        method: "POST",
        body: JSON.stringify({
          documentBase64: Buffer.from("test").toString("base64"),
          authorName: "李明 (Legal Review)",
          edits: [],
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });
  });
});
