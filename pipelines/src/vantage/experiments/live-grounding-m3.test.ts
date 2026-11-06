import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import semantic from "../../../../fixtures/vantage-pipeline-edge-cases/semantic-cases.json";
import { prepareLivePilotContext } from "../evaluation-live/pilot-context";
import type { JosephSemanticCase } from "../evaluation-integration/joseph-adapter";
import {
    m3PlanHash,
    type M3RequestBudget,
    type M3BudgetSnapshot,
} from "../evaluation-live/m3-request-budget";
import {
    createM3GroundingPipeline,
    assertM3GenerationWire,
    measureM3WireProjection,
    buildM3OfflinePlan,
    m3InputHash,
    M3_SCENARIO_ID,
    type M3GroundingInput,
} from "./live-grounding-m3";
import {
    createM3OfflineModelSettings,
    m3ModelConfigurationHash,
    serializeM3ModelSettings,
    hydrateM3ModelSettings,
    bindM3Attempt,
} from "./live-grounding-m3-transport";
import {
    createM3OfflineProviderFixture,
    type M3OfflineVariant,
} from "./live-grounding-m3-fixtures";
import { invokeStructuredAttempt } from "@launchstack/llm";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";

/** Synthetic component envelope, explicitly not authentication, DB durability, or live quality evidence. */
async function setup(variant: M3OfflineVariant = "corrected") {
    const context = await prepareLivePilotContext(
        semantic.cases.find(value => value.id === "conflicting-metrics")! as JosephSemanticCase
    );
    const envelope = context.envelope;
    const sourceRefs = {
        finance: context.prepared.documents.find(value => value.originalId === "finance")!.source,
        sales: context.prepared.documents.find(value => value.originalId === "sales")!.source,
    };
    // Explicitly declared exact native copies for testing the native lineage gate.
    envelope.v1Input.data.currentEvidence = [sourceRefs.finance, sourceRefs.sales].map(
        (ref, index) => ({
            ...context.intakeEvidence,
            id: `m3-copy-${index}`,
            body: envelope.evidenceSnapshot.entries.find(
                entry => entry.source.id === ref.id && entry.source.version === ref.version
            )!.excerpt,
        })
    );
    const input: M3GroundingInput = {
        envelope,
        sourceRefs,
        roleContext: context.prepared.roleContext,
        nativeSourceBindings: [
            { alias: "ev:m3-copy-0", ref: sourceRefs.finance },
            { alias: "ev:m3-copy-1", ref: sourceRefs.sales },
        ],
    };
    input.closedInventory = {
        ...context.trustedEvaluationInventory,
        scenarioId: M3_SCENARIO_ID,
        generationInputFingerprint: m3InputHash(envelope, input.roleContext),
    };
    const root = new URL("../../../../apps/web/config/", import.meta.url);
    const generation = createM3OfflineModelSettings({
        baseUrl: "https://synthetic.invalid/generation/v1",
        kind: "generation",
        yaml: readFileSync(new URL("chat-models.yaml", root), "utf8"),
    });
    const judge = createM3OfflineModelSettings({
        baseUrl: "https://synthetic.invalid/judge/v1",
        kind: "judge",
        yaml: readFileSync(new URL("chat-models.vantage-demo.azure.yaml", root), "utf8"),
    });
    const implementationHash = "a".repeat(64),
        plan = buildM3OfflinePlan(input, { generation, judge, implementationHash }),
        planHash = m3PlanHash(plan);
    const state: M3BudgetSnapshot = {
        budgetKey: "offline-component",
        planHash,
        plan,
        approvalState: "approved-offline",
        approvalManifest: null,
        reserved: 0,
        totalLimit: 2,
        requests: [],
    };
    const budget: M3RequestBudget = {
        async snapshot() {
            return structuredClone(state);
        },
        async beforeDispatch(intent) {
            if (
                state.reserved >= 2 ||
                state.requests.some(value => value.intent.kind === intent.kind)
            )
                throw new Error("budget exceeded");
            const ordinal = ++state.reserved;
            state.requests.push({
                request_id: intent.requestId,
                ordinal,
                intent,
                status: "reserved",
                http_status: null,
                response_hash: null,
            });
            return {
                requestId: intent.requestId,
                ordinal,
                mode: "offline",
                planHash,
                budgetKey: state.budgetKey,
            };
        },
        async completion(receipt) {
            const row = state.requests.find(value => value.request_id === receipt.requestId)!;
            row.status = receipt.status;
            row.http_status = receipt.httpStatus ?? null;
            row.response_hash = receipt.responseHash ?? null;
        },
        async verifyReceipt(check) {
            if (
                state.requests.length !== 2 ||
                state.requests.some(value => value.status !== "responded")
            )
                throw new Error("not completed");
            return {
                ...check,
                mode: "offline",
                generationResponseHash: state.requests[0]!.response_hash!,
                judgeResponseHash: state.requests[1]!.response_hash!,
                reserved: 2,
                totalLimit: 2,
            };
        },
    };
    const respond = vi.fn(createM3OfflineProviderFixture({ input, variant }));
    const options = {
        mode: "offline" as const,
        generation,
        judge,
        implementationHash,
        planHash,
        configHash: plan.bindings.configHash!,
        budget,
        adapter: { kind: "offline-injected" as const, respond },
        pricing: { status: "missing" as const },
    };
    return { input, options, state, respond };
}

describe("M3 offline real SDK Generation / whole-output Sophia path", () => {
    it.each(["corrected", "paraphrase"] as const)(
        "admits %s only after two charged SDK responses, and seals all carriers",
        async variant => {
            const test = await setup(variant);
            const forbidden = vi.fn(() => {
                throw new Error("External fetch forbidden");
            });
            vi.stubGlobal("fetch", forbidden);
            try {
                const pipeline = createM3GroundingPipeline(test.options);
                const result = await pipeline.runGroundingCandidate(test.input);
                expect(result.status, JSON.stringify(result)).toBe("admitted");
                if (result.status !== "admitted") return;
                expect(result.trace).toMatchObject({
                    actualExternalDispatches: 0,
                    injectedDispatches: 2,
                    mode: "offline",
                    judgeEvidence: "injected-offline-not-model-quality",
                });
                expect(test.state.requests.map(row => row.status)).toEqual([
                    "responded",
                    "responded",
                ]);
                expect(test.respond).toHaveBeenCalledTimes(2);
                expect(forbidden).not.toHaveBeenCalled();
                const check = {
                    envelope: test.input.envelope,
                    generated: result.generated,
                    compound: result.rawCompound,
                    normalizedReport: result.normalizedReport,
                    receipt: result.admissionReceipt,
                };
                expect(pipeline.assertAdmissionReceipt(check)).toBe(result.admissionReceipt);
                expect(() =>
                    pipeline.assertAdmissionReceipt({
                        ...check,
                        receipt: structuredClone(check.receipt),
                    })
                ).toThrow();
                expect(() =>
                    pipeline.assertAdmissionReceipt({
                        ...check,
                        generated: {
                            ...check.generated,
                            diagnostics: { substituted: true },
                        } as never,
                    })
                ).toThrow();
                expect(() => pipeline.assertAdmissionReceipt({ ...check, compound: {} })).toThrow();
            } finally {
                vi.unstubAllGlobals();
            }
        }
    );
    it.each(["omission", "native-only-source", "judge-wrong-id", "judge-low-grounding"] as const)(
        "withholds %s with charged aggregate traces",
        async variant => {
            const test = await setup(variant);
            const result = await createM3GroundingPipeline(test.options).runGroundingCandidate(
                test.input
            );
            expect(result.status).toBe("withheld");
            expect(result.admissionReceipt).toBeNull();
            expect(result.trace.injectedDispatches, JSON.stringify(result)).toBe(2);
            expect(test.state.reserved).toBe(2);
            if (variant === "native-only-source")
                expect(JSON.stringify(result.trace.judge?.requestBody)).toContain(
                    "only supplied financial source"
                );
        }
    );
    it.each([
        "generation-malformed",
        "generation-429",
        "generation-500",
        "generation-redirect",
    ] as const)("never retries %s or dispatches Judge", async variant => {
        const test = await setup(variant);
        const result = await createM3GroundingPipeline(test.options).runGroundingCandidate(
            test.input
        );
        expect(result.status).toBe("withheld");
        expect(test.respond).toHaveBeenCalledTimes(1);
        expect(test.state.reserved).toBe(1);
        expect(result.trace.injectedDispatches).toBe(1);
        expect(test.state.requests[0]!.status).toBe(
            variant === "generation-malformed" ? "responded" : "failed"
        );
    });
    it("blocks disabled and proposed live settings before reserving", async () => {
        const test = await setup();
        for (const mode of ["disabled", "live"] as const) {
            const result = await createM3GroundingPipeline({
                ...test.options,
                mode,
            }).runGroundingCandidate(test.input);
            expect(result.status).toBe("withheld");
        }
        expect(test.state.reserved).toBe(0);
        expect(test.respond).not.toHaveBeenCalled();
    });
    it("keeps sourceDate in the stable plan identity but excludes only per-read checkedAt/runId", async () => {
        const { input } = await setup();
        const changed = structuredClone(input.envelope);
        changed.manifest.runId = "another-run";
        changed.v1Input.runId = "another-run";
        changed.manifest.sourceRegistry.forEach(
            entry => (entry.checkedAt = "2030-01-01T00:00:00Z")
        );
        expect(m3InputHash(changed, input.roleContext)).toBe(
            m3InputHash(input.envelope, input.roleContext)
        );
        changed.manifest.sourceRegistry[0]!.sourceDate = "2020-01-01T00:00:00Z";
        expect(m3InputHash(changed, input.roleContext)).not.toBe(
            m3InputHash(input.envelope, input.roleContext)
        );
    });
    it("awaits reservation and preflights the exact wire before any adapter dispatch", async () => {
        const test = await setup();
        let release!: () => void;
        const pending = new Promise<void>(resolve => {
            release = resolve;
        });
        const before = test.options.budget.beforeDispatch;
        test.options.budget.beforeDispatch = async intent => {
            await pending;
            return before(intent);
        };
        const attempt = bindM3Attempt({
            kind: "generation",
            mode: "offline",
            settings: test.options.generation,
            adapter: test.options.adapter,
            budget: test.options.budget,
            planHash: test.options.planHash,
            configHash: test.options.configHash,
            inputHash: m3InputHash(test.input.envelope, test.input.roleContext),
        });
        const call = invokeStructuredAttempt(
            attempt.model,
            z.object({}),
            [new HumanMessage("test")],
            { signal: new AbortController().signal, timeoutMs: 1000, maxOutputTokens: 2400 }
        ).catch(() => null);
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(test.respond).not.toHaveBeenCalled();
        expect(test.state.reserved).toBe(0);
        release();
        await call;
        expect(test.respond).toHaveBeenCalledTimes(1);
        const denied = bindM3Attempt({
            kind: "generation",
            mode: "offline",
            settings: test.options.generation,
            adapter: test.options.adapter,
            budget: test.options.budget,
            planHash: test.options.planHash,
            configHash: test.options.configHash,
            inputHash: m3InputHash(test.input.envelope, test.input.roleContext),
            inspectRequest: () => {
                throw new Error("wire source tampered");
            },
        });
        await expect(
            invokeStructuredAttempt(denied.model, z.object({}), [new HumanMessage("test")], {
                signal: new AbortController().signal,
                timeoutMs: 1000,
                maxOutputTokens: 2400,
            })
        ).rejects.toThrow();
        expect(test.state.reserved).toBe(1);
    });
    it("rejects changed excerpts, refs and availability for every frozen source before reservation", async () => {
        const test = await setup();
        const result = await createM3GroundingPipeline(test.options).runGroundingCandidate(
            test.input
        );
        expect(result.status).toBe("admitted");
        const original = result.trace.generation!.requestBody!;
        for (const entry of test.input.envelope.evidenceSnapshot.entries) {
            for (const field of ["excerpt", "ref", "sourceDate"]) {
                const body = structuredClone(original);
                const messages = body.messages as { content: string }[];
                const message = messages.find(message => {
                    try {
                        return !!JSON.parse(message.content).context;
                    } catch {
                        return false;
                    }
                })!;
                const payload = JSON.parse(message.content);
                const source = payload.context.sources.find(
                    (source: { ref: string }) =>
                        source.ref ===
                        `${entry.source.kind}:${entry.source.id}@${entry.source.version}`
                );
                source[field] = "tampered";
                delete source.excerptFromNativeItem;
                message.content = JSON.stringify(payload);
                expect(() => assertM3GenerationWire(body, test.input)).toThrow();
            }
        }
        expect(measureM3WireProjection(result.trace.generation!)).toMatchObject({
            tokenizer: "o200k_base-proxy",
        });
        expect(measureM3WireProjection(result.trace.judge!).promptTokenProxy).toBeGreaterThan(0);
    });
    it.each(["read-failure", "timeout"] as const)(
        "records terminal %s with one charged SDK fetch and no raw error body",
        async fault => {
            const test = await setup();
            const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
                if (fault === "read-failure")
                    return Object.assign(new Response(), {
                        text: async () => {
                            throw new Error("credential must never enter trace");
                        },
                    });
                return await new Promise<Response>((_resolve, reject) => {
                    init!.signal!.addEventListener("abort", () => reject(new Error("timeout")), {
                        once: true,
                    });
                });
            });
            // Keep endpoint/model hashes internally valid for a loopback-only offline fetch adapter.
            const settings = createM3OfflineModelSettings({
                baseUrl: "http://127.0.0.1:1/v1",
                kind: "generation",
                yaml: readFileSync(
                    new URL("../../../../apps/web/config/chat-models.yaml", import.meta.url),
                    "utf8"
                ),
            });
            const attempt = bindM3Attempt({
                kind: "generation",
                mode: "offline",
                settings,
                adapter: { kind: "offline-loopback-fetch", fetch },
                budget: test.options.budget,
                planHash: test.options.planHash,
                configHash: test.options.configHash,
                inputHash: m3InputHash(test.input.envelope, test.input.roleContext),
            });
            await expect(
                invokeStructuredAttempt(
                    attempt.model,
                    z.object({}),
                    [new HumanMessage("timeout fixture")],
                    { signal: new AbortController().signal, timeoutMs: 25, maxOutputTokens: 2400 }
                )
            ).rejects.toThrow();
            expect(fetch).toHaveBeenCalledTimes(1);
            expect(test.state.reserved).toBe(1);
            expect(test.state.requests[0]!.status).toBe(fault === "timeout" ? "timeout" : "failed");
            expect(attempt.trace.responseBody).toBeNull();
        }
    );

    it("rejects same-family identities and implementation/config drift without reserving", async () => {
        const test = await setup();
        const judge = structuredClone(test.options.judge);
        judge.identity.family = test.options.generation.identity.family;
        judge.identity.modelConfigHash = m3ModelConfigurationHash(judge, judge.identity);
        const plan = buildM3OfflinePlan(test.input, {
            generation: test.options.generation,
            judge,
            implementationHash: test.options.implementationHash,
        });
        test.state.plan = plan;
        test.state.planHash = m3PlanHash(plan);
        const same = createM3GroundingPipeline({
            ...test.options,
            judge,
            planHash: test.state.planHash,
            configHash: plan.bindings.configHash!,
        });
        expect((await same.runGroundingCandidate(test.input)).status).toBe("withheld");
        expect(test.state.reserved).toBe(0);
        const fresh = await setup();
        expect(
            (
                await createM3GroundingPipeline({
                    ...fresh.options,
                    implementationHash: "b".repeat(64),
                }).runGroundingCandidate(fresh.input)
            ).status
        ).toBe("withheld");
        expect(fresh.state.reserved).toBe(0);
        expect(
            (
                await createM3GroundingPipeline({
                    ...fresh.options,
                    configHash: "c".repeat(64),
                }).runGroundingCandidate(fresh.input)
            ).status
        ).toBe("withheld");
        expect(fresh.state.reserved).toBe(0);
    });
    it("rejects an unexpected provider response model after one consumed request", async () => {
        const test = await setup();
        const respond = test.options.adapter.respond;
        test.options.adapter.respond = vi.fn(async request => {
            const response = await respond(request);
            (response.body as { model: string }).model = "unreviewed-model";
            return response;
        });
        const result = await createM3GroundingPipeline(test.options).runGroundingCandidate(
            test.input
        );
        expect(result.status).toBe("withheld");
        expect(test.state.reserved).toBe(1);
        expect(result.trace.injectedDispatches).toBe(1);
        expect(test.respond).toHaveBeenCalledTimes(1);
    });
    it("round-trips registry JSON with every real model definition and executes the same SDK path", async () => {
        const test = await setup();
        for (const kind of ["generation", "judge"] as const) {
            const original = test.options[kind];
            const wire = serializeM3ModelSettings(original);
            const json = JSON.stringify(wire);
            expect(json).not.toContain("m3-offline-no-provider-key");
            expect(Array.isArray(wire.config.models)).toBe(true);
            const hydrated = hydrateM3ModelSettings(JSON.parse(json) as unknown);
            expect(Object.fromEntries(hydrated.config.models)).toEqual(
                Object.fromEntries(original.config.models)
            );
            expect(hydrated.identity.modelConfigHash).toBe(original.identity.modelConfigHash);
            test.options[kind] = hydrated;
            const tampered = JSON.parse(json) as typeof wire;
            (tampered.config.models[0]![1] as { id: string }).id = "tampered-model-definition";
            expect(() => hydrateM3ModelSettings(tampered)).toThrow("configuration hash mismatch");
            const erased = JSON.parse(json) as Record<string, unknown>;
            erased.config = { ...wire.config, models: {} };
            expect(() => hydrateM3ModelSettings(erased)).toThrow();
        }
        const result = await createM3GroundingPipeline(test.options).runGroundingCandidate(
            test.input
        );
        expect(result.status, JSON.stringify(result)).toBe("admitted");
        expect(test.state.reserved).toBe(2);
    });
    it("binds non-primary model behavior definitions too", async () => {
        const test = await setup();
        const settings = structuredClone(test.options.generation);
        const entries = [...settings.config.models.entries()];
        expect(entries.length).toBeGreaterThan(1);
        const [, definition] = entries[entries.length - 1]!;
        definition.behavior.parameters.temperature =
            definition.behavior.parameters.temperature === "supported"
                ? "unsupported"
                : "supported";
        expect(m3ModelConfigurationHash(settings, settings.identity)).not.toBe(
            test.options.generation.identity.modelConfigHash
        );
    });
    it("retains non2xx status/hash while stripping provider diagnostics from every returned trace field", async () => {
        const test = await setup();
        const marker = "harmless-secret-marker-do-not-retain";
        test.options.adapter.respond = vi.fn(async () => ({
            status: 500,
            body: { error: { message: marker, code: marker } },
        }));
        const result = await createM3GroundingPipeline(test.options).runGroundingCandidate(
            test.input
        );
        expect(result.status).toBe("withheld");
        expect(JSON.stringify(result)).not.toContain(marker);
        expect(result.trace.generation).toMatchObject({ httpStatus: 500, state: "failed" });
        expect(result.trace.generation!.responseHash).toMatch(/^[a-f0-9]{64}$/);
        expect(test.state.reserved).toBe(1);
    });
});
