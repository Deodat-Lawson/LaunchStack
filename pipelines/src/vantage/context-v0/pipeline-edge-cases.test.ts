import { describe, expect, it, vi } from "vitest";
import dataset from "../../../../fixtures/vantage-pipeline-edge-cases/cases.json";
import normal from "../../../../fixtures/vantage-context-v0/normal.json";
import examples from "../../../../docs/design/examples/weekly-decision-agenda-v1.json";
import { resolveRoleSelectionV0 } from "../role-context-v0/roles";
import { createFixtureV0Ports, type FixtureV0Input } from "./mocks";
import { createContextAwareGenerationAdapter, runContextV0Pipeline } from "./adapters";
import type {
    ContextGenerationEnvelopeV0,
    GenerationInput,
    GenerationResult,
    GenerationRuntime,
} from "./ports";

interface EdgeCase {
    id: string;
    roles: string[];
    primaryRoleId: string;
    patches: { path: string; value: unknown }[];
    generationFault?: string;
    expected: {
        roleIds: string[];
        fallback: boolean;
        outcome: string;
        retrievalStatus: string;
        stage?: string;
        status?: number;
        forbiddenExcerpt?: string;
    };
}

// Only replace existing fixture fields. Typos must fail, not silently create data.
function replaceField(target: object, path: string, value: unknown) {
    const parts = path.split(".");
    let parent: unknown = target;
    for (const part of parts.slice(0, -1)) {
        if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, part))
            throw new Error(`Unknown fixture path: ${path}`);
        parent = (parent as Record<string, unknown>)[part];
    }
    const field = parts.at(-1)!;
    if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, field))
        throw new Error(`Unknown fixture field: ${path}`);
    (parent as Record<string, unknown>)[field] = structuredClone(value);
}

const runtime: GenerationRuntime = {
    resolveModel: () => null,
    signal: new AbortController().signal,
    budgets: { attemptTimeoutMs: 20000, maxAttempts: 2, retryWaitMs: 1000, totalMs: 45000 },
};

describe("Joseph synthetic role → retrieval → generation boundary cases", () => {
    it("uses unique case IDs so individual failures can be reproduced", () => {
        expect(new Set(dataset.cases.map(c => c.id)).size).toBe(dataset.cases.length);
    });

    it.each(dataset.cases as EdgeCase[])("$id", async scenario => {
        const data = structuredClone(normal) as unknown as FixtureV0Input;
        const principalRef = data.requiredBundle.actor.principalRef;
        // Exercise Joseph's real role mapper rather than supplying pre-resolved roles.
        const role = resolveRoleSelectionV0({
            principalRef,
            values: scenario.roles,
            primaryRoleId: scenario.primaryRoleId,
            confirmed: false,
        });
        expect(role.roleIds).toEqual(scenario.expected.roleIds);
        expect(role.fallback).toBe(scenario.expected.fallback);
        expect(role.authenticatedPrincipalRef).toBe(principalRef);
        data.roleContext = role;
        data.manifest.roleMapVersion = role.mappingVersion;
        // Simulated retrieval responses carry the role IDs actually recognized above.
        for (const item of [
            ...data.retrievalBundle.roleMatches,
            ...data.retrievalBundle.recentChanges,
            ...data.retrievalBundle.unresolvedOlderItems,
        ])
            item.roleIds = [...role.roleIds];
        for (const patch of scenario.patches) replaceField(data, patch.path, patch.value);

        const ports = createFixtureV0Ports(data);
        const retrieve = vi.spyOn(ports.retrieval, "retrieve");
        const input = {
            principalRef,
            companyId: data.requiredBundle.actor.companyId,
            reportWindow: data.retrievalBundle.reportWindow,
            budgets: normal.retrievalInput.budgets,
            runId: `synthetic-${scenario.id}`,
            inputVersion: "synthetic-edge-cases-v1",
        };
        const invokeGenerator = vi.fn(async (envelope: ContextGenerationEnvelopeV0) => {
            if (scenario.expected.forbiddenExcerpt) {
                expect(JSON.stringify(envelope)).not.toContain(scenario.expected.forbiddenExcerpt);
                const source = envelope.evidenceSnapshot.entries.find(
                    e => e.source.id === "evidence-risk-1"
                );
                expect(source?.excerpt).toBe("Evidence of an unresolved weekly risk.");
            }
            // Canned agent output: tests validation, not model reasoning quality.
            const result = structuredClone(
                examples.internal.success
            ) as unknown as GenerationResult;
            result.runId = input.runId;
            result.inputVersion = input.inputVersion;
            result.signals.since = "2026-10-12";
            result.signals.computedAt = input.reportWindow.asOf;
            const registered = data.retrievalBundle.roleMatches[0]!.source;
            return {
                v1Result: result,
                citationRefs: [
                    {
                        ...registered,
                        ...(scenario.generationFault === "unknown"
                            ? { id: "invented-evidence" }
                            : {}),
                        ...(scenario.generationFault === "stale" ? { version: "ev-v1" } : {}),
                    },
                ],
            };
        });
        const run = async () => {
            const assembled = await runContextV0Pipeline(input, ports);
            expect(retrieve).toHaveBeenCalledTimes(1);
            expect(retrieve.mock.calls[0]![0].verifiedRoleContext).toEqual(role);
            expect(assembled.manifest.retrievalState.status).toBe(
                scenario.expected.retrievalStatus
            );
            // Optional research is explicitly STOP; timeout must never become complete.
            expect(assembled.manifest.status).toBe("partial");
            const entries = assembled.evidenceSnapshot.entries;
            expect(entries.some(e => e.source.id === "doc-starred-roadmap")).toBe(true);
            const keys = entries.map(e => `${e.source.kind}:${e.source.id}@${e.source.version}`);
            expect(new Set(keys).size).toBe(keys.length);
            const v1Input = structuredClone(examples.internal.input) as unknown as GenerationInput;
            v1Input.runId = input.runId;
            v1Input.inputVersion = input.inputVersion;
            v1Input.reportPeriod = { ...v1Input.reportPeriod, ...input.reportWindow };
            const generator = createContextAwareGenerationAdapter(invokeGenerator);
            const output = await generator({ v1Input, ...assembled }, runtime);
            expect(output.contextMode).toBe("aware-v0");
            expect(output.manifestFingerprint).toBe(assembled.manifest.contextFingerprint);
            expect(output.citationRefs).toEqual([data.retrievalBundle.roleMatches[0]!.source]);
        };

        if (scenario.expected.outcome === "blocked") {
            await expect(run()).rejects.toMatchObject({ status: scenario.expected.status });
            expect(invokeGenerator).toHaveBeenCalledTimes(
                scenario.expected.stage === "generation" ? 1 : 0
            );
            expect(retrieve).toHaveBeenCalledTimes(scenario.expected.stage === "required" ? 0 : 1);
        } else {
            await run();
            expect(invokeGenerator).toHaveBeenCalledTimes(1);
        }
    });
});
