import { describe, expect, it } from "vitest";

import {
  eventIds,
  evidenceDocumentSchema,
  pipelineEventSchema,
  PROTOCOL_VERSION,
  transcribeResponseSchema,
} from "../src/index";

const baseEnvelope = {
  schemaVersion: PROTOCOL_VERSION,
  occurredAt: "2026-08-09T12:00:00.000Z",
  traceId: "trace-1",
  companyId: 42,
};

describe("pipeline events", () => {
  it("accepts a valid source.version.created event", () => {
    const event = {
      ...baseEnvelope,
      eventId: eventIds.sourceVersionCreated("job-1"),
      eventType: "source.version.created",
      payload: {
        sourceId: 7,
        sourceVersionId: 9,
        ocrJobId: "job-1",
        documentUrl: "/api/files/123",
        documentName: "handbook.pdf",
        category: "General",
        userId: "user_abc",
        mimeType: "application/pdf",
        options: { preferredProvider: "DOCLING" },
      },
    };
    const parsed = pipelineEventSchema.parse(event);
    expect(parsed.eventType).toBe("source.version.created");
  });

  it("rejects the removed MARKER provider", () => {
    const event = {
      ...baseEnvelope,
      eventId: eventIds.sourceVersionCreated("job-2"),
      eventType: "source.version.created",
      payload: {
        sourceId: 7,
        sourceVersionId: 9,
        ocrJobId: "job-2",
        documentUrl: "/api/files/123",
        documentName: "handbook.pdf",
        category: "General",
        userId: "user_abc",
        options: { preferredProvider: "MARKER" },
      },
    };
    expect(pipelineEventSchema.safeParse(event).success).toBe(false);
  });

  it("rejects a payload that does not match its eventType", () => {
    const event = {
      ...baseEnvelope,
      eventId: eventIds.evidenceVersionIndexed("job-1"),
      eventType: "evidence.version.indexed",
      payload: { sourceId: 7 },
    };
    expect(pipelineEventSchema.safeParse(event).success).toBe(false);
  });

  it("rejects confidence outside [0,1]", () => {
    const event = {
      ...baseEnvelope,
      eventId: eventIds.evidenceVersionExtracted("job-1"),
      eventType: "evidence.version.extracted",
      payload: {
        sourceId: 7,
        sourceVersionId: 9,
        ocrJobId: "job-1",
        provider: "DOCLING",
        confidence: 92,
        usedFastTextPath: false,
      },
    };
    expect(pipelineEventSchema.safeParse(event).success).toBe(false);
  });

  it("produces deterministic event ids", () => {
    expect(eventIds.sourceVersionCreated("j")).toBe(
      eventIds.sourceVersionCreated("j"),
    );
    expect(eventIds.companyStateProjected(1, 2)).not.toBe(
      eventIds.companyStateProjected(1, 3),
    );
  });
});

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
