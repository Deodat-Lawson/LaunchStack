import { describe, expect, it } from "vitest";

import { PROTOCOL_VERSION } from "@launchstack/runtime/wire-version";
import { evidenceDocumentSchema } from "./evidence-document";
import { transcribeResponseSchema } from "./audio-transcription/wire";

describe("evidence document", () => {
    it("accepts a document without confidence (never fabricated)", () => {
        const doc = evidenceDocumentSchema.parse({
            schemaVersion: PROTOCOL_VERSION,
            provider: "docling",
            source: { filename: "a.pdf", mimeType: "application/pdf", pageCount: 2 },
            pages: [
                { pageNumber: 1, text: "hello" },
                {
                    pageNumber: 2,
                    text: "world",
                    blocks: [{ type: "paragraph", text: "world" }],
                },
            ],
            markdown: "hello\n\nworld",
            warnings: ["provider returned no page boundaries"],
        });
        expect(doc.confidence).toBeUndefined();
    });

    it("rejects out-of-range block confidence", () => {
        const result = evidenceDocumentSchema.safeParse({
            schemaVersion: PROTOCOL_VERSION,
            provider: "docling",
            source: {},
            pages: [
                {
                    pageNumber: 1,
                    text: "x",
                    blocks: [{ type: "paragraph", text: "x", confidence: 92 }],
                },
            ],
            warnings: [],
        });
        expect(result.success).toBe(false);
    });
});

describe("transcription contract", () => {
    it("round-trips the sidecar response shape", () => {
        const parsed = transcribeResponseSchema.parse({
            text: "hello world",
            language: "en",
            confidence: 0.93,
            filename: "note.mp3",
            segments: [{ start: 0, end: 1.5, text: "hello world" }],
        });
        expect(parsed.segments).toHaveLength(1);
    });
});
