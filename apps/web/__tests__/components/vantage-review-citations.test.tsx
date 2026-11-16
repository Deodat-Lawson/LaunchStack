/** @jest-environment jsdom */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
jest.mock("next-intl", () => ({
    useTranslations: () => (key: string, values?: Record<string, unknown>) =>
        values ? `${key} ${Object.values(values).join(" ")}` : key,
}));
jest.mock("~/app/employer/tools/vantage/_lib/weekly-review-errors", () => ({
    useWeeklyReviewErrorText: () => () => "Request failed",
}));
jest.mock("~/app/employer/tools/vantage/_lib/format", () => ({
    useVantageFormat: () => ({
        date: (value: string) => value,
        dateLong: (value: string) => value,
        dateTime: (value: string) => value,
        list: (values: string[]) => values.join(", "),
        number: (value: number) => String(value),
    }),
}));
jest.mock("~/components/tool-app/nav", () => ({ useOptionalToolNav: () => null }));

import { ReviewCitationDialog } from "~/app/employer/tools/vantage/_components/ReviewCitationDialog";
import { ReviewCitationChips } from "~/app/employer/tools/vantage/_components/ReviewCitationChips";
import { weeklyReviewApi } from "~/app/employer/tools/vantage/api";
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
beforeEach(() => jest.clearAllMocks());
test("chips show known title and version and preserve unknown ref fallback", () => {
    const inspect = jest.fn();
    render(
        <ReviewCitationChips
            refs={["doc:1@7", "unknown-ref"]}
            sources={[{ ref: "doc:1@7", title: "Architecture", version: "7" }]}
            onInspect={inspect}
        />
    );
    fireEvent.click(screen.getByRole("button", { name: "founder.sourceVersion Architecture 7" }));
    expect(inspect).toHaveBeenCalledWith("doc:1@7");
    expect(screen.getByRole("button", { name: "unknown-ref" })).toBeVisible();
});
test("citation dialog shows frozen text and ignores a stale response after switching", async () => {
    const first = deferred<any>();
    const second = deferred<any>();
    (weeklyReviewApi.evidence as jest.Mock)
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
    const view = render(
        <ReviewCitationDialog reportId="run-a" reference="doc:1@7" onClose={jest.fn()} />
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
    fireEvent.click(screen.getByRole("button", { name: "founder.technicalDetails" }));
    expect(screen.getByText('"hash": "hash"', { exact: false })).toBeVisible();
});
