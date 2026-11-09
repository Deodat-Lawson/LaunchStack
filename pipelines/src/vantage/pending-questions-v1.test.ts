import { describe, expect, it } from "vitest";
import type { AgendaV1Dto } from "./contract-v1";
import {
    emptyPendingHistoricalState,
    mergePendingHistoricalState,
    pendingQuestionsFromReport,
    projectPendingHistoricalQuestions,
    type PendingHistoricalQuestionV1,
    type PendingHistoricalStateV1,
} from "./pending-questions-v1";

const question = (id = "original-topic"): PendingHistoricalQuestionV1 => ({
    questionId: id,
    originTopicId: id,
    originReportId: "original-report",
    originWeekStart: "2026-10-05",
    originGeneratedAt: "2026-10-09T16:00:00Z",
    title: "Deletion readiness",
    question: "Should pilot access wait for the deletion dry-run result?",
    origin: "ai",
    humanReview: {
        kind: "recorded-decision",
        contentVersion: 2,
        status: "kept",
        decision: "Keep the go/no-go question until the result is reviewed.",
        decidedAt: "2026-10-09T17:00:00Z",
    },
    suggestedDue: "2026-10-10",
    sourceRefs: [
        { ref: "ev:original-source", label: "Pilot acceptance checklist", date: "2026-10-09" },
    ],
});
const state = (questions = [question()]): PendingHistoricalStateV1 => ({
    version: 1,
    questions,
    reviews: {},
});
const project = (
    s = state(),
    overrides: Partial<Parameters<typeof projectPendingHistoricalQuestions>[0]> = {}
) =>
    projectPendingHistoricalQuestions({
        state: s,
        asOf: "2026-11-02T17:00:00Z",
        currentWeekStart: "2026-10-19",
        originAvailability: Object.fromEntries(s.questions.map(q => [q.questionId, "available"])),
        sourceStates: [
            {
                ref: "ev:original-source",
                status: "available",
                documentVerification: "not-applicable",
            },
        ],
        ...overrides,
    });
const report = (
    status: "kept" | "suggested" | "dismissed",
    origin: "ai" | "founder" = "ai",
    decision: string | null = null
) =>
    ({
        id: "original-report",
        weekStart: "2026-10-05",
        generatedAt: "2026-10-09T16:00:00Z",
        topics: [
            {
                id: "original-topic",
                title: "Deletion readiness",
                decisionQuestion: question().question,
                status,
                origin,
                decision,
                decidedAt: decision ? "2026-10-09T17:00:00Z" : null,
                contentVersion: 2,
                facts: [{ text: "A deletion test is required.", refs: question().sourceRefs }],
                conflicts: [],
                proposedDue: "2026-10-10",
            },
        ],
    }) as unknown as AgendaV1Dto;

describe("rolling pending historical questions", () => {
    it("captures original human review records without accepting unreviewed AI suggestions", () => {
        expect(pendingQuestionsFromReport(report("suggested"))).toEqual([]);
        expect(pendingQuestionsFromReport(report("dismissed", "founder", "Past decision"))).toEqual(
            []
        );
        expect(pendingQuestionsFromReport(report("kept"))[0]!.humanReview).toMatchObject({
            kind: "kept-topic",
            decision: null,
        });
        expect(
            pendingQuestionsFromReport(report("suggested", "founder"))[0]!.humanReview.kind
        ).toBe("authored-or-edited");
        expect(
            pendingQuestionsFromReport(report("suggested", "ai", "Past decision"))[0]!.humanReview
                .kind
        ).toBe("recorded-decision");
    });
    it("keeps the original question across an empty intervening report, without revisiting old prose", () => {
        const previous = state(),
            before = structuredClone(previous);
        const second = mergePendingHistoricalState({
            previous,
            current: emptyPendingHistoricalState(),
            previousReport: null,
        });
        const third = mergePendingHistoricalState({
            previous: second,
            current: emptyPendingHistoricalState(),
            previousReport: null,
        });
        expect(project(third).questions).toEqual([question()]);
        expect(previous).toEqual(before);
    });
    it("preserves original content and deduplicates the stable original identity", () => {
        const current = state();
        const previous = state([{ ...question(), question: "A later generated paraphrase" }]);
        const merged = mergePendingHistoricalState({
            current,
            previous,
            previousReport: report("kept"),
        });
        expect(merged.questions).toEqual([question()]);
    });
    it.each(["dismissed", "addressed"] as const)(
        "retains a human %s tombstone across same-week and next-week merges",
        status => {
            const reviewed = state();
            reviewed.reviews[question().questionId] = {
                status,
                reviewedAt: "2026-10-16T17:00:00Z",
                reviewedBy: "synthetic-human",
                reason: "Explicit review",
            };
            const next = mergePendingHistoricalState({
                previous: state(),
                current: reviewed,
                previousReport: report("kept"),
            });
            expect(next.questions).toHaveLength(1);
            expect(project(next).questions).toEqual([]);
            expect(project(next).reviewedQuestionIds).toEqual([question().questionId]);
            expect(
                project(
                    mergePendingHistoricalState({
                        previous: next,
                        current: emptyPendingHistoricalState(),
                        previousReport: report("kept"),
                    })
                ).questions
            ).toEqual([]);
        }
    );
    it("uses the latest explicit human review deterministically", () => {
        const previous = state(),
            current = state();
        previous.reviews[question().questionId] = {
            status: "addressed",
            reviewedAt: "2026-10-20T17:00:00Z",
            reviewedBy: "later-human",
            reason: null,
        };
        current.reviews[question().questionId] = {
            status: "dismissed",
            reviewedAt: "2026-10-19T17:00:00Z",
            reviewedBy: "earlier-human",
            reason: null,
        };
        expect(
            mergePendingHistoricalState({ previous, current, previousReport: null }).reviews[
                question().questionId
            ]!.status
        ).toBe("addressed");
    });
    it.each([
        "missing-or-unauthorized",
        "after-cutoff",
        "document-verification-unavailable",
    ] as const)("withholds source %s without deleting or closing the question", status => {
        const s = state();
        const view = project(s, {
            sourceStates: [
                {
                    ref: "ev:original-source",
                    status,
                    documentVerification:
                        status === "document-verification-unavailable"
                            ? "unavailable"
                            : "not-applicable",
                },
            ],
        });
        expect(view.questions).toEqual([]);
        expect(view.unavailableCount).toBe(1);
        expect(JSON.stringify(view)).not.toContain(question().question);
        expect(s.questions).toEqual([question()]);
        expect(s.reviews).toEqual({});
    });
    it("fails closed on a foreign/missing origin and on same-week self feedback", () => {
        expect(project(state(), { originAvailability: {} }).questions).toEqual([]);
        expect(project(state(), { currentWeekStart: "2026-10-05" }).questions).toEqual([]);
    });
    it("does not expire an old human question or limit visibility to the first validation batch", () => {
        const questions = Array.from({ length: 105 }, (_, n) => question(`topic-${n}`));
        expect(project(state(questions)).questions).toEqual(questions);
    });
    it("fingerprints omitted/private state without exposing it", () => {
        const args = { sourceStates: [] };
        const before = project(state(), args);
        const changed = state();
        changed.questions[0]!.humanReview.decision =
            "Changed historical decision beyond prompt limits";
        const after = project(changed, args);
        expect(after.questions).toEqual([]);
        expect(after.snapshotVersion).not.toBe(before.snapshotVersion);
    });
});
