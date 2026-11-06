import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import semantic from "../../../../fixtures/vantage-pipeline-edge-cases/semantic-cases.json";
import outputs from "../../../../fixtures/vantage-integration-evaluation/offline-outputs.json";
import type { ContextGenerationEnvelopeV0 } from "../context-v0/ports";
import type { AssembledContextManifestV0 } from "../context-v0/contracts";
import { assertEnvelopeBinding } from "../context-v0/adapters";
import { evidenceSnapshotFingerprintV0 } from "../context-v0/evidence-snapshot";
import { contextSourceKeyV0 } from "../proposals/context-v0";
import {
    materializeJosephOfflineOutput,
    type JosephOfflineOutput,
    type JosephSemanticCase,
} from "../evaluation-integration/joseph-adapter";
import { evaluateVantage } from "../validation/evaluate";
import {
    assessEvaluationCompleteness,
    type TrustedClosedSourceInventory,
} from "./evaluation-completeness";
import { attachLivePilotEvaluation, prepareLivePilotContext } from "./pilot-context";

const cases = semantic.cases as JosephSemanticCase[];
const identity = {
    id: "offline-completeness-test",
    pipelineVersion: "offline-completeness-test/v1",
};
const example = (id: string) =>
    outputs.cases.find(x => x.scenarioId === id)! as JosephOfflineOutput;

type TestEnvelope = ContextGenerationEnvelopeV0 & { manifest: AssembledContextManifestV0 };
const mutableEnvelope = (envelope: ContextGenerationEnvelopeV0) =>
    structuredClone(envelope) as TestEnvelope;

/** Deliberately contradictory test-host state, consistently rebound at the existing byte boundary. */
function removeSource(envelope: TestEnvelope, ref: string) {
    envelope.manifest.sourceRegistry = envelope.manifest.sourceRegistry.filter(
        s => contextSourceKeyV0(s.source) !== ref
    );
    delete envelope.manifest.sourceVersions[ref];
    envelope.manifest.selectedRefs = envelope.manifest.selectedRefs.filter(
        s => contextSourceKeyV0(s) !== ref
    );
    envelope.manifest.retrievalState.selectedRefs =
        envelope.manifest.retrievalState.selectedRefs.filter(s => contextSourceKeyV0(s) !== ref);
    envelope.manifest.coverage.checked = envelope.manifest.coverage.checked.filter(
        s => contextSourceKeyV0(s) !== ref
    );
    envelope.manifest.coverage.used = envelope.manifest.coverage.used.filter(
        s => contextSourceKeyV0(s) !== ref
    );
    Object.assign(envelope.freeze, {
        sources: envelope.freeze.sources.filter(s => contextSourceKeyV0(s.ref) !== ref),
    });
    const entries = envelope.evidenceSnapshot.entries.filter(
        s => contextSourceKeyV0(s.source) !== ref
    );
    envelope.evidenceSnapshot = {
        ...envelope.evidenceSnapshot,
        entries,
        totalExcerptChars: entries.reduce((sum, entry) => sum + entry.excerpt.length, 0),
        contentFingerprint: evidenceSnapshotFingerprintV0(entries),
    };
}

/** A rejection is safe; invalid state must never be promoted to complete. */
function expectIncompleteOrRejected(
    envelope: ContextGenerationEnvelopeV0,
    inventory: TrustedClosedSourceInventory
) {
    let result: ReturnType<typeof assessEvaluationCompleteness>;
    try {
        result = assessEvaluationCompleteness(envelope, inventory);
    } catch {
        return;
    }
    expect(result.status).toBe("excerpted");
    expect(result.reasons.length).toBeGreaterThan(0);
}

describe("trusted finite-scenario evaluation completeness without a provider", () => {
    const fetch = vi.fn(async () => {
        throw new Error("No provider request is permitted in offline completeness tests");
    });
    beforeEach(() => {
        fetch.mockClear();
        vi.stubGlobal("fetch", fetch);
    });
    afterEach(() => {
        expect(fetch).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it.each(cases)("$id is complete only with its exact full finite inventory", async scenario => {
        const context = await prepareLivePilotContext(scenario);
        const before = JSON.stringify(context.envelope);
        const result = assessEvaluationCompleteness(
            context.envelope,
            context.trustedEvaluationInventory
        );
        expect(context.envelope.manifest.status).toBe("partial");
        expect(context.envelope.manifest.research).toMatchObject({
            mode: "STOP",
            status: "stopped",
        });
        expect(result.status).toBe("complete");
        expect(result.reasons).toEqual([]);
        expect(result.inventoryFingerprint).toMatch(/^[a-f0-9]{64}$/);
        expect(JSON.stringify(context.envelope)).toBe(before);
        expect(context.envelope).not.toHaveProperty("trustedEvaluationInventory");
        expect(JSON.stringify(context.trustedEvaluationInventory)).not.toMatch(
            /must_include|must_not_claim|expectations/
        );
        for (const entry of context.envelope.evidenceSnapshot.entries) {
            expect(
                context.trustedEvaluationInventory.sourceContentHashes[
                    contextSourceKeyV0(entry.source)
                ]
            ).toBe(createHash("sha256").update(entry.excerpt, "utf8").digest("hex"));
        }
    });

    it("defaults to excerpted and keeps existing evaluator callers unchanged", async () => {
        const scenario = cases[0]!;
        const context = await prepareLivePilotContext(scenario);
        expect(assessEvaluationCompleteness(context.envelope)).toMatchObject({
            status: "excerpted",
            inventoryFingerprint: null,
        });
        const report = materializeJosephOfflineOutput(context.prepared, example(scenario.id));
        const legacy = attachLivePilotEvaluation(
            context.prepared,
            scenario,
            report,
            context.envelope,
            identity
        );
        expect(legacy.input.scenario.contextCompleteness).toBe("excerpted");
        const explicit = attachLivePilotEvaluation(
            context.prepared,
            scenario,
            report,
            context.envelope,
            identity,
            context.trustedEvaluationInventory
        );
        expect(explicit.input.scenario.contextCompleteness).toBe("complete");
        expect(legacy.input.actual).toEqual(explicit.input.actual);
        expect(legacy.input.scenario.expectations).toEqual(explicit.input.scenario.expectations);
        expect(legacy.input.scenario.documents).toEqual(explicit.input.scenario.documents);
    });

    it("a complete finite corpus does not manufacture an unavailable semantic assessment", async () => {
        const scenario = cases[1]!;
        const context = await prepareLivePilotContext(scenario);
        const report = materializeJosephOfflineOutput(context.prepared, example(scenario.id));
        const evaluation = attachLivePilotEvaluation(
            context.prepared,
            scenario,
            report,
            context.envelope,
            identity,
            context.trustedEvaluationInventory
        );
        const result = await evaluateVantage(evaluation.input);
        expect(result).toMatchObject({
            contextCompleteness: "complete",
            status: "unavailable",
            error: "no-judge",
            overallScore: null,
            verdict: "needs-review",
        });
        expect(result.metrics.every(metric => metric.score === null)).toBe(true);
        expect(result.expectations.every(expectation => expectation.verdict === "unassessed")).toBe(
            true
        );
    });

    it.each(["scenarioId", "generationInputFingerprint"] as const)(
        "rejects a trusted proof with a different %s before evaluator attachment",
        async field => {
            const scenario = cases[0]!;
            const context = await prepareLivePilotContext(scenario);
            const report = materializeJosephOfflineOutput(context.prepared, example(scenario.id));
            const changed = structuredClone(context.trustedEvaluationInventory);
            changed[field] = "another-prepared-scenario";
            expect(() =>
                attachLivePilotEvaluation(
                    context.prepared,
                    scenario,
                    report,
                    context.envelope,
                    identity,
                    changed
                )
            ).toThrow(/different prepared scenario/);
        }
    );

    it.each(["manifestFingerprint", "asOf"] as const)(
        "does not promote a proof with changed %s",
        async field => {
            const context = await prepareLivePilotContext(cases[0]!);
            const changed = structuredClone(context.trustedEvaluationInventory);
            changed[field] = field === "asOf" ? "2026-10-20T00:00:00Z" : "different-manifest";
            expect(assessEvaluationCompleteness(context.envelope, changed).status).toBe(
                "excerpted"
            );
        }
    );

    it.each(["missing", "extra", "version", "hash"] as const)(
        "requires the exact source universe and full content: %s mismatch",
        async mismatch => {
            const context = await prepareLivePilotContext(cases[0]!);
            const changed = structuredClone(context.trustedEvaluationInventory);
            const key = Object.keys(changed.sourceContentHashes)[0]!;
            const hashes = { ...changed.sourceContentHashes };
            if (mismatch === "missing") delete hashes[key];
            if (mismatch === "extra") hashes["doc:absent-document@v1"] = "f".repeat(64);
            if (mismatch === "version") {
                hashes[key + "-other-version"] = hashes[key]!;
                delete hashes[key];
            }
            if (mismatch === "hash")
                hashes[key] = createHash("sha256")
                    .update("a longer complete source body omitted from the supplied excerpt")
                    .digest("hex");
            changed.sourceContentHashes = hashes;
            expect(assessEvaluationCompleteness(context.envelope, changed).status).toBe(
                "excerpted"
            );
        }
    );

    it.each(["partial", "timeout"] as const)(
        "research STOP cannot excuse %s retrieval",
        async status => {
            const context = await prepareLivePilotContext(cases[0]!);
            const envelope = mutableEnvelope(context.envelope);
            envelope.manifest.retrievalState.status = status;
            assertEnvelopeBinding(envelope);
            expect(
                assessEvaluationCompleteness(envelope, context.trustedEvaluationInventory).status
            ).toBe("excerpted");
        }
    );

    it("research STOP cannot excuse an otherwise complete lane with retained failure diagnostics", async () => {
        const context = await prepareLivePilotContext(cases[0]!);
        const envelope = mutableEnvelope(context.envelope);
        envelope.manifest.retrievalState.failures = [
            { code: "source_unavailable", message: "Synthetic source reader failed" },
        ];
        assertEnvelopeBinding(envelope);
        expect(
            assessEvaluationCompleteness(envelope, context.trustedEvaluationInventory).status
        ).toBe("excerpted");
    });

    it("research STOP cannot excuse a required research failure", async () => {
        const context = await prepareLivePilotContext(cases[0]!);
        const envelope = mutableEnvelope(context.envelope);
        envelope.manifest.research.failures.push({
            code: "permission_denied",
            message: "Synthetic research source unavailable",
        });
        assertEnvelopeBinding(envelope);
        expect(
            assessEvaluationCompleteness(envelope, context.trustedEvaluationInventory).status
        ).toBe("excerpted");
        expect(
            assessEvaluationCompleteness(context.envelope, {
                ...context.trustedEvaluationInventory,
                researchRequirement: "must-complete",
            }).status
        ).toBe("excerpted");
    });

    it.each(["manifest", "retrieval", "coverage"] as const)(
        "cannot relabel a %s budget omission as a complete corpus",
        async lane => {
            const context = await prepareLivePilotContext(cases[0]!);
            const envelope = mutableEnvelope(context.envelope);
            const source = envelope.evidenceSnapshot.entries[0]!.source;
            if (lane === "manifest") envelope.manifest.omissions.push({ reason: "budget", source });
            if (lane === "retrieval")
                Object.assign(envelope.manifest.retrievalState, {
                    omissions: [
                        ...envelope.manifest.retrievalState.omissions,
                        { reason: "budget", source },
                    ],
                });
            if (lane === "coverage") envelope.manifest.coverage.omitted.push(source);
            assertEnvelopeBinding(envelope);
            expect(
                assessEvaluationCompleteness(envelope, context.trustedEvaluationInventory).status
            ).toBe("excerpted");
        }
    );

    it.each(["missing", "revoked", "researchOmitted"] as const)(
        "retains %s coverage uncertainty",
        async field => {
            const context = await prepareLivePilotContext(cases[0]!);
            const envelope = mutableEnvelope(context.envelope);
            envelope.manifest.coverage[field].push(envelope.evidenceSnapshot.entries[0]!.source);
            assertEnvelopeBinding(envelope);
            expect(
                assessEvaluationCompleteness(envelope, context.trustedEvaluationInventory).status
            ).toBe("excerpted");
        }
    );

    it.each(["version", "hash", "acl", "bytes", "cutoff"] as const)(
        "fails closed when frozen context changes: %s",
        async field => {
            const context = await prepareLivePilotContext(cases[0]!);
            const envelope = mutableEnvelope(context.envelope);
            const source = envelope.manifest.sourceRegistry[0]!;
            if (field === "version") source.source.version = "changed-after-freeze";
            if (field === "hash")
                Object.assign(envelope.freeze.sources[0]!, { contentHash: "changed-after-freeze" });
            if (field === "acl") source.aclDigest = "revoked-after-freeze";
            if (field === "bytes") source.excerpt += " changed after freeze";
            if (field === "cutoff")
                envelope.evidenceSnapshot = {
                    ...envelope.evidenceSnapshot,
                    asOf: "2026-10-20T00:00:00Z",
                };
            expectIncompleteOrRejected(envelope, context.trustedEvaluationInventory);
        }
    );

    it.each(["company", "star"] as const)(
        "does not trust a narrowed inventory that dropped required %s context",
        async required => {
            const context = await prepareLivePilotContext(cases[0]!);
            const envelope = mutableEnvelope(context.envelope);
            const proof = structuredClone(context.trustedEvaluationInventory);
            const source =
                required === "company"
                    ? envelope.freeze.companyArchitecture.ref
                    : envelope.freeze.personalStars[0]!.ref;
            const key = contextSourceKeyV0(source);
            removeSource(envelope, key);
            const hashes = { ...proof.sourceContentHashes };
            delete hashes[key];
            proof.sourceContentHashes = hashes;
            expectIncompleteOrRejected(envelope, proof);
        }
    );

    it.each(["company", "actor", "future"] as const)(
        "does not declare an unauthorized or unavailable source complete: %s",
        async change => {
            const context = await prepareLivePilotContext(cases[0]!);
            const envelope = mutableEnvelope(context.envelope);
            const source = envelope.manifest.sourceRegistry.find(s => s.audience.kind === "actor")!;
            const key = contextSourceKeyV0(source.source);
            const frozen = envelope.freeze.sources.find(s => contextSourceKeyV0(s.ref) === key)!;
            if (change === "company") source.companyId = "another-company";
            if (change === "actor") {
                source.audience = { kind: "actor", principalRef: "another-user" };
                Object.assign(frozen, { audience: source.audience });
            }
            if (change === "future") source.sourceDate = "2026-10-20T00:00:00Z";
            assertEnvelopeBinding(envelope);
            expect(
                assessEvaluationCompleteness(envelope, context.trustedEvaluationInventory).status
            ).toBe("excerpted");
        }
    );

    it("does not declare a consistently emptied source inventory complete", async () => {
        const context = await prepareLivePilotContext(cases[0]!);
        const envelope = mutableEnvelope(context.envelope);
        for (const source of [...envelope.evidenceSnapshot.entries])
            removeSource(envelope, contextSourceKeyV0(source.source));
        const proof = { ...context.trustedEvaluationInventory, sourceContentHashes: {} };
        expectIncompleteOrRejected(envelope, proof);
    });

    it("an older mandatory policy can be fully represented without implying current validity", async () => {
        const context = await prepareLivePilotContext(
            cases.find(c => c.id === "negation-and-old-mandatory-policy")!
        );
        const before = JSON.stringify(context.envelope);
        expect(
            context.envelope.manifest.sourceRegistry.find(s =>
                s.source.id.endsWith("/january-policy")
            )!.sourceDate
        ).toBe("2026-01-15T00:00:00.000Z");
        expect(
            assessEvaluationCompleteness(context.envelope, context.trustedEvaluationInventory)
                .status
        ).toBe("complete");
        expect(JSON.stringify(context.envelope)).toBe(before);
        expect(JSON.stringify(context.envelope)).not.toContain('"policyValidity"');
    });
});
