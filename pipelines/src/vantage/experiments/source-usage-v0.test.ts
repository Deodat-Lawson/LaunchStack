import { describe, expect, it } from "vitest";
import type { ContextSourceRefV0 } from "../proposals/context-v0";
import { inspectSourceUsageV0, type SourceUsageReportV0 } from "./source-usage-v0";

const original: ContextSourceRefV0 = { kind: "doc", id: "finance", version: "v1" };
const independent: ContextSourceRefV0 = { kind: "doc", id: "sales", version: "v2" };
const intake: ContextSourceRefV0 = { kind: "ev", id: "copy", version: "v3" };
function report(rationale = "A source-backed check may be useful."): SourceUsageReportV0 {
    return {
        summary: "The supplied observation is provisional.",
        topics: [{ facts: [{ refs: ["ev:copy@v3"] }], conflicts: [], rationale }],
    };
}

describe("exact source citation-use diagnostics, never a semantic coverage verdict", () => {
    it("reproduces the captured finance output's uncited independent source and scoped exclusivity review signal", () => {
        // Exact actual rationale, retained as a test input rather than encoded in policy.
        const value = report(
            "This is the only current revenue evidence supplied and it expressly identifies unreconciled refunds."
        );
        const result = inspectSourceUsageV0([original, independent, intake], value);
        expect(result.citedSourceKeys).toEqual(["ev:copy@v3"]);
        expect(result.uncitedSourceKeys).toEqual(["doc:finance@v1", "doc:sales@v2"]);
        expect(result.supplyExclusivityReview).toEqual([
            {
                path: "topics[0].rationale",
                assertion: value.topics[0]!.rationale,
                uncitedSourceKeys: ["doc:finance@v1", "doc:sales@v2"],
                reason: "scope-and-source-equivalence-require-semantic-review",
            },
        ]);
        expect(result).not.toHaveProperty("valid");
        expect(result).not.toHaveProperty("contradiction");
    });

    it("permits a legitimate single-original plus copy without requiring duplicate recommendations", () => {
        const value = report("This is the only observation supplied.");
        value.topics[0]!.facts[0]!.refs = [original, intake];
        const result = inspectSourceUsageV0([original, intake], value);
        expect(result.uncitedSourceKeys).toEqual([]);
        expect(result.supplyExclusivityReview).toEqual([]);
        expect(value.topics).toHaveLength(1);
    });

    it("does not assert a false-world fact when uncited documents may be unrelated", () => {
        const value = report("This is the only safety evidence supplied.");
        const result = inspectSourceUsageV0([original, independent, intake], value);
        expect(result.supplyExclusivityReview).toHaveLength(1);
        expect(result.semantics).toBe("uncited-does-not-mean-irrelevant-or-unused");
        expect(result.supplyExclusivityReview[0]!.reason).toBe(
            "scope-and-source-equivalence-require-semantic-review"
        );
    });

    it.each([
        '"This is the only current evidence supplied." was an earlier interpretation.',
        "The historical AI said: This is the only current evidence supplied.",
        "In the old review, this is the only evidence supplied was an unsupported claim.",
        "Is this the only current evidence supplied?",
        "This is not the only current evidence supplied.",
    ])(
        "does not treat quoted, historical, interrogative or negated wording as a current inventory assertion: %s",
        text => {
            const value = report(text);
            value.summary = text;
            expect(
                inspectSourceUsageV0([original, independent, intake], value).supplyExclusivityReview
            ).toEqual([]);
        }
    );

    it("does not inspect quoted factual excerpts or decision questions for inventory claims", () => {
        const value = report();
        Object.assign(value.topics[0]!.facts[0]!, {
            text: 'The previous AI wrote "This is the only evidence supplied."',
        });
        Object.assign(value.topics[0]!, {
            decisionQuestion: "Is this the only evidence supplied?",
        });
        expect(
            inspectSourceUsageV0([original, independent, intake], value).supplyExclusivityReview
        ).toEqual([]);
    });

    it("retains uncited sources as diagnostics without manufacturing citations or treating them as irrelevant", () => {
        const value = report();
        const before = structuredClone(value);
        const result = inspectSourceUsageV0([original, independent, intake], value);
        expect(result.uncitedSourceKeys).toEqual(["doc:finance@v1", "doc:sales@v2"]);
        expect(result.supplyExclusivityReview).toEqual([]);
        expect(value).toEqual(before);
    });

    it("does not invent aliases for unknown or stale source references", () => {
        const value = report();
        value.topics[0]!.facts[0]!.refs = ["ev:copy", "doc:sales@old", "doc:invented@v1"];
        const result = inspectSourceUsageV0([original, independent, intake], value);
        expect(result.citedSourceKeys).toEqual([]);
        expect(result.uncitedSourceKeys).toHaveLength(3);
    });

    it("is deterministic, exact-versioned and deduplicates only exact source identities", () => {
        const old = { ...independent, version: "v1" };
        const value = report();
        value.topics[0]!.conflicts = [{ refs: [independent, independent] }];
        expect(inspectSourceUsageV0([intake, original, independent, original, old], value)).toEqual(
            inspectSourceUsageV0([old, independent, original, intake], value)
        );
        expect(inspectSourceUsageV0([independent, old, intake], value).uncitedSourceKeys).toEqual([
            "doc:sales@v1",
        ]);
    });
});
