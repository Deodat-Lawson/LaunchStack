/** @jest-environment jsdom */
import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type {
    DemoReport,
    DemoSourceRef,
    DemoTopic,
} from "~/app/employer/tools/vantage/demo-contract";
import { selectWeeklyBrief } from "~/app/employer/tools/vantage/_lib/weekly-brief";
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

describe("conservative weekly brief selection", () => {
    it("retains different-sample uncertainty without asserting definite contradiction", () => {
        const summary =
            "QA and Operations report different deletion counts, but their account lists may differ.";
        const view = selectWeeklyBrief(report(summary));
        expect(view.preview).toBe(summary);
        expect(view.headline).toBe("Compare sample coverage before deciding");
        expect(view.headline).not.toMatch(/disagree|contradict/);
    });
    it("does not turn a missing approval record into denial or universal absence", () => {
        const summary =
            "The supplied document contains no approval; whether approval occurred elsewhere is unknown.";
        expect(selectWeeklyBrief(report(summary)).preview).toBe(summary);
    });
    it("preserves a late negation and qualification in a complete sentence", () => {
        const summary =
            "The checks passed after several rounds of account reconciliation and review, but this is not approval and the record may cover a different sample.";
        expect(selectWeeklyBrief(report(summary)).preview).toBe(summary);
    });
    it("does not clip long sentences or discard later-sentence qualifications", () => {
        const view = selectWeeklyBrief(report(longSummary));
        expect(view.previewLabel).toBe("Question from saved report");
        expect(view.fullSummary).toBe(longSummary);
    });
    it("selects two complete source-validated facts for a long summary without requiring all facts to fit", () => {
        const facts = [
            {
                text: "QA reports all sampled accounts deleted; this is not a recorded privacy sign-off.",
                refs: [sourceA],
            },
            {
                text: "Operations reports a remaining record, but its sample may differ and no shared sample was reconciled.",
                refs: [sourceB],
            },
            {
                text: `${"Other context ".repeat(80)}No conclusion is established.`,
                refs: [sourceB],
            },
        ];
        const view = selectWeeklyBrief(report(longSummary, [topic({ facts })]));
        expect(view.preview).toBe(`${facts[0]!.text} ${facts[1]!.text}`);
        expect(view.previewLabel).toBe("Reported evidence");
        expect(view.fullSummary).toBe(longSummary);
        expect(view.evidence).toHaveLength(3);
    });
    it("preserves a compact conflict qualifier even when its refs are covered by selected facts", () => {
        const conflict = {
            text: "The reports may use different samples; this does not establish a reliable trend.",
            refs: [sourceA, sourceB],
        };
        const view = selectWeeklyBrief(
            report(longSummary, [
                topic({
                    facts: [
                        { text: "QA reports completion.", refs: [sourceA] },
                        { text: "Operations reports a remaining record.", refs: [sourceB] },
                    ],
                    conflicts: [conflict],
                }),
            ])
        );
        expect(view.preview).toBe(conflict.text);
        expect(view.previewLabel).toBe("Reported conflict");
    });
    it("uses a compact conflict when it cites an additional valid source", () => {
        const conflict = {
            text: "The comparison remains unresolved; the independent review uses a different account list.",
            refs: [sourceB],
        };
        const view = selectWeeklyBrief(
            report(longSummary, [
                topic({
                    facts: [{ text: "QA reports completion.", refs: [sourceA] }],
                    conflicts: [conflict],
                }),
            ])
        );
        expect(view.preview).toBe(conflict.text);
    });
    it("falls back to a question if an uncovered conflict is too long", () => {
        const input = report(longSummary, [
            topic({
                facts: [{ text: "QA reports completion.", refs: [sourceA] }],
                conflicts: [
                    {
                        text: `${"Account-level context ".repeat(40)}This is not approval.`,
                        refs: [sourceB],
                    },
                ],
            }),
        ]);
        expect(selectWeeklyBrief(input).previewLabel).toBe("Question from saved report");
    });
    it.each(
        [
            [],
            [{ ...sourceA, version: "999" }],
            [{ ...sourceA, kind: "company" as const }],
            [{ ...sourceA, id: "missing" }],
        ].map(refs => ({ refs }))
    )("discards facts without exact known refs: %j", ({ refs }) => {
        const input = report(longSummary, [
            topic({
                facts: [
                    { text: "Unverified assertion.", refs },
                    { text: "A source reports uncertainty.", refs: [sourceB] },
                ],
            }),
        ]);
        expect(selectWeeklyBrief(input).preview).toBe("A source reports uncertainty.");
    });
    it("does not publish selected facts when a conflict has invalid references", () => {
        const input = report(longSummary, [
            topic({
                facts: [{ text: "QA reports completion.", refs: [sourceA] }],
                conflicts: [
                    {
                        text: "A later report disputes completion.",
                        refs: [{ ...sourceB, version: "unknown" }],
                    },
                ],
            }),
        ]);
        expect(selectWeeklyBrief(input).previewLabel).toBe("Question from saved report");
    });
    it("uses compact factual evidence when a summary is missing", () => {
        const facts = [{ text: "The test passed; this is not approval.", refs: [sourceA] }];
        expect(selectWeeklyBrief(report("", [topic({ facts })]))).toMatchObject({
            preview: facts[0]!.text,
            previewLabel: "Reported evidence",
        });
    });
    it("does not promote rationale or proposed actions into facts", () => {
        const view = selectWeeklyBrief(
            report("", [
                topic({
                    rationale: "All accounts were deleted.",
                    whyItMatters: "Approval is guaranteed.",
                    proposedNextStep: "Launch immediately.",
                    decisionQuestion: "",
                }),
            ])
        );
        expect(view.preview).toBe(
            "Read the full brief and review the source evidence before deciding."
        );
    });
    it("works for unrelated companies without matching a fixture", () => {
        const view = selectWeeklyBrief(
            report("Cedar Labs reports an uncertain delivery date.", [
                topic({ title: "Clarify Cedar Labs delivery timing" }),
            ])
        );
        expect(view.headline).toBe("Clarify Cedar Labs delivery timing");
        expect(view.preview).toBe("Cedar Labs reports an uncertain delivery date.");
    });
    it("preserves multilingual summaries and safely handles unpunctuated text", () => {
        const summary =
            "\u5ba1\u67e5\u5c1a\u672a\u5b8c\u6210\u3002\u7ed3\u679c\u4ecd\u4e0d\u786e\u5b9a\u3002";
        expect(selectWeeklyBrief(report(summary)).preview).toBe(summary);
        expect(selectWeeklyBrief(report("Review incomplete and uncertain"))).toMatchObject({
            previewLabel: "Question from saved report",
            fullSummary: "Review incomplete and uncertain",
        });
    });
    it("handles a report without topics", () => {
        expect(selectWeeklyBrief(report("", []))).toMatchObject({
            headline: "Review this week's report",
            previewLabel: null,
            evidence: [],
        });
    });
    it("does not mutate originals and preserves exact summary, evidence refs and unknowns", () => {
        const input = report(`  ${longSummary}\n\nMore context.  `, [
            topic({
                facts: [{ text: "The evidence is uncertain.", refs: [sourceA] }],
                unknowns: ["Whether the samples overlap is unknown."],
            }),
        ]);
        const before = JSON.stringify(input);
        const view = selectWeeklyBrief(input);
        expect(JSON.stringify(input)).toBe(before);
        expect(view.fullSummary).toBe(input.summary);
        expect(view.evidence[0]).toBe(input.topics[0]!.facts[0]);
        expect(view.evidence[0]!.refs[0]).toBe(sourceA);
        expect(view.unknowns).toEqual(input.topics[0]!.unknowns);
    });
    it("renders full summary and unknowns and forwards the exact original source reference", () => {
        const input = report(longSummary, [
            topic({
                facts: [{ text: "A reported observation, not a decision.", refs: [sourceA] }],
                unknowns: ["Reviewer identity remains unknown."],
            }),
        ]);
        const onSource = jest.fn();
        const { container } = render(createElement(WeeklyBrief, { report: input, onSource }));
        expect(container.querySelector("details summary")?.textContent).toContain(
            "Read full brief"
        );
        expect(screen.getByText(longSummary)).toBeTruthy();
        expect(screen.getByText("Reviewer identity remains unknown.")).toBeTruthy();
        expect(container.querySelector("details")?.hasAttribute("open")).toBe(false);
        fireEvent.click(screen.getByRole("button", { name: "foreign/a (v2)", hidden: true }));
        expect(onSource.mock.calls[0]![0]).toBe(sourceA);
    });
});

describe("supplemental recorded evidence", () => {
    const independent: DemoSourceRef = { kind: "doc", id: "independent-review", version: "5" };
    const statement =
        "A human review document asks for a comparison before approval; the document contains no approval record.";
    function input(extra = { text: statement, refs: [independent] }) {
        const saved = report(longSummary, [
            topic({
                facts: [
                    { text: "QA reports completion; this is not approval.", refs: [sourceA] },
                    {
                        text: "Operations reports a remaining record; the sample may differ.",
                        refs: [sourceB],
                    },
                    extra,
                ],
            }),
        ]);
        saved.diagnostics.sources.push({
            source: independent,
            title: "Human review",
            contentHash: "saved",
            reviewState: "unreviewed",
        });
        return saved;
    }
    it("adds one whole qualified statement with independent exact refs", () => {
        const saved = input();
        const view = selectWeeklyBrief(saved);
        expect(view.highlight).toEqual({ text: statement, refs: [independent], unreviewed: true });
        expect(view.highlight?.refs).toBe(saved.topics[0]!.facts[2]!.refs);
        expect(view.previewRefs).toEqual([sourceA, sourceB]);
        expect(view.preview).not.toContain(statement);
    });
    it.each([
        { text: statement, refs: [] },
        { text: statement, refs: [{ ...independent, version: "missing" }] },
        { text: "A review remains incomplete without punctuation", refs: [independent] },
        { text: `${"Review context ".repeat(30)}No approval is recorded.`, refs: [independent] },
        { text: statement, refs: [sourceA] },
        { text: "QA reports completion; this is not approval.", refs: [independent] },
    ])("omits unsupported, partial, overlong or represented highlights: %j", extra => {
        expect(selectWeeklyBrief(input(extra)).highlight).toBeNull();
    });
    it("does not add highlights to whole-summary or question previews", () => {
        const summary = input();
        summary.summary = "The review remains uncertain.";
        expect(selectWeeklyBrief(summary).highlight).toBeNull();
        const question = input();
        question.topics[0]!.conflicts = [{ text: "Unresolved source conflict.", refs: [] }];
        expect(selectWeeklyBrief(question).highlight).toBeNull();
    });
    it("renders a review-state label and source button using the exact original ref", () => {
        const saved = input();
        const onSource = jest.fn();
        const { container } = render(createElement(WeeklyBrief, { report: saved, onSource }));
        const card = container.querySelector('aside[aria-label="Also recorded"]');
        expect(card?.textContent).toContain(statement);
        expect(card?.textContent).toContain("unreviewed source");
        const button = card?.querySelector("button");
        expect(button).toBeTruthy();
        fireEvent.click(button!);
        expect(onSource.mock.calls[0]![0]).toBe(independent);
    });
});
