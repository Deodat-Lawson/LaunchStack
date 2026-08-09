import { describe, expect, it } from "vitest";

import { buildCitations } from "../src/citations";

const NOW = "2026-08-09T12:00:00.000Z";

describe("buildCitations", () => {
  it("anchors page hits and computes freshness from the version date", () => {
    const citations = buildCitations(
      [
        {
          sourceId: 1,
          sourceVersionId: 10,
          chunkId: 100,
          page: 3,
          content: "Revenue was $1.2M in Q2.",
          documentTitle: "Q2 Report",
          relevance: 0.91,
        },
      ],
      [{ sourceVersionId: 10, createdAt: "2026-08-01T00:00:00.000Z" }],
      { now: NOW },
    );

    expect(citations).toHaveLength(1);
    expect(citations[0]?.anchorKey).toBe("src:1/ver:10/page:3");
    expect(citations[0]?.freshness).toBe("fresh");
    expect(citations[0]?.quote).toBe("Revenue was $1.2M in Q2.");
  });

  it("uses time spans for transcript evidence", () => {
    const citations = buildCitations(
      [
        {
          sourceId: 2,
          sourceVersionId: 20,
          startSeconds: 12.5,
          endSeconds: 31.25,
          content: "we decided to sunset the beta",
          relevance: 0.8,
        },
      ],
      [],
      { now: NOW },
    );
    expect(citations[0]?.anchor.span).toEqual({
      kind: "time",
      startSeconds: 12.5,
      endSeconds: 31.25,
    });
    expect(citations[0]?.freshness).toBeUndefined();
  });

  it("dedupes by anchor and keeps the higher-relevance hit", () => {
    const citations = buildCitations(
      [
        {
          sourceId: 1,
          sourceVersionId: 10,
          page: 3,
          content: "weaker hit",
          relevance: 0.4,
        },
        {
          sourceId: 1,
          sourceVersionId: 10,
          page: 3,
          content: "stronger hit",
          relevance: 0.9,
        },
      ],
      [],
      { now: NOW },
    );
    expect(citations).toHaveLength(1);
    expect(citations[0]?.quote).toBe("stronger hit");
  });

  it("orders deterministically by relevance then anchor key", () => {
    const citations = buildCitations(
      [
        { sourceId: 1, sourceVersionId: 10, page: 2, content: "b", relevance: 0.5 },
        { sourceId: 1, sourceVersionId: 10, page: 1, content: "a", relevance: 0.5 },
        { sourceId: 1, sourceVersionId: 10, page: 9, content: "c", relevance: 0.9 },
      ],
      [],
      { now: NOW },
    );
    expect(citations.map((c) => c.anchorKey)).toEqual([
      "src:1/ver:10/page:9",
      "src:1/ver:10/page:1",
      "src:1/ver:10/page:2",
    ]);
  });

  it("marks old evidence stale", () => {
    const citations = buildCitations(
      [{ sourceId: 1, sourceVersionId: 10, page: 1, content: "x" }],
      [{ sourceVersionId: 10, createdAt: "2024-01-01T00:00:00.000Z" }],
      { now: NOW },
    );
    expect(citations[0]?.freshness).toBe("stale");
  });
});
