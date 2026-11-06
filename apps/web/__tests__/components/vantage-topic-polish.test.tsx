/** @jest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
    CompactTopicRow,
    hasReportedComparison,
} from "~/app/employer/tools/vantage/_components/CompactTopicRow";
import { TopicDetailSheet } from "~/app/employer/tools/vantage/_components/TopicDetailSheet";
import type {
    DemoReport,
    DemoSourceRef,
    DemoTopic,
} from "~/app/employer/tools/vantage/demo-contract";

const qa: DemoSourceRef = { kind: "doc", id: "qa", version: "17" };
const ops: DemoSourceRef = { kind: "doc", id: "ops", version: "21" };
const question =
    "Should a reviewer compare the account identifiers from both independent checks before deciding whether the supplied evidence supports acceptance, given that sample overlap remains unknown?";
function topic(overrides: Partial<DemoTopic> = {}): DemoTopic {
    return {
        id: "original-question",
        title: "Reconcile deletion samples",
        facts: [
            { text: "QA reports 3 of 3 sampled accounts deleted.", refs: [qa] },
            { text: "Operations reports 2 of 3; its account list may differ.", refs: [ops] },
        ],
        conflicts: [{ text: "Results differ; the samples may not match.", refs: [qa, ops] }],
        decisionQuestion: question,
        whyItMatters: "A comparison could clarify sample coverage.",
        proposedNextStep: "Compare the account identifiers and inspect the remaining record.",
        unknowns: ["Whether the account lists overlap."],
        rationale: "Sample comparability is unknown.",
        status: "suggested",
        ...overrides,
    };
}
const report: DemoReport = {
    id: "saved-report",
    weekStart: "2026-10-12",
    generatedAt: "2026-10-19T00:00:00Z",
    version: 1,
    summary: "Saved summary.",
    topics: [],
    execution: {
        mode: "replay",
        modelId: "recorded",
        promptVersion: "existing",
        attempts: 1,
        durationMs: 0,
        fallbackReason: null,
    },
    diagnostics: {
        sources: [
            { source: qa, title: "QA check", contentHash: "qa-hash", reviewState: "unreviewed" },
            { source: ops, title: "Operations audit", contentHash: "ops-hash" },
        ],
        contextFingerprint: "saved-context",
        persisted: true,
        historicalHumanDecisions: 0,
    },
};
function drawer(value = topic()) {
    const onReview = jest.fn();
    const onDecision = jest.fn();
    const onSource = jest.fn();
    render(
        <TopicDetailSheet
            open
            onOpenChange={jest.fn()}
            topic={value}
            report={report}
            onReview={onReview}
            onDecision={onDecision}
            onSource={onSource}
        />
    );
    return { dialog: screen.getByRole("dialog"), onReview, onDecision, onSource };
}

it("keeps the entire decision question in the compact row and uses consistent grounded chips", () => {
    const value = topic();
    const before = JSON.stringify(value);
    const onOpen = jest.fn();
    render(<CompactTopicRow topic={value} report={report} onOpen={onOpen} />);
    expect(screen.getByText(question)).toHaveTextContent(question);
    const chips = ["2 sources", "1 unknown", "Results differ", "Unreviewed context"].map(text =>
        screen.getByText(text)
    );
    expect(new Set(chips.map(chip => chip.className)).size).toBe(1);
    expect(screen.getByText("Results differ")).toHaveAttribute("data-tone", "warning");
    expect(screen.getByText("Unreviewed context")).toHaveAttribute("data-tone", "info");
    expect(screen.queryByText("Sources disagree")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledWith(screen.getByRole("button"));
    expect(JSON.stringify(value)).toBe(before);
});

it("does not infer a comparison from different numeric facts alone", () => {
    const value = topic({ conflicts: [] });
    expect(hasReportedComparison(value)).toBe(false);
    render(<CompactTopicRow topic={value} report={report} onOpen={jest.fn()} />);
    expect(screen.queryByText("Results differ")).not.toBeInTheDocument();
});

it("requires a supplied comparison covering at least two factual sources", () => {
    expect(hasReportedComparison(topic())).toBe(true);
    expect(
        hasReportedComparison(topic({ conflicts: [{ text: "Some difference.", refs: [qa] }] }))
    ).toBe(false);
    expect(
        hasReportedComparison(topic({ facts: [{ text: "One statement.", refs: [qa, ops] }] }))
    ).toBe(false);
    expect(hasReportedComparison(topic({ conflicts: [{ text: "", refs: [qa, ops] }] }))).toBe(
        false
    );
});

it("gives all three decision outcomes the same neutral treatment without selecting or submitting one", () => {
    const { dialog, onDecision } = drawer();
    const buttons = ["Go", "No-go", "Needs more evidence"].map(name =>
        within(dialog).getByRole("button", { name })
    );
    expect(new Set(buttons.map(button => button.className)).size).toBe(1);
    for (const button of buttons) expect(button).not.toHaveAttribute("aria-pressed", "true");
    expect(onDecision).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "No-go" }));
    expect(onDecision).toHaveBeenCalledWith("no-go");
    expect(within(dialog).getByText(question, { selector: "p" })).toBeVisible();
});

it("uses comparison cards only for a supported comparison and opens exact versioned sources", () => {
    const { dialog, onSource, onReview } = drawer();
    const evidence = within(dialog).getByRole("region", { name: "Source evidence" });
    expect(evidence.querySelector('[data-evidence-layout="comparison"]')).not.toBeNull();
    fireEvent.click(within(evidence).getByRole("button", { name: /QA check/ }));
    expect(onSource).toHaveBeenCalledWith(qa);
    expect(
        within(evidence).getByText("Operations reports 2 of 3; its account list may differ.")
    ).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep for later" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Dismiss topic" }));
    expect(onReview.mock.calls).toEqual([["kept"], ["dismissed"]]);
});

it("keeps the original comparison narrative and exact citations in a collapsed disclosure", () => {
    const { dialog, onSource } = drawer();
    const disclosure = within(dialog).getByText("Comparison & limitations", {
        selector: "summary",
    });
    const narrative = within(dialog).getByText("Results differ; the samples may not match.");
    expect(narrative).not.toBeVisible();
    fireEvent.click(disclosure);
    expect(narrative).toBeVisible();
    fireEvent.click(
        within(disclosure.parentElement!).getByRole("button", { name: /Operations audit/ })
    );
    expect(onSource).toHaveBeenCalledWith(ops);
});

it("stacks independent evidence while keeping all original statements", () => {
    const value = topic({ conflicts: [] });
    const { dialog } = drawer(value);
    const evidence = within(dialog).getByRole("region", { name: "Source evidence" });
    expect(evidence.querySelector('[data-evidence-layout="stacked"]')).not.toBeNull();
    for (const fact of value.facts) expect(within(evidence).getByText(fact.text)).toBeVisible();
});

it("shows the persisted human decision separately and preserves kept state without AI preselection", () => {
    const { dialog, onDecision } = drawer(
        topic({
            status: "kept",
            decision: {
                value: "go",
                text: "Explicit human record.",
                recordedAt: "2026-10-19T12:00:00Z",
            },
        })
    );
    expect(within(dialog).getByText("Your recorded decision")).toBeVisible();
    expect(within(dialog).getByText("Explicit human record.")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Kept" })).toBeDisabled();
    expect(onDecision).not.toHaveBeenCalled();
});
