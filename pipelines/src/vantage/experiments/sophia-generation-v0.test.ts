import { describe, expect, it, vi } from "vitest";
import { coerceMessageLikeToMessage } from "@langchain/core/messages";
import type { ResolvedChatModel } from "@launchstack/llm";
import { structuredSchemaInstruction, StructuredAttemptSetupError } from "@launchstack/llm";
import examples from "../../../../docs/design/examples/weekly-decision-agenda-v1.json";
import fixture from "../../../../fixtures/vantage-context-v0/normal.json";
import { createFixtureV0Ports, type FixtureV0Input } from "../context-v0/mocks";
import { runContextV0Pipeline } from "../context-v0/adapters";
import type { ContextGenerationEnvelopeV0 } from "../context-v0/ports";
import { contextSourceKeyV0 } from "../proposals/context-v0";
import type { GenerationInput, GenerationRuntime } from "../contract-v1";
import { GENERATION_BUDGETS, GenerationOutputSchema } from "../generation-v1";
import {
    createSophiaContextGenerationExperimentV0,
    type SophiaCompoundOutputSchemaV0,
    SOPHIA_EXPERIMENT_MAX_PROMPT_BYTES,
} from "./sophia-generation-v0";

type Invoke = NonNullable<Parameters<typeof createSophiaContextGenerationExperimentV0>[0]>;
const model = {
    modelId: "synthetic-paired-context-model",
    behavior: { parameters: { systemMessages: "supported" } },
    prepareMessages: (messages: Parameters<ResolvedChatModel["prepareMessages"]>[0]) =>
        messages.map(coerceMessageLikeToMessage),
} as unknown as ResolvedChatModel;
const runtime = (
    resolveModel: GenerationRuntime["resolveModel"] = () => model
): GenerationRuntime => ({
    resolveModel,
    signal: new AbortController().signal,
    budgets: GENERATION_BUDGETS,
});

async function envelope(
    options: { companyExcerpt?: string; weeklyExcerpt?: string } = {}
): Promise<ContextGenerationEnvelopeV0> {
    const data = structuredClone(fixture) as unknown as FixtureV0Input;
    for (const entry of data.retrievalInput.sourceCatalog) {
        if (options.companyExcerpt && entry.source.kind === "company")
            entry.excerpt = options.companyExcerpt;
        if (options.weeklyExcerpt && entry.source.id === "doc-weekly-plan")
            entry.excerpt = options.weeklyExcerpt;
    }
    if (options.companyExcerpt)
        data.requiredBundle.companyArchitecture.excerpt = options.companyExcerpt;
    if (options.weeklyExcerpt)
        data.requiredBundle.workspaceMandatoryDocuments[0]!.excerpt = options.weeklyExcerpt;
    for (const entry of data.manifest.sourceRegistry) {
        if (options.companyExcerpt && entry.source.kind === "company")
            entry.excerpt = options.companyExcerpt;
        if (options.weeklyExcerpt && entry.source.id === "doc-weekly-plan")
            entry.excerpt = options.weeklyExcerpt;
    }
    const window = data.retrievalBundle.reportWindow;
    const built = await runContextV0Pipeline(
        {
            principalRef: data.requiredBundle.actor.principalRef,
            companyId: data.requiredBundle.actor.companyId,
            reportWindow: window,
            budgets: {
                maxSources: 20,
                maxQueries: 2,
                maxExcerptChars: 200000,
                maxTokens: 200000,
                timeoutMs: 5000,
            },
            runId: "paired-context-unit",
            inputVersion: "paired-input-unit",
        },
        createFixtureV0Ports(data)
    );
    const input = structuredClone(examples.internal.input) as GenerationInput;
    input.runId = built.manifest.runId;
    input.inputVersion = built.manifest.inputVersion;
    input.reportPeriod = { ...input.reportPeriod, ...window, kind: "completed-week" };
    return {
        v1Input: input,
        manifest: built.manifest,
        evidenceSnapshot: built.evidenceSnapshot,
        freeze: built.freeze,
    };
}
function topic(refs = ["company:architecture-tilde@company-v3", "doc:doc-weekly-plan@doc-v7"]) {
    return {
        title: "Clarify the supplied planning constraints",
        facts: [
            {
                text: "The authorized architecture and planning excerpts supply context with unknowns marked.",
                refs,
            },
        ],
        whyItMatters:
            "The supplied constraints can guide a small decision while their implementation remains unverified.",
        decisionQuestion: "Which constraint should guide the next small verification?",
        proposedNextStep:
            "Compare one proposed check with the supplied planning constraints and record any mismatch before choosing it.",
        proposedOwner: null,
        proposedDueInDays: null,
        helpRequested: null,
        unknowns: ["The excerpts do not establish completion of any proposed work."],
        conflicts: [],
        rationale: "The question uses the actual authorized context.",
    };
}
function pair() {
    const native = topic(["ev:ev-demo-1"]);
    native.title = "Native paired B observation";
    native.facts = [
        { text: "The tester could not find the create-project action.", refs: ["ev:ev-demo-1"] },
    ];
    return {
        native: {
            summary: "Native B reports the supplied onboarding observation.",
            topics: [native],
            enhancements: [],
        },
        experimental: {
            summary:
                "Context B connects the supplied architecture and planning excerpts while preserving their unknowns.",
            topics: [topic()],
            enhancements: [],
        },
    };
}
const response = (value = pair()) => ({
    result: value,
    usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
});
const run = (invoke: ReturnType<typeof vi.fn>) =>
    createSophiaContextGenerationExperimentV0(invoke as Invoke);

describe("opt-in paired Sophia context model experiment", () => {
    it("sends actual frozen context and produces both B reports in one invocation without fake v1 IDs", async () => {
        const input = await envelope(),
            before = structuredClone(input);
        const invoke = vi.fn().mockResolvedValue(response());
        const output = await run(invoke)(input, runtime());
        expect(invoke).toHaveBeenCalledTimes(1);
        const schema = invoke.mock.calls[0]![1] as typeof SophiaCompoundOutputSchemaV0;
        expect(schema.shape.native).toBe(GenerationOutputSchema);
        expect(schema.shape.experimental).toBe(GenerationOutputSchema);
        expect(structuredSchemaInstruction(schema)).toContain('"$ref"');
        const prompt = JSON.stringify(invoke.mock.calls[0]![2]);
        expect(prompt).toContain("Reviewed architecture with unknowns marked.");
        expect(prompt).toContain("Mandatory weekly planning constraints.");
        expect(prompt).toContain("founder");
        expect(prompt).toContain("unreviewed contextual claims");
        expect(prompt).toContain("host-authorized exact versioned document excerpts");
        const contextMessage = invoke.mock.calls[0]![2].at(-1) as { content: string };
        const context = JSON.parse(contextMessage.content).context;
        expect(context.checkedRefs).toEqual(
            input.manifest.coverage.checked.map(contextSourceKeyV0)
        );
        expect(context).not.toHaveProperty("requiredRefs");
        expect(invoke.mock.calls[0]![3]).toMatchObject({ maxOutputTokens: 2400, timeoutMs: 20000 });
        expect(output.generated.contextMode).toBe("aware-v0");
        expect(output.generated.v1Result.draft.summary).toBe(pair().native.summary);
        expect(output.report.summary).toBe(pair().experimental.summary);
        expect(output.generated.v1Result.draft.topics[0]!.facts[0]!.refs[0]!.ref).toBe(
            "ev:ev-demo-1"
        );
        expect(output.report.topics[0]!.facts[0]!.refs).toEqual([
            { kind: "company", id: "architecture-tilde", version: "company-v3" },
            { kind: "doc", id: "doc-weekly-plan", version: "doc-v7" },
        ]);
        expect(output.generated.citationRefs).toEqual(output.report.topics[0]!.facts[0]!.refs);
        expect(output.diagnostics).toMatchObject({
            providerAttempts: 1,
            generationAttempts: 1,
            modelId: model.modelId,
            usage: { totalTokens: 140 },
        });
        expect(output.diagnostics.promptBytes).toBeLessThanOrEqual(
            SOPHIA_EXPERIMENT_MAX_PROMPT_BYTES
        );
        expect(input).toEqual(before);
    });
    it("repairs invalid exact-version citations inside the existing second attempt and clears rejected refs", async () => {
        const invalid = pair();
        invalid.experimental.topics[0]!.facts[0]!.refs = ["doc:doc-weekly-plan@wrong-version"];
        const invoke = vi
            .fn()
            .mockResolvedValueOnce(response(invalid))
            .mockResolvedValueOnce(response());
        const output = await run(invoke)(await envelope(), runtime());
        expect(invoke).toHaveBeenCalledTimes(2);
        expect(JSON.stringify(invoke.mock.calls[1]![2])).toContain("previous attempt was invalid");
        expect(output.diagnostics).toMatchObject({
            providerAttempts: 2,
            generationAttempts: 2,
            usage: { totalTokens: 280 },
        });
        expect(JSON.stringify(output.generated.citationRefs)).not.toContain("wrong-version");
    });
    it.each(["doc:doc-weekly-plan", "doc:invented@v1", "ev:doc-weekly-plan@doc-v7"])(
        "does not label two invalid %s attempts as context-aware Rules output",
        async ref => {
            const invalid = pair();
            invalid.experimental.topics[0]!.facts[0]!.refs = [ref];
            const invoke = vi.fn().mockResolvedValue(response(invalid));
            await expect(run(invoke)(await envelope(), runtime())).rejects.toMatchObject({
                code: "context_model_not_successful",
                execution: { mode: "rules", fallbackReason: "invalid-output", attempts: 2 },
            });
            expect(invoke).toHaveBeenCalledTimes(2);
        }
    );
    it("rejects an over-budget full required context before an actual provider invocation", async () => {
        const input = await envelope({
            companyExcerpt: "Required authorized company context. ".repeat(320),
        });
        const invoke = vi.fn().mockResolvedValue(response());
        await expect(run(invoke)(input, runtime())).rejects.toBeInstanceOf(
            StructuredAttemptSetupError
        );
        expect(invoke).not.toHaveBeenCalled();
    });
    it.each(["no-model", "rules", "empty"])(
        "keeps %s generation honest rather than claiming the model consumed V0",
        async kind => {
            const input = await envelope();
            if (kind === "rules") input.v1Input.generationMode = "rules";
            if (kind === "empty")
                input.v1Input.data = {
                    metricDefinitions: [],
                    currentEvidence: [],
                    currentObservations: [],
                    comparisonObservations: [],
                    carryForwardCommitments: [],
                    resolvedCommitments: [],
                };
            const invoke = vi.fn().mockResolvedValue(response());
            await expect(
                run(invoke)(
                    input,
                    runtime(() => (kind === "no-model" ? null : model))
                )
            ).rejects.toMatchObject({
                code: "context_model_not_successful",
                execution: { mode: "rules", attempts: 0 },
            });
            expect(invoke).not.toHaveBeenCalled();
        }
    );
    it("rejects event-state strengthening in the experimental summary inside the repair path", async () => {
        const input = await envelope({
            weeklyExcerpt:
                "The customer requested moving the pilot start from November 20 to November 27.",
        });
        const invalid = pair();
        invalid.experimental.summary =
            "The customer moved the pilot start from November 20 to November 27.";
        const valid = pair();
        valid.experimental.summary =
            "The customer requested moving the pilot start from November 20 to November 27; agreement is not established.";
        const invoke = vi
            .fn()
            .mockResolvedValueOnce(response(invalid))
            .mockResolvedValueOnce(response(valid));
        const output = await run(invoke)(input, runtime());
        expect(invoke).toHaveBeenCalledTimes(2);
        expect(output.report.summary).toContain("requested moving");
    });
    it("checks a native-only request when the sidecar summarizes both supplied source collections", async () => {
        const input = await envelope();
        input.v1Input.data.currentEvidence[0]!.body =
            "The customer requested moving the pilot start from November 20 to November 27.";
        const invalid = pair(),
            valid = pair();
        for (const value of [invalid, valid]) {
            value.native.summary =
                "The current note reports a request to move the pilot start; agreement remains unverified.";
            value.native.topics[0]!.facts[0]!.text = input.v1Input.data.currentEvidence[0]!.body;
        }
        invalid.experimental.summary =
            "The customer moved the pilot start from November 20 to November 27.";
        valid.experimental.summary =
            "The customer requested moving the pilot start from November 20 to November 27; confirmation remains unavailable.";
        const invoke = vi
            .fn()
            .mockResolvedValueOnce(response(invalid))
            .mockResolvedValueOnce(response(valid));
        const output = await run(invoke)(input, runtime());
        expect(invoke).toHaveBeenCalledTimes(2);
        expect(output.report.summary).toContain("requested moving");
    });
    it.each(["native-topic-limit", "sidecar-topic-limit", "owner", "due", "enhancement"])(
        "enforces %s within the paired response budget",
        async kind => {
            const invalid = pair();
            if (kind === "native-topic-limit")
                invalid.native.topics.push(structuredClone(invalid.native.topics[0]!));
            if (kind === "sidecar-topic-limit")
                invalid.experimental.topics = Array.from({ length: 4 }, () => topic());
            if (kind === "owner")
                (invalid.experimental.topics[0] as { proposedOwner: string | null }).proposedOwner =
                    "Invented owner";
            if (kind === "due")
                (
                    invalid.experimental.topics[0] as { proposedDueInDays: number | null }
                ).proposedDueInDays = 7;
            if (kind === "enhancement")
                (invalid.experimental.enhancements as unknown[]) = [
                    {
                        topicId: "unknown",
                        baseTopicVersion: 1,
                        kind: "question",
                        text: "New question",
                        refs: ["doc:doc-weekly-plan@doc-v7"],
                        rationale: "Not permitted in this paired experiment",
                    },
                ];
            const invoke = vi.fn().mockResolvedValue(response(invalid));
            await expect(run(invoke)(await envelope(), runtime())).rejects.toMatchObject({
                code: "context_model_not_successful",
            });
            expect(invoke).toHaveBeenCalledTimes(2);
        }
    );
    it("keeps historical pending questions separate from current V0 work-state evidence", async () => {
        const input = await envelope();
        input.v1Input.pendingHistoricalQuestions = {
            contractVersion: "pending-historical-questions/v1",
            trust: "historical-human-records",
            snapshotVersion: "synthetic-history",
            unavailableCount: 0,
            questions: [
                {
                    questionId: "past-question",
                    originTopicId: "past-question",
                    originReportId: "past-report",
                    originWeekStart: "2026-10-05",
                    originGeneratedAt: "2026-10-09T16:00:00Z",
                    title: "Deletion check",
                    question: "What result will justify pilot access?",
                    origin: "ai",
                    humanReview: {
                        kind: "recorded-decision",
                        contentVersion: 2,
                        status: "kept",
                        decision: "Obtain the result before access",
                        decidedAt: "2026-10-09T16:00:00Z",
                    },
                    suggestedDue: "2026-10-10",
                    sourceRefs: [],
                },
            ],
        };
        const invoke = vi.fn().mockResolvedValue(response());
        await run(invoke)(input, runtime());
        const messages = invoke.mock.calls[0]![2] as { content: string }[];
        expect(JSON.stringify(messages)).toContain("missing feedback does not prove");
        const context = JSON.parse(messages.at(-1)!.content).context;
        expect(
            context.sources.some((source: { ref: string }) => source.ref.includes("past-question"))
        ).toBe(false);
        expect(JSON.stringify(context)).not.toContain("Obtain the result before access");
    });
});
