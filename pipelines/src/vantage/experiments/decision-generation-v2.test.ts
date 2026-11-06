import capturedFailures from "../../../../fixtures/vantage-phase-a-repair/structured-pilot-responses.json";
import { GenerationCompoundSchemaV2 } from "../generation-v2-schema";
import { normalizeGenerationV2 } from "../validate-generation-v2";
import c02Input from "../../../../fixtures/vantage-generation-v2/C02.input.json";
import c02Golden from "../../../../fixtures/vantage-generation-v2/C02.compound.json";
import orbitInput from "../../../../fixtures/vantage-generation-v2/V2-04.input.json";
import orbitGolden from "../../../../fixtures/vantage-generation-v2/V2-04.compound.json";
import type { BusinessRoleContextV0 } from "../proposals/context-v0";
import { describe, expect, it, vi } from "vitest";
import { coerceMessageLikeToMessage } from "@langchain/core/messages";
import { InvalidStructuredAttemptError, type ResolvedChatModel } from "@launchstack/llm";
import input from "../../../../fixtures/vantage-generation-v2/C05.input.json";
import golden from "../../../../fixtures/vantage-generation-v2/C05.compound.json";
import type { ContextGenerationEnvelopeV0 } from "../context-v0/ports";
import type { GenerationRuntime } from "../contract-v1";
import { GENERATION_BUDGETS, GENERATION_SYSTEM_PROMPT } from "../generation-v1";
import { createSophiaContextGenerationExperimentV0 } from "./sophia-generation-v0";
import {
    createDecisionExperimentV2,
    decisionPromptV2,
    GENERATION_PROMPT_VERSION_V2,
    outputSizeV2,
    roleFrameV2,
} from "./decision-generation-v2";
const envelope = () => structuredClone(input.envelope) as unknown as ContextGenerationEnvelopeV0;
const pair = () => structuredClone(golden);
const model = {
    modelId: "offline-synthetic",
    behavior: { parameters: { systemMessages: "supported" } },
    prepareMessages: (messages: Parameters<ResolvedChatModel["prepareMessages"]>[0]) =>
        messages.map(coerceMessageLikeToMessage),
} as unknown as ResolvedChatModel;
const runtime = (): GenerationRuntime => ({
    resolveModel: () => model,
    signal: new AbortController().signal,
    budgets: GENERATION_BUDGETS,
});
type Invoke = NonNullable<Parameters<typeof createSophiaContextGenerationExperimentV0>[0]>;
const response = (result: unknown) => ({ result, usage: { outputTokens: 100 } });
const run = (
    invoke: ReturnType<typeof vi.fn>,
    version: typeof GENERATION_PROMPT_VERSION_V2 | "disabled" = GENERATION_PROMPT_VERSION_V2
) => createDecisionExperimentV2({ version, invoke: invoke as Invoke, countTokens: () => 100 });

describe("isolated Phase 1 decision experiment (synthetic transports)", () => {
    it.each([
        { id: "C02", input: c02Input, golden: c02Golden },
        { id: "V2-04", input: orbitInput, golden: orbitGolden },
    ])("normalizes the complete $id compound through Sophia and native runtime", async item => {
        const invoke = vi.fn().mockResolvedValue(response(item.golden));
        const result = await run(invoke)(
            item.input.envelope as unknown as ContextGenerationEnvelopeV0,
            runtime()
        );
        expect(result.outcome, JSON.stringify(result)).toBe("v2-first-pass");
    });
    it("uses the verified primary rather than the first role ID", () => {
        const e = envelope();
        e.manifest.roleIds = ["founder", "engineering"];
        const role: BusinessRoleContextV0 = {
            contractVersion: "v0-proposed",
            authenticatedPrincipalRef: e.manifest.actor.principalRef,
            roleIds: ["founder", "engineering"],
            primaryRoleId: "engineering",
            mappingVersion: e.manifest.roleMapVersion,
            roles: [
                {
                    roleId: "founder",
                    description: "Founder",
                    responsibilities: ["Strategy"],
                    priorities: ["Readiness"],
                },
                {
                    roleId: "engineering",
                    description: "Engineer",
                    responsibilities: ["Engineering"],
                    priorities: ["Readiness"],
                },
            ],
            provenance: { kind: "server", source: "synthetic-host" },
            userConfirmed: false,
            fallback: false,
        };
        expect(roleFrameV2(e, role)).toBe("a decision assistant");
        role.primaryRoleId = "founder";
        expect(roleFrameV2(e, role)).toContain("chief of staff");
        role.fallback = true;
        expect(roleFrameV2(e, role)).toBe("a decision assistant");
    });
    it("obtains role authority through the host resolver", async () => {
        const resolvePrimaryRole = vi.fn().mockReturnValue(null);
        const invoke = vi.fn().mockResolvedValue(response(pair()));
        const e = envelope();
        const result = await createDecisionExperimentV2({
            version: GENERATION_PROMPT_VERSION_V2,
            invoke: invoke as Invoke,
            countTokens: () => 100,
            resolvePrimaryRole,
        })(e, runtime());
        expect(result.outcome).toBe("v2-first-pass");
        expect(resolvePrimaryRole).toHaveBeenCalledWith({
            principalRef: e.manifest.actor.principalRef,
            companyId: e.manifest.actor.companyId,
        });
    });
    it("is disabled without the explicit version and makes no request", async () => {
        const invoke = vi.fn();
        await expect(run(invoke, "disabled")(envelope(), runtime())).rejects.toThrow();
        expect(invoke).not.toHaveBeenCalled();
    });
    it("preserves appendices and falls back to a generic persona without verified primary role", () => {
        const e = envelope();
        expect(roleFrameV2(e)).toBe("a decision assistant");
        expect(decisionPromptV2(e)).toContain(
            GENERATION_SYSTEM_PROMPT.slice(
                GENERATION_SYSTEM_PROMPT.indexOf("PREVIOUS VANTAGE CONTEXT")
            )
        );
    });
    it("delivers first-pass V2 through native normalization with the unchanged cap", async () => {
        const invoke = vi.fn().mockResolvedValue(response(pair()));
        const result = await run(invoke)(envelope(), runtime());
        expect(result.outcome, JSON.stringify(result)).toBe("v2-first-pass");
        expect(result.output?.report).toHaveProperty("headline", golden.experimental.headline);
        expect(result.output?.generated.v1Result.execution.mode).toBe("ai");
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(invoke.mock.calls[0]![3].maxOutputTokens).toBe(2400);
        expect(result.output?.diagnostics.promptBytes).toBeLessThanOrEqual(23500);
        const payloads = invoke.mock.calls[0]![2].map((m: unknown) =>
            coerceMessageLikeToMessage(m as Parameters<typeof coerceMessageLikeToMessage>[0])
        )
            .filter(
                (m: { getType: () => string; content: unknown }) =>
                    m.getType() === "human" && typeof m.content === "string"
            )
            .map((m: { content: unknown }) => JSON.parse(m.content as string));
        const native = payloads.find((p: { items?: unknown }) => Array.isArray(p.items));
        const context = payloads.find((p: { context?: unknown }) => p.context).context;
        let interned = 0;
        for (const source of context.sources) {
            if (!source.excerptFromNativeItem) continue;
            interned++;
            const binding = source.excerptFromNativeItem;
            const item = native.items.find((i: { ref: string }) => i.ref === binding.ref);
            const original = input.envelope.evidenceSnapshot.entries.find(
                e => `${e.source.kind}:${e.source.id}@${e.source.version}` === source.ref
            );
            expect(item.text.slice(binding.start, binding.start + binding.length)).toBe(
                original?.excerpt
            );
        }
        expect(interned).toBeGreaterThan(0);
    });
    it("repairs once with actual validation messages", async () => {
        const bad = pair();
        bad.experimental.headline = "The order is for 999 cups.";
        const invoke = vi
            .fn()
            .mockResolvedValueOnce(response(bad))
            .mockResolvedValueOnce(response(pair()));
        const result = await run(invoke)(envelope(), runtime());
        expect(result.outcome).toBe("v2-after-repair");
        expect(invoke).toHaveBeenCalledTimes(2);
        expect(JSON.stringify(invoke.mock.calls[1]![2])).toContain("ungrounded");
    });
    it("never displays partially valid reports or makes a third attempt", async () => {
        const bad = pair();
        bad.experimental.headline = "The order is for 999 cups.";
        const invoke = vi.fn().mockResolvedValue(response(bad));
        const result = await run(invoke)(envelope(), runtime());
        expect(result.outcome).toBe("failed");
        expect(result.output).toBeNull();
        expect(invoke).toHaveBeenCalledTimes(2);
    });
    it("uses only an already validated same-envelope fallback without another request", async () => {
        const value = pair();
        const { headline: _h, brief: _b, keyFigures: _k, ...legacy } = value.experimental;
        void _h;
        void _b;
        void _k;
        const experimental = {
            ...legacy,
            topics: legacy.topics.map(({ whyNow: _w, recommendation: _r, ...topic }) => topic),
        };
        const fallback = await createSophiaContextGenerationExperimentV0(
            vi.fn().mockResolvedValue(response({ native: value.native, experimental })) as Invoke
        )(envelope(), runtime());
        const bad = pair();
        bad.experimental.headline = "999 cups are needed.";
        const invoke = vi.fn().mockResolvedValue(response(bad));
        const result = await run(invoke)(envelope(), runtime(), fallback);
        expect(result.outcome).toBe("v1.5-fallback");
        expect(invoke).toHaveBeenCalledTimes(2);
        expect(result.output?.report).not.toHaveProperty("headline");
        const stale = structuredClone(fallback);
        stale.diagnostics.contextFingerprint = "stale";
        expect((await run(invoke)(envelope(), runtime(), stale)).outcome).toBe("failed");
    });
    it("preserves native citation and topic limits", async () => {
        const bad = pair();
        bad.native.topics[0]!.facts[0]!.refs = ["doc:D03@v1"];
        const invoke = vi.fn().mockResolvedValue(response(bad));
        expect((await run(invoke)(envelope(), runtime())).outcome).toBe("failed");
    });
    it("counts the full compound and warns above 85 percent", () => {
        const counter = vi.fn().mockReturnValue(2041);
        expect(outputSizeV2(pair(), counter).warn).toBe(true);
        expect(counter).toHaveBeenCalledWith(JSON.stringify(golden));
    });
});

describe("Phase A captured structured-output regressions (offline only)", () => {
    it("preserves proof that the provider received the actual whyNow limit", () => {
        for (const attempt of capturedFailures.attempts) {
            const schema = JSON.parse(attempt.schemaInstruction.split("\n").slice(1).join("\n"));
            expect(
                schema.properties.experimental.properties.topics.items.properties.whyNow.maxLength
            ).toBe(160);
            expect(attempt.finishReason).toBe("stop");
        }
    });
    it("still rejects the initial unversioned experimental citations", () => {
        const pair = JSON.parse(capturedFailures.attempts[0]!.rawContent);
        expect(GenerationCompoundSchemaV2.safeParse(pair).success).toBe(true);
        expect(() =>
            normalizeGenerationV2(
                pair,
                capturedFailures.envelope as unknown as ContextGenerationEnvelopeV0
            )
        ).toThrow("exact versioned references");
    });
    it("does not trim or repair the extra closing brace in the first recovery", () => {
        const raw = capturedFailures.attempts[1]!.rawContent;
        expect(raw.endsWith("}}}")).toBe(true);
        expect(() => JSON.parse(raw)).toThrow(SyntaxError);
    });
    it("still rejects 174-character whyNow even when JSON mode succeeded", () => {
        const pair = JSON.parse(capturedFailures.attempts[2]!.rawContent);
        expect(pair.experimental.topics[0].whyNow).toHaveLength(174);
        const parsed = GenerationCompoundSchemaV2.safeParse(pair);
        expect(parsed.success).toBe(false);
        if (!parsed.success)
            expect(parsed.error.issues).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        code: "too_big",
                        maximum: 160,
                        path: ["experimental", "topics", 0, "whyNow"],
                    }),
                ])
            );
    });
    it("gives the actual experimental transport explicit citation namespaces and schema-derived limits", async () => {
        const invoke = vi.fn().mockResolvedValue(response(pair()));
        expect((await run(invoke)(envelope(), runtime())).outcome).toBe("v2-first-pass");
        const text = invoke.mock.calls[0]![2].map(
            (message: Parameters<typeof coerceMessageLikeToMessage>[0]) => {
                const content = coerceMessageLikeToMessage(message).content;
                return typeof content === "string" ? content : JSON.stringify(content);
            }
        ).join("\n");
        expect(text).toContain(
            "experimental: cite only exact context.sources[].ref values, including @version"
        );
        expect(text).toContain("native: cite only original native item refs");
        const fields = GenerationCompoundSchemaV2.shape.experimental.shape;
        for (const [name, maximum] of [
            ["whyNow", fields.topics.element.shape.whyNow.maxLength],
            ["rationale", fields.topics.element.shape.rationale.maxLength],
        ])
            expect(text).toContain(`${name}<=${maximum} characters`);
        expect(text).toContain("Review the full authorized contextual source set");
        expect(text).toContain("Return one complete JSON object");
    });
    it.each([
        { tokens: 2399, outcome: "v2-first-pass" },
        { tokens: 2401, outcome: "failed" },
    ])(
        "keeps the shared cap at $tokens for the three-topic schema capacity (mock tokenizer only)",
        async ({ tokens, outcome }) => {
            // Capacity test only: repeated facts are not three independent issues or a quality score.
            const value = pair();
            value.experimental.topics = ["A", "B", "C"].map(slot => ({
                ...structuredClone(value.experimental.topics[0]!),
                title: `Synthetic capacity slot ${slot}`,
            }));
            const invoke = vi.fn().mockResolvedValue(response(value));
            const result = await createDecisionExperimentV2({
                version: GENERATION_PROMPT_VERSION_V2,
                invoke: invoke as Invoke,
                countTokens: () => tokens,
            })(envelope(), runtime());
            expect(result.outcome).toBe(outcome);
            expect(invoke).toHaveBeenCalledTimes(outcome === "v2-first-pass" ? 1 : 2);
            expect(result.attempts[0]).toMatchObject({ outputTokens: tokens, warn: true });
            if (outcome === "v2-first-pass") expect(result.output?.report.topics).toHaveLength(3);
            else expect(result.output).toBeNull();
        }
    );
    it("keeps pre-dispatch V2 budget diagnostics without invoking the injected transport", async () => {
        const invoke = vi.fn();
        const oversizedModel = {
            ...model,
            prepareMessages: (messages: Parameters<ResolvedChatModel["prepareMessages"]>[0]) => {
                const prepared = messages.map(coerceMessageLikeToMessage);
                if (JSON.stringify(prepared[0]?.content).includes("whyNow")) {
                    const message = prepared[0]!;
                    message.content = `${JSON.stringify(message.content)} ${"x".repeat(24000)}`;
                }
                return prepared;
            },
        } as unknown as ResolvedChatModel;
        const result = await run(invoke)(envelope(), {
            ...runtime(),
            resolveModel: () => oversizedModel,
        });
        expect(result.outcome).toBe("failed");
        expect(result.attempts).toHaveLength(0);
        expect(result.setup?.reason).toBe("v2-prompt-budget");
        expect(result.setup?.promptBytes).toBeGreaterThan(23500);
        expect(invoke).not.toHaveBeenCalled();
    });
    it("does not invent parse or schema details when shared transport returns a generic failure", async () => {
        const invoke = vi.fn().mockRejectedValue(new InvalidStructuredAttemptError());
        const result = await run(invoke)(envelope(), runtime());
        expect(result.outcome).toBe("failed");
        expect(invoke).toHaveBeenCalledTimes(2);
        expect(result.attempts.every(attempt => attempt.stage === "structured-transport")).toBe(
            true
        );
        expect(result.attempts[0]!.issues).toEqual([
            "The model returned invalid structured output.",
        ]);
    });
    it("keeps exact schema paths in a bounded repair instruction when available locally", async () => {
        const bad = pair();
        bad.experimental.topics[0]!.whyNow = JSON.parse(
            capturedFailures.attempts[2]!.rawContent
        ).experimental.topics[0].whyNow;
        const invoke = vi
            .fn()
            .mockResolvedValueOnce(response(bad))
            .mockResolvedValueOnce(response(pair()));
        const result = await run(invoke)(envelope(), runtime());
        expect(result.outcome).toBe("v2-after-repair");
        expect(result.attempts[0]).toMatchObject({ stage: "output-schema" });
        expect(result.attempts[0]!.issues.join(";")).toContain("experimental.topics.0.whyNow");
        expect(JSON.stringify(invoke.mock.calls[1]![2])).toContain("experimental.topics.0.whyNow");
        expect(result.output?.diagnostics.promptBytes).toBeLessThanOrEqual(23500);
    });
});
