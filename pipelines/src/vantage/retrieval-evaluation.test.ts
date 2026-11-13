import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
    evaluateRetrievalOffline,
    type EvaluationGold,
    type RetrievalEvaluationCandidate,
    type RetrievalEvaluationInput,
    type RetrievalEvaluationOutput,
} from "./retrieval-evaluation";

const input: RetrievalEvaluationInput = {
    corpusId: "synthetic-provisional-microcase",
    corpusVersion: "v1",
    companyId: "company-a",
    cutoff: "2026-10-26T00:00:00.000Z",
    query: "What evidence supports the release decision?",
    topK: 2,
    budgets: { maxAcquired: 4, maxSelected: 3, maxSelectedCharacters: 100, maxElapsedMs: 1000 },
    corpus: ["required", "decision", "routine", "follow-up"].map(id => ({
        id,
        version: "v1",
        hash: createHash("sha256").update(id, "utf8").digest("hex"),
        citation: `doc:${id}@v1`,
        companyId: "company-a",
        authorized: true,
        availableAt: "2026-10-23T12:00:00.000Z",
        text: id,
    })),
};
const gold: EvaluationGold = {
    provenance: "provisional",
    source: "retrieval-evaluation.test.ts synthetic hand-authored microcase",
    reviewer: "test-author",
    revision: "v1",
    criticalIds: ["decision", "follow-up"],
    mandatoryIds: ["required"],
    optional: {
        poolIds: ["decision", "routine", "follow-up"],
        relevantIds: ["decision", "follow-up"],
    },
    decisions: [{ id: "release", requiredEvidenceIds: ["decision", "follow-up"] }],
};
function output(
    ids: string[],
    acquiredIds = input.corpus.map(item => item.id)
): RetrievalEvaluationOutput {
    return {
        acquiredIds,
        selected: ids.map(id => {
            const evidence = input.corpus.find(item => item.id === id)!;
            return {
                id,
                version: evidence.version,
                hash: evidence.hash,
                citation: evidence.citation,
            };
        }),
    };
}
function candidate(
    result: RetrievalEvaluationOutput,
    name: RetrievalEvaluationCandidate["name"] = "D-scoped-candidate"
) {
    return { name, implementation: "synthetic-callback-v1", run: () => result };
}

describe("offline retrieval evaluation", () => {
    it("keeps missing labels unverified with null values", async () => {
        const report = await evaluateRetrievalOffline(input, [candidate(output(["routine"]))]);
        expect(report.candidates[0]!.status).toBe("valid");
        for (const metric of Object.values(report.candidates[0]!.metrics)) {
            expect(metric).toEqual({
                status: "unverified",
                provenance: "none",
                numerator: null,
                denominator: null,
                value: null,
            });
        }
        expect(report.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    });

    it("computes only explicit provisional judgments with reviewable denominators", async () => {
        const report = await evaluateRetrievalOffline({ ...input, gold }, [
            candidate(output(["required", "routine"]), "A-production"),
            candidate(output(["decision", "follow-up", "required"])),
        ]);
        const [baseline, scoped] = report.candidates;
        expect(baseline!.metrics.criticalEvidenceRecallAtK.value).toBe(0);
        expect(baseline!.metrics.mandatoryCoverage.value).toBe(1);
        expect(baseline!.metrics.optionalRelevanceAtK.value).toBe(0);
        expect(baseline!.metrics.decisionEvidenceCoverage.value).toBe(0);
        expect(scoped!.metrics.criticalEvidenceRecallAtK).toEqual({
            status: "verified",
            provenance: "provisional",
            numerator: 2,
            denominator: 2,
            value: 1,
        });
        expect(scoped!.metrics.mandatoryCoverage.value).toBe(1);
        expect(scoped!.metrics.optionalRelevanceAtK.value).toBe(1);
        expect(scoped!.metrics.decisionEvidenceCoverage.value).toBe(1);
        expect(scoped!.output!.acquiredIds).toHaveLength(4);
        expect(scoped!.output!.selected).toHaveLength(3);
        expect(scoped!.elapsedMs).toBeGreaterThanOrEqual(0);
    });

    it("retains invalid selections and reports exact version, hash, citation, and ACL violations", async () => {
        const invalid = output(["decision"]);
        const selected = [
            { ...invalid.selected[0]!, version: "v2", hash: "wrong", citation: "wrong" },
            { id: "private-other-company", version: "v1", hash: "x", citation: "x" },
        ];
        const report = await evaluateRetrievalOffline({ ...input, gold }, [
            candidate({
                acquiredIds: ["decision", "private-other-company"],
                selected,
            }),
        ]);
        const result = report.candidates[0]!;
        expect(result.status).toBe("invalid");
        expect(result.output!.selected).toEqual(selected);
        expect(result.violations).toEqual(
            expect.arrayContaining([
                "version-mismatch:decision",
                "hash-mismatch:decision",
                "citation-mismatch:decision",
                "acquired-outside-authorized-corpus:private-other-company",
                "selected-outside-authorized-corpus:private-other-company",
            ])
        );
        expect(result.metrics.criticalEvidenceRecallAtK.status).toBe("invalid-output");
        expect(result.metrics.criticalEvidenceRecallAtK.value).toBeNull();
    });

    it("reports resource cap, duplicate, and unacquired selection violations", async () => {
        const report = await evaluateRetrievalOffline(
            {
                ...input,
                budgets: {
                    ...input.budgets,
                    maxAcquired: 1,
                    maxSelected: 2,
                    maxSelectedCharacters: 1,
                },
            },
            [
                candidate({
                    acquiredIds: ["decision", "decision"],
                    selected: output(["decision", "decision", "routine"]).selected,
                }),
            ]
        );
        expect(report.candidates[0]!.violations).toEqual(
            expect.arrayContaining([
                "duplicate-acquisition",
                "acquisition-cap",
                "selection-cap",
                "character-cap",
                "duplicate-selection:decision",
                "selected-without-acquisition:routine",
            ])
        );
    });

    it.each([
        { authorized: false },
        { companyId: "other-company" },
        { availableAt: "2026-10-26T00:00:00.001Z" },
        { availableAt: "invalid" },
    ])("rejects unauthorized or nonhistorical frozen corpus records %j", async patch => {
        await expect(
            evaluateRetrievalOffline({ ...input, corpus: [{ ...input.corpus[0]!, ...patch }] }, [])
        ).rejects.toThrow("Corpus must contain unique, authorized, cutoff-eligible exact evidence");
    });

    it("accepts exact cutoff equality by default and supports explicit exclusive cutoff", async () => {
        const equal = { ...input, corpus: [{ ...input.corpus[0]!, availableAt: input.cutoff }] };
        const report = await evaluateRetrievalOffline(equal, []);
        expect(report.manifest.cutoffInclusive).toBe(true);
        await expect(
            evaluateRetrievalOffline({ ...equal, cutoffInclusive: false }, [])
        ).rejects.toThrow("cutoff-eligible");
    });

    it("bounds asynchronous awaiting, aborts the signal, and continues after a noncooperative callback", async () => {
        let signal: AbortSignal | undefined;
        const report = await evaluateRetrievalOffline(
            { ...input, budgets: { ...input.budgets, maxElapsedMs: 10 } },
            [
                {
                    name: "A-production",
                    implementation: "synthetic-never-resolves-v1",
                    run: (_, suppliedSignal) => {
                        signal = suppliedSignal;
                        return new Promise<RetrievalEvaluationOutput>(() => {});
                    },
                },
                candidate(output([], []), "B-budget-v1"),
            ]
        );
        expect(signal!.aborted).toBe(true);
        expect(report.candidates[0]!.status).toBe("error");
        expect(report.candidates[0]!.violations).toContain("callback-timeout");
        expect(report.candidates[0]!.error).toBe("retrieval_evaluation_timeout");
        expect(report.candidates[1]!.status).toBe("valid");
    });

    it("rejects unreviewable or inconsistent labels before callbacks run", async () => {
        await expect(
            evaluateRetrievalOffline({ ...input, gold: { ...gold, reviewer: "" } }, [])
        ).rejects.toThrow("reviewable provenance");
        await expect(
            evaluateRetrievalOffline({ ...input, gold: { ...gold, criticalIds: ["unknown"] } }, [])
        ).rejects.toThrow("unknown evidence ID");
        await expect(
            evaluateRetrievalOffline(
                { ...input, gold: { ...gold, criticalIds: ["decision", "decision"] } },
                []
            )
        ).rejects.toThrow("duplicate or unknown");
    });

    it("keeps absent categories and zero denominators unverified", async () => {
        const report = await evaluateRetrievalOffline(
            {
                ...input,
                gold: { ...gold, criticalIds: undefined, mandatoryIds: [], decisions: [] },
            },
            [candidate(output(["required"]))]
        );
        for (const metric of Object.values(report.candidates[0]!.metrics)) {
            expect(metric.status).toBe("unverified");
            expect(metric.value).toBeNull();
        }
    });

    it("keeps exceptions separate from successful empty retrieval and continues comparison", async () => {
        const report = await evaluateRetrievalOffline({ ...input, gold }, [
            {
                name: "A-production",
                implementation: "synthetic-throws-v1",
                run: () => {
                    throw new Error("retrieval unavailable");
                },
            },
            candidate(output([], []), "B-budget-v1"),
        ]);
        expect(report.candidates[0]!.status).toBe("error");
        expect(report.candidates[0]!.error).toBe("retrieval unavailable");
        expect(report.candidates[0]!.metrics.criticalEvidenceRecallAtK.value).toBeNull();
        expect(report.candidates[1]!.status).toBe("valid");
        expect(report.candidates[1]!.metrics.criticalEvidenceRecallAtK.value).toBe(0);
    });

    it.each([
        { hash: "0".repeat(64) },
        { text: "changed body retaining prior hash" },
        { hash: "not-a-sha256" },
    ])("rejects forged or stale corpus hashes before invoking candidates %j", async patch => {
        let called = false;
        await expect(
            evaluateRetrievalOffline({ ...input, corpus: [{ ...input.corpus[0]!, ...patch }] }, [
                {
                    ...candidate(output([], [])),
                    run: () => {
                        called = true;
                        return output([], []);
                    },
                },
            ])
        ).rejects.toThrow("cutoff-eligible exact evidence");
        expect(called).toBe(false);
    });

    it("keeps evaluator labels and unexpected runtime metadata outside candidate inputs", async () => {
        const visible: string[] = [];
        const inspect: RetrievalEvaluationCandidate = {
            name: "A-production",
            implementation: "gold-blind-probe-v1",
            run: frozen => {
                // @ts-expect-error Gold is deliberately absent from the candidate contract.
                expect(frozen.gold).toBeUndefined();
                expect(Object.keys(frozen)).not.toContain("reviewer");
                expect(Object.keys(frozen.corpus[0]!)).not.toContain("criticalLabel");
                expect(Object.isFrozen(frozen.corpus[0])).toBe(true);
                visible.push(JSON.stringify(frozen));
                return output([], []);
            },
        };
        const extended = {
            ...input,
            reviewer: "private evaluator",
            corpus: input.corpus.map(item => ({ ...item, criticalLabel: true })),
        };
        await evaluateRetrievalOffline({ ...extended, gold }, [inspect]);
        await evaluateRetrievalOffline(
            { ...extended, gold: { ...gold, revision: "v2", criticalIds: ["routine"] } },
            [inspect]
        );
        expect(visible[0]).toBe(visible[1]);
        expect(visible[0]).not.toContain("test-author");
        expect(visible[0]).not.toContain("criticalIds");
    });

    it("freezes independent inputs and snapshots outputs between candidates", async () => {
        const mutable = output(["decision"]);
        const report = await evaluateRetrievalOffline(input, [
            {
                ...candidate(mutable, "A-production"),
                run: frozen => {
                    expect(Object.isFrozen(frozen.corpus[0])).toBe(true);
                    return mutable;
                },
            },
            {
                ...candidate(output([], []), "B-budget-v1"),
                run: () => {
                    mutable.selected[0]!.version = "mutated";
                    return output([], []);
                },
            },
        ]);
        expect(report.candidates[0]!.output!.selected[0]!.version).toBe("v1");
        expect(Object.isFrozen(input)).toBe(false);
        const repeat = await evaluateRetrievalOffline(input, []);
        expect(repeat.manifestSha256).toBe(report.manifestSha256);
    });
});
