import { describe, expect, it } from "vitest";

import {
  reconcile,
  type CitationAnchor,
  type EvidenceAssertion,
  type FactRecord,
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

const record = (
  factKey: string,
  value: string,
  a: CitationAnchor,
  observedAt: string,
  supersededValues: FactRecord["supersededValues"] = [],
): FactRecord => ({ factKey, value, anchor: a, observedAt, supersededValues });

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
};

const current = new Set([2, 20]);

describe("reconcile", () => {
  it("creates a record for a new fact key", () => {
    const incoming = [
      assertion("hq.city", "Berlin", anchor(1, 2), "2026-01-01T00:00:00Z"),
    ];
    const result = reconcile([], incoming, { currentVersionIds: current });
    expect(result.changes).toEqual([{ factKey: "hq.city", kind: "created" }]);
    expect(result.facts).toEqual([
      record("hq.city", "Berlin", anchor(1, 2), "2026-01-01T00:00:00Z"),
    ]);
    expect(result.conflicts).toEqual([]);
  });

  it("updates an existing fact and pushes the old value onto supersededValues", () => {
    const existing = [
      record("hq.city", "Berlin", anchor(1, 2), "2026-01-01T00:00:00Z"),
    ];
    const result = reconcile(
      existing,
      [assertion("hq.city", "Munich", anchor(1, 2, 3), "2026-02-01T00:00:00Z")],
      { currentVersionIds: current },
    );
    expect(result.changes).toEqual([{ factKey: "hq.city", kind: "updated" }]);
    expect(result.facts).toEqual([
      record("hq.city", "Munich", anchor(1, 2, 3), "2026-02-01T00:00:00Z", [
        {
          value: "Berlin",
          anchor: anchor(1, 2),
          observedAt: "2026-01-01T00:00:00Z",
        },
      ]),
    ]);
  });

  it("reports unchanged when the incoming value agrees after normalization", () => {
    const existing = [
      record("hq.city", "Berlin", anchor(1, 2), "2026-01-01T00:00:00Z"),
    ];
    const result = reconcile(
      existing,
      [assertion("hq.city", " BERLIN ", anchor(9, 20), "2026-02-01T00:00:00Z")],
      { currentVersionIds: current },
    );
    expect(result.changes).toEqual([{ factKey: "hq.city", kind: "unchanged" }]);
    expect(result.facts[0]).toBe(existing[0]);
  });

  it("ignores incoming assertions anchored in superseded versions", () => {
    const existing = [
      record("hq.city", "Berlin", anchor(1, 2), "2026-01-01T00:00:00Z"),
    ];
    const result = reconcile(
      existing,
      [assertion("hq.city", "Munich", anchor(1, 1), "2026-02-01T00:00:00Z")],
      { currentVersionIds: current },
    );
    expect(result.changes).toEqual([]);
    expect(result.facts).toEqual(existing);
    expect(result.facts[0]).toBe(existing[0]);
    expect(result.conflicts).toEqual([]);
  });

  it("keeps the newest value when the incoming assertion is older, storing it as history", () => {
    const existing = [
      record("hq.city", "Munich", anchor(1, 2), "2026-03-01T00:00:00Z"),
    ];
    const result = reconcile(
      existing,
      [assertion("hq.city", "Berlin", anchor(9, 20), "2026-01-01T00:00:00Z")],
      { currentVersionIds: current },
    );
    expect(result.changes).toEqual([{ factKey: "hq.city", kind: "updated" }]);
    expect(result.facts[0]!.value).toBe("Munich");
    expect(result.facts[0]!.supersededValues).toEqual([
      {
        value: "Berlin",
        anchor: anchor(9, 20),
        observedAt: "2026-01-01T00:00:00Z",
      },
    ]);
  });

  it("applies a batch for one key oldest to newest", () => {
    const result = reconcile(
      [],
      [
        assertion("hq.city", "Hamburg", anchor(1, 2), "2026-03-01T00:00:00Z"),
        assertion("hq.city", "Berlin", anchor(1, 2, 2), "2026-01-01T00:00:00Z"),
        assertion("hq.city", "Munich", anchor(1, 2, 3), "2026-02-01T00:00:00Z"),
      ],
      { currentVersionIds: current },
    );
    expect(result.changes).toEqual([{ factKey: "hq.city", kind: "created" }]);
    expect(result.facts[0]!.value).toBe("Hamburg");
    expect(result.facts[0]!.supersededValues.map((s) => s.value)).toEqual([
      "Berlin",
      "Munich",
    ]);
  });

  it("reports cross-source conflicts over the merged current set", () => {
    const existing = [
      record("hq.city", "Berlin", anchor(1, 2), "2026-01-01T00:00:00Z"),
    ];
    const result = reconcile(
      existing,
      [assertion("hq.city", "Munich", anchor(9, 20), "2026-02-01T00:00:00Z")],
      { currentVersionIds: current },
    );
    // The ledger keeps the recency winner, but the disagreement is surfaced.
    expect(result.facts[0]!.value).toBe("Munich");
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.factKey).toBe("hq.city");
    expect(result.conflicts[0]!.values.map((v) => v.value).sort()).toEqual([
      "berlin",
      "munich",
    ]);
  });

  it("does not report a conflict when the ledger record's version is superseded", () => {
    // The existing record cites version 1, no longer current; only the
    // incoming evidence participates in conflict detection.
    const existing = [
      record("hq.city", "Berlin", anchor(1, 1), "2026-01-01T00:00:00Z"),
    ];
    const result = reconcile(
      existing,
      [assertion("hq.city", "Munich", anchor(9, 20), "2026-02-01T00:00:00Z")],
      { currentVersionIds: current },
    );
    expect(result.conflicts).toEqual([]);
    expect(result.facts[0]!.value).toBe("Munich");
  });

  it("handles independent keys in one batch", () => {
    const existing = [
      record("hq.city", "Berlin", anchor(1, 2), "2026-01-01T00:00:00Z"),
      record("ceo.name", "Ada Lovelace", anchor(1, 2, 2), "2026-01-01T00:00:00Z"),
    ];
    const result = reconcile(
      existing,
      [
        assertion("ceo.name", "Grace Hopper", anchor(9, 20), "2026-02-01T00:00:00Z"),
        assertion("founded.year", "2019", anchor(9, 20, 2), "2026-02-01T00:00:00Z"),
      ],
      { currentVersionIds: current },
    );
    expect(result.changes).toEqual([
      { factKey: "ceo.name", kind: "updated" },
      { factKey: "founded.year", kind: "created" },
    ]);
    expect(result.facts.map((f) => f.factKey)).toEqual([
      "hq.city",
      "ceo.name",
      "founded.year",
    ]);
    // Untouched records pass through by reference.
    expect(result.facts[0]).toBe(existing[0]);
  });

  it("never mutates its inputs", () => {
    const existing = deepFreeze([
      record("hq.city", "Berlin", anchor(1, 2), "2026-01-01T00:00:00Z", [
        {
          value: "Bonn",
          anchor: anchor(1, 1),
          observedAt: "2025-06-01T00:00:00Z",
        },
      ]),
    ]);
    const incoming = deepFreeze([
      assertion("hq.city", "Munich", anchor(9, 20), "2026-02-01T00:00:00Z"),
      assertion("ceo.name", "Ada Lovelace", anchor(9, 20, 2), "2026-02-01T00:00:00Z"),
    ]);
    const existingSnapshot = structuredClone(existing);
    const incomingSnapshot = structuredClone(incoming);

    const result = reconcile(existing, incoming, { currentVersionIds: current });

    expect(existing).toEqual(existingSnapshot);
    expect(incoming).toEqual(incomingSnapshot);
    // The updated record is a fresh object; prior history is carried over.
    expect(result.facts[0]).not.toBe(existing[0]);
    expect(result.facts[0]!.supersededValues.map((s) => s.value)).toEqual([
      "Bonn",
      "Berlin",
    ]);
  });

  it("rejects a ledger with duplicate fact keys", () => {
    const dup = [
      record("hq.city", "Berlin", anchor(1, 2), "2026-01-01T00:00:00Z"),
      record("hq.city", "Munich", anchor(9, 20), "2026-02-01T00:00:00Z"),
    ];
    expect(() =>
      reconcile(dup, [], { currentVersionIds: current }),
    ).toThrow(RangeError);
  });
});
