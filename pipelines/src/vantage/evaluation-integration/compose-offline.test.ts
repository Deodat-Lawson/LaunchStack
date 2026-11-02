import { describe, it, expect } from "vitest";
import semantic from "../../../../fixtures/vantage-pipeline-edge-cases/semantic-cases.json";
import outputs from "../../../../fixtures/vantage-integration-evaluation/offline-outputs.json";
import { runJosephOfflineScenario } from "./compose-offline";
import type { JosephSemanticCase, JosephOfflineOutput } from "./joseph-adapter";

const cases = semantic.cases as JosephSemanticCase[];
const response = (id: string) =>
    outputs.cases.find(item => item.scenarioId === id)! as JosephOfflineOutput;
describe("Joseph documents through Sophia retrieval and TL generation boundary into Sophia evaluation", () => {
    it.each(cases)(
        "$id retains exact sources and produces a versioned unassessed report",
        async scenario => {
            const result = await runJosephOfflineScenario(scenario, response(scenario.id));
            expect(result, JSON.stringify(result)).toMatchObject({
                outcome: "evaluated",
                generatorCalls: 1,
                mockPersistCalls: 1,
            });
            if (result.outcome !== "evaluated") throw new Error(result.message);
            expect(result.evaluation).toMatchObject({
                version: "vantage-evaluation/v1",
                verdict: "needs-review",
                status: "unavailable",
                error: "no-judge",
                overallScore: null,
                judge: { kind: "none" },
            });
            expect(result.evaluation.integrityIssues).toEqual([]);
            expect(result.evaluation.contextCompleteness).toBe("excerpted");
            expect(result.evaluationInput.scenario.documents).toHaveLength(
                result.evidenceSnapshot.entries.length
            );
            expect(
                result.sidecar.contextProjection.supplementalSyntheticControlSourceIds
            ).toHaveLength(3);
            expect(result.evaluation.metrics.every(metric => metric.score === null)).toBe(true);
            expect(
                result.evaluation.expectations.every(item => item.verdict === "unassessed")
            ).toBe(true);
            expect(result.events.indexOf("gold-attached-after-generation")).toBeGreaterThan(
                result.events.indexOf("synthetic-contextual-output-citation-validated")
            );
            expect(result.prepared).not.toHaveProperty("expectations");
            expect(result.nativeCarrier).toMatchObject({ contextMode: "aware-v0", mode: "rules" });
            expect(result.provenance).toMatchObject({ judgment: "none", providerCalls: 0 });
            for (const document of result.prepared.documents) {
                const source = result.evidenceSnapshot.entries.find(
                    entry => entry.source.id === document.source.id
                );
                expect(source).toMatchObject({ source: document.source, excerpt: document.text });
            }
            expect(result.manifest.roleMapVersion).toBe(result.prepared.roleContext.mappingVersion);
            expect(
                result.evidenceSnapshot.entries.filter(
                    entry => entry.source.id === "doc-starred-roadmap"
                )
            ).toHaveLength(1);
        }
    );
    it.each(["missing-required", "revoked-required"] as const)(
        "%s blocks before generation without manufacturing an evaluation",
        async fault => {
            const scenario = cases[0]!;
            const result = await runJosephOfflineScenario(scenario, response(scenario.id), {
                fault,
            });
            expect(result).toMatchObject({
                outcome: "blocked",
                stage: "authorized-context",
                generatorCalls: 0,
                mockPersistCalls: 0,
            });
            expect(result).not.toHaveProperty("evaluation");
        }
    );
    it("rejects an exact source version changed in the synthetic generation output", async () => {
        const scenario = cases[0]!;
        const result = await runJosephOfflineScenario(scenario, response(scenario.id), {
            fault: "unregistered-citation",
        });
        expect(result).toMatchObject({
            outcome: "blocked",
            stage: "generation-test-boundary",
            status: 403,
            generatorCalls: 1,
            mockPersistCalls: 0,
        });
        expect(result).not.toHaveProperty("evaluation");
    });
    it("rechecks actor permissions before even a mock commit", async () => {
        const scenario = cases[0]!;
        const result = await runJosephOfflineScenario(scenario, response(scenario.id), {
            fault: "acl-changed-during-generation",
        });
        expect(result).toMatchObject({
            outcome: "blocked",
            stage: "guarded-commit-test-boundary",
            status: 403,
            generatorCalls: 1,
            mockPersistCalls: 0,
        });
        expect(result).not.toHaveProperty("evaluation");
    });
});
