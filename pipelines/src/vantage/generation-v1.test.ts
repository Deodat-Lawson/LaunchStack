import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { ResolvedChatModel } from "@launchstack/llm";
import type { GenerationInput, GenerationRuntime } from "./contract-v1";
import {
    createGenerationPort,
    GENERATION_BUDGETS,
    generationPrompt,
    GenerationOutputSchema,
} from "./generation-v1";
import { computeGenerationSignals, eligibleInput, selectGenerationEvidence } from "./evidence-v1";

const examples = JSON.parse(
    readFileSync(
        new URL("../../../docs/design/examples/weekly-decision-agenda-v1.json", import.meta.url),
        "utf8"
    )
).internal;
const fixture = (key = "input"): GenerationInput => structuredClone(examples[key]);
const model = { modelId: "synthetic-model", route: "default" } as ResolvedChatModel;
const runtime = (
    resolveModel = vi.fn(() => model),
    signal = new AbortController().signal
): GenerationRuntime => ({ resolveModel, signal, budgets: GENERATION_BUDGETS });
function output() {
    const t = structuredClone(examples.success.draft.topics[0]);
    delete t.proposedDue;
    t.proposedDueInDays = 7;
    t.facts = t.facts.map((f: { text: string; refs: { ref: string }[] }) => ({
        text: f.text,
        refs: f.refs.map(r => r.ref),
    }));
    return { summary: examples.success.draft.summary, topics: [t], enhancements: [] };
}
function success(value = output()) {
    return { result: value, usage: { inputTokens: 100, outputTokens: 30, totalTokens: 130 } };
}
function port(fn: ReturnType<typeof vi.fn>) {
    return createGenerationPort(fn as Parameters<typeof createGenerationPort>[0]);
}
afterEach(() => vi.useRealTimers());

describe("v1 generation examples and source boundary", () => {
    it("generates the normal fixture with one observed invocation and canonical refs", async () => {
        const invoke = vi.fn().mockResolvedValue(success());
        const r = await port(invoke)(fixture(), runtime());
        expect(r.runId).toBe(examples.input.runId);
        expect(r.inputVersion).toBe(examples.input.inputVersion);
        expect(r.execution).toMatchObject({
            outcome: "generated",
            mode: "ai",
            attempts: 1,
            fallbackReason: null,
            modelId: "synthetic-model",
        });
        expect(r.draft.topics[0]?.facts).toEqual(examples.success.draft.topics[0].facts);
        expect(r.draft.topics[0]?.proposedDue).toBe("2026-10-24");
        expect(r.signals.metricChanges[0]).toMatchObject({
            delta: 20,
            pct: 0.2,
            direction: "up",
            notable: true,
        });
        expect(r.draft.modelMetadata.usage).toEqual({
            inputTokens: 100,
            outputTokens: 30,
            totalTokens: 130,
            reasoningTokens: undefined,
        });
        expect(invoke.mock.calls[0]![3]).toMatchObject({ timeoutMs: 20000, maxOutputTokens: 2400 });
    });
    it("explicit rules and empty input never resolve or invoke a model", async () => {
        const invoke = vi.fn(),
            resolve = vi.fn(() => model);
        const input = fixture();
        input.generationMode = "rules";
        const a = await port(invoke)(input, runtime(resolve));
        const b = await port(invoke)(fixture("emptyInput"), runtime(resolve));
        expect(a.execution).toMatchObject({ mode: "rules", attempts: 0, fallbackReason: null });
        expect(b.execution).toMatchObject({
            outcome: "empty",
            mode: "rules",
            attempts: 0,
            fallbackReason: null,
        });
        expect(b.draft.topics).toEqual([]);
        expect(b.enhancements).toEqual([]);
        expect(resolve).not.toHaveBeenCalled();
        expect(invoke).not.toHaveBeenCalled();
    });
    it("missing or throwing model resolution is an honest no-model fallback", async () => {
        for (const resolve of [
            () => null,
            () => {
                throw new Error("secret configuration");
            },
        ]) {
            const r = await createGenerationPort()(fixture(), {
                ...runtime(),
                resolveModel: resolve,
            });
            expect(r.execution).toMatchObject({
                mode: "rules",
                attempts: 0,
                fallbackReason: "no-model",
                modelId: null,
            });
            expect(JSON.stringify(r)).not.toContain("secret configuration");
        }
    });
    it("rules are deterministic, source-linked and independent of the wall clock", async () => {
        const input = fixture();
        input.generationMode = "rules";
        const a = await createGenerationPort()(input, runtime());
        const b = await createGenerationPort()(input, runtime());
        expect(a.draft).toEqual(b.draft);
        expect(a.signals).toEqual(b.signals);
        expect(a.draft.topics.length).toBeGreaterThan(0);
        expect(a.draft.topics.every(t => t.facts.every(f => f.refs.length > 0))).toBe(true);
        expect(JSON.stringify(a)).not.toContain("larger than noise");
    });
    it("keeps thin evidence useful without padding topics or making statistical claims", async () => {
        const input = fixture();
        input.generationMode = "rules";
        input.data.currentObservations = [];
        input.data.comparisonObservations = [];
        const r = await createGenerationPort()(input, runtime());
        expect(r.draft.topics).toHaveLength(1);
        expect(r.signals.metricsWithoutData).toHaveLength(1);
        expect(r.draft.topics[0]?.unknowns[0]).toContain("does not establish prevalence");
    });
    it("cannot access outside input, fetch source URLs, or put runtime secrets in prompts", async () => {
        const input = fixture();
        input.data.currentEvidence[0]!.sourceUrl = "https://example.invalid/do-not-fetch";
        const invoke = vi.fn().mockResolvedValue(success());
        await port(invoke)(input, runtime());
        const prompt = JSON.stringify(invoke.mock.calls[0]![2]);
        expect(prompt).not.toContain("do-not-fetch");
        expect(prompt).not.toContain("resolveModel");
        expect(prompt).toContain("untrusted data");
        expect(prompt).toContain("comparison context only");
    });
    it.each([
        "unknown-fact",
        "mixed-ref",
        "unknown-conflict",
        "uncited",
        "extra-sharing",
        "wrong-version",
        "wrong-target",
    ])("rejects %s model output within two attempts", async kind => {
        const raw = output();
        if (kind === "unknown-fact") raw.topics[0].facts[0].refs = ["ev:invented"];
        if (kind === "mixed-ref") raw.topics[0].facts[0].refs.push("ev:invented");
        if (kind === "unknown-conflict")
            raw.topics[0].conflicts = [{ text: "Conflict", refs: ["obs:invented"] }];
        if (kind === "uncited") raw.topics[0].facts[0].refs = [];
        if (kind === "extra-sharing") raw.topics[0].shared = true;
        const data: unknown = kind.startsWith("wrong")
            ? {
                  ...raw,
                  enhancements: [
                      {
                          topicId: kind === "wrong-target" ? "someone-else" : "topic-demo-1",
                          baseTopicVersion: kind === "wrong-version" ? 99 : 2,
                          kind: "question",
                          text: "Test navigation?",
                          refs: ["ev:ev-demo-1"],
                          rationale: "Based on the interview.",
                      },
                  ],
              }
            : raw;
        const invoke = vi.fn().mockResolvedValue({ result: data, usage: {} });
        const r = await port(invoke)(fixture("enrichmentInput"), runtime());
        expect(r.execution).toMatchObject({
            mode: "rules",
            fallbackReason: "invalid-output",
            attempts: 2,
        });
        expect(invoke).toHaveBeenCalledTimes(2);
    });
    it("repairs invalid output once and records both attempts", async () => {
        const invoke = vi
            .fn()
            .mockResolvedValueOnce({ result: {}, usage: {} })
            .mockResolvedValueOnce(success());
        const r = await port(invoke)(fixture(), runtime());
        expect(r.execution).toMatchObject({ mode: "ai", attempts: 2, fallbackReason: null });
        expect(JSON.stringify(invoke.mock.calls[1]![2])).toContain("previous attempt was invalid");
    });
});

describe("protected human content", () => {
    it.each(["kept", "dismissed", "decided", "suggested"])(
        "preserves %s topics, text, decisions, refs and action links",
        async status => {
            const input = fixture("enrichmentInput");
            Object.assign(input.reviewedTopics[0]!.topic, {
                status,
                origin: "founder",
                decision: "Human decision",
                commitmentId: "human-action",
            });
            const before = structuredClone(input);
            const invoke = vi.fn().mockResolvedValue(success());
            const r = await port(invoke)(input, runtime());
            expect(input).toEqual(before);
            expect(r.draft.topics).toEqual([]);
            expect(r.enhancements).toEqual([]); // Identical reviewed content adds nothing new.
            expect(JSON.stringify(r)).not.toContain("human-action");
        }
    );
    it("accepts explicit source-linked enrichment and retains its exact version", async () => {
        const e = structuredClone(examples.enrichment.enhancements[0]);
        e.refs = e.refs.map((r: { ref: string }) => r.ref);
        const invoke = vi.fn().mockResolvedValue({
            result: {
                summary: "A question for separate review.",
                topics: [],
                enhancements: [e],
            },
            usage: {},
        });
        const r = await port(invoke)(fixture("enrichmentInput"), runtime());
        expect(r.enhancements).toEqual(examples.enrichment.enhancements);
    });
    it("rules also route overlapping sources to enhancements", async () => {
        const input = fixture("enrichmentInput");
        input.generationMode = "rules";
        const r = await createGenerationPort()(input, runtime());
        expect(r.enhancements).toHaveLength(1);
        expect(
            r.draft.topics.every(
                t => !t.facts.some(f => f.refs.some(r => r.ref === "ev:ev-demo-1"))
            )
        ).toBe(true);
    });
});

describe("reporting signals and bounded evidence", () => {
    it("filters stale/future rows before signals, selection and prompts", () => {
        const input = fixture(),
            ev = input.data.currentEvidence[0]!;
        input.data.currentEvidence.push(
            { ...ev, id: "stale", observedAt: "2026-10-11" },
            { ...ev, id: "future-date", observedAt: "2026-10-18" },
            { ...ev, id: "future-created", createdAt: "2026-10-18T10:00:00Z" },
            { ...ev, id: "exact-end", observedAt: input.reportPeriod.endExclusive },
            { ...ev, id: "before-start", observedAt: "2026-10-12T03:59:59Z" }
        );
        const eligible = eligibleInput(input),
            signals = computeGenerationSignals(eligible);
        expect(signals.newEvidence).toEqual([{ kind: "interview", count: 1 }]);
        expect(signals.recentEvidenceIds).toEqual([ev.id]);
        expect(signals.since).toBe("2026-10-12");
        expect(signals.computedAt).toBe(input.reportPeriod.asOf);
        expect(JSON.stringify(selectGenerationEvidence(eligible, signals))).not.toContain(
            "future-created"
        );
    });
    it("does not compare a partial week with a full week or choose among conflicting prior values", () => {
        const input = fixture();
        input.data.comparisonObservations[0]!.periodEnd = "2026-10-11";
        expect(computeGenerationSignals(input).metricChanges[0]).toMatchObject({
            previous: null,
            delta: null,
            notable: false,
        });
        input.data.comparisonObservations[0]!.periodEnd = "2026-10-10";
        input.data.comparisonObservations.push({
            ...input.data.comparisonObservations[0]!,
            id: "conflict-prior",
            value: 99,
        });
        expect(computeGenerationSignals(input).metricChanges[0]?.previous).toBeNull();
    });
    it("conflicts suppress a claimed trend; zero baseline never produces Infinity", () => {
        const input = fixture();
        input.data.currentObservations.push({
            ...input.data.currentObservations[0]!,
            id: "second",
            value: 90,
        });
        const signals = computeGenerationSignals(input);
        expect(signals.metricConflicts).toHaveLength(1);
        expect(signals.metricChanges[0]?.notable).toBe(false);
        input.data.currentObservations.pop();
        input.data.comparisonObservations[0]!.value = 0;
        expect(computeGenerationSignals(input).metricChanges[0]).toMatchObject({
            delta: 120,
            pct: null,
            direction: "up",
        });
    });
    it("a prior observation alone is context and does not fill missing current data", () => {
        const input = fixture();
        input.data.currentObservations = [];
        const signals = computeGenerationSignals(input);
        expect(signals.metricChanges).toEqual([]);
        expect(signals.metricsWithoutData).toHaveLength(1);
    });
    it("supports New York DST weeks and date-only evidence precision", () => {
        const input = fixture();
        input.reportPeriod = {
            ...input.reportPeriod,
            weekStart: "2026-10-26",
            startInclusive: "2026-10-26T04:00:00Z",
            endExclusive: "2026-11-02T05:00:00Z",
            asOf: "2026-11-02T14:00:00Z",
            kind: "completed-week",
        };
        input.data.currentEvidence[0]!.observedAt = "2026-11-01";
        input.data.currentObservations[0] = {
            ...input.data.currentObservations[0]!,
            periodStart: "2026-10-26",
            periodEnd: "2026-11-01",
        };
        input.data.comparisonObservations[0] = {
            ...input.data.comparisonObservations[0]!,
            periodStart: "2026-10-19",
            periodEnd: "2026-10-25",
        };
        const signals = computeGenerationSignals(eligibleInput(input));
        expect(signals.recentEvidenceIds).toHaveLength(1);
        expect(signals.metricChanges[0]?.delta).toBe(20);
    });
    it("bounds all source kinds, oversized Unicode and reviewed text; records omissions", () => {
        const input = fixture();
        const ev = input.data.currentEvidence[0]!;
        input.data.currentEvidence = Array.from({ length: 200 }, (_, n) => ({
            ...ev,
            id: `e${n}`,
            body: "证据".repeat(2000),
        }));
        const reviewed = fixture("enrichmentInput").reviewedTopics[0]!;
        input.reviewedTopics = Array.from({ length: 100 }, (_, n) => ({
            ...reviewed,
            topic: { ...reviewed.topic, id: `t${n}`, title: "长".repeat(2000) },
        }));
        const signals = computeGenerationSignals(input),
            { pack, selection } = selectGenerationEvidence(input, signals);
        expect(signals.newEvidence[0]?.count).toBe(200);
        expect(pack.items.length).toBeLessThanOrEqual(40);
        expect(selection.evidenceBytes).toBeLessThanOrEqual(14000);
        expect(selection.omittedItems).toBeGreaterThan(0);
        expect(selection.truncatedItems).toBeGreaterThan(0);
        const prompt = generationPrompt(input, pack);
        expect(Buffer.byteLength(prompt.text)).toBeLessThanOrEqual(18000);
        expect(prompt.payload.omissions.reviewedTopics).toBeGreaterThan(0);
        const reversed = structuredClone(input);
        reversed.data.currentEvidence.reverse();
        expect(
            selectGenerationEvidence(reversed, computeGenerationSignals(reversed)).pack.items
        ).toEqual(pack.items);
    });
    it("labels carry-forward and resolved commitments with original dates", async () => {
        const input = fixture();
        input.generationMode = "rules";
        const c = {
            id: "c",
            agendaId: null,
            topicId: null,
            topicTitle: null,
            title: "Test onboarding",
            owner: "Founder",
            dueOn: "2026-10-10",
            test: "Five tests",
            status: "open" as const,
            outcome: null,
            shared: false,
            resolvedAt: null,
            createdAt: "2026-10-05T12:00:00Z",
        };
        input.data.carryForwardCommitments = [c];
        input.data.resolvedCommitments = [
            {
                ...c,
                id: "done",
                status: "done",
                outcome: "4 of 5 completed",
                resolvedAt: "2026-10-16T12:00:00Z",
            },
        ];
        const r = await createGenerationPort()(input, runtime());
        expect(r.signals.overdueCommitmentIds).toEqual(["c"]);
        expect(r.signals.resolvedCommitmentIds).toEqual(["done"]);
        const pack = selectGenerationEvidence(input, r.signals).pack;
        expect(pack.items.find(i => i.ref === "cm:c")?.text).toContain("carry-forward context");
        expect(pack.items.find(i => i.ref === "cm:c")?.date).toBe("2026-10-10");
    });
});

describe("attempt budgets, retry, cancellation and late output", () => {
    it.each([401, 403, 400])(
        "does not retry non-transient HTTP %s errors or leak bodies",
        async status => {
            const invoke = vi
                .fn()
                .mockRejectedValue(Object.assign(new Error("PRIVATE BODY API_KEY"), { status }));
            const r = await port(invoke)(fixture(), runtime());
            expect(r.execution).toMatchObject({
                mode: "rules",
                fallbackReason: "provider-error",
                attempts: 1,
            });
            expect(invoke).toHaveBeenCalledTimes(1);
            expect(JSON.stringify(r)).not.toContain("PRIVATE BODY");
        }
    );
    it.each([429, 500, 503])("waits one second before retrying transient HTTP %s", async status => {
        vi.useFakeTimers();
        const invoke = vi.fn().mockRejectedValueOnce({ status }).mockResolvedValueOnce(success());
        const promise = port(invoke)(fixture(), runtime());
        await vi.advanceTimersByTimeAsync(999);
        expect(invoke).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect((await promise).execution).toMatchObject({ mode: "ai", attempts: 2 });
    });
    it("aborts each 20-second attempt and returns forced timeout fallback by 41 seconds", async () => {
        vi.useFakeTimers();
        const signals: AbortSignal[] = [];
        const invoke = vi.fn((_m, _s, _p, opts) => {
            signals.push(opts.signal);
            return new Promise(() => {});
        });
        const promise = port(invoke)(fixture(), runtime());
        await vi.advanceTimersByTimeAsync(41000);
        const r = await promise;
        expect(r.execution).toMatchObject({
            mode: "rules",
            fallbackReason: "timeout",
            attempts: 2,
        });
        expect(signals).toHaveLength(2);
        expect(signals.every(s => s.aborted)).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });
    it("cancels in-flight work without returning a saveable fallback or late model output", async () => {
        const controller = new AbortController();
        let finish: ((x: ReturnType<typeof success>) => void) | undefined;
        const invoke = vi.fn(
            () =>
                new Promise(resolve => {
                    finish = resolve;
                })
        );
        const promise = port(invoke)(
            fixture(),
            runtime(
                vi.fn(() => model),
                controller.signal
            )
        );
        const rejection = expect(promise).rejects.toThrow("cancelled");
        controller.abort();
        await rejection;
        finish?.(success());
        await Promise.resolve();
        expect(invoke).toHaveBeenCalledTimes(1);
    });
    it("cancels during retry wait and before any work", async () => {
        vi.useFakeTimers();
        const controller = new AbortController(),
            invoke = vi.fn().mockRejectedValue({ status: 503 });
        const promise = port(invoke)(
            fixture(),
            runtime(
                vi.fn(() => model),
                controller.signal
            )
        );
        const rejection = expect(promise).rejects.toThrow("cancelled");
        await vi.advanceTimersByTimeAsync(1);
        controller.abort();
        await rejection;
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
        await expect(
            port(invoke)(
                fixture(),
                runtime(
                    vi.fn(() => model),
                    controller.signal
                )
            )
        ).rejects.toThrow("cancelled");
        expect(invoke).toHaveBeenCalledTimes(1);
    });
    it("uses strict schemas without changing the public contract", () => {
        expect(GenerationOutputSchema.safeParse(output()).success).toBe(true);
    });
});

describe("total deadline and defensive output", () => {
    it("reserves fallback time when model resolution consumes part of the total budget", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
        const invoke = vi.fn(() => new Promise(() => {}));
        const resolve = vi.fn(() => {
            vi.advanceTimersByTime(10000);
            return model;
        });
        const pending = port(invoke)(fixture(), runtime(resolve));
        await vi.advanceTimersByTimeAsync(34000);
        const result = await pending;
        expect(result.execution).toMatchObject({
            mode: "rules",
            attempts: 2,
            fallbackReason: "timeout",
            durationMs: 44000,
        });
        expect(invoke.mock.calls).toHaveLength(2);
        expect(vi.getTimerCount()).toBe(0);
    });
    it("discards late success after an attempt has timed out", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
        let late: ((value: ReturnType<typeof success>) => void) | undefined;
        const invoke = vi
            .fn()
            .mockImplementationOnce(
                () =>
                    new Promise(resolve => {
                        late = resolve;
                    })
            )
            .mockRejectedValueOnce({ status: 401 });
        const pending = port(invoke)(fixture(), runtime());
        await vi.advanceTimersByTimeAsync(21000);
        const result = await pending;
        expect(result.execution).toMatchObject({
            mode: "rules",
            attempts: 2,
            fallbackReason: "provider-error",
        });
        late?.(success());
        await Promise.resolve();
        expect(result.draft.origin).toBe("rules");
    });
    it("only allows citations actually sent to the model, even when another input item exists", async () => {
        const input = fixture();
        input.data.currentEvidence = Array.from({ length: 100 }, (_, n) => ({
            ...input.data.currentEvidence[0]!,
            id: `e${n}`,
            body: "Evidence ".repeat(400),
        }));
        const { pack } = selectGenerationEvidence(input, computeGenerationSignals(input));
        const selected = new Set(pack.items.map(i => i.ref));
        const omitted = input.data.currentEvidence.find(e => !selected.has(`ev:${e.id}`))!;
        const raw = output();
        raw.topics[0].facts[0].refs = [`ev:${omitted.id}`];
        const invoke = vi.fn().mockResolvedValue(success(raw));
        const result = await port(invoke)(input, runtime());
        expect(result.execution).toMatchObject({ fallbackReason: "invalid-output", mode: "rules" });
    });
    it("does not invent owners or help requests from model output", async () => {
        const raw = output();
        raw.topics[0].proposedOwner = "Invented person";
        raw.topics[0].helpRequested = "Email all mentors";
        const result = await port(vi.fn().mockResolvedValue(success(raw)))(fixture(), runtime());
        expect(result.draft.topics[0]).toMatchObject({ proposedOwner: null, helpRequested: null });
    });
});

describe("complete model path with in-memory HTTP fixture", () => {
    it("runs the real shared SDK adapter, schema validation, refs and metadata together", async () => {
        const { resolveChatModel, buildChatModelsConfig } = await import("@launchstack/llm");
        const config = buildChatModelsConfig({
            endpoint: { baseUrl: "https://synthetic.invalid/v1", apiKey: "synthetic-only" },
            file: {
                version: 1,
                models: { test: { id: "test-model", preset: "openai/gpt-4o" } },
                routes: { default: "test" },
            },
        });
        const configured = resolveChatModel({ config });
        const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
            async () =>
                new Response(
                    JSON.stringify({
                        id: "synthetic",
                        object: "chat.completion",
                        created: 0,
                        model: "test-model",
                        choices: [
                            {
                                index: 0,
                                message: { role: "assistant", content: JSON.stringify(output()) },
                                finish_reason: "stop",
                            },
                        ],
                    }),
                    { status: 200, headers: { "Content-Type": "application/json" } }
                )
        );
        configured.chat.lc_kwargs.configuration = { baseURL: config.endpoint.baseUrl, fetch };
        const result = await createGenerationPort()(fixture(), {
            ...runtime(),
            resolveModel: () => configured,
        });
        expect(result.execution).toMatchObject({ mode: "ai", modelId: "test-model", attempts: 1 });
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(result.draft.topics[0]?.facts).toEqual(examples.success.draft.topics[0].facts);
        const bodyText = fetch.mock.calls[0]![1]?.body;
        if (typeof bodyText !== "string") throw new Error("Expected a serialized request body.");
        const body = JSON.parse(bodyText);
        expect(body.max_tokens).toBe(2400);
    });
});

describe("weekly summary usefulness", () => {
    it("connects selected measurements and feedback with a specific suggested focus", async () => {
        const input = fixture();
        input.generationMode = "rules";
        const result = await createGenerationPort()(input, runtime());
        expect(result.draft.summary).toContain("120");
        expect(result.draft.summary).toContain("20%");
        expect(result.draft.summary).toContain("create-project");
        expect(result.draft.summary).toContain("Suggested weekly focus:");
        expect(result.draft.summary).toContain("without prompting");
        expect(result.draft.summary).not.toContain("unfinished commitments");
        expect(result.draft.summary.length).toBeLessThanOrEqual(1200);
        expect(new Set(result.draft.topics.map(t => t.proposedNextStep)).size).toBe(2);
    });
    it("does not invent a metric trend from evidence alone", async () => {
        const input = fixture();
        input.generationMode = "rules";
        input.data.currentObservations = [];
        input.data.comparisonObservations = [];
        const result = await createGenerationPort()(input, runtime());
        expect(result.draft.summary).not.toContain("20%");
        expect(result.draft.summary).toContain("does not establish prevalence");
        expect(result.draft.summary).toContain("create-project");
    });
    it("keeps a focus concerning reviewed content separate from existing decisions", async () => {
        const input = fixture("enrichmentInput");
        input.generationMode = "rules";
        const before = structuredClone(input);
        const result = await createGenerationPort()(input, runtime());
        expect(result.draft.summary).toContain("without changing the existing decision");
        expect(input).toEqual(before);
        expect(result.enhancements).toHaveLength(1);
    });
    it("bounds long summaries without including text beyond the source excerpt", async () => {
        const input = fixture();
        input.generationMode = "rules";
        input.data.currentEvidence[0]!.title = "Long source title ".repeat(100);
        input.data.currentEvidence[0]!.body = "Observed detail ".repeat(200) + "UNSELECTED_TAIL";
        const result = await createGenerationPort()(input, runtime());
        expect(result.draft.summary.length).toBeLessThanOrEqual(1200);
        expect(result.draft.summary).not.toContain("UNSELECTED_TAIL");
    });
});

describe("provided evidence in the output", () => {
    it("uses the supplied evidence body and attributes the summary to its source", async () => {
        const input = fixture();
        input.generationMode = "rules";
        input.data.currentObservations = [];
        input.data.comparisonObservations = [];
        const evidence = input.data.currentEvidence[0]!;
        evidence.title = "Export feedback";
        evidence.body = "The tester could not find the download button.";
        evidence.source = "Pilot interview 7";
        const before = structuredClone(input);
        const result = await createGenerationPort()(input, runtime());
        expect(result.draft.summary).toContain("download button");
        expect(result.draft.summary).toContain("[Source: Pilot interview 7]");
        expect(result.draft.summary).not.toContain("create-project");
        expect(result.draft.topics[0]!.facts[0]!.refs).toEqual([
            { ref: `ev:${evidence.id}`, label: evidence.source, date: evidence.observedAt },
        ]);
        expect(input).toEqual(before);
    });
    it("falls back to the evidence title when the source label is absent", async () => {
        const input = fixture();
        input.generationMode = "rules";
        input.data.currentEvidence[0]!.source = null;
        const result = await createGenerationPort()(input, runtime());
        expect(result.draft.summary).toContain("[Source: Onboarding feedback]");
    });
});

describe("specific weekly direction", () => {
    it("leads with the change and proposes a measurable check of the reported obstacle", async () => {
        const input = fixture();
        input.generationMode = "rules";
        const result = await createGenerationPort()(input, runtime());
        expect(result.draft.summary).toMatch(/^Demo signups rose 20%/);
        expect(result.draft.summary).toContain("time taken");
        expect(result.draft.summary).toContain("Why this focus:");
        expect(result.draft.summary).toContain("does not establish a link");
        expect(result.draft.summary).not.toContain("willingness to pay");
        const feedback = result.draft.topics.find(t =>
            t.facts.some(f => f.refs.some(r => r.ref.startsWith("ev:")))
        )!;
        expect(feedback.proposedNextStep).toContain("create-project action");
        expect(feedback.proposedNextStep).toContain("If the same difficulty recurs");
    });
    it("does not invent a navigation task for unrelated feedback", async () => {
        const input = fixture();
        input.generationMode = "rules";
        input.data.currentEvidence[0]!.body = "The tester liked the report colors.";
        const result = await createGenerationPort()(input, runtime());
        expect(result.draft.summary).not.toContain("create-project");
        expect(result.draft.summary).not.toContain("clearer wording");
        expect(result.draft.summary).toContain("report colors");
    });
    it("offers a specific separate idea while preserving the reviewed topic", async () => {
        const input = fixture("enrichmentInput");
        input.generationMode = "rules";
        const before = structuredClone(input);
        const result = await createGenerationPort()(input, runtime());
        expect(result.enhancements[0]).toMatchObject({
            kind: "idea",
            topicId: "topic-demo-1",
            baseTopicVersion: 2,
        });
        expect(result.enhancements[0]!.text).toContain("time taken");
        expect(result.enhancements[0]!.refs[0]!.ref).toBe("ev:ev-demo-1");
        expect(input).toEqual(before);
    });
});
