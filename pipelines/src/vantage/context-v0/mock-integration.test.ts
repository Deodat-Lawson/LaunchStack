import { describe, expect, it } from "vitest";
import examples from "../../../../docs/design/examples/weekly-decision-agenda-v1.json";
import normalFixture from "../../../../fixtures/vantage-context-v0/normal.json";
import type { GenerationResult } from "../contract-v1";
import type { GenerationRuntime } from "./ports";
import { createContextAwareGenerationAdapter, runContextV0Pipeline } from "./adapters";
import {
    createFixtureV0Ports as createFixturePorts,
    createMockContextAwareGenerator,
} from "./mocks";
import type { FixtureV0Input, FixtureV0Overrides } from "./mocks";

const fixtureInput = normalFixture as unknown as FixtureV0Input;
const createFixtureV0Ports = (overrides: FixtureV0Overrides = {}) =>
    createFixturePorts(fixtureInput, overrides);
const compatibleV1Input = {
    ...structuredClone(examples.internal.input),
    reportPeriod: {
        ...examples.internal.input.reportPeriod,
        startInclusive: "2026-10-12T00:00:00Z",
        endExclusive: "2026-10-19T00:00:00Z",
        asOf: "2026-10-19T12:00:00Z",
    },
};

const result = examples.internal.success as unknown as GenerationResult;
result.signals.since = "2026-10-12";
result.signals.computedAt = "2026-10-19T12:00:00Z";
const input = {
    principalRef: "user-joseph",
    companyId: "company-tilde",
    reportWindow: {
        startInclusive: "2026-10-12T00:00:00Z",
        endExclusive: "2026-10-19T00:00:00Z",
        asOf: "2026-10-19T12:00:00Z",
    },
    budgets: {
        maxSources: 20,
        maxExcerptChars: 8000,
        timeoutMs: 5000,
        maxQueries: 2,
        maxTokens: 1200,
    },
    runId: "run-demo-1",
    inputVersion: "input-v0-1",
};

describe("Vantage v0 fixture integration", () => {
    it("supports a deterministic multi-role fixture and private-star audience boundary", async () => {
        const ports = createFixtureV0Ports({
            roleContext: {
                ...createFixtureV0Ports().fixture.roleContext,
                roleIds: ["founder", "engineering"],
                roles: [
                    {
                        roleId: "founder",
                        description: "Founder",
                        responsibilities: ["Direction"],
                        priorities: ["Risk"],
                    },
                    {
                        roleId: "engineering",
                        description: "Engineering",
                        responsibilities: ["Ship"],
                        priorities: ["Reliability"],
                    },
                ],
            },
        });
        const output = await runContextV0Pipeline(input, ports);
        const star = output.evidenceSnapshot.entries.find(
            item => item.source.id === "doc-starred-roadmap"
        );
        expect(star).toBeDefined();
        expect(output.evidenceSnapshot.entries.some(item => item.excerpt?.includes("secret"))).toBe(
            false
        );
    });

    it("rejects an unregistered citation from a replaceable context-aware generator", async () => {
        const ports = createFixtureV0Ports();
        const assembled = await runContextV0Pipeline(input, ports);
        const badResult = structuredClone(result);
        badResult.draft.topics[0]!.facts[0]!.refs[0]!.ref = "ev:ev-demo-1";
        const generator = createMockContextAwareGenerator(badResult, [
            { kind: "ev", id: "ev-demo-1", version: "ev-v2" },
        ]);
        await expect(
            generator(
                {
                    v1Input: compatibleV1Input as never,
                    manifest: assembled.manifest,
                    evidenceSnapshot: assembled.evidenceSnapshot,
                    freeze: assembled.freeze,
                },
                {
                    resolveModel: () => null,
                    signal: new AbortController().signal,
                    budgets: {
                        attemptTimeoutMs: 20000,
                        maxAttempts: 2,
                        retryWaitMs: 1000,
                        totalMs: 45000,
                    },
                } as GenerationRuntime
            )
        ).rejects.toMatchObject({ status: 403 });
    });

    it("accepts registered citations through the context-aware adapter", async () => {
        const ports = createFixtureV0Ports();
        const assembled = await runContextV0Pipeline(input, ports);
        const goodResult = structuredClone(result);
        goodResult.draft.topics[0]!.facts[0]!.refs[0]!.ref = "ev:ev-demo-1";
        const registered = assembled.evidenceSnapshot.entries.find(
            entry => entry.source.kind === "ev"
        )!.source;
        const generator = createContextAwareGenerationAdapter(async envelope => {
            try {
                (envelope as { manifest: unknown }).manifest = { forged: true };
                (envelope.evidenceSnapshot.entries[0] as { excerpt: string }).excerpt = "forged";
            } catch {
                // The adapter intentionally supplies a deep immutable envelope.
            }
            return { v1Result: goodResult, citationRefs: [registered] };
        });
        const output = await generator(
            {
                v1Input: compatibleV1Input as never,
                manifest: assembled.manifest,
                evidenceSnapshot: assembled.evidenceSnapshot,
                freeze: assembled.freeze,
            },
            {
                resolveModel: () => null,
                signal: new AbortController().signal,
                budgets: {
                    attemptTimeoutMs: 20000,
                    maxAttempts: 2,
                    retryWaitMs: 1000,
                    totalMs: 45000,
                },
            } as GenerationRuntime
        );
        expect(output.contextMode).toBe("aware-v0");
        expect(output.citationRefs).toEqual([registered]);
        expect(assembled.manifest.contextFingerprint).toBe(output.manifestFingerprint);
        expect(assembled.evidenceSnapshot.entries[0]!.excerpt).not.toBe("forged");
    });
});
