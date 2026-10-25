import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AgendaV1Dto, ReportPeriod } from "./contract-v1";
import type { CommitmentDto } from "./types";
import {
    assemblePreviousVantageContext,
    MAX_PREVIOUS_VANTAGE_BYTES,
    previousVantageFingerprint,
    previousActionStateFingerprint,
    type PreviousVantageAssemblyInput,
    type PreviousVantageSource,
} from "./previous-context-v1";

const examples = JSON.parse(
    readFileSync(
        new URL("../../../docs/design/examples/weekly-decision-agenda-v1.json", import.meta.url),
        "utf8"
    )
).internal;
const currentPeriod: ReportPeriod = examples.input.reportPeriod;
function fixture(): PreviousVantageAssemblyInput {
    const topic = structuredClone(examples.enrichmentInput.reviewedTopics[0].topic);
    topic.agendaId = "previous-report";
    topic.facts = [
        {
            text: "Historical claim",
            refs: [{ ref: "ev:old", label: "Prior note", date: "2026-10-09" }],
        },
    ];
    const report: AgendaV1Dto = {
        id: "previous-report",
        weekStart: "2026-10-05",
        weekEnd: "2026-10-11",
        status: "held",
        summary: "Historical AI summary is not a current fact.",
        generatedAt: "2026-10-10T14:00:00Z",
        heldAt: "2026-10-10T15:00:00Z",
        createdAt: "2026-10-10T14:00:00Z",
        topics: [topic],
        signals: null,
        modelMetadata: { mode: "ai" },
        reportPeriod: null,
        version: 4,
        enhancements: [],
        execution: null,
    };
    return {
        currentPeriod,
        report,
        sourceStates: [
            { ref: "ev:old", status: "available", documentVerification: "not-applicable" },
        ],
    };
}
function action(): CommitmentDto {
    return {
        id: "original-action",
        agendaId: "previous-report",
        topicId: "topic-demo-1",
        topicTitle: null,
        title: "Run the original check",
        owner: "Founder",
        dueOn: "2026-10-09",
        test: "Record results",
        status: "open",
        outcome: null,
        shared: false,
        resolvedAt: null,
        createdAt: "2026-10-08T14:00:00Z",
    };
}

describe("bounded previous Vantage assembly", () => {
    it("separates untrusted prose, actual decisions, reported actions and provenance without mutation", () => {
        const input = fixture();
        input.report!.topics[0]!.decision = "Run the original check";
        input.report!.topics[0]!.decidedAt = "2026-10-10T15:00:00Z";
        input.actions = [action()];
        const before = JSON.stringify(input);
        const context = assemblePreviousVantageContext(input)!;
        expect(context).toMatchObject({
            contractVersion: "previous-vantage/v1",
            trust: "untrusted-history",
            reportId: "previous-report",
            weekStart: "2026-10-05",
            reportVersion: 4,
            topics: [
                {
                    recordedDecision: { text: "Run the original check" },
                    reportedActions: [{ id: "original-action", status: "open" }],
                    originalRefs: [{ ref: "ev:old", status: "available" }],
                },
            ],
        });
        expect(context.topics[0]!.suggestedDue).toBe("2026-10-24");
        expect(context.topics[0]!.reportedActions[0]!.dueOn).toBe("2026-10-09");
        expect(JSON.stringify(input)).toBe(before);
        expect(assemblePreviousVantageContext(input)).toEqual(context);
    });

    it("does not turn a kept topic or expired due date into a decision or a completed action", () => {
        const input = fixture();
        input.actions = [action()];
        const topic = assemblePreviousVantageContext(input)!.topics[0]!;
        expect(topic.status).toBe("kept");
        expect(topic.recordedDecision).toBeNull();
        expect(topic.reportedActions[0]!.status).toBe("open");
    });

    it("continues without a previous report and rejects same-week or non-previous reports", () => {
        expect(assemblePreviousVantageContext({ currentPeriod, report: null })).toBeNull();
        for (const weekStart of ["2026-10-12", "2026-09-28", "2026-10-19"]) {
            const input = fixture();
            input.report!.weekStart = weekStart;
            expect(assemblePreviousVantageContext(input)).toBeNull();
        }
    });

    it.each(["createdAt", "generatedAt", "updatedAt"])(
        "withholds a report with %s after the reporting cutoff",
        field => {
            const input = fixture(),
                future = "2026-10-17T14:00:00.001Z";
            if (field === "updatedAt") input.reportUpdatedAt = future;
            else input.report![field as "createdAt" | "generatedAt"] = future;
            expect(assemblePreviousVantageContext(input)).toBeNull();
        }
    );

    it.each<PreviousVantageSource["status"]>([
        "missing-or-unauthorized",
        "after-cutoff",
        "document-verification-unavailable",
        "unsupported-ref",
    ])("does not leak derived historical prose for %s sources", status => {
        const input = fixture();
        input.report!.summary = "PRIVATE historical derived summary";
        Object.assign(input.report!.topics[0]!, {
            title: "PRIVATE title",
            whyItMatters: "PRIVATE interpretation",
            decision: "PRIVATE decision",
            proposedNextStep: "PRIVATE proposed action",
        });
        input.sourceStates = [{ ref: "ev:old", status, documentVerification: "unavailable" }];
        const context = assemblePreviousVantageContext(input)!;
        expect(context.topics).toEqual([]);
        expect(context.summary).toBeNull();
        expect(context.unavailableSources).toEqual(input.sourceStates);
        expect(JSON.stringify(context)).not.toContain("PRIVATE");
    });

    it("fails closed when the reader did not supply a source check", () => {
        const input = fixture();
        input.sourceStates = [];
        const context = assemblePreviousVantageContext(input)!;
        expect(context.topics).toEqual([]);
        expect(context.summary).toBeNull();
        expect(context.unavailableSources[0]!.status).toBe("missing-or-unauthorized");
    });

    it.each(["doc:unchecked", "ev:old"])(
        "does not accept contradictory available metadata for unverified %s sources",
        ref => {
            const input = fixture();
            input.report!.topics[0]!.facts[0]!.refs[0]!.ref = ref;
            input.sourceStates = [
                { ref, status: "available", documentVerification: "unavailable" },
            ];
            const context = assemblePreviousVantageContext(input)!;
            expect(context.topics).toEqual([]);
            expect(context.summary).toBeNull();
            expect(context.unavailableSources[0]!.status).not.toBe("available");
        }
    );

    it("allows authorized source-less suggestions only as untrusted history", () => {
        const input = fixture();
        input.report!.topics[0]!.facts = [];
        const context = assemblePreviousVantageContext(input)!;
        expect(context.topics).toHaveLength(1);
        expect(context.trust).toBe("untrusted-history");
        expect(context.topics[0]!.originalRefs).toEqual([]);
    });

    it.each(["topic", "decision", "action"])(
        "withholds text edited after cutoff in %s state",
        kind => {
            const input = fixture(),
                future = "2026-10-17T14:00:00.001Z";
            if (kind === "topic") input.topicState = { "topic-demo-1": { updatedAt: future } };
            if (kind === "decision") {
                input.report!.topics[0]!.decision = "Later decision";
                input.report!.topics[0]!.decidedAt = future;
            }
            if (kind === "action") {
                input.actions = [action()];
                input.actionState = { "original-action": { updatedAt: future } };
            }
            const context = assemblePreviousVantageContext(input)!;
            expect(context.topics).toEqual([]);
            expect(context.summary).toBeNull();
        }
    );

    it("caps Unicode context and reports omissions without trusting an incomplete summary", () => {
        const input = fixture(),
            template = input.report!.topics[0]!;
        input.report!.summary = "界".repeat(2000);
        input.report!.topics = Array.from({ length: 20 }, (_, i) => ({
            ...structuredClone(template),
            id: "topic-" + i,
            position: i,
            title: "界".repeat(300),
            whyItMatters: "界".repeat(1000),
            proposedNextStep: "界".repeat(1000),
        }));
        const context = assemblePreviousVantageContext(input)!;
        expect(Buffer.byteLength(JSON.stringify(context))).toBeLessThanOrEqual(
            MAX_PREVIOUS_VANTAGE_BYTES
        );
        expect(context.omissions.topics).toBeGreaterThan(0);
        expect(context.omissions.summary).toBe(true);
        expect(context.summary).toBeNull();
    });

    it("masks topics with refs beyond coverage instead of exposing unchecked content", () => {
        const input = fixture();
        input.report!.topics[0]!.facts = [
            {
                text: "Many sources",
                refs: Array.from({ length: 12 }, (_, n) => ({
                    ref: "ev:" + n,
                    label: "Source",
                    date: null,
                })),
            },
        ];
        input.sourceStates = Array.from({ length: 12 }, (_, n) => ({
            ref: "ev:" + n,
            status: "available",
            documentVerification: "not-applicable",
        }));
        const context = assemblePreviousVantageContext(input)!;
        expect(context.topics).toEqual([]);
        expect(context.omissions.refs).toBe(4);
        expect(context.summary).toBeNull();
    });

    it("fingerprints PostgreSQL bigint identities and Date values deterministically", () => {
        const value = {
            companyId: 9007199254740993n,
            rows: [{ companyId: 42n, updatedAt: new Date("2026-10-10T12:00Z") }],
        };
        expect(previousVantageFingerprint(value)).toBe(
            previousVantageFingerprint(structuredClone(value))
        );
        expect(previousVantageFingerprint(value)).not.toBe(
            previousVantageFingerprint({ ...value, companyId: 9007199254740994n })
        );
    });

    it("retains an exact action state version before clipping long historical fields", () => {
        const input = fixture(),
            full = action();
        full.title = "Long title ".repeat(25);
        full.owner = "Long owner ".repeat(20);
        full.test = "Long test ".repeat(40);
        full.outcome = "Long outcome ".repeat(40);
        input.actions = [full];
        const projected = assemblePreviousVantageContext(input)!.topics[0]!.reportedActions[0]!;
        expect(projected.title).not.toBe(full.title);
        expect(projected.stateVersion).toBe(previousActionStateFingerprint(full));
        expect(previousActionStateFingerprint({ ...full, test: full.test + "changed" })).not.toBe(
            projected.stateVersion
        );
        expect(
            previousActionStateFingerprint({
                ...full,
                topicTitle: "Only derived display title changed",
            })
        ).toBe(projected.stateVersion);
    });

    it("fingerprints full omitted prose and exact source state rather than only the projection", () => {
        const input = fixture(),
            template = input.report!.topics[0]!;
        input.report!.topics = Array.from({ length: 7 }, (_, i) => ({
            ...structuredClone(template),
            id: "topic-" + i,
            position: i,
        }));
        const before = assemblePreviousVantageContext(input)!;
        input.report!.topics[6]!.whyItMatters = "Changed text outside selected topics";
        expect(assemblePreviousVantageContext(input)!.snapshotVersion).not.toBe(
            before.snapshotVersion
        );
        expect(
            previousVantageFingerprint({ source: { updatedAt: new Date("2026-10-10T12:00Z") } })
        ).not.toBe(
            previousVantageFingerprint({ source: { updatedAt: new Date("2026-10-10T13:00Z") } })
        );
    });
});
