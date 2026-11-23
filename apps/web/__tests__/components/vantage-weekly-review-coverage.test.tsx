/** @jest-environment jsdom */
import React from "react";
import { fireEvent, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { renderWithLocale } from "~/i18n/testing/render";
import zhVantage from "~/i18n/messages/zh-CN/vantage.json";
import { ReportSources } from "~/app/employer/tools/vantage/_components/ReportSources";
import type {
    WeeklyReviewContextDto,
    WeeklyReviewDto,
} from "~/server/vantage/weekly-review-client-types";

function review(state = "relevant_spans_reviewed") {
    return {
        id: "accepted-review",
        version: 1,
        decisions: [],
        report: {
            headline: "Accepted report",
            brief: "Brief",
            summary: "Summary",
            keyFigures: [],
            topics: [],
        },
        evidence: {
            inputSnapshot: {
                sources: [{ ref: "doc:101@202", title: "Release evidence", version: "202" }],
                scopedEvidence: [
                    {
                        documentId: "101",
                        parentVersion: "202",
                        scopeHash: "scope-hash",
                        units: [],
                        coverage: {
                            state,
                            qualification: "Pricing decision spans approved by the administrator",
                            includedUnits: 2,
                            requiredUnits: 2,
                            originalCompleteness: "unknown",
                        },
                    },
                ],
            },
        },
    } as unknown as WeeklyReviewDto;
}
const context = {
    enabled: true,
    canConfigure: true,
    scopedEvidenceEnabled: false,
    policy: null,
    preferences: null,
    documents: [
        { id: "101", title: "Release evidence", category: "Shared" },
        { id: "102", title: "Security review not selected", category: "Shared" },
    ],
} satisfies WeeklyReviewContextDto;

it("keeps coverage collapsed at the bottom and preserves frozen qualifications with scope creation off", () => {
    renderWithLocale(
        <ReportSources review={review()} context={context} onInspect={jest.fn()} />,
        "en"
    );
    expect(screen.queryByText("Relevant configured spans reviewed")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sources used" }));
    expect(screen.getByText("Relevant configured spans reviewed")).toBeVisible();
    expect(screen.getByText("Pricing decision spans approved by the administrator")).toBeVisible();
    expect(screen.getByText("Reviewed 2 of 2 required evidence units.")).toBeVisible();
    expect(
        screen.getByText("Completeness of the original PDF or OCR extraction is unknown.")
    ).toBeVisible();
    expect(
        screen.getByText(
            "Review coverage is limited to the configured spans of canonical indexed text."
        )
    ).toBeVisible();
    const source = screen.getByRole("button", { name: "Source 1: Release evidence, version 202" });
    expect(source).toBeVisible();
    expect(source).toHaveTextContent(/^1$/);
    expect(screen.getByText("Release evidence — version 202", { selector: "span" })).toBeVisible();
    expect(screen.queryByText("doc:101@202")).not.toBeInTheDocument();
});

it("shows current readable sources not selected without performing retrieval", () => {
    const fetch = jest.fn();
    global.fetch = fetch;
    renderWithLocale(
        <ReportSources review={review()} context={context} onInspect={jest.fn()} />,
        "en"
    );
    fireEvent.click(screen.getByRole("button", { name: "Sources used" }));
    expect(screen.getByText("Security review not selected")).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
});

it.each([
    ["full_document_reviewed", "Full canonical indexed text reviewed"],
    ["insufficient_evidence", "Insufficient evidence"],
])("renders the frozen %s state in words", (state, label) => {
    renderWithLocale(
        <ReportSources review={review(state)} context={context} onInspect={jest.fn()} />,
        "en"
    );
    fireEvent.click(screen.getByRole("button", { name: "Sources used" }));
    expect(screen.getByText(label)).toBeVisible();
    expect(
        screen.queryByText(
            "Review coverage is limited to the configured spans of canonical indexed text."
        )
    ).not.toBeInTheDocument();
});

it("does not invent scoped coverage when a supported whole-document report has none", () => {
    const saved = review();
    saved.evidence = {};
    renderWithLocale(<ReportSources review={saved} context={null} onInspect={jest.fn()} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Sources used" }));
    expect(screen.queryByText("Relevant configured spans reviewed")).not.toBeInTheDocument();
    expect(screen.queryByText("Full canonical indexed text reviewed")).not.toBeInTheDocument();
});

it("renders scope qualifications in Simplified Chinese", () => {
    renderWithLocale(
        <ReportSources review={review()} context={context} onInspect={jest.fn()} />,
        "zh-CN"
    );
    fireEvent.click(
        screen.getByRole("button", { name: zhVantage.weeklyReview.founder.sourcesUsed })
    );
    expect(screen.getByText("已审阅配置的相关文本片段")).toBeVisible();
    expect(screen.getByText("原始 PDF 或 OCR 提取的完整性未知。")).toBeVisible();
});
