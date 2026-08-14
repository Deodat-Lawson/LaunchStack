import { describe, expect, it } from "vitest";

import {
  detectConflicts,
  normalizeFactValue,
  resolveByRecency,
  type CitationAnchor,
  type EvidenceAssertion,
} from "../src/index";

const anchor = (
  sourceId: number,
  sourceVersionId: number,
  page = 1,
): CitationAnchor => ({
  sourceId,
  sourceVersionId,
  span: { kind: "page", page },
});

const assertion = (
  factKey: string,
  value: string,
  a: CitationAnchor,
  observedAt: string,
): EvidenceAssertion => ({ factKey, value, anchor: a, observedAt });

describe("normalizeFactValue", () => {
  it("trims, collapses whitespace runs, and casefolds", () => {
    expect(normalizeFactValue("  Acme   Corp \n Inc.\t")).toBe("acme corp inc.");
    expect(normalizeFactValue("ACME CORP INC.")).toBe("acme corp inc.");
    expect(normalizeFactValue("acme corp inc.")).toBe("acme corp inc.");
  });
});

describe("detectConflicts", () => {
  const current = new Set([2, 20]);

  it("detects a cross-source conflict on distinct normalized values", () => {
    const conflicts = detectConflicts(
      [
        assertion("hq.city", "Berlin", anchor(1, 2), "2026-01-01T00:00:00Z"),
        assertion("hq.city", "Munich", anchor(9, 20), "2026-02-01T00:00:00Z"),
      ],
      { currentVersionIds: current },
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.factKey).toBe("hq.city");
    expect(conflicts[0]!.values.map((v) => v.value)).toEqual([
      "berlin",
      "munich",
    ]);
    expect(conflicts[0]!.values.flatMap((v) => v.assertions)).toHaveLength(2);
  });

  it("does not conflict when values only differ in case/whitespace", () => {
    expect(
      detectConflicts(
        [
          assertion("hq.city", "Berlin", anchor(1, 2), "2026-01-01T00:00:00Z"),
          assertion("hq.city", "  BERLIN ", anchor(9, 20), "2026-02-01T00:00:00Z"),
        ],
        { currentVersionIds: current },
      ),
    ).toEqual([]);
  });

  it("never conflicts within a single source", () => {
    expect(
      detectConflicts(
        [
          assertion("hq.city", "Berlin", anchor(1, 2), "2026-01-01T00:00:00Z"),
          assertion("hq.city", "Munich", anchor(1, 2, 7), "2026-02-01T00:00:00Z"),
        ],
        { currentVersionIds: current },
      ),
    ).toEqual([]);
  });

  it("excludes assertions anchored in superseded versions", () => {
    // Source 1's v1 said Berlin, superseded by v2 saying Munich. Source 9
    // (current) also says Munich: nothing left disagrees.
    const conflicts = detectConflicts(
      [
        assertion("hq.city", "Berlin", anchor(1, 1), "2026-01-01T00:00:00Z"),
        assertion("hq.city", "Munich", anchor(1, 2), "2026-03-01T00:00:00Z"),
        assertion("hq.city", "Munich", anchor(9, 20), "2026-02-01T00:00:00Z"),
      ],
      { currentVersionIds: current },
    );
    expect(conflicts).toEqual([]);
  });

  it("still reports the cross-source conflict after superseded evidence is removed", () => {
    // Source 1's superseded v1 agreed with source 9; its current v2 does not.
    const conflicts = detectConflicts(
      [
        assertion("hq.city", "Munich", anchor(1, 1), "2026-01-01T00:00:00Z"),
        assertion("hq.city", "Berlin", anchor(1, 2), "2026-03-01T00:00:00Z"),
        assertion("hq.city", "Munich", anchor(9, 20), "2026-02-01T00:00:00Z"),
      ],
      { currentVersionIds: current },
    );
    expect(conflicts).toHaveLength(1);
    const berlin = conflicts[0]!.values.find((v) => v.value === "berlin");
    expect(berlin?.assertions.map((a) => a.anchor.sourceVersionId)).toEqual([2]);
    const munich = conflicts[0]!.values.find((v) => v.value === "munich");
    expect(munich?.assertions.map((a) => a.anchor.sourceVersionId)).toEqual([20]);
  });

  it("orders conflicts and value groups deterministically regardless of input order", () => {
    const input = [
      assertion("b.fact", "one", anchor(1, 2), "2026-01-01T00:00:00Z"),
      assertion("b.fact", "two", anchor(9, 20), "2026-01-02T00:00:00Z"),
      assertion("a.fact", "yes", anchor(1, 2), "2026-01-03T00:00:00Z"),
      assertion("a.fact", "no", anchor(9, 20), "2026-01-04T00:00:00Z"),
    ];
    const forward = detectConflicts(input, { currentVersionIds: current });
    const backward = detectConflicts([...input].reverse(), {
      currentVersionIds: current,
    });
    expect(forward.map((c) => c.factKey)).toEqual(["a.fact", "b.fact"]);
    expect(backward.map((c) => c.factKey)).toEqual(["a.fact", "b.fact"]);
    expect(forward[0]!.values.map((v) => v.value)).toEqual(["no", "yes"]);
    expect(backward[0]!.values.map((v) => v.value)).toEqual(["no", "yes"]);
  });
});

describe("resolveByRecency", () => {
  const conflictOf = (...assertions: EvidenceAssertion[]) =>
    detectConflicts(assertions, {
      currentVersionIds: new Set(
        assertions.map((a) => a.anchor.sourceVersionId),
      ),
    })[0]!;

  it("picks the newest observedAt and preserves all alternatives", () => {
    const older = assertion("hq.city", "Berlin", anchor(1, 2), "2026-01-01T00:00:00Z");
    const newest = assertion("hq.city", "Munich", anchor(9, 20), "2026-03-01T00:00:00Z");
    const middle = assertion("hq.city", "Hamburg", anchor(5, 50), "2026-02-01T00:00:00Z");
    const { winner, alternatives } = resolveByRecency(
      conflictOf(older, newest, middle),
    );
    expect(winner).toBe(newest);
    expect(alternatives).toHaveLength(2);
    expect(alternatives).toContain(older);
    expect(alternatives).toContain(middle);
  });

  it("breaks observedAt ties by higher sourceVersionId", () => {
    const at = "2026-03-01T00:00:00Z";
    const lowVersion = assertion("hq.city", "Berlin", anchor(1, 2), at);
    const highVersion = assertion("hq.city", "Munich", anchor(9, 20), at);
    expect(resolveByRecency(conflictOf(lowVersion, highVersion)).winner).toBe(
      highVersion,
    );
    expect(resolveByRecency(conflictOf(highVersion, lowVersion)).winner).toBe(
      highVersion,
    );
  });

  it("breaks full observedAt+version ties by anchorKey ordering, deterministically", () => {
    const at = "2026-03-01T00:00:00Z";
    // Same version id on both anchors; keys differ only in page.
    const pageTwo = assertion("hq.city", "Berlin", anchor(1, 2, 2), at);
    const pageNine = assertion("hq.city", "Munich", anchor(3, 2, 9), at);
    const a = resolveByRecency(conflictOf(pageTwo, pageNine));
    const b = resolveByRecency(conflictOf(pageNine, pageTwo));
    expect(a.winner).toBe(b.winner);
    // "src:3/ver:2/page:9" > "src:1/ver:2/page:2" — greatest key wins the tie.
    expect(a.winner).toBe(pageNine);
    expect(a.alternatives).toEqual([pageTwo]);
  });

  it("orders alternatives most recent first", () => {
    const a1 = assertion("k", "v1", anchor(1, 2), "2026-01-01T00:00:00Z");
    const a2 = assertion("k", "v2", anchor(5, 50), "2026-02-01T00:00:00Z");
    const a3 = assertion("k", "v3", anchor(9, 20), "2026-03-01T00:00:00Z");
    const { alternatives } = resolveByRecency(conflictOf(a1, a3, a2));
    expect(alternatives).toEqual([a2, a1]);
  });
});
