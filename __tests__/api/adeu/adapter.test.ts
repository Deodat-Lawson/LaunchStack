/**
 * Unit tests for the Adeu TypeScript adapter (src/lib/adeu/client.ts).
 * Tests all five adapter functions, error classes, and edge cases.
 */

import {
  readDocx,
  processDocumentBatch,
  acceptAllChanges,
  applyEditsAsMarkdown,
  diffDocxFiles,
  getBaseUrl,
  AdeuConfigError,
  AdeuServiceError,
} from "~/lib/adeu/client";

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------
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
// Helpers
// ---------------------------------------------------------------------------
function makeDocxBuffer(): Buffer {
  return Buffer.from("PK\x03\x04fake-docx-content");
}

function jsonResponse(body: object, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function blobResponse(content: string, status = 200, headers?: Record<string, string>): Response {
  return new Response(content, {
    status,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ...headers,
    },
  });
}

// ===========================================================================
// getBaseUrl
// ===========================================================================
describe("getBaseUrl", () => {
  it("returns the URL when ADEU_SERVICE_URL is set", () => {
    process.env.ADEU_SERVICE_URL = "http://sidecar:8000";
    expect(getBaseUrl()).toBe("http://sidecar:8000");
  });

  it("throws AdeuConfigError when ADEU_SERVICE_URL is not set", () => {
    delete process.env.ADEU_SERVICE_URL;
    expect(() => getBaseUrl()).toThrow(AdeuConfigError);
    expect(() => getBaseUrl()).toThrow("ADEU_SERVICE_URL environment variable is not set");
  });

  it("throws an instance of Error", () => {
    delete process.env.ADEU_SERVICE_URL;
    try {
      getBaseUrl();
      fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(AdeuConfigError);
    }
  });
});

// ===========================================================================
// AdeuServiceError
// ===========================================================================
describe("AdeuServiceError", () => {
  it("has correct name, statusCode, and detail", () => {
    const err = new AdeuServiceError(422, "Batch rejected");
    expect(err.name).toBe("AdeuServiceError");
    expect(err.statusCode).toBe(422);
    expect(err.detail).toBe("Batch rejected");
    expect(err.message).toBe("Adeu service error (422): Batch rejected");
  });

  it("is an instance of Error", () => {
    const err = new AdeuServiceError(500, "Internal error");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AdeuServiceError);
  });
});

// ===========================================================================
// readDocx
// ===========================================================================
describe("readDocx", () => {
  it("sends POST to /adeu/read and returns parsed JSON", async () => {
    const expected = { text: "Hello world", filename: "doc.docx" };
    mockFetch.mockResolvedValueOnce(jsonResponse(expected));

    const result = await readDocx(makeDocxBuffer());

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:8000/adeu/read");
    expect(opts.method).toBe("POST");
    expect(opts.body).toBeInstanceOf(FormData);
    expect(result).toEqual(expected);
  });

  it("sends clean_view form field when specified", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ text: "clean", filename: "doc.docx" }));

    await readDocx(makeDocxBuffer(), { cleanView: true });

    const formData: FormData = mockFetch.mock.calls[0][1].body;
    expect(formData.get("clean_view")).toBe("true");
  });

  it("does not send clean_view when not specified", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ text: "raw", filename: "doc.docx" }));

    await readDocx(makeDocxBuffer());

    const formData: FormData = mockFetch.mock.calls[0][1].body;
    expect(formData.get("clean_view")).toBeNull();
  });

  it("sends clean_view=false when explicitly set to false", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ text: "raw", filename: "doc.docx" }));

    await readDocx(makeDocxBuffer(), { cleanView: false });

    const formData: FormData = mockFetch.mock.calls[0][1].body;
    expect(formData.get("clean_view")).toBe("false");
  });

  it("accepts Blob input", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ text: "blob text", filename: "doc.docx" }));

    const blob = new Blob([new Uint8Array(makeDocxBuffer())]);
    const result = await readDocx(blob);

    expect(result.text).toBe("blob text");
  });

  it("throws AdeuServiceError on 422", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ detail: "Invalid DOCX file" }, 422));

    await expect(readDocx(makeDocxBuffer())).rejects.toThrow(AdeuServiceError);
    await mockFetch.mockResolvedValueOnce(jsonResponse({ detail: "Invalid DOCX file" }, 422));
    try {
      await readDocx(makeDocxBuffer());
    } catch (e) {
      expect(e).toBeInstanceOf(AdeuServiceError);
      expect((e as AdeuServiceError).statusCode).toBe(422);
      expect((e as AdeuServiceError).detail).toBe("Invalid DOCX file");
    }
  });

  it("throws AdeuServiceError on 500", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ detail: "Internal error" }, 500));

    try {
      await readDocx(makeDocxBuffer());
      fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AdeuServiceError);
      expect((e as AdeuServiceError).statusCode).toBe(500);
    }
  });

  it("throws AdeuServiceError with statusCode 0 on network failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    try {
      await readDocx(makeDocxBuffer());
      fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AdeuServiceError);
      expect((e as AdeuServiceError).statusCode).toBe(0);
      expect((e as AdeuServiceError).detail).toContain("ECONNREFUSED");
    }
  });

  it("throws AdeuConfigError when ADEU_SERVICE_URL is missing", async () => {
    delete process.env.ADEU_SERVICE_URL;
    await expect(readDocx(makeDocxBuffer())).rejects.toThrow(AdeuConfigError);
  });
});

// ===========================================================================
// processDocumentBatch
// ===========================================================================
describe("processDocumentBatch", () => {
  const params = {
    author_name: "Test Author",
    edits: [{ target_text: "old", new_text: "new", comment: "fix" }],
    actions: [{ action: "ACCEPT" as const, target_id: "Chg:1" }],
  };

  it("sends POST to /adeu/process-batch with file and JSON body", async () => {
    const summary = { applied_edits: 1, skipped_edits: 0, applied_actions: 1, skipped_actions: 0 };
    mockFetch.mockResolvedValueOnce(
      blobResponse("modified-docx-bytes", 200, {
        "x-batch-summary": JSON.stringify(summary),
      })
    );

    const result = await processDocumentBatch(makeDocxBuffer(), params);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:8000/adeu/process-batch");
    expect(opts.method).toBe("POST");

    const formData: FormData = opts.body;
    expect(formData.get("file")).toBeTruthy();
    expect(formData.get("body")).toBe(JSON.stringify(params));

    expect(result.summary).toEqual(summary);
    expect(result.file).toBeInstanceOf(Blob);
  });

  it("returns default summary when X-Batch-Summary header is missing", async () => {
    mockFetch.mockResolvedValueOnce(blobResponse("modified-docx-bytes"));

    const result = await processDocumentBatch(makeDocxBuffer(), params);

    expect(result.summary).toEqual({
      applied_edits: 0,
      skipped_edits: 0,
      applied_actions: 0,
      skipped_actions: 0,
    });
  });

  it("sends edits-only batch (no actions)", async () => {
    mockFetch.mockResolvedValueOnce(blobResponse("modified"));

    await processDocumentBatch(makeDocxBuffer(), {
      author_name: "Author",
      edits: [{ target_text: "a", new_text: "b" }],
    });

    const formData: FormData = mockFetch.mock.calls[0][1].body;
    const body = JSON.parse(formData.get("body") as string);
    expect(body.edits).toHaveLength(1);
    expect(body.actions).toBeUndefined();
  });

  it("sends actions-only batch (no edits)", async () => {
    mockFetch.mockResolvedValueOnce(blobResponse("modified"));

    await processDocumentBatch(makeDocxBuffer(), {
      author_name: "Author",
      actions: [{ action: "REJECT", target_id: "Chg:2" }],
    });

    const formData: FormData = mockFetch.mock.calls[0][1].body;
    const body = JSON.parse(formData.get("body") as string);
    expect(body.edits).toBeUndefined();
    expect(body.actions).toHaveLength(1);
  });

  it("throws AdeuServiceError on 422 with validation errors", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ detail: "Batch rejected", errors: ["Edit 1: target not found"] }, 422)
    );

    try {
      await processDocumentBatch(makeDocxBuffer(), params);
      fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AdeuServiceError);
      expect((e as AdeuServiceError).statusCode).toBe(422);
      expect((e as AdeuServiceError).detail).toContain("Batch rejected");
    }
  });

  it("throws on network failure with statusCode 0", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

    try {
      await processDocumentBatch(makeDocxBuffer(), params);
      fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AdeuServiceError);
      expect((e as AdeuServiceError).statusCode).toBe(0);
    }
  });
});

// ===========================================================================
// acceptAllChanges
// ===========================================================================
describe("acceptAllChanges", () => {
  it("sends POST to /adeu/accept-all and returns Blob", async () => {
    mockFetch.mockResolvedValueOnce(blobResponse("clean-docx"));

    const result = await acceptAllChanges(makeDocxBuffer());

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:8000/adeu/accept-all");
    expect(result).toBeInstanceOf(Blob);
  });

  it("attaches file to FormData", async () => {
    mockFetch.mockResolvedValueOnce(blobResponse("clean-docx"));

    await acceptAllChanges(makeDocxBuffer());

    const formData: FormData = mockFetch.mock.calls[0][1].body;
    expect(formData.get("file")).toBeTruthy();
  });

  it("throws on 422 for invalid DOCX", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ detail: "Invalid DOCX file" }, 422));

    await expect(acceptAllChanges(makeDocxBuffer())).rejects.toThrow(AdeuServiceError);
  });

  it("throws on 500 internal error", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ detail: "Adeu crash" }, 500));

    try {
      await acceptAllChanges(makeDocxBuffer());
      fail("should have thrown");
    } catch (e) {
      expect((e as AdeuServiceError).statusCode).toBe(500);
    }
  });

  it("throws on network failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("socket hang up"));

    try {
      await acceptAllChanges(makeDocxBuffer());
      fail("should have thrown");
    } catch (e) {
      expect((e as AdeuServiceError).statusCode).toBe(0);
      expect((e as AdeuServiceError).detail).toContain("socket hang up");
    }
  });

  it("works with Blob input", async () => {
    mockFetch.mockResolvedValueOnce(blobResponse("clean"));

    const result = await acceptAllChanges(new Blob(["fake docx"]));
    expect(result).toBeInstanceOf(Blob);
  });
});

// ===========================================================================
// applyEditsAsMarkdown
// ===========================================================================
describe("applyEditsAsMarkdown", () => {
  const params = {
    edits: [{ target_text: "old text", new_text: "new text" }],
    highlight_only: false,
    include_index: true,
  };

  it("sends POST to /adeu/apply-edits-markdown and returns parsed JSON", async () => {
    const expected = { markdown: "Some {--old--}{++new++} text [Edit:0]" };
    mockFetch.mockResolvedValueOnce(jsonResponse(expected));

    const result = await applyEditsAsMarkdown(makeDocxBuffer(), params);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:8000/adeu/apply-edits-markdown");
    expect(result).toEqual(expected);
  });

  it("sends edits and options in JSON body field", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ markdown: "text" }));

    await applyEditsAsMarkdown(makeDocxBuffer(), params);

    const formData: FormData = mockFetch.mock.calls[0][1].body;
    const body = JSON.parse(formData.get("body") as string);
    expect(body.edits).toEqual(params.edits);
    expect(body.highlight_only).toBe(false);
    expect(body.include_index).toBe(true);
  });

  it("handles highlight_only mode", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ markdown: "{==highlighted==}" }));

    const result = await applyEditsAsMarkdown(makeDocxBuffer(), {
      edits: [{ target_text: "x", new_text: "y" }],
      highlight_only: true,
    });

    expect(result.markdown).toContain("{==");
  });

  it("throws on 422", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ detail: "No edits" }, 422));

    await expect(applyEditsAsMarkdown(makeDocxBuffer(), params)).rejects.toThrow(AdeuServiceError);
  });

  it("throws on network failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("timeout"));

    try {
      await applyEditsAsMarkdown(makeDocxBuffer(), params);
      fail("should have thrown");
    } catch (e) {
      expect((e as AdeuServiceError).statusCode).toBe(0);
    }
  });
});

// ===========================================================================
// diffDocxFiles
// ===========================================================================
describe("diffDocxFiles", () => {
  it("sends POST to /adeu/diff with two files and returns parsed JSON", async () => {
    const expected = { diff: "some diff text", has_differences: true };
    mockFetch.mockResolvedValueOnce(jsonResponse(expected));

    const result = await diffDocxFiles(makeDocxBuffer(), makeDocxBuffer());

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:8000/adeu/diff");
    expect(result).toEqual(expected);
  });

  it("sends both files as separate FormData fields", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ diff: "", has_differences: false }));

    await diffDocxFiles(makeDocxBuffer(), makeDocxBuffer());

    const formData: FormData = mockFetch.mock.calls[0][1].body;
    expect(formData.get("original")).toBeTruthy();
    expect(formData.get("modified")).toBeTruthy();
  });

  it("sends compare_clean when specified", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ diff: "", has_differences: false }));

    await diffDocxFiles(makeDocxBuffer(), makeDocxBuffer(), { compareClean: true });

    const formData: FormData = mockFetch.mock.calls[0][1].body;
    expect(formData.get("compare_clean")).toBe("true");
  });

  it("does not send compare_clean when not specified", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ diff: "", has_differences: false }));

    await diffDocxFiles(makeDocxBuffer(), makeDocxBuffer());

    const formData: FormData = mockFetch.mock.calls[0][1].body;
    expect(formData.get("compare_clean")).toBeNull();
  });

  it("returns has_differences: false for identical documents", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ diff: "", has_differences: false }));

    const result = await diffDocxFiles(makeDocxBuffer(), makeDocxBuffer());
    expect(result.has_differences).toBe(false);
  });

  it("returns has_differences: true for different documents", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ diff: "change here", has_differences: true }));

    const result = await diffDocxFiles(
      Buffer.from("original"),
      Buffer.from("modified"),
    );
    expect(result.has_differences).toBe(true);
  });

  it("throws on 422", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ detail: "Invalid file" }, 422));

    await expect(diffDocxFiles(makeDocxBuffer(), makeDocxBuffer())).rejects.toThrow(
      AdeuServiceError,
    );
  });

  it("throws on network failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("DNS resolution failed"));

    try {
      await diffDocxFiles(makeDocxBuffer(), makeDocxBuffer());
      fail("should have thrown");
    } catch (e) {
      expect((e as AdeuServiceError).statusCode).toBe(0);
      expect((e as AdeuServiceError).detail).toContain("DNS resolution failed");
    }
  });

  it("works with Blob inputs", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ diff: "", has_differences: false }));

    const result = await diffDocxFiles(
      new Blob(["original"]),
      new Blob(["modified"]),
    );
    expect(result.has_differences).toBe(false);
  });
});

// ===========================================================================
// All exports exist
// ===========================================================================
describe("adapter exports", () => {
  it("exports all five adapter functions", () => {
    expect(typeof readDocx).toBe("function");
    expect(typeof processDocumentBatch).toBe("function");
    expect(typeof acceptAllChanges).toBe("function");
    expect(typeof applyEditsAsMarkdown).toBe("function");
    expect(typeof diffDocxFiles).toBe("function");
  });

  it("exports error classes", () => {
    expect(typeof AdeuConfigError).toBe("function");
    expect(typeof AdeuServiceError).toBe("function");
  });

  it("exports getBaseUrl helper", () => {
    expect(typeof getBaseUrl).toBe("function");
  });
});

// ===========================================================================
// Error response parsing edge cases
// ===========================================================================
describe("error response parsing", () => {
  it("handles non-JSON error response body", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("Bad Gateway", { status: 502, headers: { "content-type": "text/plain" } })
    );

    try {
      await readDocx(makeDocxBuffer());
      fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AdeuServiceError);
      expect((e as AdeuServiceError).statusCode).toBe(502);
    }
  });

  it("handles error response with no detail field", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "something went wrong" }, 400));

    try {
      await readDocx(makeDocxBuffer());
      fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AdeuServiceError);
      expect((e as AdeuServiceError).statusCode).toBe(400);
    }
  });

  it("handles 401 unauthorized", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ detail: "Unauthorized" }, 401));

    try {
      await readDocx(makeDocxBuffer());
      fail("should have thrown");
    } catch (e) {
      expect((e as AdeuServiceError).statusCode).toBe(401);
    }
  });

  it("handles 413 file too large", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ detail: "File exceeds maximum size" }, 413));

    try {
      await processDocumentBatch(makeDocxBuffer(), { author_name: "A" });
      fail("should have thrown");
    } catch (e) {
      expect((e as AdeuServiceError).statusCode).toBe(413);
      expect((e as AdeuServiceError).detail).toContain("File exceeds maximum size");
    }
  });

  it("handles non-Error throw from fetch", async () => {
    mockFetch.mockRejectedValueOnce("string error");

    try {
      await readDocx(makeDocxBuffer());
      fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AdeuServiceError);
      expect((e as AdeuServiceError).statusCode).toBe(0);
      expect((e as AdeuServiceError).detail).toBe("string error");
    }
  });
});
