import { describe, expect, it } from "vitest";
import {
    rankRoleAwareCandidates as rank,
    ROLE_AWARE_RANKING_PROVENANCE,
    type RoleAwareCandidate,
} from "./role-aware-ranking";

const window = { start: "2026-11-07T00:00:00Z", cutoff: "2026-11-14T00:00:00Z" };
const role = {
    primaryRole: "Engineering",
    responsibilities: ["systems"],
    priorities: ["reliability"],
};
const candidate = (id: string, extra: Partial<RoleAwareCandidate> = {}): RoleAwareCandidate => ({
    id,
    version: "v1",
    title: "Engineering systems reliability",
    category: "technical",
    availableAt: "2026-11-10T00:00:00Z",
    ...extra,
});

describe("adapted Sophia deterministic ranking", () => {
    it("uses exact unique term overlap with Sophia stop words and Unicode normalization", () => {
        const result = rank(
            [candidate("a", { title: "SYSTEMS systems café", category: "" })],
            {
                primaryRole: "the",
                responsibilities: ["systems systems", "café"],
                priorities: ["missing"],
            },
            window
        )[0]!;
        expect(result.scores.matchedTerms).toEqual(["café", "systems"]);
        expect(result.scores.totalTerms).toBe(3);
        expect(result.scores.relevance).toBe(2 / 3);
        expect(result.provenance).toEqual(ROLE_AWARE_RANKING_PROVENANCE);
        expect(result.provenance.sourceCommit).toBe("d53cefc7c048dbaecc5d1eee387686211570f082");
    });
    it("ranks role relevance ahead of recency without inferring unresolved state", () => {
        const result = rank(
            [
                candidate("recent", { title: "Campaign", availableAt: window.cutoff }),
                candidate("older", { availableAt: "2026-10-01T00:00:00Z" }),
            ],
            role,
            window
        );
        expect(result.map(item => item.candidate.id)).toEqual(["older", "recent"]);
        expect(result.map(item => item.scores.olderOpen)).toEqual([false, false]);
        expect(result[0]!.scores.relevance).toBe(1);
    });
    it.each([undefined, { primaryRole: "the and", responsibilities: [], priorities: [] }])(
        "falls back to explicit recency with no membership role inference for %j",
        suppliedRole => {
            const result = rank(
                [
                    candidate("old", { availableAt: window.start }),
                    candidate("new", { title: "Growth", availableAt: window.cutoff }),
                ],
                suppliedRole,
                window
            );
            expect(result.map(item => item.candidate.id)).toEqual(["new", "old"]);
            expect(
                result.every(
                    item =>
                        item.rationale.mode === "recency-fallback" &&
                        item.rationale.primaryRole === null &&
                        item.scores.relevance === 0
                )
            ).toBe(true);
        }
    );
    it("preserves exact versions and deterministic identity ties across input permutations", () => {
        const docs = [
            candidate("same", { version: "v2" }),
            candidate("same", { version: "v1" }),
            candidate("a"),
        ];
        const expected = [
            ["a", "v1"],
            ["same", "v1"],
            ["same", "v2"],
        ];
        for (const supplied of [docs, [...docs].reverse(), [docs[1]!, docs[0]!, docs[2]!]]) {
            const result = rank(supplied, role, window);
            expect(result.map(item => [item.candidate.id, item.candidate.version])).toEqual(
                expected
            );
            expect(result.map(item => item.rank)).toEqual([1, 2, 3]);
            expect(result.every(item => supplied.includes(item.candidate))).toBe(true);
        }
    });
    it("accepts cutoff exactly and excludes future versions", () => {
        const result = rank(
            [
                candidate("boundary", { availableAt: window.cutoff }),
                candidate("future", { availableAt: "2026-11-14T00:00:00.001Z" }),
            ],
            role,
            window
        );
        expect(result.map(item => item.candidate.id)).toEqual(["boundary"]);
    });
    it("bounds text evaluation and reports truncation without mutating exact candidates", () => {
        const doc = candidate("bounded", {
            title: "",
            category: "",
            text: "x".repeat(6000) + " systems",
        });
        const result = rank([doc], role, window)[0]!;
        expect(result.scores.relevance).toBe(0);
        expect(result.rationale).toMatchObject({ evaluatedTextChars: 6000, textTruncated: true });
        expect(result.candidate).toBe(doc);
        expect(doc.text).toHaveLength(6008);
    });
    it("accepts 64 candidates and rejects overflow and duplicate exact versions", () => {
        const docs = Array.from({ length: 64 }, (_, i) => candidate(String(i)));
        expect(rank(docs, role, window)).toHaveLength(64);
        expect(() => rank([...docs, candidate("overflow")], role, window)).toThrow(
            "candidate limit"
        );
        expect(() => rank([candidate("a"), candidate("a")], role, window)).toThrow("Duplicate");
    });
    it("rejects malformed dates, windows, metadata and role arrays", () => {
        expect(() => rank([candidate("a", { availableAt: "invalid" })], role, window)).toThrow();
        expect(() => rank([], role, { start: window.cutoff, cutoff: window.start })).toThrow();
        expect(() => rank([candidate("a", { title: "x".repeat(1001) })], role, window)).toThrow();
        expect(() => rank([], { ...role, priorities: Array(101).fill("risk") }, window)).toThrow();
    });
});
