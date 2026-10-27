/**
 * Raw pipeline errors → one plain sentence, raw text kept for "Copy details".
 * The examples are real rows from a local database and the worker's own
 * error formats.
 */

import { friendlyProcessingError } from "~/lib/processing-queue/errors";

const message = (raw: string) => friendlyProcessingError(raw)?.message;

describe("friendlyProcessingError", () => {
    it("returns null when there is no error", () => {
        expect(friendlyProcessingError(null)).toBeNull();
        expect(friendlyProcessingError(undefined)).toBeNull();
        expect(friendlyProcessingError("   ")).toBeNull();
    });

    it("keeps the raw error as the detail", () => {
        const raw =
            "pipeline dead after max attempts: [s3] fetch failed ← caused by: fetch failed ← caused by: ";
        expect(friendlyProcessingError(raw)).toEqual({
            message: "Couldn't fetch the file from storage.",
            detail: raw.trim(),
        });
    });

    it("reads through both dead-letter prefixes, even stacked", () => {
        for (const prefix of [
            "pipeline dead after max attempts: ",
            "pipeline event dead: ",
            "pipeline event dead: pipeline dead after max attempts: ",
            "",
        ]) {
            expect(message(`${prefix}[s3] fetch failed ← caused by: fetch failed`)).toBe(
                "Couldn't fetch the file from storage."
            );
        }
    });

    it("a converter 4xx can't open the file; a 5xx is the converter's problem", () => {
        expect(
            message(
                'pipeline dead after max attempts: Document converter /convert failed: 400 Bad Request — {"error":{"code":"url-not-allowed","message":"url origin http://localhost:57776 is not in ALLOWED_FETCH_ORIGINS"}}'
            )
        ).toBe("The converter couldn't open this file.");
        expect(message("Document converter /convert failed: 415 Unsupported Media Type — {}")).toBe(
            "The converter couldn't open this file."
        );
        expect(message("Document converter /convert failed: 502 Bad Gateway — ")).toBe(
            "The document converter had a problem — try again later."
        );
    });

    it("timeouts", () => {
        expect(message("Document converter /convert timed out after 120000ms")).toBe(
            "Processing took too long and timed out."
        );
        expect(message("Azure Document Intelligence analysis timed out")).toBe(
            "Processing took too long and timed out."
        );
        expect(message("connect ETIMEDOUT 10.0.0.4:443")).toBe(
            "Processing took too long and timed out."
        );
    });

    it("credit and rate limits", () => {
        const sentence = "The AI provider is out of credit or rate-limited — try again later.";
        expect(
            message(
                "402 Insufficient credits. Add more using https://openrouter.ai/settings/credits"
            )
        ).toBe(sentence);
        expect(message('OpenAI API error: 429 - {"error":"Rate limit reached"}')).toBe(sentence);
        expect(message("You exceeded your current quota")).toBe(sentence);
    });

    it("embedding failures", () => {
        expect(message("Failed to generate embeddings for indices: 0, 3")).toBe(
            "Couldn't build the search index for this file."
        );
        expect(message('Embedding index "legacy-1536" is not registered or not enabled.')).toBe(
            "Couldn't build the search index for this file."
        );
    });

    it("unsupported file types", () => {
        expect(message("Unsupported file type: application/x-msdownload")).toBe(
            "This file type isn't supported."
        );
    });

    it("a worker that kept dying", () => {
        expect(
            message("pipeline event dead: reclaimed after stale claim; attempts exhausted")
        ).toBe("The worker kept stopping while processing this file.");
    });

    it("unreachable services", () => {
        expect(message("fetch failed ← caused by: connect ECONNREFUSED 127.0.0.1:8002")).toBe(
            "Couldn't reach a service needed to process this file."
        );
    });

    it("anything else gets the generic sentence", () => {
        expect(message('Pipeline state "pages" not found for job abc')).toBe(
            "Processing stopped with an error."
        );
    });
});
