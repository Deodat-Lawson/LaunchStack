import {
    describeSourceFailure,
    readSourceFailureReport,
    sourceFailureContactHref,
    sourceFailureReportText,
    type SourceFailureCategory,
} from "~/lib/source-failure";

/** What production stamped on a 259-page book when Gemini's free tier ran out (2026-10). */
const GEMINI_QUOTA_429 =
    "pipeline event dead: Failed to generate embeddings after 3 attempts: OpenAI API error: 429 - " +
    '[{\n  "error": {\n    "code": 429,\n    "message": "You exceeded your current quota, please ' +
    'check your plan and billing details.",\n    "status": "RESOURCE_EXHAUSTED"\n  }\n}]';

describe("describeSourceFailure", () => {
    it("turns the provider's quota JSON into one sentence, and keeps the JSON as detail", () => {
        const failure = describeSourceFailure(GEMINI_QUOTA_429);

        expect(failure.category).toBe("embedding_quota");
        expect(failure.message).toBe(
            "The embedding service is over its usage limit. Try again in a few minutes."
        );
        expect(failure.retryable).toBe(true);
        expect(failure.message).not.toContain("RESOURCE_EXHAUSTED");
        // The raw text survives for the details toggle, minus the pipeline's prefix.
        expect(failure.detail).toMatch(/^Failed to generate embeddings/);
        expect(failure.detail).toContain("RESOURCE_EXHAUSTED");
    });

    it.each<[string, SourceFailureCategory, boolean]>([
        ["OpenAI API error: 503 - upstream connect error", "embedding_unavailable", true],
        [
            "Failed to generate embeddings after 3 attempts: fetch failed",
            "embedding_unavailable",
            true,
        ],
        ['OpenAI API error: 401 - {"error":"invalid api key"}', "misconfigured", false],
        ["API key not configured for embeddings", "misconfigured", false],
        ["Embeddings base URL not configured. Set EMBEDDING_API_BASE_URL", "misconfigured", false],
        ["DATALAB_API_KEY is not set", "misconfigured", false],
        ["Document converter returned 502", "ocr_unavailable", true],
        ["OCR API request failed: 500 - internal", "ocr_unavailable", true],
        ["Landing.AI parse failed: 429 - slow down", "ocr_unavailable", true],
        ["connect ECONNREFUSED 127.0.0.1:8000", "ocr_unavailable", true],
        ["Transcription service request failed (503): busy", "transcription_unavailable", true],
        ["Invalid data found when processing input", "file_unreadable", false],
        ["PDF is encrypted and requires a password", "file_unreadable", false],
        ["ffprobe reported no duration for clip.mp4", "file_unreadable", false],
        ["Failed to download PDF from URL: 404", "file_missing", false],
        ["PptxAdapter fetch failed: 403", "file_missing", false],
        ["TextAdapter fetch failed: 502", "ocr_unavailable", true],
        ["Azure Document Intelligence analysis timed out", "timeout", true],
        ["The operation was aborted due to timeout", "timeout", true],
        ["reclaimed after stale claim; attempts exhausted", "interrupted", true],
        ["outbox payload failed protocol validation (outbox row 12)", "internal", false],
        ['Pipeline state "extraction" not found for job abc', "internal", false],
        ["Embedding mismatch: fewer embeddings than children", "internal", false],
        ["Page 512 not found in document", "unknown", true],
        ["something nobody planned for", "unknown", true],
    ])("%s → %s", (raw, category, retryable) => {
        const failure = describeSourceFailure(`pipeline event dead: ${raw}`);
        expect(failure.category).toBe(category);
        expect(failure.retryable).toBe(retryable);
        // Never the raw text as the message.
        expect(failure.message).not.toContain(raw);
        expect(failure.detail).toBe(raw);
    });

    it("says something went wrong, retryably, when there is no error text", () => {
        for (const raw of [undefined, null, "", "pipeline event dead: "]) {
            const failure = describeSourceFailure(raw);
            expect(failure.category).toBe("unknown");
            expect(failure.retryable).toBe(true);
            expect(failure.detail).toBeNull();
        }
    });

    it("gives every category a short label and a sentence", () => {
        const samples = [GEMINI_QUOTA_429, "Invalid data found when processing input", ""];
        for (const raw of samples) {
            const { label, message } = describeSourceFailure(raw);
            expect(label.length).toBeLessThanOrEqual(26);
            expect(message).toMatch(/\.$/);
        }
    });
});

describe("source failure contact link", () => {
    const report = {
        document: "The Long Book.pdf",
        documentId: 42,
        category: "embedding_quota" as const,
        jobId: "5b0e6d1c-0d3c-4e4c-9a55-1f2f6b0c9e11",
    };

    it("carries the document, category and job id — never the raw error", () => {
        const href = sourceFailureContactHref(report);
        expect(href.startsWith("/employer/contact?")).toBe(true);
        const params = new URLSearchParams(href.split("?")[1]);
        expect(Object.fromEntries(params)).toEqual({
            topic: "source-failure",
            document: "The Long Book.pdf",
            category: "embedding_quota",
            documentId: "42",
            job: report.jobId,
        });
    });

    it("round-trips through the contact page's reader", () => {
        const params = Object.fromEntries(
            new URLSearchParams(sourceFailureContactHref(report).split("?")[1])
        );
        expect(readSourceFailureReport(params)).toEqual(report);
    });

    it("ignores a page opened any other way, or with a made-up category", () => {
        expect(readSourceFailureReport({})).toBeNull();
        expect(readSourceFailureReport({ topic: "source-failure", document: "x" })).toBeNull();
        expect(
            readSourceFailureReport({
                topic: "source-failure",
                document: "x",
                category: "toString",
            })
        ).toBeNull();
        expect(
            readSourceFailureReport({ topic: "other", document: "x", category: "timeout" })
        ).toBeNull();
    });

    it("drops a malformed document id and caps long values", () => {
        const read = readSourceFailureReport({
            topic: "source-failure",
            document: "d".repeat(500),
            category: "timeout",
            documentId: "-3",
            job: "j".repeat(400),
        });
        expect(read?.documentId).toBeUndefined();
        expect(read?.document).toHaveLength(200);
        expect(read?.jobId).toHaveLength(128);
    });

    it("pre-fills a subject and the details an operator needs", () => {
        const { subject, details } = sourceFailureReportText(report);
        expect(subject).toBe('Problem processing "The Long Book.pdf"');
        expect(details.split("\n")).toEqual([
            "Document: The Long Book.pdf",
            "Document ID: 42",
            "Error: Embedding usage limit (embedding_quota)",
            `Job / trace ID: ${report.jobId}`,
        ]);
    });
});
