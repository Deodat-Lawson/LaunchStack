import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { structuredSchemaInstruction, type ResolvedChatModel } from "@launchstack/llm";
import type { AgendaV1Dto, GenerationInput, GenerationRuntime, ReportPeriod } from "./contract-v1";
import {
    createGenerationPort,
    generationPrompt,
    GenerationOutputSchema,
    GENERATION_BUDGETS,
    GENERATION_SYSTEM_PROMPT,
} from "./generation-v1";
import { computeGenerationSignals, eligibleInput, selectGenerationEvidence } from "./evidence-v1";
import {
    assemblePreviousVantageContext,
    type PreviousVantageContext,
    type PreviousVantageSource,
} from "./previous-context-v1";
import type { CommitmentDto, EvidenceDto } from "./types";

interface Scenario {
    id: string;
    description: string;
    title: string | null;
    body: string | null;
    relatedCurrentEvidence: boolean;
    currentActionStatus?: "open";
    topicTitle?: string;
    interpretation?: string;
    proposedNextStep?: string;
    proposedDue?: string;
    decision?: string | null;
    decidedAt?: string | null;
    commitmentId?: string | null;
    historyWeekStart?: string;
    historySummary?: string;
    noHistory?: boolean;
    sourceStatuses?: string[];
    raceVariants?: string[];
    document?: { contentVerification: string };
}
interface TwoWeekFixtures {
    period: ReportPeriod;
    history: {
        id: string;
        weekStart: string;
        generatedAt: string;
        summary: string;
        topicId: string;
        topicTitle: string;
        interpretation: string;
        proposedNextStep: string;
        proposedDue: string;
        sourceRef: string;
        sourceBody: string;
        decision: string;
        decidedAt: string;
        commitmentId: string;
        recordedActionStatus: "open";
    };
    scenarios: Scenario[];
}
const fixtures = JSON.parse(
    readFileSync(
        new URL("../../../fixtures/vantage-previous-context/two-week.json", import.meta.url),
        "utf8"
    )
) as TwoWeekFixtures;
const scenario = (id: string) => fixtures.scenarios.find(s => s.id === id)!;
const action = (): CommitmentDto => ({
    id: fixtures.history.commitmentId,
    agendaId: fixtures.history.id,
    topicId: fixtures.history.topicId,
    topicTitle: fixtures.history.topicTitle,
    title: "Verify invoice export confirmation",
    owner: "Synthetic founder",
    dueOn: fixtures.history.proposedDue,
    test: "Five recorded confirmation checks",
    status: "open",
    outcome: null,
    shared: false,
    resolvedAt: null,
    createdAt: "2026-10-17T16:00:00.000Z",
});
function historicalReport(s: Scenario): AgendaV1Dto {
    const h = fixtures.history;
    const weekStart = s.historyWeekStart ?? h.weekStart;
    const decision = s.decision === undefined ? h.decision : s.decision;
    const commitmentId = s.commitmentId === undefined ? h.commitmentId : s.commitmentId;
    return {
        id: h.id,
        weekStart,
        weekEnd: weekStart === h.weekStart ? "2026-10-18" : "2026-10-25",
        status: "draft",
        summary: s.historySummary ?? h.summary,
        signals: null,
        modelMetadata: { mode: "ai", promptVersion: "synthetic-history" },
        generatedAt: h.generatedAt,
        heldAt: null,
        createdAt: "2026-10-17T14:00:00.000Z",
        topics: [
            {
                id: h.topicId,
                agendaId: h.id,
                position: 0,
                contentVersion: 2,
                status: "kept",
                origin: "ai",
                title: s.topicTitle ?? h.topicTitle,
                facts: [
                    {
                        text: h.sourceBody,
                        refs: [
                            {
                                ref: h.sourceRef,
                                label: "Synthetic previous-week note",
                                date: "2026-10-16",
                            },
                        ],
                    },
                ],
                whyItMatters: s.interpretation ?? h.interpretation,
                decisionQuestion: "What does invoice export confirmation require us to clarify?",
                proposedNextStep: s.proposedNextStep ?? h.proposedNextStep,
                proposedOwner: null,
                proposedDue: s.proposedDue ?? h.proposedDue,
                helpRequested: null,
                unknowns: ["Whether the earlier interpretation is correct."],
                conflicts: [],
                rationale: "Historical AI proposal, not current evidence.",
                shared: false,
                decision,
                decidedAt: s.decidedAt === undefined ? h.decidedAt : s.decidedAt,
                commitmentId,
            },
        ],
        reportPeriod: {
            weekStart,
            timeZone: "America/New_York",
            startInclusive: weekStart + "T04:00:00.000Z",
            endExclusive:
                weekStart === h.weekStart ? "2026-10-19T04:00:00.000Z" : "2026-10-26T04:00:00.000Z",
            asOf: h.generatedAt,
            kind: "completed-week",
        },
        version: 3,
        enhancements: [],
        execution: null,
    };
}
const availableSource = (): PreviousVantageSource => ({
    ref: fixtures.history.sourceRef,
    status: "available",
    documentVerification: "not-applicable",
});
function context(s: Scenario): PreviousVantageContext | null {
    return assemblePreviousVantageContext({
        currentPeriod: fixtures.period,
        report: s.noHistory ? null : historicalReport(s),
        actions: s.commitmentId === null ? [] : [action()],
        sourceStates: [availableSource()],
    });
}
function inputFor(s: Scenario): GenerationInput {
    const evidence: EvidenceDto[] =
        s.title && s.body
            ? [
                  {
                      id: "ev-current-" + s.id,
                      kind: s.document ? "document" : "note",
                      title: s.title,
                      body: s.body,
                      source: "Synthetic current-week Vantage note",
                      sourceUrl: null,
                      observedAt: "2026-10-23",
                      visibility: "private",
                      tags: ["synthetic", "two-week"],
                      createdAt: "2026-10-23T17:00:00.000Z",
                  },
              ]
            : [];
    return {
        contractVersion: "v1",
        runId: "synthetic-" + s.id,
        inputVersion: "synthetic-input-" + s.id,
        reportPeriod: structuredClone(fixtures.period),
        generationMode: "rules",
        data: {
            metricDefinitions: [],
            currentEvidence: evidence,
            currentObservations: [],
            comparisonObservations: [],
            resolvedCommitments: [],
            carryForwardCommitments: s.currentActionStatus === "open" ? [action()] : [],
        },
        reviewedTopics: [],
        previousVantageContext: context(s),
    };
}
const runtime = (
    resolveModel: GenerationRuntime["resolveModel"] = vi.fn(() => null)
): GenerationRuntime => ({
    resolveModel,
    signal: new AbortController().signal,
    budgets: GENERATION_BUDGETS,
});
const promptFor = (input: GenerationInput) => {
    const eligible = eligibleInput(input);
    const { pack } = selectGenerationEvidence(eligible, computeGenerationSignals(eligible));
    return generationPrompt(eligible, pack);
};
const content = (result: Awaited<ReturnType<ReturnType<typeof createGenerationPort>>>) =>
    JSON.stringify({
        summary: result.draft.summary,
        topics: result.draft.topics,
        enhancements: result.enhancements,
    });

describe("previous Vantage: observed Rules behavior on two-week synthetic sources", () => {
    it.each(fixtures.scenarios.filter(s => s.relatedCurrentEvidence))(
        "$id: current source is the premise; historical work is not recreated",
        async s => {
            const input = inputFor(s);
            const before = JSON.stringify(input);
            const resolve = vi.fn(() => null);
            const result = await createGenerationPort()(input, runtime(resolve));
            expect(JSON.stringify(input)).toBe(before);
            expect(resolve).not.toHaveBeenCalled();
            expect(result.execution).toMatchObject({
                mode: "rules",
                attempts: 0,
                fallbackReason: null,
            });
            const topic = result.draft.topics.find(t =>
                t.facts.some(f => f.refs.some(r => r.ref === "ev:ev-current-" + s.id))
            );
            expect(topic, s.description).toBeDefined();
            expect(topic!.facts[0]!.text).toContain(s.body!.slice(0, 450));
            expect(topic!.facts.flatMap(f => f.refs.map(r => r.ref))).not.toContain(
                fixtures.history.sourceRef
            );
            expect(topic!.proposedNextStep).toBe("");
            expect(topic!.proposedOwner).toBeNull();
            expect(topic!.proposedDue).toBeNull();
            expect(
                [topic!.decisionQuestion, topic!.whyItMatters, topic!.rationale].join(" ")
            ).toMatch(/historical/i);
            expect([topic!.whyItMatters, ...topic!.unknowns].join(" ")).toMatch(/recorded/i);
            expect(content(result)).not.toContain(
                s.proposedNextStep ?? fixtures.history.proposedNextStep
            );
            expect(result.enhancements).toEqual([]);
        }
    );

    it("completion-indicated: preserves explicit acceptance evidence without confirming or updating the old action", async () => {
        const input = inputFor(scenario("completion-indicated"));
        const historicalAction = structuredClone(
            input.previousVantageContext!.topics[0]!.reportedActions[0]!
        );
        const result = await createGenerationPort()(input, runtime());
        expect(result.draft.topics[0]!.facts[0]!.text).toContain(
            "all five synthetic invoice export confirmation checks passed"
        );
        expect(result.draft.topics[0]!.facts[0]!.text).toContain("Before the fix");
        expect(result.draft.topics[0]!.whyItMatters).toMatch(/recorded/i);
        expect(input.previousVantageContext!.topics[0]!.reportedActions[0]).toEqual(
            historicalAction
        );
        expect(historicalAction.status).toBe("open");
    });

    it("shows current reported progress beside an unchanged open record without creating another action", async () => {
        const input = inputFor(scenario("completion-indicated"));
        input.data.carryForwardCommitments = [action()];
        const before = JSON.stringify(input);
        const result = await createGenerationPort()(input, runtime());
        expect(result.draft.topics).toHaveLength(1);
        const currentRecord = result.draft.topics[0]!.facts.find(f =>
            f.refs.some(r => r.ref === "cm:" + fixtures.history.commitmentId)
        );
        expect(currentRecord!.text).toContain("status open");
        expect(currentRecord!.text).toMatch(/reported action state/i);
        expect(result.draft.topics[0]!.proposedNextStep).toBe("");
        expect(JSON.stringify(input)).toBe(before);
    });

    it("distinguishes a supplied current done record from evidence merely indicating completion", async () => {
        const input = inputFor(scenario("completion-indicated"));
        input.data.resolvedCommitments = [
            {
                ...action(),
                status: "done",
                outcome: "The synthetic founder recorded five passing checks.",
                resolvedAt: "2026-10-22T15:00:00.000Z",
            },
        ];
        const before = JSON.stringify(input);
        const result = await createGenerationPort()(input, runtime());
        const recordFacts = result.draft.topics
            .flatMap(t => t.facts)
            .filter(f => f.refs.some(r => r.ref === "cm:" + fixtures.history.commitmentId));
        expect(recordFacts.some(f => f.text.includes("status done"))).toBe(true);
        expect(
            result.draft.topics.every(t => t.proposedNextStep === "" && t.proposedDue === null)
        ).toBe(true);
        expect(JSON.stringify(input)).toBe(before);
    });

    it("an unchanged carry-forward record without fresh evidence does not renew an old recommendation", async () => {
        const input = inputFor(scenario("no-progress-evidence"));
        input.data.carryForwardCommitments = [action()];
        const result = await createGenerationPort()(input, runtime());
        expect(result.draft.topics).toEqual([]);
        expect(result.enhancements).toEqual([]);
        expect(result.draft.summary).toMatch(/progress|unknown|neither completion nor failure/i);
        expect(content(result)).not.toContain(fixtures.history.proposedNextStep);
    });

    it("no-progress-evidence: history alone leaves progress unknown and creates no factual topic or action", async () => {
        const input = inputFor(scenario("no-progress-evidence"));
        input.generationMode = "configured-model";
        const resolve = vi.fn(() => null);
        const result = await createGenerationPort()(input, runtime(resolve));
        expect(result.execution).toMatchObject({ outcome: "empty", mode: "rules", attempts: 0 });
        expect(resolve).not.toHaveBeenCalled();
        expect(result.draft.topics).toEqual([]);
        expect(result.enhancements).toEqual([]);
        expect(result.draft.summary).toMatch(
            /progress|unknown|cannot.*establish|cannot.*determin/i
        );
        expect(content(result)).not.toContain(fixtures.history.proposedNextStep);
    });

    it("prior-ai-contradicted: quotes the current successful export rather than reinstate the old unavailable-export premise", async () => {
        const result = await createGenerationPort()(
            inputFor(scenario("prior-ai-contradicted")),
            runtime()
        );
        expect(result.draft.topics[0]!.facts[0]!.text).toContain("successfully exported");
        expect(result.draft.topics[0]!.facts[0]!.text).toContain(
            "only its confirmation notification is absent"
        );
        expect(result.draft.topics[0]!.title).toContain("Invoice export confirmation follow-up");
        expect(result.draft.topics[0]!.title).not.toContain("unavailable");
        expect(result.draft.topics[0]!.decisionQuestion).toMatch(/resolv|contradict|open|clarif/i);
    });

    it("expired-no-current-relevance: keeps unrelated current evidence and omits the old pitch recommendation", async () => {
        const s = scenario("expired-no-current-relevance");
        const result = await createGenerationPort()(inputFor(s), runtime());
        expect(result.draft.topics).toHaveLength(1);
        expect(result.draft.topics[0]!.title).not.toMatch(/pitch|rehearsal/i);
        expect(content(result)).not.toContain(s.proposedNextStep!);
        expect(content(result)).not.toContain("2026-10-15");
    });

    it("expired-still-important: uses the current unresolved blocker without copying its expired target", async () => {
        const result = await createGenerationPort()(
            inputFor(scenario("expired-still-important")),
            runtime()
        );
        expect(result.draft.topics[0]!.facts[0]!.text).toContain(
            "blocks the October 30 reconciliation check"
        );
        expect(result.draft.topics[0]!.facts[0]!.text).toContain("remains unresolved");
        expect(result.draft.topics[0]!.proposedDue).toBeNull();
        expect(result.draft.topics[0]!.proposedNextStep).toBe("");
    });

    it.each(["changed-document-relevant", "document-change-not-completion"])(
        "%s: document edits remain source reports, not verification or completion",
        async id => {
            const input = inputFor(scenario(id));
            const result = await createGenerationPort()(input, runtime());
            expect(input.previousVantageContext!.documentVerification).toBe("unavailable");
            expect(promptFor(input).payload.items[0]!.text).toContain(
                "Workspace document verification: unavailable"
            );
            expect(result.draft.topics[0]!.facts[0]!.refs.map(r => r.ref)).toEqual([
                "ev:ev-current-" + id,
            ]);
            expect(result.draft.topics[0]!.facts[0]!.text).toContain("not");
            expect(result.draft.topics[0]!.proposedNextStep).toBe("");
            expect(result.draft.topics[0]!.unknowns.join(" ")).toMatch(
                /Automatic workspace document verification is unavailable/
            );
            expect(
                [result.draft.topics[0]!.whyItMatters, ...result.draft.topics[0]!.unknowns].join(
                    " "
                )
            ).toMatch(/recorded/i);
        }
    );

    it("no-human-decision: a kept AI proposal is not a recorded decision", async () => {
        const input = inputFor(scenario("no-human-decision"));
        expect(input.previousVantageContext!.topics[0]!.recordedDecision).toBeNull();
        expect(input.previousVantageContext!.topics[0]!.reportedActions).toEqual([]);
        const result = await createGenerationPort()(input, runtime());
        expect(result.draft.summary).not.toContain("existing decision");
        expect(result.draft.topics[0]!.proposedNextStep).toBe("");
    });

    it("same-week-regeneration: the assembler excludes self-feedback and generation stays identical to no history", async () => {
        const input = inputFor(scenario("same-week-regeneration"));
        expect(input.previousVantageContext).toBeNull();
        expect(promptFor(input).text).not.toContain("SELF_FEEDBACK_SENTINEL");
        const noHistory = structuredClone(input);
        delete noHistory.previousVantageContext;
        const a = await createGenerationPort()(input, runtime());
        const b = await createGenerationPort()(noHistory, runtime());
        expect(a.draft).toEqual(b.draft);
        expect(a.signals).toEqual(b.signals);
    });

    it.each(["missing", "revoked", "unauthorized"])(
        "historical-sources-unavailable (%s): redacts historical derived content and does not invent verification",
        async _status => {
            const s = scenario("historical-sources-unavailable");
            const previous = assemblePreviousVantageContext({
                currentPeriod: fixtures.period,
                report: historicalReport(s),
                actions: [action()],
                sourceStates: [
                    {
                        ref: fixtures.history.sourceRef,
                        status: "missing-or-unauthorized",
                        documentVerification: "not-applicable",
                    },
                ],
            });
            expect(previous).not.toBeNull();
            expect(previous!.summary).toBeNull();
            expect(previous!.topics).toEqual([]);
            expect(previous!.unavailableSources[0]!.status).toBe("missing-or-unauthorized");
            const input = inputFor(s);
            input.previousVantageContext = previous;
            expect(promptFor(input).text).not.toContain("PRIVATE_HISTORY_SENTINEL");
            expect(promptFor(input).text).not.toContain(fixtures.history.proposedNextStep);
            const result = await createGenerationPort()(input, runtime());
            expect(result.draft.topics[0]!.title).not.toMatch(/invoice|confirmation/i);
        }
    );

    it("no-previous-vantage: ordinary generation is unchanged", async () => {
        const input = inputFor(scenario("no-previous-vantage"));
        expect(input.previousVantageContext).toBeNull();
        const omitted = structuredClone(input);
        delete omitted.previousVantageContext;
        const a = await createGenerationPort()(input, runtime());
        const b = await createGenerationPort()(omitted, runtime());
        expect(a.draft).toEqual(b.draft);
        expect(a.signals).toEqual(b.signals);
        expect(a.enhancements).toEqual(b.enhancements);
    });
});

describe("historical context source, cutoff and snapshot boundaries", () => {
    it("historical-state-changes-during-generation: snapshots include decision content beyond projection limits and source-access state", () => {
        const s = scenario("historical-state-changes-during-generation");
        const report = historicalReport(s);
        report.topics[0]!.decision =
            "A bounded historical decision. ".repeat(20) + "original suffix";
        const before = assemblePreviousVantageContext({
            currentPeriod: fixtures.period,
            report,
            sourceStates: [availableSource()],
        })!;
        const edited = structuredClone(report);
        edited.topics[0]!.decision =
            "A bounded historical decision. ".repeat(20) + "changed suffix";
        const after = assemblePreviousVantageContext({
            currentPeriod: fixtures.period,
            report: edited,
            sourceStates: [availableSource()],
        })!;
        expect(before.topics[0]!.recordedDecision).toEqual(after.topics[0]!.recordedDecision);
        expect(before.snapshotVersion).not.toBe(after.snapshotVersion);
        const revoked = assemblePreviousVantageContext({
            currentPeriod: fixtures.period,
            report,
            sourceStates: [{ ...availableSource(), status: "missing-or-unauthorized" }],
        })!;
        expect(revoked.snapshotVersion).not.toBe(before.snapshotVersion);
        expect(revoked.topics).toEqual([]);
    });

    it("excludes reports generated after the current cutoff", () => {
        const report = historicalReport(scenario("completion-indicated"));
        report.generatedAt = "2026-10-25T12:00:00.000Z";
        expect(
            assemblePreviousVantageContext({
                currentPeriod: fixtures.period,
                report,
                sourceStates: [availableSource()],
            })
        ).toBeNull();
    });

    it("keeps history outside the current evidence citation allowlist and current signals", () => {
        const input = inputFor(scenario("completion-indicated"));
        const eligible = eligibleInput(input);
        const signals = computeGenerationSignals(eligible);
        const { pack } = selectGenerationEvidence(eligible, signals);
        expect(pack.items.map(i => i.ref)).toEqual([
            "cm:" + fixtures.history.commitmentId,
            "ev:ev-current-completion-indicated",
        ]);
        expect(JSON.stringify(signals)).not.toContain(fixtures.history.sourceRef);
        expect(JSON.stringify(signals)).not.toContain(fixtures.history.proposedNextStep);
    });

    it("only one model invocation is made; historical references cannot support current-world facts (output double)", async () => {
        const input = inputFor(scenario("completion-indicated"));
        input.generationMode = "configured-model";
        const response = {
            summary: "The current synthetic source reports its dated invoice confirmation result.",
            topics: [
                {
                    title: "Clarify the current invoice confirmation result",
                    facts: [
                        {
                            text: scenario("completion-indicated").body,
                            refs: ["ev:ev-current-completion-indicated"],
                        },
                    ],
                    whyItMatters:
                        "The current account requires separate review from recorded action state.",
                    decisionQuestion:
                        "Does the current source establish resolution or require clarification?",
                    proposedNextStep: "",
                    proposedOwner: null,
                    proposedDueInDays: null,
                    helpRequested: null,
                    unknowns: ["Whether recorded completion is confirmed."],
                    conflicts: [],
                    rationale:
                        "A synthetic output double tests transport and source boundaries, not model reasoning.",
                },
            ],
            enhancements: [],
        };
        const invoke = vi.fn().mockResolvedValue({ result: response, usage: {} });
        const model = { modelId: "synthetic-history-output-double" } as ResolvedChatModel;
        const result = await createGenerationPort(
            invoke as Parameters<typeof createGenerationPort>[0]
        )(input, runtime(vi.fn(() => model)));
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(invoke.mock.calls[0]![3]).toMatchObject({ timeoutMs: 20000, maxOutputTokens: 2400 });
        expect(result.execution).toMatchObject({ mode: "ai", attempts: 1, fallbackReason: null });
        const invalid = structuredClone(response);
        invalid.topics[0]!.facts[0]!.refs = [fixtures.history.sourceRef];
        const rejected = vi.fn().mockResolvedValue({ result: invalid, usage: {} });
        const fallback = await createGenerationPort(
            rejected as Parameters<typeof createGenerationPort>[0]
        )(input, runtime(vi.fn(() => model)));
        expect(fallback.execution).toMatchObject({
            mode: "rules",
            attempts: 2,
            fallbackReason: "invalid-output",
        });
    });

    it("uses explicitly skeptical instructions without changing the one-call/output/time budgets", () => {
        expect(GENERATION_SYSTEM_PROMPT).toMatch(/untrusted histor/i);
        expect(GENERATION_SYSTEM_PROMPT).toMatch(/recorded.*completion|completion.*recorded/i);
        expect(GENERATION_SYSTEM_PROMPT).toMatch(/deadline/i);
        expect(GENERATION_SYSTEM_PROMPT).toMatch(/document/i);
        expect(GENERATION_BUDGETS).toEqual({
            attemptTimeoutMs: 20000,
            maxAttempts: 2,
            retryWaitMs: 1000,
            totalMs: 45000,
        });
        const input = inputFor(scenario("completion-indicated"));
        const prompt = promptFor(input);
        expect(Buffer.byteLength(prompt.text)).toBeLessThanOrEqual(18000);
        expect(prompt.text).toContain("untrusted-history");
        expect(prompt.payload.items.map(i => i.ref)).toContain(
            "ev:ev-current-completion-indicated"
        );
    });

    it("bounds Unicode history, reviewed prose and dense current evidence inside the unchanged shared transport limit", () => {
        const s = scenario("completion-indicated");
        const input = inputFor(s);
        const report = historicalReport(s);
        report.summary = "历史总结".repeat(5000);
        report.topics = Array.from({ length: 80 }, (_, index) => ({
            ...structuredClone(report.topics[0]!),
            id: "historical-" + index,
            position: index,
            title: "历史线索".repeat(1000),
            whyItMatters: "不可当作事实的推断".repeat(1000),
            decisionQuestion: "是否需要当前证据".repeat(1000),
            proposedNextStep: "历史建议不可自动重复".repeat(1000),
            decision: "过去的人类决定不证明工作已发生".repeat(1000),
        }));
        input.previousVantageContext = assemblePreviousVantageContext({
            currentPeriod: fixtures.period,
            report,
            sourceStates: [availableSource()],
        });
        expect(Buffer.byteLength(JSON.stringify(input.previousVantageContext))).toBeLessThanOrEqual(
            4096
        );
        input.reviewedTopics = report.topics.map(topic => ({ topic, contentVersion: 2 }));
        const current = input.data.currentEvidence[0]!;
        input.data.carryForwardCommitments = [];
        input.data.currentEvidence = Array.from({ length: 160 }, (_, index) => ({
            ...current,
            id: "dense-current-" + index,
            title: "当前证据标题".repeat(100),
            body: "当前授权证据不可替换为历史结论".repeat(2000),
        }));
        const before = JSON.stringify(input);
        const prompt = promptFor(input);
        expect(Buffer.byteLength(prompt.text)).toBeLessThanOrEqual(18000);
        expect(
            Buffer.byteLength(
                JSON.stringify([
                    structuredSchemaInstruction(GenerationOutputSchema),
                    GENERATION_SYSTEM_PROMPT,
                    prompt.text,
                ])
            )
        ).toBeLessThanOrEqual(23500);
        if (prompt.payload.previousVantageContext) {
            expect(
                Buffer.byteLength(JSON.stringify(prompt.payload.previousVantageContext))
            ).toBeLessThanOrEqual(4096);
        }
        expect(prompt.payload.items.every(item => item.ref.startsWith("ev:dense-current-"))).toBe(
            true
        );
        expect(prompt.payload.omissions.reviewedTopics).toBeGreaterThan(0);
        expect(JSON.stringify(input)).toBe(before);
    });
});
