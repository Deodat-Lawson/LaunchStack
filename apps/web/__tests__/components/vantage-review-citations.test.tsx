/** @jest-environment jsdom */
import React from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { renderWithLocale } from "~/i18n/testing/render";
jest.mock("~/app/employer/tools/vantage/_lib/weekly-review-errors", () => ({
    useWeeklyReviewErrorText: () => () => "Request failed",
}));
import { ReviewCitationDialog } from "~/app/employer/tools/vantage/_components/ReviewCitationDialog";
import {
    ReviewCitationChips,
    reviewSources,
} from "~/app/employer/tools/vantage/_components/ReviewCitationChips";
import { weeklyReviewApi } from "~/app/employer/tools/vantage/api";
import type { WeeklyReviewDto } from "~/server/vantage/weekly-review-client-types";
jest.mock("~/app/employer/tools/vantage/api", () => ({ weeklyReviewApi: { evidence: jest.fn() } }));
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => {
        resolve = done;
    });
    return { promise, resolve };
}
const evidence = (title: string) => ({
    title,
    version: "7",
    ref: "doc:1@7",
    text: "Frozen excerpt",
    hash: "hash",
    purpose: "company-architecture",
    scope: null,
});
const originalResizeObserver = globalThis.ResizeObserver;
beforeAll(() => {
    // Radix measures the focused Tooltip trigger; jsdom has no layout observer.
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
});
afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
});
beforeEach(() => jest.clearAllMocks());
test("chips show only their report number while labels retain title, version and unknown-ref fallback", () => {
    const inspect = jest.fn();
    renderWithLocale(
        <ReviewCitationChips
            refs={["doc:1@7", "unknown-ref"]}
            sources={[{ ref: "doc:1@7", title: "Architecture", version: "7" }]}
            onInspect={inspect}
        />,
        "en"
    );
    const chip = screen.getByRole("button", { name: "Source 1: Architecture, version 7" });
    expect(chip).toHaveTextContent(/^1$/);
    fireEvent.click(chip);
    expect(inspect).toHaveBeenCalledWith("doc:1@7");
    expect(screen.getByRole("button", { name: "Source 2: unknown-ref" })).toHaveTextContent(/^2$/);
});

test("one report inventory deduplicates frozen refs and numbers missing metadata after them", () => {
    const report = {
        report: {
            keyFigures: [{ refs: ["doc:2@8"] }],
            topics: [
                {
                    facts: [{ refs: ["doc:1@7", "unavailable-ref"] }],
                    conflicts: [],
                    recommendation: { refs: ["doc:1@7"] },
                },
            ],
        },
        evidence: {
            inputSnapshot: {
                sources: [
                    { ref: "doc:1@7", title: "Architecture", version: "7" },
                    { ref: "doc:1@7", title: "Architecture", version: "7" },
                    { ref: "doc:2@8", title: "QA evidence", version: "8" },
                ],
            },
        },
    } as unknown as WeeklyReviewDto;
    const sources = reviewSources(report);
    expect(sources.map(source => source.ref)).toEqual(["doc:1@7", "doc:2@8", "unavailable-ref"]);
    renderWithLocale(
        <>
            <ReviewCitationChips
                refs={["doc:2@8", "doc:1@7", "doc:1@7"]}
                sources={sources}
                onInspect={jest.fn()}
            />
            <ReviewCitationChips
                refs={["doc:1@7", "unavailable-ref"]}
                sources={sources}
                onInspect={jest.fn()}
            />
        </>,
        "en"
    );
    expect(
        screen.getAllByRole("button", { name: "Source 1: Architecture, version 7" })
    ).toHaveLength(2);
    expect(
        screen.getByRole("button", { name: "Source 2: QA evidence, version 8" })
    ).toHaveTextContent(/^2$/);
    expect(screen.getByRole("button", { name: "Source 3: unavailable-ref" })).toHaveTextContent(
        /^3$/
    );
});

test("keyboard focus reveals title and version and clicking the numbered chip opens the evidence dialog", async () => {
    (weeklyReviewApi.evidence as jest.Mock).mockResolvedValue(evidence("Architecture"));
    function Harness() {
        const [reference, setReference] = React.useState<string | null>(null);
        return (
            <>
                <ReviewCitationChips
                    refs={["doc:1@7"]}
                    sources={[{ ref: "doc:1@7", title: "Architecture", version: "7" }]}
                    onInspect={setReference}
                />
                <ReviewCitationDialog
                    reportId="run"
                    reference={reference}
                    onClose={() => setReference(null)}
                />
            </>
        );
    }
    renderWithLocale(<Harness />, "en");
    const chip = screen.getByRole("button", { name: "Source 1: Architecture, version 7" });
    act(() => chip.focus());
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Architecture — version 7");
    fireEvent.click(chip);
    expect(await screen.findByText("Frozen excerpt")).toBeVisible();
    expect(screen.getByRole("dialog")).toHaveTextContent("Architecture");
    expect(weeklyReviewApi.evidence).toHaveBeenCalledWith("run", "doc:1@7");
});
test("citation dialog shows frozen text and ignores a stale response after switching", async () => {
    const first = deferred<any>();
    const second = deferred<any>();
    (weeklyReviewApi.evidence as jest.Mock)
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
    const view = renderWithLocale(
        <ReviewCitationDialog reportId="run-a" reference="doc:1@7" onClose={jest.fn()} />,
        "en"
    );
    view.rerender(
        <ReviewCitationDialog reportId="run-b" reference="doc:2@8" onClose={jest.fn()} />
    );
    await act(async () => {
        second.resolve(evidence("Current source"));
    });
    expect(screen.getByRole("dialog")).toHaveTextContent("Current source");
    expect(screen.getByText("Frozen excerpt")).toBeVisible();
    expect(screen.queryByText('"hash": "hash"', { exact: false })).not.toBeInTheDocument();
    await act(async () => {
        first.resolve(evidence("Stale source"));
    });
    expect(screen.queryByText("Stale source")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Technical details" }));
    expect(screen.getByText('"hash": "hash"', { exact: false })).toBeVisible();
});
