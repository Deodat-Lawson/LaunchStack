/** @jest-environment jsdom */
import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type {
    DemoReport,
    DemoSourceRef,
    DemoTopic,
} from "~/app/employer/tools/vantage/demo-contract";
import {
    firstSummarySentence,
    selectWeeklyBrief,
} from "~/app/employer/tools/vantage/_lib/weekly-brief";
import { WeeklyBrief } from "~/app/employer/tools/vantage/_components/WeeklyBrief";

const sourceA: DemoSourceRef = { kind: "doc", id: "foreign/a", version: "2" };
const sourceB: DemoSourceRef = { kind: "doc", id: "foreign/b", version: "3" };
const longSummary =
    "The audit passed. The report says the launch is ready. However, it is provisional and not privacy approval.";
function topic(overrides: Partial<DemoTopic> = {}): DemoTopic {
    return {
        id: "foreign-topic",
        title: "Compare sample coverage before deciding",
        facts: [],
        conflicts: [],
        whyItMatters: "",
        decisionQuestion: "Do the reports cover the same accounts?",
        proposedNextStep: "",
        unknowns: [],
        rationale: "",
        status: "suggested",
        ...overrides,
    };
}
function report(summary: string, topics: DemoTopic[] = [topic()]): DemoReport {
    return {
        id: "unrelated-company-report",
        weekStart: "2026-10-12",
        generatedAt: "2026-10-20T12:00:00Z",
        version: 1,
        summary,
        topics,
        execution: {
            mode: "replay",
            modelId: "recorded",
            promptVersion: "v1",
            attempts: 1,
            durationMs: 0,
            fallbackReason: null,
        },
        diagnostics: {
            sources: [sourceA, sourceB].map(source => ({
                source,
                title: source.id,
                contentHash: "stored",
            })),
            contextFingerprint: "foreign",
            persisted: true,
            historicalHumanDecisions: 0,
        },
    };
}

describe("saved-summary-only weekly brief", () => {
    it.each([
        [
            "Invoice No. 1043 was downloaded. Notification is unconfirmed.",
            "Invoice No. 1043 was downloaded.",
        ],
        [
            "Fig. 2 shows a provisional result. Approval is unknown.",
            "Fig. 2 shows a provisional result.",
        ],
        ["The audit remains incomplete. Approval is unknown.", "The audit remains incomplete."],
        [
            "The error rate was 2.5 percent. Its cause is unknown.",
            "The error rate was 2.5 percent.",
        ],
        ["Dr. Reed requested a review. No decision is recorded.", "Dr. Reed requested a review."],
        [
            "Ms. Lane asked Operations to check. Progress is unknown.",
            "Ms. Lane asked Operations to check.",
        ],
        ["The review is on Oct. 5, 2026. It has not occurred.", "The review is on Oct. 5, 2026."],
        [
            "The check occurred at 5 p.m. on Jan. 12. Approval is unknown.",
            "The check occurred at 5 p.m. on Jan. 12.",
        ],
        [
            "The U.S. team requested a change. It is unconfirmed.",
            "The U.S. team requested a change.",
        ],
        ["J. Smith requested a check. It is pending.", "J. Smith requested a check."],
        [
            "The data is partial, e.g. only one sample. No conclusion is established.",
            "The data is partial, e.g. only one sample.",
        ],
        ["Version v2.1 is planned. It is not deployed.", "Version v2.1 is planned."],
        [
            "The check is dated 2026.10.12. Its scope is uncertain.",
            "The check is dated 2026.10.12.",
        ],
        [
            "The source is example.test/review. Its contents remain unreviewed.",
            "The source is example.test/review.",
        ],
        [
            'The report says "Approval is unknown." Another report is pending.',
            'The report says "Approval is unknown."',
        ],
        ["Is approval recorded? The supplied evidence does not say.", "Is approval recorded?"],
        [
            "The reviewer wrote \u201cNot approved.\u201d Progress remains unknown.",
            "The reviewer wrote \u201cNot approved.\u201d",
        ],
        [
            "\u5ba1\u67e5\u5c1a\u672a\u5b8c\u6210\u3002\u7ed3\u679c\u4ecd\u4e0d\u786e\u5b9a\u3002",
            "\u5ba1\u67e5\u5c1a\u672a\u5b8c\u6210\u3002",
        ],
        ["The record is incomplete and uncertain", "The record is incomplete and uncertain"],
        [
            "The record is incomplete... further review is needed",
            "The record is incomplete... further review is needed",
        ],
        ["1. Review is pending. Progress remains unknown.", "1. Review is pending."],
        ["  Review is pending.\n\nProgress is unknown.  ", "Review is pending."],
    ])("retains a reliable complete sentence from %s", (summary, expected) => {
        expect(firstSummarySentence(summary)).toBe(expected);
    });

    it("preserves every qualification within the first sentence without a character cutoff", () => {
        const sentence = `${"The sample is uncertain; ".repeat(60)}this does not establish approval.`;
        expect(firstSummarySentence(`${sentence} More context follows.`)).toBe(sentence);
    });
    it("preserves different-population and missing-approval qualifications verbatim", () => {
        const summary =
            "QA and Operations report different deletion counts, but their account lists may differ and approval outside these sources is unknown. More review is planned.";
        expect(selectWeeklyBrief(report(summary)).preview).toBe(
            summary.slice(0, summary.indexOf(" More review"))
        );
    });
    it("does not create a topic headline, assembled conflict, or extra evidence card", () => {
        const input = report(longSummary, [
            topic({
                facts: [{ text: "A fact that is not the saved summary.", refs: [sourceA] }],
                conflicts: [{ text: "A separate reported conflict.", refs: [sourceA, sourceB] }],
                unknowns: ["A separate unknown."],
            }),
        ]);
        const { container } = render(createElement(WeeklyBrief, { report: input }));
        expect(container.querySelector("h2")?.textContent).toBe("THIS WEEK'S BRIEF");
        expect(container.querySelector("h3")).toBeNull();
        expect(screen.queryByText(input.topics[0]!.title)).toBeNull();
        expect(screen.queryByText("A fact that is not the saved summary.")).toBeNull();
        expect(screen.queryByText("A separate reported conflict.")).toBeNull();
        expect(screen.queryByText("A separate unknown.")).toBeNull();
        expect(container.querySelector("aside")).toBeNull();
        expect(screen.getByText("The audit passed.")).toBeTruthy();
    });
    it("keeps the full exact original saved summary behind its disclosure", () => {
        const summary = `  ${longSummary}\n\nA further qualification is recorded.  `;
        const { container } = render(createElement(WeeklyBrief, { report: report(summary) }));
        const disclosure = container.querySelector("details")!;
        expect(disclosure.open).toBe(false);
        expect(disclosure.querySelector("p")?.textContent).toBe(summary);
        expect(disclosure.querySelector("summary")?.textContent).toContain("Read full brief");
        fireEvent.click(disclosure.querySelector("summary")!);
        expect(disclosure.open).toBe(true);
        expect(disclosure.querySelector("p")?.textContent).toBe(summary);
    });
    it("shows a restrained absence label rather than promoting a topic or suggestion", () => {
        const input = report("", [
            topic({
                rationale: "All work was completed.",
                proposedNextStep: "Launch immediately.",
            }),
        ]);
        const { container } = render(createElement(WeeklyBrief, { report: input }));
        expect(selectWeeklyBrief(input)).toEqual({ preview: "", fullSummary: "" });
        expect(container.textContent).toContain("No saved summary is available.");
        expect(container.textContent).not.toContain("Launch immediately");
        expect(container.textContent).not.toContain("All work was completed");
    });
    it("does not mutate saved topic, evidence, provenance or summary data", () => {
        const input = report(`  ${longSummary}\n\nMore context.  `, [
            topic({
                facts: [{ text: "Evidence remains uncertain.", refs: [sourceA] }],
                unknowns: ["Sample overlap is unknown."],
            }),
        ]);
        const before = JSON.stringify(input);
        const view = selectWeeklyBrief(input);
        expect(JSON.stringify(input)).toBe(before);
        expect(view.fullSummary).toBe(input.summary);
        expect(view.preview).toBe("The audit passed.");
    });
    it("works without topics and without fixture-specific company wording", () => {
        expect(
            selectWeeklyBrief(
                report("Cedar Labs reports an uncertain delivery date. More detail follows.", [])
            )
        ).toEqual({
            preview: "Cedar Labs reports an uncertain delivery date.",
            fullSummary: "Cedar Labs reports an uncertain delivery date. More detail follows.",
        });
    });
    it("renders punctuation as Unicode without replacement characters", () => {
        const summary =
            "Operations\u2019 review is pending \u2014 sample overlap is unknown. A recorded replay follows.";
        const { container } = render(createElement(WeeklyBrief, { report: report(summary) }));
        expect(container.textContent).toContain(
            "Operations\u2019 review is pending \u2014 sample overlap is unknown."
        );
        expect(container.textContent).not.toContain("\ufffd");
        expect(container.querySelector("summary")?.textContent).toContain("\u2304");
    });
});
