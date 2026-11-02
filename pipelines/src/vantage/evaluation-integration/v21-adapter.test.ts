import { describe, expect, it, vi } from "vitest";
import {
    contextSourceKeyV0,
    type BusinessRoleContextV0,
    type ContextSourceRefV0,
} from "../proposals/context-v0";
import { evaluateVantage } from "../validation/evaluate";
import { normalizeVantageOutput, outputUnits, parseEvaluationInput } from "../validation/input";
import {
    RATED_CRITERIA,
    type EvaluationInput,
    type ValidationJudge,
} from "../validation/contracts";
import { adaptV21Evaluation, V21_EVALUATION_ADAPTER_VERSION } from "./v21-adapter";

const source: ContextSourceRefV0 = { kind: "doc", id: "synthetic-samples", version: "7" };
const sourceId = contextSourceKeyV0(source);
const sourceText =
    "QA reports 3 of 3 deleted. Operations reports 2 of 3; whether samples overlap is unknown.";
function roles(): BusinessRoleContextV0 {
    return {
        contractVersion: "v0-proposed",
        authenticatedPrincipalRef: "synthetic-actor",
        roleIds: ["engineering", "product"],
        primaryRoleId: "engineering",
        mappingVersion: "synthetic-directory/v1",
        roles: [
            {
                roleId: "engineering",
                description: "Engineering perspective",
                responsibilities: [],
                priorities: [],
            },
            {
                roleId: "product",
                description: "Product perspective",
                responsibilities: [],
                priorities: [],
            },
        ],
        provenance: { kind: "server", source: "explicit synthetic evaluation role fixture" },
        userConfirmed: false,
        fallback: false,
    };
}
function report() {
    return {
        summary: "QA and Operations report deletion checks whose sample overlap is unknown.",
        headline: "Whether samples overlap is unknown.",
        brief: "QA reports 3 of 3 and Operations reports 2 of 3; sample overlap is unknown.",
        keyFigures: [
            {
                label: "QA deleted",
                value: "3",
                tone: "neutral" as const,
                refs: [source],
                derivation: { op: "sum" as const, inputs: [{ value: 3, ref: source }] },
            },
        ],
        topics: [
            {
                title: "Reconcile deletion samples",
                facts: [{ text: sourceText, refs: [source] }],
                conflicts: [],
                whyItMatters: "The checks may concern different accounts.",
                decisionQuestion: "Which accounts should reviewers compare?",
                proposedNextStep: "Compare account identifiers in both checks.",
                proposedOwner: null,
                proposedDue: null,
                helpRequested: null,
                unknowns: ["Whether the samples overlap."],
                rationale: "Sample comparability is unverified.",
                whyNow: "Resolve sample comparability before making an acceptance decision.",
                recommendation: {
                    call: "Compare account identifiers in the two checks.",
                    because: "The supplied checks do not establish sample overlap.",
                    wouldChangeIf:
                        "A reconciled account-level sample shows the same records in both checks.",
                    confidence: "low" as const,
                    refs: [source],
                },
            },
        ],
        enhancements: [],
    };
}
function input(): EvaluationInput {
    return parseEvaluationInput({
        version: "vantage-evaluation/v1",
        scenario: {
            id: "v21-synthetic-comparability",
            version: "synthetic/v1",
            title: "Synthetic sample comparison",
            asOf: "2026-10-19T12:00:00.000Z",
            contextCompleteness: "complete",
            documents: [
                {
                    id: sourceId,
                    version: "7",
                    availableAt: "2026-10-18T12:00:00.000Z",
                    text: sourceText,
                },
            ],
            expectations: [
                {
                    id: "sample-overlap-unknown",
                    kind: "must_include",
                    importance: "important",
                    description: "Preserve sample-overlap uncertainty.",
                    evidence: [{ sourceId, quote: "whether samples overlap is unknown" }],
                },
            ],
        },
        actual: normalizeVantageOutput(report(), {
            id: "synthetic-v21-output",
            pipelineVersion: "synthetic-v21-no-model/v1",
        }),
    });
}

describe("bounded V2.1 evaluation bridge", () => {
    it("preserves every added field, exact references and role provenance without editing original outputs", () => {
        const raw = report();
        const originalInput = input();
        const roleContext = roles();
        const before = JSON.stringify({ raw, originalInput, roleContext });
        const bridge = adaptV21Evaluation(
            { native: originalInput.actual, report: raw },
            { input: originalInput, roleContext }
        );
        expect(bridge.version).toBe(V21_EVALUATION_ADAPTER_VERSION);
        expect(bridge.originalFields).toEqual({
            headline: raw.headline,
            brief: raw.brief,
            keyFigures: raw.keyFigures,
            topics: raw.topics.map(topic => ({
                whyNow: topic.whyNow,
                recommendation: topic.recommendation,
            })),
        });
        expect(bridge.roleContext).toEqual(roleContext);
        expect(bridge.roleContext.userConfirmed).toBe(false);
        expect(bridge.supplementaryInput.scenario.title).toContain(
            '"roleIds":["engineering","product"]'
        );
        expect(bridge.supplementaryInput.scenario.title).toContain(
            "not source evidence or authorization"
        );
        expect(JSON.stringify({ raw, originalInput, roleContext })).toBe(before);
        expect(bridge.units.find(unit => unit.fieldPath === "keyFigures[0]")?.refs).toEqual([
            source,
        ]);
    });

    it("exposes all added content to unchanged Sophia outputUnits without inventing headline citations", () => {
        const raw = report();
        const bridge = adaptV21Evaluation(raw, { input: input(), roleContext: roles() });
        const units = outputUnits(bridge.supplementaryInput);
        for (const unit of bridge.units) {
            expect(units.find(item => item.id === unit.outputId)).toMatchObject({
                text: unit.text,
                sourceIds: unit.sourceIds,
            });
            expect(unit.semanticStatus).toBe("unassessed");
        }
        expect(
            bridge.units
                .filter(unit => ["headline", "brief", "topics[0].whyNow"].includes(unit.fieldPath))
                .every(unit => unit.sourceIds.length === 0)
        ).toBe(true);
        expect(bridge.units.map(unit => unit.text)).toEqual(
            expect.arrayContaining([
                raw.headline,
                raw.brief,
                raw.topics[0]!.whyNow,
                raw.topics[0]!.recommendation.call,
                raw.topics[0]!.recommendation.because,
                raw.topics[0]!.recommendation.wouldChangeIf,
                raw.topics[0]!.recommendation.confidence,
            ])
        );
        expect(bridge.units.find(unit => unit.fieldPath === "keyFigures[0]")?.text).toBe(
            JSON.stringify({
                label: "QA deleted",
                value: "3",
                tone: "neutral",
                derivation: { op: "sum", inputs: [{ value: 3, ref: source }] },
            })
        );
    });

    it("keeps semantic, recommendation and presentation scores unassessed when no judge exists", async () => {
        const bridge = adaptV21Evaluation(report(), { input: input(), roleContext: roles() });
        const result = await evaluateVantage(bridge.supplementaryInput);
        expect(result.status).toBe("unavailable");
        expect(result.verdict).toBe("needs-review");
        expect(result.error).toBe("no-judge");
        expect(result.integrityIssues).toEqual([]);
        expect(result.metrics.every(metric => metric.score === null)).toBe(true);
        expect(result.expectations.every(item => item.verdict === "unassessed")).toBe(true);
        expect(bridge.limitations.join(" ")).toContain("not calibrated");
    });

    it("allows a clearly labeled test-only judge to cite new-field output addresses", async () => {
        const bridge = adaptV21Evaluation(report(), { input: input(), roleContext: roles() });
        const addedUnit = bridge.units.find(
            unit => unit.fieldPath === "topics[0].recommendation.because"
        )!;
        const evidence = [
            { kind: "source" as const, id: sourceId, quote: sourceText },
            { kind: "output" as const, id: addedUnit.outputId, quote: addedUnit.text },
        ];
        // This fixture judgment proves address/quote compatibility, not quality.
        const judge: ValidationJudge = {
            kind: "fixture-replay",
            id: "v21-address-compatibility-test-double",
            evaluate: vi.fn(async () => ({
                judgment: {
                    expectations: [
                        {
                            expectationId: "sample-overlap-unknown",
                            verdict: "met",
                            reason: "Test-only address fixture.",
                            evidence,
                        },
                    ],
                    ratings: RATED_CRITERIA.map(criterion => ({
                        criterion,
                        score: 3,
                        reason: "Test-only address fixture, not an independent assessment.",
                        evidence,
                    })),
                },
            })),
        };
        const result = await evaluateVantage(bridge.supplementaryInput, { judge });
        expect(result.error).toBeNull();
        expect(result.status).toBe("assessed");
        expect(result.judge).toEqual({
            kind: "fixture-replay",
            id: "v21-address-compatibility-test-double",
        });
        expect(judge.evaluate).toHaveBeenCalledOnce();
        const request = vi.mocked(judge.evaluate).mock.calls[0]![0];
        expect(request.outputUnits.some(unit => unit.id === addedUnit.outputId)).toBe(true);
    });

    it("requires explicit bindings for raw compound aliases and never rewrites the native object", () => {
        const experimental = report();
        const alias = "doc:synthetic-samples@v7";
        const raw = JSON.parse(
            JSON.stringify({ native: { summary: "Saved native output", topics: [] }, experimental })
        );
        raw.experimental.topics[0].facts[0].refs = [alias];
        raw.experimental.topics[0].recommendation.refs = [alias];
        raw.experimental.keyFigures[0].refs = [alias];
        raw.experimental.keyFigures[0].derivation.inputs[0].ref = alias;
        const before = JSON.stringify(raw);
        expect(() => adaptV21Evaluation(raw, { input: input(), roleContext: roles() })).toThrow(
            "Unbound V2 citation alias"
        );
        const bridge = adaptV21Evaluation(raw, {
            input: input(),
            roleContext: roles(),
            sourceBindings: [{ alias, ref: source }],
        });
        expect(bridge.originalFields.keyFigures[0]!.refs).toEqual([alias]);
        expect(bridge.units.find(unit => unit.fieldPath === "keyFigures[0]")?.sourceIds).toEqual([
            sourceId,
        ]);
        expect(JSON.stringify(raw)).toBe(before);
    });

    it.each(["reference-version", "scenario-version"])(
        "rejects %s mismatch instead of inventing a citation",
        mode => {
            const raw = report();
            const base = input();
            if (mode === "reference-version")
                raw.keyFigures[0]!.refs = [{ ...source, version: "8" }];
            else base.scenario.documents[0]!.version = "8";
            expect(() => adaptV21Evaluation(raw, { input: base, roleContext: roles() })).toThrow(
                "exact scenario source/version"
            );
        }
    );

    it("rejects derivation citation tampering even when the parent figure reference exists", () => {
        const raw = report();
        raw.keyFigures[0]!.derivation.inputs[0]!.ref = { ...source, version: "8" };
        expect(() => adaptV21Evaluation(raw, { input: input(), roleContext: roles() })).toThrow(
            "exact scenario source/version"
        );
    });

    it("does not turn a null recommendation into a synthetic recommendation", () => {
        const raw = { ...report(), topics: [{ ...report().topics[0]!, recommendation: null }] };
        const bridge = adaptV21Evaluation(raw, { input: input(), roleContext: roles() });
        expect(bridge.originalFields.topics[0]!.recommendation).toBeNull();
        expect(bridge.units.some(unit => unit.fieldPath.includes("recommendation"))).toBe(false);
    });

    it("binds role state and content deterministically and can reuse an explicit existing role-title transport", () => {
        const first = adaptV21Evaluation(report(), { input: input(), roleContext: roles() });
        const second = adaptV21Evaluation(report(), { input: input(), roleContext: roles() });
        expect(first.supplementaryInputFingerprint).toBe(second.supplementaryInputFingerprint);
        expect(first.roleContextFingerprint).toBe(second.roleContextFingerprint);
        const changed = roles();
        changed.primaryRoleId = "product";
        const third = adaptV21Evaluation(report(), { input: input(), roleContext: changed });
        expect(third.supplementaryInputFingerprint).not.toBe(first.supplementaryInputFingerprint);
        expect(third.roleContextFingerprint).not.toBe(first.roleContextFingerprint);
        const prior = {
            ...input(),
            scenario: { ...input().scenario, title: first.supplementaryInput.scenario.title },
        };
        const reused = adaptV21Evaluation(report(), {
            input: prior,
            roleContext: roles(),
            roleMetadataAlreadyIncluded: true,
        });
        expect(reused.supplementaryInput.scenario.title).toBe(prior.scenario.title);
        expect(reused.roleTransport.alreadyIncludedByCaller).toBe(true);
    });

    it.each(["summary", "task", "reference"] as const)(
        "rejects a different %s body reusing an existing candidate identity",
        field => {
            const raw = report();
            const base = input();
            const identity = { id: base.actual.id, pipelineVersion: base.actual.pipelineVersion };
            if (field === "summary") raw.summary = "A different saved candidate summary.";
            else if (field === "task")
                raw.topics[0]!.proposedNextStep = "A different suggested next step.";
            else {
                const alternate = { ...source, id: "synthetic-alternate" };
                base.scenario.documents.push({
                    id: contextSourceKeyV0(alternate),
                    version: alternate.version,
                    availableAt: "2026-10-18T12:00:00.000Z",
                    text: sourceText,
                });
                raw.topics[0]!.facts[0]!.refs = [alternate];
            }
            expect({ id: base.actual.id, pipelineVersion: base.actual.pipelineVersion }).toEqual(
                identity
            );
            const before = JSON.stringify({ raw, base });
            expect(() => adaptV21Evaluation(raw, { input: base, roleContext: roles() })).toThrow(
                "different candidate"
            );
            expect(JSON.stringify({ raw, base })).toBe(before);
        }
    );

    it("rejects a V1-only report rather than silently claiming V2 coverage", () => {
        const legacy: Partial<ReturnType<typeof report>> = report();
        delete legacy.headline;
        delete legacy.brief;
        expect(() => adaptV21Evaluation(legacy, { input: input(), roleContext: roles() })).toThrow(
            "Expected bounded V2.1"
        );
    });
});
