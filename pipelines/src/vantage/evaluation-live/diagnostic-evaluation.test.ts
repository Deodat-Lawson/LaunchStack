import { describe, expect, it } from "vitest";
import semantic from "../../../../fixtures/vantage-pipeline-edge-cases/semantic-cases.json";
import outputs from "../../../../fixtures/vantage-integration-evaluation/offline-outputs.json";
import {
    materializeJosephOfflineOutput,
    type JosephSemanticCase,
    type JosephOfflineOutput,
} from "../evaluation-integration/joseph-adapter";
import { contextSourceKeyV0 } from "../proposals/context-v0";
import { checkOutputIntegrity, evaluateVantage } from "../validation/evaluate";
import { outputUnits } from "../validation/input";
import { prepareLivePilotContext } from "./pilot-context";
import { buildDiagnosticEvaluation } from "./diagnostic-evaluation";

const scenario = semantic.cases[0]! as JosephSemanticCase;
const identity = { id: "observed-invalid-delivery", pipelineVersion: "diagnostic-unit/v1" };
async function fixture() {
    const context = await prepareLivePilotContext(scenario);
    const source = context.prepared.documents[0]!.sourceKey;
    const materialized = materializeJosephOfflineOutput(
        context.prepared,
        outputs.cases[0]! as JosephOfflineOutput
    );
    const first = materialized.topics[0]!;
    const { proposedDue: _due, ...legacy } = first;
    void _due;
    const raw = {
        summary: materialized.summary,
        headline: "A rollback plan is required.",
        brief: "The policy calls for a rollback plan. It does not establish approval.",
        keyFigures: [
            { label: "Requirement", value: "rollback plan", tone: "neutral", refs: [source] },
        ],
        topics: [
            {
                ...legacy,
                proposedDueInDays: null,
                facts: first.facts.map(item => ({
                    ...item,
                    refs: item.refs.map(contextSourceKeyV0),
                })),
                conflicts: first.conflicts.map(item => ({
                    ...item,
                    refs: item.refs.map(contextSourceKeyV0),
                })),
                whyNow: "x".repeat(174),
                recommendation: {
                    call: "Review the rollback plan.",
                    confidence: "low",
                    because: "The policy requires rollback planning.",
                    wouldChangeIf: "A recorded release decision supplies more evidence.",
                    refs: [source],
                },
            },
        ],
        enhancements: [],
    };
    return { ...context, raw };
}

describe("observed V2 semantic diagnostic is never a validated Generation result", () => {
    it("preserves every V2 field and the overlong whyNow without changing report or envelope", async () => {
        const f = await fixture();
        const before = JSON.stringify({ raw: f.raw, prepared: f.prepared, envelope: f.envelope });
        const result = buildDiagnosticEvaluation(f.prepared, scenario, f.raw, f.envelope, identity);
        expect(result).toMatchObject({ diagnosticOnly: true, generationValidated: false });
        const diagnostic = result.sidecar.diagnostic;
        expect(diagnostic.originalRawExperimental).toEqual(f.raw);
        expect(
            diagnostic.structuralSchemaIssues.some(
                issue => issue.path.join(".") === "topics.0.whyNow" && issue.code === "too_big"
            )
        ).toBe(true);
        expect(diagnostic.units.find(unit => unit.fieldPath.endsWith("whyNow"))?.text).toBe(
            f.raw.topics[0]!.whyNow
        );
        expect(diagnostic.units.find(unit => unit.fieldPath.endsWith("whyNow"))?.text).toHaveLength(
            174
        );
        const texts = outputUnits(result.input).map(unit => unit.text);
        for (const text of [
            f.raw.headline,
            f.raw.brief,
            f.raw.topics[0]!.whyNow,
            ...Object.entries(f.raw.topics[0]!.recommendation)
                .filter(([key]) => key !== "refs")
                .map(([, value]) => value),
        ])
            expect(texts).toContain(text);
        expect(texts).toContain(JSON.stringify(f.raw.keyFigures[0]));
        expect(diagnostic.citationIntegrityIssues).toEqual([]);
        expect(JSON.stringify({ raw: f.raw, prepared: f.prepared, envelope: f.envelope })).toBe(
            before
        );
        expect(JSON.stringify(result.input)).not.toMatch(
            /diagnosticOnly|generationValidated|structuralSchemaIssues|too_big/
        );
        expect(result.input.actual.summary).toBe(f.raw.summary);
    });

    it("does not repair unversioned original factual citations", async () => {
        const f = await fixture();
        const unversioned = `doc:${f.prepared.documents[0]!.source.id}`;
        f.raw.topics[0]!.facts[0]!.refs = [unversioned];
        const result = buildDiagnosticEvaluation(f.prepared, scenario, f.raw, f.envelope, identity);
        expect(result.input.actual.tasks[0]!.facts[0]!.sourceIds).toEqual([unversioned]);
        expect(checkOutputIntegrity(result.input)).toContainEqual(
            expect.objectContaining({ code: "unknown-citation", sourceId: unversioned })
        );
        expect(result.generationValidated).toBe(false);
    });

    it("retains unknown recommendation refs and missing factual refs for the actual integrity checker", async () => {
        const f = await fixture();
        f.raw.topics[0]!.recommendation.refs = ["doc:invented@not-registered"];
        f.raw.keyFigures[0]!.refs = [];
        const result = buildDiagnosticEvaluation(f.prepared, scenario, f.raw, f.envelope, identity);
        const issues = checkOutputIntegrity(result.input);
        expect(
            issues.some(
                issue =>
                    issue.code === "unknown-citation" &&
                    issue.sourceId === "doc:invented@not-registered"
            )
        ).toBe(true);
        expect(
            issues.some(
                issue => issue.code === "uncited-fact" && issue.outputId.includes("keyFigures")
            )
        ).toBe(true);
        expect(
            result.sidecar.diagnostic.units.find(unit => unit.fieldPath === "headline")!.sourceIds
        ).toEqual([]);
        expect(
            result.sidecar.diagnostic.units.find(unit => unit.fieldPath === "brief")!.sourceIds
        ).toEqual([]);
    });

    it("keeps unknown nested derivation references visible to deterministic citation checks", async () => {
        const f = await fixture();
        Object.assign(f.raw.keyFigures[0]!, {
            derivation: { op: "count", inputs: [{ value: 1, ref: "doc:unknown-derivation@v1" }] },
        });
        const result = buildDiagnosticEvaluation(f.prepared, scenario, f.raw, f.envelope, identity);
        expect(checkOutputIntegrity(result.input)).toContainEqual(
            expect.objectContaining({
                code: "unknown-citation",
                sourceId: "doc:unknown-derivation@v1",
            })
        );
        expect(outputUnits(result.input).map(unit => unit.text)).toContain(
            JSON.stringify(f.raw.keyFigures[0])
        );
    });

    it("keeps semantic judgment unavailable without a separately invoked Judge", async () => {
        const f = await fixture();
        const result = buildDiagnosticEvaluation(f.prepared, scenario, f.raw, f.envelope, identity);
        const assessed = await evaluateVantage(result.input);
        expect(assessed).toMatchObject({
            judge: { kind: "none" },
            verdict: "needs-review",
            overallScore: null,
            error: "no-judge",
        });
        expect(assessed.metrics.every(metric => metric.score === null)).toBe(true);
        expect(result.generationValidated).toBe(false);
    });

    it("does not silently drop units to fit the existing 30-unit limit", async () => {
        const f = await fixture();
        f.raw.topics = Array.from({ length: 6 }, (_, index) => ({
            ...structuredClone(f.raw.topics[0]!),
            title: `Topic ${index}`,
            whyNow: "why",
            facts: [],
            conflicts: [],
            whyItMatters: "why",
            decisionQuestion: "which",
            proposedNextStep: "step",
            unknowns: [],
            rationale: "why",
            recommendation: {
                call: "call",
                confidence: "low",
                because: "because",
                wouldChangeIf: "change",
                refs: [],
            },
        }));
        expect(() =>
            buildDiagnosticEvaluation(f.prepared, scenario, f.raw, f.envelope, identity)
        ).toThrow(/30 evaluation enhancement units|14000 bytes/);
    });

    it("honors the unchanged evaluator byte budget without truncating observed text", async () => {
        const f = await fixture();
        f.raw.headline = "x".repeat(6000);
        f.raw.brief = "y".repeat(6000);
        expect(() =>
            buildDiagnosticEvaluation(f.prepared, scenario, f.raw, f.envelope, identity)
        ).toThrow("14000 bytes");
        expect(f.raw.headline).toHaveLength(6000);
        expect(f.raw.brief).toHaveLength(6000);
    });
});
