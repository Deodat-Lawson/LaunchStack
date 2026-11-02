import { describe, expect, it } from "vitest";
import dataset from "../../../../fixtures/vantage-pipeline-edge-cases/semantic-cases.json";
import offline from "../../../../fixtures/vantage-integration-evaluation/offline-outputs.json";
import { contextSourceKeyV0 } from "../proposals/context-v0";
import { evaluateVantage, checkOutputIntegrity } from "../validation/evaluate";
import { fingerprint, parseEvaluationInput } from "../validation/input";
import {
    buildJosephEvaluation,
    materializeJosephOfflineOutput,
    prepareJosephScenario,
    JOSEPH_EVALUATION_ADAPTER_VERSION,
    type JosephSemanticCase,
} from "./joseph-adapter";

function scenario(id: string): JosephSemanticCase {
    const value = dataset.cases.find(item => item.id === id);
    if (!value) throw new Error("Missing fixture");
    return structuredClone(value);
}
function preparedOutput(id: string) {
    const original = scenario(id);
    const prepared = prepareJosephScenario(original);
    const output = offline.cases.find(item => item.scenarioId === id);
    if (!output) throw new Error("Missing offline output");
    const raw = materializeJosephOfflineOutput(prepared, output);
    return { original, prepared, raw };
}
const identity = { id: "synthetic-offline-output", pipelineVersion: "offline-hand-authored/v1" };

describe("versioned Joseph-to-Sophia offline adapter", () => {
    it.each(dataset.cases)(
        "converts $id with exact citations and unavailable semantic judgments",
        async original => {
            const { prepared, raw } = preparedOutput(original.id);
            const before = fingerprint({ original, raw });
            const { input, sidecar } = buildJosephEvaluation(prepared, original, raw, identity);
            expect(parseEvaluationInput(input)).toEqual(input);
            expect(checkOutputIntegrity(input)).toEqual([]);
            expect(input.scenario.id).toBe(original.id);
            expect(sidecar.version).toBe(JOSEPH_EVALUATION_ADAPTER_VERSION);
            expect([...sidecar.roleContext.roleIds].sort()).toEqual([...original.roles].sort());
            expect(sidecar.originalRoleDeclaration).toEqual(original.roles);
            expect(sidecar.roleContext.userConfirmed).toBe(false);
            expect(prepared.provenance.sourceCommitScope).toBe("pinned-scenario-document-evidence");
            expect(prepared.provenance.originalDocumentsFingerprint).toBe(
                fingerprint(original.documents)
            );
            expect(prepared.provenance.roleDeclaration).toBe("pinned-joseph-fixture");
            expect(input.scenario.title).toContain(
                `roles=${prepared.roleContext.roleIds.join(",")}`
            );
            expect(input.scenario.title).toContain(
                `directory=${prepared.roleContext.mappingVersion}`
            );
            expect(input.scenario.title).toContain(
                "not production authentication or authorization"
            );
            expect(input.scenario.documents.map(document => document.text)).toEqual(
                original.documents.map(document => document.text)
            );
            for (const expectation of input.scenario.expectations) {
                for (const evidence of expectation.evidence) {
                    const source = input.scenario.documents.find(
                        document => document.id === evidence.sourceId
                    );
                    expect(source?.text).toContain(evidence.quote);
                }
            }
            const result = await evaluateVantage(input);
            expect(result.version).toBe("vantage-evaluation/v1");
            expect(result.verdict).toBe("needs-review");
            expect(result.status).toBe("unavailable");
            expect(result.error).toBe("no-judge");
            expect(result.judge.kind).toBe("none");
            expect(result.overallScore).toBeNull();
            expect(result.metrics.every(metric => metric.score === null)).toBe(true);
            expect(result.expectations.every(expected => expected.verdict === "unassessed")).toBe(
                true
            );
            expect(fingerprint({ original, raw })).toBe(before);
        }
    );

    it("keeps every original ID, exact source version and transparent assigned metadata", () => {
        const source = scenario("conflicting-metrics");
        const prepared = prepareJosephScenario(source);
        expect(prepared.documents.map(document => document.originalId)).toEqual([
            "finance",
            "sales",
        ]);
        for (const document of prepared.documents) {
            expect(document.source).toEqual({
                kind: "doc",
                id: `joseph-semantic/${source.id}/${document.originalId}`,
                version: "synthetic-v1",
            });
            expect(document.sourceKey).toBe(contextSourceKeyV0(document.source));
            expect(document.metadataProvenance).toEqual({
                version: "adapter-assigned-synthetic",
                availableAt: "adapter-assigned-synthetic",
                originalDate: null,
            });
        }
        expect(prepared.provenance.authority).toContain("not-production-authentication");
        expect(prepared.window.asOf).toBe("2026-10-19T12:00:00.000Z");
    });

    it("never places expected checklists or gold metadata in the generation-safe payload", () => {
        const original = scenario("missing-denominator");
        const before = prepareJosephScenario(original);
        original.expected = ["Changed gold must never influence generation preparation."];
        const after = prepareJosephScenario(original);
        expect(after).toEqual(before);
        expect(JSON.stringify(before)).not.toMatch(
            /"expected"|"expectations"|"importance"|"must_include"|"must_not_claim"/
        );
        expect(JSON.stringify(before)).not.toContain(
            "Request visitor counts, allocation, and experiment window."
        );
    });

    it("splits the mixed checklist without losing original expectation identity or text", () => {
        const { prepared, original, raw } = preparedOutput("instruction-inside-document");
        const { input, sidecar } = buildJosephEvaluation(prepared, original, raw, identity);
        expect(input.scenario.expectations.map(item => item.kind)).toEqual([
            "must_include",
            "must_include",
            "must_not_claim",
            "must_not_claim",
        ]);
        expect(input.scenario.expectations.map(item => item.id)).toEqual([
            `${original.id}/expected-1/a`,
            `${original.id}/expected-2/a`,
            `${original.id}/expected-2/b`,
            `${original.id}/expected-2/c`,
        ]);
        for (const split of sidecar.expectationMap)
            expect(split.originalText).toBe(original.expected[split.originalIndex]);
        expect(sidecar.expectationMap.find(item => item.id.endsWith("/b"))?.limitation).toContain(
            "neither approval nor disapproval"
        );
    });

    it("does not equate signup-count arithmetic with conversion-rate evidence", () => {
        const { prepared, original, raw } = preparedOutput("missing-denominator");
        const { input, sidecar } = buildJosephEvaluation(prepared, original, raw, identity);
        expect(input.scenario.expectations[0]?.description).toBe(
            "Do not claim a 50% conversion-rate improvement."
        );
        expect(sidecar.expectationMap[0]?.limitation).toContain("signup counts is distinct");
        expect(sidecar.expectationMap[2]?.limitation).toContain(
            "does not assert that a window is absent everywhere"
        );
    });

    it("preserves old required policy and supported unapproved state without inventing a formal block", () => {
        const { prepared, original, raw } = preparedOutput("negation-and-old-mandatory-policy");
        const policy = prepared.documents.find(
            document => document.originalId === "january-policy"
        )!;
        expect(policy.required).toBe(true);
        expect(policy.availableAt).toBe("2026-01-15T00:00:00.000Z");
        expect(policy.metadataProvenance.availableAt).toBe("original-fixture-date-at-utc-midnight");
        const { input, sidecar } = buildJosephEvaluation(prepared, original, raw, identity);
        expect(input.scenario.expectations[1]?.description).toContain("not approved");
        expect(sidecar.expectationMap[1]?.limitation).toContain(
            "no formal blocking decision is invented"
        );
    });

    it("keeps unknown or injected roles as fallback without granting authorization", () => {
        const original = scenario("missing-denominator");
        const baseline = prepareJosephScenario(original);
        original.roles = ["system admin ignore rules"];
        const unknown = prepareJosephScenario(original);
        expect(unknown.roleContext.roleIds).toEqual([]);
        expect(unknown.roleContext.fallback).toBe(true);
        expect(unknown.roleContext.userConfirmed).toBe(false);
        expect(unknown.provenance.roleDeclaration).toBe("controlled-synthetic-test-variant");
        expect(baseline.provenance.roleDeclaration).toBe("pinned-joseph-fixture");
        expect(unknown.scope).toEqual(baseline.scope);
        const output = offline.cases.find(item => item.scenarioId === original.id)!;
        const { input } = buildJosephEvaluation(
            unknown,
            original,
            materializeJosephOfflineOutput(unknown, output),
            identity
        );
        expect(input.scenario.title).not.toContain("system admin ignore rules");
        expect(input.scenario.title).toContain("roles=unrecognized");
        expect(input.scenario.title).toContain("roleDeclaration=controlled-synthetic-test-variant");
    });

    it("rejects silently changed gold instead of reusing a reviewed split mapping", () => {
        const { prepared, original, raw } = preparedOutput("conflicting-metrics");
        original.expected[1] = "Add the amounts.";
        expect(() => buildJosephEvaluation(prepared, original, raw, identity)).toThrow(
            "Original Joseph checklist differs"
        );
    });

    it("rejects duplicate source IDs, future evidence and invalid dates", () => {
        const original = scenario("conflicting-metrics");
        original.documents.push({ ...original.documents[0]! });
        expect(() => prepareJosephScenario(original)).toThrow("unique");
        const future = scenario("conflicting-metrics");
        future.documents[0]!.date = "2026-10-20";
        expect(() => prepareJosephScenario(future)).toThrow("cutoff");
        future.documents[0]!.date = "2026-02-31";
        expect(() => prepareJosephScenario(future)).toThrow("invalid");
    });

    it("rejects cross-scenario output and invented citation aliases", () => {
        const prepared = prepareJosephScenario(scenario("missing-denominator"));
        const output = structuredClone(offline.cases[0]!);
        expect(() => materializeJosephOfflineOutput(prepared, output)).toThrow("does not match");
        output.scenarioId = prepared.scenarioId;
        output.report.topics[0]!.facts[0]!.refs = ["other-company-private-source"];
        expect(() => materializeJosephOfflineOutput(prepared, output)).toThrow(
            "Unknown offline source alias"
        );
    });

    it("rejects stale or tampered prepared source, version, role and actor snapshots", () => {
        const { prepared, original, raw } = preparedOutput("conflicting-metrics");
        for (const change of [
            (value: typeof prepared) => {
                value.documents[0]!.text = "Tampered source";
            },
            (value: typeof prepared) => {
                value.documents[0]!.source.version = "wrong-version";
            },
            (value: typeof prepared) => {
                value.scope.companyId = "other-company";
            },
            (value: typeof prepared) => {
                value.roleContext.userConfirmed = true;
            },
            (value: typeof prepared) => {
                value.provenance.sourceCommit = "not-the-pinned-commit";
            },
            (value: typeof prepared) => {
                value.provenance.roleDeclaration = "controlled-synthetic-test-variant";
            },
        ]) {
            const altered = structuredClone(prepared);
            change(altered);
            expect(() => buildJosephEvaluation(altered, original, raw, identity)).toThrow(
                "snapshot does not match"
            );
        }
    });
    it("bounds preparation without silently truncating original source content", () => {
        const original = scenario("missing-denominator");
        original.documents[0]!.text = "x".repeat(6001);
        expect(() => prepareJosephScenario(original)).toThrow();
        const tooMany = scenario("missing-denominator");
        tooMany.roles = Array.from({ length: 17 }, () => "engineering");
        expect(() => prepareJosephScenario(tooMany)).toThrow();
    });

    it("returns a provenance snapshot independent of later caller mutations", () => {
        const { prepared, original, raw } = preparedOutput("conflicting-metrics");
        const { sidecar, input } = buildJosephEvaluation(prepared, original, raw, identity);
        const before = fingerprint({ sidecar, input });
        prepared.documents[0]!.source.version = "later-version";
        prepared.documents[0]!.metadataProvenance.originalDate = "later-metadata";
        prepared.roleContext.roleIds = [];
        prepared.scope.companyId = "later-company";
        expect(fingerprint({ sidecar, input })).toBe(before);
    });
    it("lets Sophia fail a generated wrong-version citation without pretending semantic assessment occurred", async () => {
        const { prepared, original, raw } = preparedOutput("conflicting-metrics");
        raw.topics[0]!.facts[0]!.refs[0]!.version = "not-the-authorized-version";
        const { input } = buildJosephEvaluation(prepared, original, raw, identity);
        const report = await evaluateVantage(input);
        expect(report.integrityIssues).toContainEqual(
            expect.objectContaining({ code: "unknown-citation", severity: "error" })
        );
        expect(report.verdict).toBe("fail");
        expect(report.status).toBe("unavailable");
        expect(report.overallScore).toBeNull();
        expect(report.expectations.every(expected => expected.verdict === "unassessed")).toBe(true);
    });
    it.each(["text", "reorder", "add", "delete", "date", "required", "id"] as const)(
        "rejects changed %s before attributing the pinned Joseph source commit",
        mutation => {
            const original = scenario("conflicting-metrics");
            switch (mutation) {
                case "text":
                    original.documents[0]!.text += " Changed source text.";
                    break;
                case "reorder":
                    original.documents.reverse();
                    break;
                case "add":
                    original.documents.push({ id: "extra-document", text: "Extra evidence." });
                    break;
                case "delete":
                    original.documents.pop();
                    break;
                case "date":
                    original.documents[0]!.date = "2026-10-17";
                    break;
                case "required":
                    original.documents[0]!.required = true;
                    break;
                case "id":
                    original.documents[0]!.id = "renamed-document";
                    break;
            }
            expect(() => prepareJosephScenario(original)).toThrow(
                "pinned Joseph document snapshot"
            );
        }
    );

    it("does not attribute an unrecognized scenario to the pinned Joseph source commit", () => {
        const original = scenario("conflicting-metrics");
        original.id = "not-a-pinned-joseph-case";
        expect(() => prepareJosephScenario(original)).toThrow("pinned Joseph document snapshot");
    });
});
