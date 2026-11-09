import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { structuredSchemaInstruction, type ResolvedChatModel } from "@launchstack/llm";
import type { AgendaV1Dto, GenerationInput, GenerationRuntime, ReportPeriod } from "./contract-v1";
import type { CommitmentDto, EvidenceDto } from "./types";
import { previousActionStateFingerprint, type PreviousVantageContext } from "./previous-context-v1";
import { usablePreviousVantage } from "./revalidate-previous-v1";
import {
    createGenerationPort,
    generationPrompt,
    GenerationOutputSchema,
    GENERATION_BUDGETS,
    GENERATION_SYSTEM_PROMPT,
} from "./generation-v1";
import { computeGenerationSignals, eligibleInput, selectGenerationEvidence } from "./evidence-v1";
import {
    emptyPendingHistoricalState,
    mergePendingHistoricalState,
    pendingQuestionsFromReport,
    projectPendingHistoricalQuestions,
    type PendingHistoricalQuestionV1,
    type PendingHistoricalQuestionsContextV1,
    type PendingHistoricalStateV1,
} from "./pending-questions-v1";

const fixture = JSON.parse(
    readFileSync(
        new URL(
            "../../../fixtures/vantage-previous-context/pending-questions.json",
            import.meta.url
        ),
        "utf8"
    )
) as {
    period: ReportPeriod;
    pendingContext: PendingHistoricalQuestionsContextV1;
    currentEvidence: EvidenceDto;
};

const question = () => structuredClone(fixture.pendingContext.questions[0]!);
const state = (): PendingHistoricalStateV1 => ({
    version: 1,
    questions: [question()],
    reviews: {},
});
const priorAiContext = (): PreviousVantageContext => ({
    contractVersion: "previous-vantage/v1",
    trust: "untrusted-history",
    reportId: "previous-ai-report",
    weekStart: "2026-10-12",
    generatedAt: "2026-10-18T20:00:00.000Z",
    reportVersion: 2,
    snapshotVersion: "synthetic-ai-projection-v1",
    summary: "Earlier AI interpretations are investigation clues.",
    topics: Array.from({ length: 6 }, (_, index) => ({
        topicId: "old-ai-topic-" + index,
        contentVersion: 1,
        origin: "ai",
        status: "suggested",
        title: "Earlier AI clue " + index,
        interpretation: "Untrusted older interpretation.",
        question: "Is any relevant current evidence available?",
        suggestedNextStep: "An old unapproved suggestion.",
        suggestedDue: "2026-10-16",
        recordedDecision: null,
        reportedActions: [],
        originalRefs: [],
    })),
    unavailableSources: [],
    omissions: { topics: 0, refs: 0, summary: false },
    documentVerification: "unavailable",
});
const input = (): GenerationInput => ({
    contractVersion: "v1",
    runId: "synthetic-rolling-pending",
    inputVersion: "synthetic-rolling-pending-v1",
    reportPeriod: structuredClone(fixture.period),
    generationMode: "configured-model",
    data: {
        metricDefinitions: [],
        currentEvidence: [],
        currentObservations: [],
        comparisonObservations: [],
        resolvedCommitments: [],
        carryForwardCommitments: [],
    },
    reviewedTopics: [],
    previousVantageContext: null,
    pendingHistoricalQuestions: structuredClone(fixture.pendingContext),
});
const runtime = (resolveModel: GenerationRuntime["resolveModel"] = vi.fn(() => null)) => ({
    resolveModel,
    signal: new AbortController().signal,
    budgets: GENERATION_BUDGETS,
});
const promptFor = (value: GenerationInput) => {
    const eligible = eligibleInput(value);
    const { pack } = selectGenerationEvidence(eligible, computeGenerationSignals(eligible));
    return { pack, prompt: generationPrompt(eligible, pack) };
};
const project = (
    value: PendingHistoricalStateV1 = state(),
    configure?: (args: Parameters<typeof projectPendingHistoricalQuestions>[0]) => void
) => {
    const args: Parameters<typeof projectPendingHistoricalQuestions>[0] = {
        state: value,
        originAvailability: Object.fromEntries(
            value.questions.map(q => [q.questionId, "available"])
        ),
        sourceStates: value.questions.flatMap(q =>
            q.sourceRefs.map(ref => ({
                ref: ref.ref,
                status: "available" as const,
                documentVerification: "not-applicable" as const,
            }))
        ),
        asOf: fixture.period.asOf,
        currentWeekStart: fixture.period.weekStart,
    };
    configure?.(args);
    return projectPendingHistoricalQuestions(args);
};

function reportFor(q: PendingHistoricalQuestionV1): AgendaV1Dto {
    return {
        id: q.originReportId,
        weekStart: q.originWeekStart,
        weekEnd: "2026-10-18",
        status: "held",
        summary: "Historical model prose, never a current source.",
        signals: null,
        modelMetadata: { mode: "ai" },
        generatedAt: q.originGeneratedAt,
        heldAt: q.humanReview.decidedAt,
        createdAt: "2026-10-18T20:00:00.000Z",
        reportPeriod: null,
        version: 2,
        enhancements: [],
        execution: null,
        topics: [
            {
                id: q.originTopicId,
                agendaId: q.originReportId,
                position: 0,
                contentVersion: q.humanReview.contentVersion,
                status: q.humanReview.status,
                origin: q.origin,
                title: q.title,
                facts: [{ text: "An earlier source raised this question.", refs: q.sourceRefs }],
                whyItMatters: "An earlier interpretation does not establish present truth.",
                decisionQuestion: q.question,
                proposedNextStep: "Run the historical proposed check.",
                proposedOwner: null,
                proposedDue: q.suggestedDue,
                helpRequested: null,
                unknowns: ["Whether any work happened is unknown."],
                conflicts: [],
                rationale: "Synthetic historical report fixture.",
                shared: false,
                decision: q.humanReview.decision,
                decidedAt: q.humanReview.decidedAt,
                commitmentId: null,
            },
        ],
    };
}

describe("rolling pending questions retain exact human-record lineage", () => {
    it("keeps an original question through a genuinely empty intervening report", () => {
        const original = reportFor(question());
        const first = mergePendingHistoricalState({
            previous: emptyPendingHistoricalState(),
            current: emptyPendingHistoricalState(),
            previousReport: original,
        });
        const emptySecond = {
            ...original,
            id: "report-week-two",
            weekStart: "2026-10-19",
            topics: [],
        };
        const before = JSON.stringify({ original, first, emptySecond });
        const third = mergePendingHistoricalState({
            previous: first,
            current: emptyPendingHistoricalState(),
            previousReport: emptySecond,
        });
        expect(third.questions).toEqual(first.questions);
        expect(third.questions[0]).toMatchObject({
            questionId: original.topics[0]!.id,
            originTopicId: original.topics[0]!.id,
            originReportId: original.id,
            originWeekStart: "2026-10-12",
            originGeneratedAt: original.generatedAt,
        });
        expect(JSON.stringify({ original, first, emptySecond })).toBe(before);
    });

    it("does not create pending obligations from an untouched AI suggestion", () => {
        const report = reportFor(question());
        report.topics[0]!.status = "suggested";
        report.topics[0]!.decision = null;
        report.topics[0]!.decidedAt = null;
        expect(pendingQuestionsFromReport(report)).toEqual([]);
    });

    it("a kept topic without a decision remains explicitly different from a recorded decision", () => {
        const report = reportFor(question());
        report.topics[0]!.decision = null;
        report.topics[0]!.decidedAt = null;
        const [pending] = pendingQuestionsFromReport(report);
        expect(pending!.humanReview).toMatchObject({
            kind: "kept-topic",
            decision: null,
            decidedAt: null,
        });
    });

    it("never rediscovers a dismissed historical topic as pending", () => {
        const report = reportFor(question());
        report.topics[0]!.status = "dismissed";
        expect(pendingQuestionsFromReport(report)).toEqual([]);
    });

    it.each(["dismissed", "addressed"] as const)(
        "a human %s tombstone survives same-week merging and the next report",
        status => {
            const current = state();
            current.reviews[question().questionId] = {
                status,
                reviewedAt: fixture.period.asOf,
                reviewedBy: "synthetic-reviewer",
                reason: "Explicit human review, never inferred completion.",
            };
            const merged = mergePendingHistoricalState({
                previous: state(),
                current,
                previousReport: reportFor(question()),
            });
            expect(merged.questions).toHaveLength(1);
            expect(merged.reviews[question().questionId]!.status).toBe(status);
            expect(project(merged).questions).toEqual([]);
            expect(project(merged).unavailableCount).toBe(0);
        }
    );

    it("keeps same-title questions with distinct original identities separate", () => {
        const first = question();
        const second = {
            ...question(),
            questionId: "other-original-topic",
            originTopicId: "other-original-topic",
            originReportId: "other-original-report",
        };
        const merged = mergePendingHistoricalState({
            previous: { version: 1, questions: [first, second], reviews: {} },
            current: state(),
            previousReport: reportFor(first),
        });
        expect(merged.questions.map(q => q.questionId).sort()).toEqual(
            [first.questionId, second.questionId].sort()
        );
    });

    it.each([
        "missing-or-unauthorized",
        "after-cutoff",
        "document-verification-unavailable",
    ] as const)(
        "%s source withholds the question without erasing its original stored record",
        status => {
            const stored = state();
            stored.questions[0]!.title = "PRIVATE_PENDING_SENTINEL";
            const before = JSON.stringify(stored);
            const visible = project(stored, args => {
                args.sourceStates[0]!.status = status;
            });
            expect(visible.questions).toEqual([]);
            expect(visible.unavailableCount).toBe(1);
            expect(JSON.stringify(visible)).not.toContain("PRIVATE_PENDING_SENTINEL");
            expect(JSON.stringify(stored)).toBe(before);
        }
    );

    it.each(["missing-or-unauthorized", "after-cutoff", "dismissed"] as const)(
        "%s original topic cannot supply visible pending prose",
        availability => {
            const visible = project(state(), args => {
                args.originAvailability[question().questionId] = availability;
            });
            expect(visible.questions).toEqual([]);
        }
    );

    it("rejects an unknown origin and a mismatched question ID without matching titles", () => {
        const unknown = project(state(), args => {
            args.originAvailability = {};
        });
        expect(unknown.questions).toEqual([]);
        const mismatch = state();
        mismatch.questions[0]!.questionId = "forged-other-question";
        expect(project(mismatch).questions).toEqual([]);
    });

    it("excludes a same-week origin instead of feeding the draft back into itself", () => {
        const value = state();
        value.questions[0]!.originWeekStart = fixture.period.weekStart;
        expect(project(value).questions).toEqual([]);
    });

    it("keeps old deadlines as history and includes full decision/source changes in the fingerprint", () => {
        const original = project();
        const changed = state();
        changed.questions[0]!.humanReview.decision += " Changed beyond a short display projection.";
        expect(project(changed).snapshotVersion).not.toBe(original.snapshotVersion);
        const revoked = project(state(), args => {
            args.sourceStates[0]!.status = "missing-or-unauthorized";
        });
        expect(revoked.snapshotVersion).not.toBe(original.snapshotVersion);
        expect(original.questions[0]!.suggestedDue).toBe("2026-10-23");
        expect(original.questions[0]!.humanReview.decision).toBe(question().humanReview.decision);
    });
});

describe("pending historical questions stay separate from factual agenda generation", () => {
    it("empty current input retains pending continuity without facts, actions, or any model call", async () => {
        const value = input();
        const before = JSON.stringify(value);
        const resolve = vi.fn(() => null);
        const invoke = vi.fn();
        const result = await createGenerationPort(invoke)(value, runtime(resolve));
        expect(result.execution).toMatchObject({ mode: "rules", outcome: "empty", attempts: 0 });
        expect(result.draft.topics).toEqual([]);
        expect(result.enhancements).toEqual([]);
        expect(resolve).not.toHaveBeenCalled();
        expect(invoke).not.toHaveBeenCalled();
        expect(JSON.stringify(value)).toBe(before);
        expect(value.pendingHistoricalQuestions!.questions[0]!.questionId).toBe(
            question().questionId
        );
    });

    it("projects pending history without requiring last week's AI report to contain a topic", () => {
        const value = input();
        const { prompt, pack } = promptFor(value);
        expect(pack.items).toEqual([]);
        expect(prompt.payload.previousVantageContext).toBeNull();
        expect(prompt.payload.pendingHistoricalQuestions!.questions).toHaveLength(1);
        expect(prompt.payload.pendingHistoricalQuestions!.questions[0]).toMatchObject({
            questionId: question().questionId,
            originReportId: question().originReportId,
            originTopicId: question().originTopicId,
            originWeekStart: "2026-10-12",
        });
        expect(prompt.payload.omissions.pendingHistoricalQuestions).toBe(0);
    });

    it("does not turn unrelated current evidence into a fact about the historical issue", async () => {
        const value = input();
        value.generationMode = "rules";
        value.data.currentEvidence = [structuredClone(fixture.currentEvidence)];
        const { pack } = promptFor(value);
        const result = await createGenerationPort()(value, runtime());
        expect(pack.items.map(item => item.ref)).toEqual(["ev:pending-current-cohort"]);
        expect(result.draft.topics).toHaveLength(1);
        const topic = result.draft.topics[0]!;
        expect(topic.facts[0]!.text).toContain(fixture.currentEvidence.body);
        expect(JSON.stringify(topic)).not.toMatch(/deletion|dry.run|pilot access/i);
        expect(topic.facts.flatMap(fact => fact.refs.map(ref => ref.ref))).toEqual([
            "ev:pending-current-cohort",
        ]);
    });

    it("retains original identity when the pending issue is older than the immediate previous week", () => {
        const value = input();
        value.reportPeriod = {
            weekStart: "2026-11-23",
            timeZone: "America/New_York",
            startInclusive: "2026-11-23T05:00:00.000Z",
            endExclusive: "2026-11-29T15:00:00.000Z",
            asOf: "2026-11-29T15:00:00.000Z",
            kind: "week-to-date",
        };
        const visible = promptFor(value).prompt.payload.pendingHistoricalQuestions!.questions;
        expect(visible[0]).toMatchObject({
            questionId: question().questionId,
            originWeekStart: "2026-10-12",
            originReportId: question().originReportId,
        });
        expect(value.pendingHistoricalQuestions!.questions[0]!.suggestedDue).toBe("2026-10-23");
    });

    it("reports unavailable verification as a count without reconstructing withheld prose", () => {
        const value = input();
        value.pendingHistoricalQuestions = {
            ...fixture.pendingContext,
            questions: [],
            unavailableCount: 3,
        };
        const { prompt } = promptFor(value);
        expect(prompt.payload.pendingHistoricalQuestions!.questions).toEqual([]);
        expect(prompt.payload.pendingHistoricalQuestions!.unavailableCount).toBe(3);
        expect(prompt.text).not.toContain(question().title);
        expect(prompt.text).not.toContain(question().humanReview.decision!);
    });

    it("same-title pending IDs are not merged in the prepared model context", () => {
        const value = input();
        value.pendingHistoricalQuestions!.questions.push({
            ...question(),
            questionId: "same-title-other-origin",
            originTopicId: "same-title-other-origin",
        });
        const sent = promptFor(value).prompt.payload.pendingHistoricalQuestions!.questions;
        expect(sent.map(q => q.questionId).sort()).toEqual(
            [question().questionId, "same-title-other-origin"].sort()
        );
    });

    it("human pending questions take priority within the shared six-entry and byte envelope", () => {
        const value = input();
        value.previousVantageContext = priorAiContext();
        value.pendingHistoricalQuestions!.questions = Array.from({ length: 3 }, (_, index) => ({
            ...question(),
            questionId: "human-pending-" + index,
            originTopicId: "human-pending-" + index,
        }));
        const before = JSON.stringify(value);
        const { prompt } = promptFor(value);
        expect(prompt.payload.pendingHistoricalQuestions!.questions).toHaveLength(3);
        expect((prompt.payload.previousVantageContext?.topics.length ?? 0) + 3).toBeLessThanOrEqual(
            6
        );
        expect(prompt.payload.omissions.previousVantageTopics).toBeGreaterThan(0);
        expect(
            Buffer.byteLength(
                JSON.stringify({
                    previousVantageContext: prompt.payload.previousVantageContext,
                    pendingHistoricalQuestions: prompt.payload.pendingHistoricalQuestions,
                })
            )
        ).toBeLessThanOrEqual(4096);
        expect(JSON.stringify(value)).toBe(before);
    });

    it("withholds earlier AI summary prose when unavailable carried provenance could leak through it", () => {
        const value = input();
        value.previousVantageContext = priorAiContext();
        value.previousVantageContext.summary =
            "PRIVATE_PENDING_SENTINEL came from a source that is now unavailable.";
        value.pendingHistoricalQuestions = {
            ...fixture.pendingContext,
            questions: [],
            unavailableCount: 1,
        };
        const { prompt } = promptFor(value);
        expect(prompt.payload.previousVantageContext).toBeNull();
        expect(prompt.payload.pendingHistoricalQuestions!.unavailableCount).toBe(1);
        expect(prompt.text).not.toContain("PRIVATE_PENDING_SENTINEL");
    });

    it("does not authorize a pending provenance ref for a current-world fact (model output double)", async () => {
        const value = input();
        value.data.currentEvidence = [structuredClone(fixture.currentEvidence)];
        const response = {
            summary: "A synthetic output double attempts to misuse a historical provenance ID.",
            topics: [
                {
                    title: "Unsupported current deletion result",
                    facts: [
                        {
                            text: "Deletion was completed this week.",
                            refs: [question().sourceRefs[0]!.ref],
                        },
                    ],
                    whyItMatters:
                        "This test double exercises citation boundaries, not model judgment.",
                    decisionQuestion: "Is the supplied source actually current?",
                    proposedNextStep: "",
                    proposedOwner: null,
                    proposedDueInDays: null,
                    helpRequested: null,
                    unknowns: [],
                    conflicts: [],
                    rationale: "Synthetic boundary test only.",
                },
            ],
            enhancements: [],
        };
        const invoke = vi.fn().mockResolvedValue({ result: response, usage: {} });
        const model = { modelId: "synthetic-pending-output-double" } as ResolvedChatModel;
        const result = await createGenerationPort(invoke)(
            value,
            runtime(() => model)
        );
        expect(result.execution).toMatchObject({
            mode: "rules",
            attempts: 2,
            fallbackReason: "invalid-output",
        });
        expect(
            result.draft.topics.flatMap(topic =>
                topic.facts.flatMap(fact => fact.refs.map(ref => ref.ref))
            )
        ).not.toContain(question().sourceRefs[0]!.ref);
    });

    it.each(["dismissed", "addressed"] as const)(
        "an explicitly %s original ID cannot return through previous AI prose or Rules",
        async status => {
            const value = input();
            value.generationMode = "rules";
            const reviewedId = status + "-original-topic";
            value.pendingHistoricalQuestions!.questions = [];
            value.pendingHistoricalQuestions!.reviewedQuestionIds = [reviewedId];
            value.previousVantageContext = priorAiContext();
            value.previousVantageContext.summary = "REVIEWED_SUMMARY_SENTINEL from old AI prose.";
            value.previousVantageContext.topics = [
                {
                    ...value.previousVantageContext.topics[0]!,
                    topicId: reviewedId,
                    title: "REVIEWED_ORIGIN_SENTINEL invoice verification",
                    question: "Does invoice verification require another check?",
                },
            ];
            value.data.currentEvidence = [
                {
                    ...fixture.currentEvidence,
                    title: "Invoice verification result",
                    body: "One invoice verification result was recorded this week.",
                },
            ];
            const before = JSON.stringify(value);
            const eligible = eligibleInput(value);
            expect(eligible.previousVantageContext).toEqual(value.previousVantageContext);
            expect(usablePreviousVantage(eligible)!.topics).toEqual([]);
            expect(usablePreviousVantage(eligible)!.summary).toBeNull();
            const { pack } = promptFor(value);
            // Call generationPrompt on raw input as well as the eligible path.
            const prompt = generationPrompt(value, pack);
            expect(prompt.payload.previousVantageContext!.topics).toEqual([]);
            expect(prompt.payload.previousVantageContext!.summary).toBeNull();
            expect(prompt.text).not.toContain("REVIEWED_ORIGIN_SENTINEL");
            expect(prompt.text).not.toContain("REVIEWED_SUMMARY_SENTINEL");
            expect(prompt.text).not.toContain("reviewedQuestionIds");
            const result = await createGenerationPort()(value, runtime());
            expect(result.draft.topics).toHaveLength(1);
            expect(result.draft.topics[0]!.facts[0]!.text).toContain(
                value.data.currentEvidence[0]!.body
            );
            expect(result.draft.topics[0]!.decisionQuestion).not.toMatch(/historical question/i);
            expect(JSON.stringify(result.draft)).not.toContain("REVIEWED_ORIGIN_SENTINEL");
            expect(JSON.stringify(value)).toBe(before);
        }
    );

    it("suppresses by original ID without suppressing another same-title question", () => {
        const value = input();
        value.pendingHistoricalQuestions!.questions = [];
        value.pendingHistoricalQuestions!.reviewedQuestionIds = ["reviewed-original"];
        value.previousVantageContext = priorAiContext();
        const template = value.previousVantageContext.topics[0]!;
        value.previousVantageContext.topics = [
            { ...template, topicId: "reviewed-original", title: "Identical historical title" },
            {
                ...template,
                topicId: "still-pending-other-origin",
                title: "Identical historical title",
            },
        ];
        const before = JSON.stringify(value);
        expect(
            usablePreviousVantage(eligibleInput(value))!.topics.map(topic => topic.topicId)
        ).toEqual(["still-pending-other-origin"]);
        const { pack } = promptFor(value);
        const prompt = generationPrompt(value, pack);
        expect(prompt.payload.previousVantageContext!.topics.map(topic => topic.topicId)).toEqual([
            "still-pending-other-origin",
        ]);
        expect(prompt.payload.previousVantageContext!.summary).toBeNull();
        expect(JSON.stringify(value)).toBe(before);
    });

    it("an already-dismissed previous topic is suppressed without any pending ledger", async () => {
        const value = input();
        value.generationMode = "rules";
        delete value.pendingHistoricalQuestions;
        value.previousVantageContext = priorAiContext();
        value.previousVantageContext.summary = "DISMISSED_SUMMARY_SENTINEL";
        value.previousVantageContext.topics = [
            {
                ...value.previousVantageContext.topics[0]!,
                status: "dismissed",
                title: "DISMISSED_TOPIC_SENTINEL invoice verification",
            },
        ];
        const before = JSON.stringify(value);
        const eligible = eligibleInput(value);
        expect(eligible.previousVantageContext).toEqual(value.previousVantageContext);
        expect(usablePreviousVantage(eligible)!.topics).toEqual([]);
        expect(usablePreviousVantage(eligible)!.summary).toBeNull();
        const prompt = generationPrompt(value, promptFor(value).pack);
        expect(prompt.text).not.toContain("DISMISSED_SUMMARY_SENTINEL");
        expect(prompt.text).not.toContain("DISMISSED_TOPIC_SENTINEL");
        expect((await createGenerationPort()(value, runtime())).draft.topics).toEqual([]);
        expect(JSON.stringify(value)).toBe(before);
    });

    it("withholds untraceable summary sentences even when the reviewed ID was outside the old topic projection", () => {
        const value = input();
        value.pendingHistoricalQuestions!.questions = [];
        value.pendingHistoricalQuestions!.reviewedQuestionIds = ["reviewed-topic-omitted-earlier"];
        value.previousVantageContext = priorAiContext();
        value.previousVantageContext.summary = "OMITTED_REVIEW_SUMMARY_SENTINEL";
        const originalIds = value.previousVantageContext.topics.map(topic => topic.topicId);
        const before = JSON.stringify(value);
        const eligible = eligibleInput(value);
        expect(usablePreviousVantage(eligible)!.topics.map(topic => topic.topicId)).toEqual(
            originalIds
        );
        expect(usablePreviousVantage(eligible)!.summary).toBeNull();
        const prompt = generationPrompt(value, promptFor(value).pack);
        expect(prompt.text).not.toContain("OMITTED_REVIEW_SUMMARY_SENTINEL");
        expect(JSON.stringify(value)).toBe(before);
    });

    it.each(["source-unavailable", "dismissed", "addressed"] as const)(
        "%s history still suppresses an unchanged open linked commitment without renewing work",
        async reason => {
            const value = input();
            value.generationMode = "rules";
            value.previousVantageContext = priorAiContext();
            const action: CommitmentDto = {
                id: "unchanged-linked-invoice-action",
                agendaId: value.previousVantageContext.reportId,
                topicId: "original-invoice-action-topic",
                topicTitle: "OLD_LINKED_ACTION_SENTINEL invoice confirmation",
                title: "Verify invoice confirmation",
                owner: "Noah",
                dueOn: "2026-10-16",
                test: "Five invoice confirmation checks.",
                status: "open",
                outcome: null,
                shared: false,
                resolvedAt: null,
                createdAt: "2026-10-16T15:00:00.000Z",
            };
            value.previousVantageContext.summary = "OLD_LINKED_SUMMARY_SENTINEL";
            value.previousVantageContext.topics = [
                {
                    ...value.previousVantageContext.topics[0]!,
                    topicId: action.topicId!,
                    title: action.topicTitle!,
                    reportedActions: [
                        {
                            id: action.id,
                            stateVersion: previousActionStateFingerprint(action),
                            title: action.title,
                            owner: action.owner,
                            dueOn: action.dueOn,
                            test: action.test,
                            status: action.status,
                            outcome: action.outcome,
                            resolvedAt: action.resolvedAt,
                            createdAt: action.createdAt,
                        },
                    ],
                },
            ];
            value.pendingHistoricalQuestions!.questions = [];
            if (reason === "source-unavailable")
                value.pendingHistoricalQuestions!.unavailableCount = 1;
            else value.pendingHistoricalQuestions!.reviewedQuestionIds = [action.topicId!];
            value.data.carryForwardCommitments = [action];
            const before = JSON.stringify(value);
            const eligible = eligibleInput(value);
            expect(eligible.previousVantageContext!.topics[0]!.reportedActions[0]!.id).toBe(
                action.id
            );
            const visible = usablePreviousVantage(eligible);
            expect(visible?.topics ?? []).toEqual([]);
            const { pack, prompt } = promptFor(value);
            expect(pack.items.map(item => item.ref)).toEqual(["cm:" + action.id]);
            expect(prompt.text).not.toContain("OLD_LINKED_ACTION_SENTINEL");
            expect(prompt.text).not.toContain("OLD_LINKED_SUMMARY_SENTINEL");
            const result = await createGenerationPort()(value, runtime());
            expect(result.draft.topics).toEqual([]);
            expect(result.enhancements).toEqual([]);
            expect(result.execution).toMatchObject({ mode: "rules", attempts: 0 });
            expect(action.status).toBe("open");
            expect(action.resolvedAt).toBeNull();
            expect(JSON.stringify(value)).toBe(before);
        }
    );

    it("bounds dense Unicode pending context visibly without dropping the complete input ledger", () => {
        const value = input();
        value.pendingHistoricalQuestions!.questions = Array.from({ length: 35 }, (_, index) => ({
            ...question(),
            questionId: "pending-" + index,
            originTopicId: "pending-" + index,
            title: "历史问题".repeat(50),
            question: "需要明确过去的人类决策但不能假定工作已经完成".repeat(50),
            humanReview: {
                ...question().humanReview,
                decision: "历史决定不证明当前状态".repeat(100),
            },
        }));
        value.pendingHistoricalQuestions!.questions.unshift(question());
        const before = JSON.stringify(value);
        const { prompt } = promptFor(value);
        const pending = prompt.payload.pendingHistoricalQuestions!;
        expect(pending.questions.length).toBeGreaterThan(0);
        expect(
            pending.questions.length + (prompt.payload.previousVantageContext?.topics.length ?? 0)
        ).toBeLessThanOrEqual(6);
        expect(pending.totalCount).toBe(36);
        expect(pending.omittedCount).toBe(36 - pending.questions.length);
        expect(prompt.payload.omissions.pendingHistoricalQuestions).toBe(pending.omittedCount);
        expect(
            Buffer.byteLength(
                JSON.stringify({
                    previousVantageContext: prompt.payload.previousVantageContext,
                    pendingHistoricalQuestions: pending,
                })
            )
        ).toBeLessThanOrEqual(4096);
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
        expect(JSON.stringify(value)).toBe(before);
        expect(value.pendingHistoricalQuestions!.questions).toHaveLength(36);
    });

    it("omits an oversized whole decision visibly instead of changing the human's clauses", () => {
        const value = input();
        value.pendingHistoricalQuestions!.questions[0]!.humanReview.decision =
            "Do not enable access without the full acceptance result. ".repeat(150);
        const originalDecision =
            value.pendingHistoricalQuestions!.questions[0]!.humanReview.decision;
        const { prompt } = promptFor(value);
        expect(prompt.payload.pendingHistoricalQuestions!.questions).toEqual([]);
        expect(prompt.payload.pendingHistoricalQuestions!.totalCount).toBe(1);
        expect(prompt.payload.pendingHistoricalQuestions!.omittedCount).toBe(1);
        expect(prompt.payload.omissions.pendingHistoricalQuestions).toBe(1);
        expect(value.pendingHistoricalQuestions!.questions[0]!.humanReview.decision).toBe(
            originalDecision
        );
    });
});
