import { describe, expect, it, vi } from "vitest";
import semantic from "../../../../fixtures/vantage-pipeline-edge-cases/semantic-cases.json";
import outputs from "../../../../fixtures/vantage-integration-evaluation/offline-outputs.json";
import { contextSourceKeyV0 } from "../proposals/context-v0";
import { createGenerationPort } from "../generation-v1";
import type { GenerationRuntime } from "../contract-v1";
import type { ResolvedChatModel } from "@launchstack/llm";
import {
    materializeJosephOfflineOutput,
    type JosephSemanticCase,
    type JosephOfflineOutput,
} from "../evaluation-integration/joseph-adapter";
import { checkOutputIntegrity } from "../validation/evaluate";
import { prepareLivePilotContext, attachLivePilotEvaluation } from "./pilot-context";

const cases = semantic.cases as JosephSemanticCase[];
const identity = { id: "pilot-context-unit", pipelineVersion: "pilot-context-unit/v1" };
const example = (id: string) =>
    outputs.cases.find(item => item.scenarioId === id)! as JosephOfflineOutput;

describe("live pilot synthetic context without any provider call", () => {
    it.each(cases)(
        "$id retains exact documents and enables real generation eligibility without Gold",
        async scenario => {
            const before = JSON.stringify(scenario);
            const context = await prepareLivePilotContext(scenario);
            expect(context.nativeEligibility).toEqual({
                eligibleEvidenceCount: 1,
                selectedRefs: [`ev:pilot-intake-${scenario.id}`],
            });
            expect(context.envelope.v1Input.generationMode).toBe("configured-model");
            expect(context.prepared).not.toHaveProperty("expectations");
            expect(JSON.stringify(context.envelope)).not.toMatch(
                /"(?:expectations|must_include|must_not_claim)"/
            );
            expect(context.envelope.manifest.status).toBe("partial");
            expect(context.prepared.roleContext.userConfirmed).toBe(false);
            for (const document of context.prepared.documents) {
                const source = context.envelope.evidenceSnapshot.entries.find(
                    entry => contextSourceKeyV0(entry.source) === document.sourceKey
                );
                expect(source).toMatchObject({ source: document.source, excerpt: document.text });
            }
            const ev = context.envelope.evidenceSnapshot.entries.filter(
                entry => entry.source.kind === "ev"
            );
            expect(ev).toHaveLength(1);
            expect(ev[0]!.source.id).toBe(context.intakeEvidence.id);
            expect(ev[0]!.source.id).not.toBe(context.prepared.documents[0]!.source.id);
            expect(ev[0]!.excerpt).toBe(context.intakeEvidence.body);
            expect(context.intakeEvidence.body).toContain(context.prepared.documents[0]!.text);
            expect(context.intakeEvidence.body).toContain("not independent corroboration");
            expect(context.envelope.evidenceSnapshot.entries).toHaveLength(
                context.prepared.documents.length + 4
            );
            expect(JSON.stringify(scenario)).toBe(before);
        }
    );

    it("actually enters the real generation invocation boundary with an in-memory failing transport", async () => {
        const { envelope } = await prepareLivePilotContext(cases[0]!);
        const invoke = vi.fn(async () => {
            throw new Error("Synthetic test failure; no network transport installed");
        });
        const runtime = {
            resolveModel: () => ({ modelId: "synthetic-unit-model" }) as ResolvedChatModel,
            signal: new AbortController().signal,
            budgets: { attemptTimeoutMs: 20000, maxAttempts: 1, retryWaitMs: 1000, totalMs: 45000 },
        } as unknown as GenerationRuntime;
        const generated = await createGenerationPort(invoke)(envelope.v1Input, runtime);
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(generated.execution).toMatchObject({ mode: "rules", attempts: 1 });
        expect(generated.execution.fallbackReason).not.toBeNull();
    });

    it.each(cases)(
        "$id attaches Gold only after supplied generation and exposes every authorized snapshot excerpt",
        async scenario => {
            const context = await prepareLivePilotContext(scenario);
            // This is a clearly synthetic test double for the evaluator adapter, not a live result.
            const report = materializeJosephOfflineOutput(context.prepared, example(scenario.id));
            const before = JSON.stringify(context.envelope);
            const evaluation = attachLivePilotEvaluation(
                context.prepared,
                scenario,
                report,
                context.envelope,
                identity
            );
            expect(evaluation.input.version).toBe("vantage-evaluation/v1");
            expect(evaluation.input.scenario.contextCompleteness).toBe("excerpted");
            expect(evaluation.input.scenario.expectations.length).toBeGreaterThan(0);
            expect(evaluation.input.scenario.documents).toHaveLength(
                context.envelope.evidenceSnapshot.entries.length
            );
            expect(
                evaluation.sidecar.liveContext.supplementalSyntheticControlSourceIds
            ).toHaveLength(4);
            expect(checkOutputIntegrity(evaluation.input)).toEqual([]);
            for (const entry of context.envelope.evidenceSnapshot.entries) {
                const doc = evaluation.input.scenario.documents.find(
                    item => item.id === contextSourceKeyV0(entry.source)
                );
                expect(doc).toMatchObject({ version: entry.source.version, text: entry.excerpt });
            }
            expect(JSON.stringify(context.envelope)).toBe(before);
        }
    );

    it("retains the January mandatory policy as old evidence rather than pretending it is a new source", async () => {
        const context = await prepareLivePilotContext(cases[4]!);
        const policy = context.envelope.manifest.sourceRegistry.find(entry =>
            entry.source.id.endsWith("/january-policy")
        )!;
        expect(policy.sourceDate).toBe("2026-01-15T00:00:00.000Z");
        expect(context.scopeProvenance.intake.assignedCreatedAt).toBe("2026-10-18T12:00:00.000Z");
        expect(
            context.envelope.evidenceSnapshot.entries.some(
                entry => entry.source.id === policy.source.id
            )
        ).toBe(true);
    });

    it("rejects tampered source bytes and a mismatched actor before attaching an evaluation", async () => {
        const context = await prepareLivePilotContext(cases[0]!);
        const report = materializeJosephOfflineOutput(context.prepared, example(cases[0]!.id));
        const changedBytes = structuredClone(context.envelope);
        const first = changedBytes.evidenceSnapshot.entries[0]!;
        first.excerpt += " fabricated";
        expect(() =>
            attachLivePilotEvaluation(context.prepared, cases[0]!, report, changedBytes, identity)
        ).toThrow();
        const changedActor = structuredClone(context.envelope);
        changedActor.manifest.actor.companyId = "cross-company";
        expect(() =>
            attachLivePilotEvaluation(context.prepared, cases[0]!, report, changedActor, identity)
        ).toThrow();
    });
});
