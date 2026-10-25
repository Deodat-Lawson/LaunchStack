import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AgendaV1Dto, GenerationInput } from "./contract-v1";
import type { CommitmentDto } from "./types";
import {
    assemblePreviousVantageContext,
    type PreviousVantageAssemblyInput,
} from "./previous-context-v1";
import { unchangedHistoricalAction } from "./revalidate-previous-v1";

const examples = JSON.parse(
    readFileSync(
        new URL("../../../docs/design/examples/weekly-decision-agenda-v1.json", import.meta.url),
        "utf8"
    )
).internal;

function historicalAction(): CommitmentDto {
    return {
        id: "long-historical-action",
        agendaId: "long-history-report",
        topicId: "long-history-topic",
        topicTitle: "Check invoice export confirmation",
        title: "Carry-forward invoice export verification ".repeat(4),
        owner: "Synthetic recorded owner ".repeat(5),
        dueOn: "2026-10-09",
        test: "Record invoice export acknowledgement with exact test outputs. ".repeat(5),
        status: "open",
        outcome: "Progress note only; actual completion remains unconfirmed. ".repeat(5),
        shared: false,
        resolvedAt: null,
        createdAt: "2026-10-08T14:00:00Z",
    };
}

function inputWithAssembledHistory(
    action: CommitmentDto,
    configure?: (assembly: PreviousVantageAssemblyInput) => void
): GenerationInput {
    const input = structuredClone(examples.input) as GenerationInput;
    const template = structuredClone(examples.enrichmentInput.reviewedTopics[0].topic);
    const report: AgendaV1Dto = {
        id: action.agendaId!,
        weekStart: "2026-10-05",
        weekEnd: "2026-10-11",
        status: "held",
        summary: "An untrusted historical question about invoice export confirmation.",
        generatedAt: "2026-10-10T14:00:00Z",
        heldAt: "2026-10-10T15:00:00Z",
        createdAt: "2026-10-10T14:00:00Z",
        topics: [
            {
                ...template,
                id: action.topicId!,
                agendaId: action.agendaId!,
                title: action.topicTitle!,
                facts: [
                    {
                        text: "A historical source raised an invoice export question.",
                        refs: [
                            {
                                ref: "ev:old-invoice-source",
                                label: "Historical submitted note",
                                date: "2026-10-09",
                            },
                        ],
                    },
                ],
                decision: "Run the original confirmation check.",
                decidedAt: "2026-10-10T15:00:00Z",
                commitmentId: action.id,
                contentVersion: 2,
            },
        ],
        signals: null,
        modelMetadata: { mode: "ai" },
        reportPeriod: null,
        version: 4,
        enhancements: [],
        execution: null,
    };
    input.data = {
        metricDefinitions: [],
        currentEvidence: [],
        currentObservations: [],
        comparisonObservations: [],
        resolvedCommitments: action.status === "open" ? [] : [structuredClone(action)],
        carryForwardCommitments: action.status === "open" ? [structuredClone(action)] : [],
    };
    input.reviewedTopics = [];
    const assembly: PreviousVantageAssemblyInput = {
        currentPeriod: input.reportPeriod,
        report,
        actions: [structuredClone(action)],
        sourceStates: [
            {
                ref: "ev:old-invoice-source",
                status: "available",
                documentVerification: "not-applicable",
            },
        ],
    };
    configure?.(assembly);
    input.previousVantageContext = assemblePreviousVantageContext(assembly);
    return input;
}

describe("historical action comparison retains identity beyond bounded prose", () => {
    it("recognizes unchanged long fields after the actual history assembler clips them", () => {
        const action = historicalAction();
        const input = inputWithAssembledHistory(action);
        const projected = input.previousVantageContext!.topics[0]!.reportedActions[0]!;
        for (const field of ["title", "owner", "test", "outcome"] as const) {
            expect(projected[field]).not.toBe(action[field]);
            expect(action[field]!.startsWith(projected[field]!)).toBe(true);
        }
        const before = JSON.stringify({ input, action });
        expect(unchangedHistoricalAction(input, action)).toBe(true);
        expect(JSON.stringify({ input, action })).toBe(before);
    });

    it.each(["title", "owner", "test", "outcome"] as const)(
        "a change only beyond the clipped %s remains a real state change",
        field => {
            const original = historicalAction();
            const input = inputWithAssembledHistory(original);
            const projected = input.previousVantageContext!.topics[0]!.reportedActions[0]!;
            const changed = structuredClone(original);
            changed[field] = original[field]!.slice(0, -1) + "!";
            expect(changed[field].startsWith(projected[field]!)).toBe(true);
            expect(unchangedHistoricalAction(input, changed)).toBe(false);
        }
    );

    it("does not turn completion-like outcome prose into a completed recorded action", () => {
        const action = historicalAction();
        action.outcome =
            "Someone wrote that the work was completed. No recorded resolution exists.";
        const input = inputWithAssembledHistory(action);
        const recorded = input.previousVantageContext!.topics[0]!.reportedActions[0]!;
        expect(recorded.status).toBe("open");
        expect(recorded.resolvedAt).toBeNull();
        expect(unchangedHistoricalAction(input, action)).toBe(true);
    });

    it("does not suppress a current-period recorded resolution that also appears in linked as-of state", () => {
        const action = historicalAction();
        action.status = "done";
        action.outcome = "The operator recorded a resolution during the current reporting week.";
        action.resolvedAt = "2026-10-16T12:00:00Z";
        const input = inputWithAssembledHistory(action);
        const recorded = input.previousVantageContext!.topics[0]!.reportedActions[0]!;
        expect(recorded.status).toBe("done");
        expect(recorded.resolvedAt).toBe(action.resolvedAt);
        expect(input.data.resolvedCommitments).toEqual([action]);
        expect(unchangedHistoricalAction(input, action)).toBe(false);
    });

    it("does not revive old linked work when its topic is omitted by the history topic budget", () => {
        const action = historicalAction();
        const input = inputWithAssembledHistory(action, assembly => {
            const original = assembly.report!.topics[0]!;
            original.position = 6;
            assembly.report!.topics = [
                ...Array.from({ length: 6 }, (_, index) => ({
                    ...structuredClone(original),
                    id: "retained-unlinked-topic-" + index,
                    position: index,
                    title: "Other historical question " + index,
                    facts: [],
                    whyItMatters: "Historical interpretation only.",
                    decisionQuestion: "Is there a useful current clarification?",
                    proposedNextStep: "Consider a small check.",
                    decision: null,
                    decidedAt: null,
                    commitmentId: null,
                    unknowns: [],
                    conflicts: [],
                })),
                original,
            ];
        });
        const history = input.previousVantageContext!;
        expect(history.omissions.topics).toBeGreaterThan(0);
        expect(history.topics.some(topic => topic.topicId === action.topicId)).toBe(false);
        expect(history.topics.flatMap(topic => topic.reportedActions)).toEqual([]);
        expect(unchangedHistoricalAction(input, action)).toBe(true);
    });

    it("does not revive old linked work when source permissions withhold its historical topic", () => {
        const action = historicalAction();
        const input = inputWithAssembledHistory(action, assembly => {
            assembly.sourceStates![0]!.status = "missing-or-unauthorized";
        });
        const history = input.previousVantageContext!;
        expect(history.topics).toEqual([]);
        expect(history.summary).toBeNull();
        expect(history.unavailableSources[0]!.status).toBe("missing-or-unauthorized");
        expect(unchangedHistoricalAction(input, action)).toBe(true);
    });

    it("uses a retained topic link for a legacy action without agenda linkage, without suppressing unrelated work", () => {
        const action = historicalAction();
        const input = inputWithAssembledHistory(action, assembly => {
            assembly.actions = [];
        });
        const legacy = { ...action, agendaId: null };
        input.data.carryForwardCommitments = [legacy];
        expect(input.previousVantageContext!.topics[0]!.topicId).toBe(legacy.topicId);
        expect(input.previousVantageContext!.topics[0]!.reportedActions).toEqual([]);
        expect(unchangedHistoricalAction(input, legacy)).toBe(true);
        expect(
            unchangedHistoricalAction(input, {
                ...legacy,
                id: "unrelated-new-action",
                topicId: "unrelated-current-topic",
            })
        ).toBe(false);
    });
});
