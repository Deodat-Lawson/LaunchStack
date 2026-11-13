/** @jest-environment jsdom */
import React from "react";
import { screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { renderWithLocale } from "~/i18n/testing/render";
import { WeeklyReviewEntry } from "~/app/employer/tools/vantage/_screens/WeeklyReviewEntry";

jest.mock("~/app/employer/tools/vantage/_screens/AgendaScreen", () => ({
    AgendaScreen: () => <p>Legacy agenda</p>,
}));

const mockFetch = jest.fn();
const coverage = {
    state: "relevant_spans_reviewed",
    qualification: "Pricing decision spans approved by workspace admin",
    includedUnits: 2,
    requiredUnits: 2,
    reviewedRepresentation: "canonical_indexed_text",
    originalCompleteness: "unknown",
};

function savedReview(state = coverage.state) {
    return {
        id: "accepted-review",
        version: 1,
        report: {
            headline: "Accepted report",
            brief: "Brief",
            summary: "Summary",
            keyFigures: [],
            topics: [],
        },
        decisions: [],
        evidence: {
            inputSnapshot: {
                scopedEvidence: [
                    {
                        documentId: "101",
                        parentVersion: "version-2",
                        scopeHash: "scope-hash",
                        coverage: { ...coverage, state },
                    },
                ],
            },
        },
    };
}

function mockResponses({
    enabled = true,
    state = coverage.state,
    legacy = false,
    empty = false,
} = {}) {
    mockFetch.mockImplementation(async (url: string) => {
        let value: unknown;
        if (url.includes("?weekStart=")) {
            value = {
                enabled,
                scopedEvidenceEnabled: false,
                activeId: empty ? null : "accepted-review",
                runs: empty
                    ? []
                    : [
                          {
                              id: "accepted-review",
                              status: "accepted",
                              week_start: "2026-11-09",
                              created_at: "2026-11-10T12:00:00Z",
                          },
                      ],
            };
        } else if (url.endsWith("/context")) {
            value = { canConfigure: false, documents: [] };
        } else {
            const saved = savedReview(state);
            value = legacy ? { ...saved, evidence: {} } : saved;
        }
        return { ok: true, json: async () => value };
    });
}

beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch;
});

it("keeps scoped accepted history qualified with scoped evidence disabled", async () => {
    mockResponses();
    renderWithLocale(<WeeklyReviewEntry week="2026-11-09" />, "en");
    expect(await screen.findByText("Relevant configured spans reviewed")).toBeInTheDocument();
    expect(screen.getByText(coverage.qualification)).toBeInTheDocument();
    expect(screen.getByText("Reviewed 2 of 2 required evidence units.")).toBeInTheDocument();
    expect(
        screen.getByText("Completeness of the original PDF or OCR extraction is unknown.")
    ).toBeInTheDocument();
    expect(
        screen.getByText(
            "Review coverage is limited to the configured spans of canonical indexed text."
        )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate review" })).toBeEnabled();
    expect(screen.queryByText("Legacy agenda")).not.toBeInTheDocument();
});

it("renders Chinese coverage and original completeness qualification", async () => {
    mockResponses({ enabled: true });
    renderWithLocale(<WeeklyReviewEntry week="2026-11-09" />, "zh-CN");
    expect(await screen.findByText("已审阅配置的相关文本片段")).toBeInTheDocument();
    expect(screen.getByText("原始 PDF 或 OCR 提取的完整性未知。")).toBeInTheDocument();
});

it.each([
    ["full_document_reviewed", "Full canonical indexed text reviewed"],
    ["insufficient_evidence", "Insufficient evidence"],
])("renders the stored %s coverage state", async (state, label) => {
    mockResponses({ state });
    renderWithLocale(<WeeklyReviewEntry week="2026-11-09" />, "en");
    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(
        screen.queryByText(
            "Review coverage is limited to the configured spans of canonical indexed text."
        )
    ).not.toBeInTheDocument();
});

it("reads historical unscoped evidence without inventing scoped coverage", async () => {
    mockResponses({ legacy: true });
    renderWithLocale(<WeeklyReviewEntry week="2026-11-09" />, "en");
    expect(await screen.findByText("Accepted report")).toBeInTheDocument();
    expect(
        screen.queryByRole("region", { name: "Source review coverage" })
    ).not.toBeInTheDocument();
});

it("keeps the agenda fallback when disabled with no accepted report", async () => {
    mockResponses({ enabled: false, empty: true });
    renderWithLocale(<WeeklyReviewEntry week="2026-11-09" />, "en");
    expect(await screen.findByText("Legacy agenda")).toBeInTheDocument();
});
