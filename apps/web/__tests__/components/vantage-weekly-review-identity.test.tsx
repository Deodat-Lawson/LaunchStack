/** @jest-environment jsdom */
import React from "react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { renderWithLocale } from "~/i18n/testing/render";
import { WeeklyReviewEntry } from "~/app/employer/tools/vantage/_screens/WeeklyReviewEntry";

jest.mock("~/app/employer/tools/vantage/_screens/AgendaScreen", () => ({
    AgendaScreen: () => <p>Legacy agenda</p>,
}));
jest.mock("~/components/ui/select", () => ({
    Select: ({ children, value, onValueChange, disabled }: any) => (
        <select
            aria-label="Report history"
            value={value ?? ""}
            disabled={disabled}
            onChange={event => onValueChange(event.target.value)}
        >
            {children}
        </select>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: any) => <>{children}</>,
    SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
}));

const mockFetch = jest.fn();
const weekA = "2026-11-09";
const weekB = "2026-11-02";
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => {
        resolve = done;
    });
    return { promise, resolve };
}
function response(value: unknown, ok = true) {
    return { ok, json: async () => value };
}
function report(id: string) {
    return {
        id,
        version: 1,
        decisions: [],
        evidence: {},
        report: {
            headline: `Report ${id}`,
            brief: "Brief",
            summary: "Summary",
            keyFigures: [],
            topics: ["topic-0", "topic-1"].map(id => ({
                id,
                title: id,
                facts: [],
                conflicts: [],
                whyItMatters: "Why",
                whyNow: "Now",
                decisionQuestion: "Question",
                rationale: "Rationale",
                proposedNextStep: "Next",
                unknowns: [],
            })),
        },
    };
}
function list(activeId: string, week = weekA) {
    return {
        enabled: true,
        activeId,
        runs: [
            { id: activeId, status: "accepted", week_start: week, created_at: "2026-11-10" },
            { id: "history", status: "accepted", week_start: weekA, created_at: "2026-11-09" },
            { id: "other-week", status: "accepted", week_start: weekB, created_at: "2026-11-02" },
        ],
    };
}
function defaultFetch(url: string, options?: RequestInit): unknown {
    if (url.includes("?weekStart="))
        return response(list(url.endsWith(weekB) ? "B" : "A", url.endsWith(weekB) ? weekB : weekA));
    if (url.endsWith("/context/role"))
        return response({ role: null, version: 0, canEdit: true, enabled: true });
    if (url.endsWith("/context")) return response({ documents: [], canConfigure: false });
    if (options?.method === "POST") return response(report("generated"));
    return response(report(url.split("/").at(-1)!));
}
function history(id: string) {
    fireEvent.change(screen.getByRole("combobox", { name: "Report history" }), {
        target: { value: id },
    });
}
function changeWeek(value: string) {
    fireEvent.change(screen.getByLabelText("Reporting week"), { target: { value } });
}
function saveButton() {
    return screen.getAllByRole("button", { name: "Record decision" })[0]!;
}
beforeEach(() => {
    mockFetch.mockReset().mockImplementation(async (url, options) => defaultFetch(url, options));
    global.fetch = mockFetch;
    Object.defineProperty(global.crypto, "randomUUID", {
        configurable: true,
        value: () => "test-key",
    });
});

it("namespaces drafts by report and restores them when returning to history", async () => {
    renderWithLocale(<WeeklyReviewEntry week={weekA} />, "en");
    await screen.findByText("Report A");
    fireEvent.change(screen.getAllByLabelText("Human decision")[0]!, {
        target: { value: "A only" },
    });
    history("history");
    await screen.findByRole("heading", { name: "Report history" });
    expect(screen.getAllByLabelText("Human decision")[0]).toHaveValue("");
    history("A");
    await screen.findByText("Report A");
    expect(screen.getAllByLabelText("Human decision")[0]).toHaveValue("A only");
});

it("preserves both newer same-topic edits and other-topic edits while a save waits", async () => {
    const saving = deferred<ReturnType<typeof response>>();
    mockFetch.mockImplementation(async (url, options) =>
        url.endsWith("/decisions") ? saving.promise : defaultFetch(url, options)
    );
    renderWithLocale(<WeeklyReviewEntry week={weekA} />, "en");
    await screen.findByText("Report A");
    fireEvent.change(screen.getAllByLabelText("Human decision")[0]!, {
        target: { value: "submitted" },
    });
    fireEvent.click(saveButton());
    fireEvent.change(screen.getAllByLabelText("Human decision")[0]!, {
        target: { value: "newer" },
    });
    fireEvent.change(screen.getAllByLabelText("Human decision")[1]!, {
        target: { value: "other topic" },
    });
    await act(async () => {
        saving.resolve(response({}));
    });
    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(screen.getAllByLabelText("Human decision")[0]).toHaveValue("newer");
    expect(screen.getAllByLabelText("Human decision")[1]).toHaveValue("other topic");
});

it("uses the true active pointer while displaying history and filters the chosen week", async () => {
    renderWithLocale(<WeeklyReviewEntry week={weekA} />, "en");
    await screen.findByText("Report A");
    expect(screen.queryByRole("option", { name: /2026-11-02/ })).not.toBeInTheDocument();
    history("history");
    await screen.findByRole("heading", { name: "Report history" });
    fireEvent.click(screen.getByRole("button", { name: "Generate review" }));
    await waitFor(() =>
        expect(mockFetch).toHaveBeenCalledWith(
            "/api/vantage/reviews",
            expect.objectContaining({
                body: JSON.stringify({ weekStart: weekA, expectedActiveId: "A" }),
            })
        )
    );
});

it("loads context and permits replacement when the active report cannot be read", async () => {
    mockFetch.mockImplementation(async (url, options) =>
        url.endsWith("/A")
            ? response({ error: "source_access_denied" }, false)
            : defaultFetch(url, options)
    );
    renderWithLocale(<WeeklyReviewEntry week={weekA} />, "en");
    await screen.findByRole("alert");
    expect(mockFetch).toHaveBeenCalledWith("/api/vantage/reviews/context", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Generate review" }));
    await waitFor(() =>
        expect(mockFetch).toHaveBeenCalledWith(
            "/api/vantage/reviews",
            expect.objectContaining({
                body: JSON.stringify({ weekStart: weekA, expectedActiveId: "A" }),
            })
        )
    );
});

it("ignores a late week list and disables generation until the selected week loads", async () => {
    const oldList = deferred<ReturnType<typeof response>>();
    mockFetch.mockImplementation(async (url, options) =>
        url.endsWith(`weekStart=${weekA}`) ? oldList.promise : defaultFetch(url, options)
    );
    renderWithLocale(<WeeklyReviewEntry week={weekA} />, "en");
    changeWeek(weekB);
    expect(screen.getByRole("button", { name: "Generate review" })).toBeDisabled();
    await screen.findByText("Report B");
    await act(async () => {
        oldList.resolve(response(list("A")));
    });
    expect(screen.getByText("Report B")).toBeInTheDocument();
    expect(screen.queryByText("Report A")).not.toBeInTheDocument();
});

it("ignores late report and context results from the previous week", async () => {
    const oldReport = deferred<ReturnType<typeof response>>();
    const oldContext = deferred<ReturnType<typeof response>>();
    let contexts = 0;
    mockFetch.mockImplementation(async (url, options) => {
        if (url.endsWith("/A")) return oldReport.promise;
        if (url.endsWith("/context") && contexts++ === 0) return oldContext.promise;
        return defaultFetch(url, options);
    });
    renderWithLocale(<WeeklyReviewEntry week={weekA} />, "en");
    await waitFor(() =>
        expect(mockFetch).toHaveBeenCalledWith("/api/vantage/reviews/A", expect.anything())
    );
    changeWeek(weekB);
    await screen.findByText("Report B");
    await act(async () => {
        oldReport.resolve(response(report("A")));
        oldContext.resolve(
            response({
                canConfigure: true,
                documents: [{ id: "secret-old", title: "Old context" }],
            })
        );
    });
    expect(screen.getByText("Report B")).toBeInTheDocument();
    expect(screen.queryByText("Old context")).not.toBeInTheDocument();
});

it("does not reload an old report after a save completes in a new week", async () => {
    const saving = deferred<ReturnType<typeof response>>();
    mockFetch.mockImplementation(async (url, options) =>
        url.endsWith("/decisions") ? saving.promise : defaultFetch(url, options)
    );
    renderWithLocale(<WeeklyReviewEntry week={weekA} />, "en");
    await screen.findByText("Report A");
    fireEvent.change(screen.getAllByLabelText("Human decision")[0]!, {
        target: { value: "submitted" },
    });
    fireEvent.click(saveButton());
    changeWeek(weekB);
    await screen.findByText("Report B");
    const readsBefore = mockFetch.mock.calls.filter(([url]) => url.endsWith("/A")).length;
    await act(async () => {
        saving.resolve(response({}));
    });
    expect(screen.getByText("Report B")).toBeInTheDocument();
    expect(mockFetch.mock.calls.filter(([url]) => url.endsWith("/A"))).toHaveLength(readsBefore);
});

it("clears only the submitted unchanged draft after a successful save", async () => {
    renderWithLocale(<WeeklyReviewEntry week={weekA} />, "en");
    await screen.findByText("Report A");
    fireEvent.change(screen.getAllByLabelText("Human decision")[0]!, {
        target: { value: "submitted" },
    });
    fireEvent.change(screen.getAllByLabelText("Human decision")[1]!, { target: { value: "keep" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getAllByLabelText("Human decision")[0]).toHaveValue(""));
    expect(screen.getAllByLabelText("Human decision")[1]).toHaveValue("keep");
    expect(mockFetch).toHaveBeenCalledWith(
        "/api/vantage/reviews/A/decisions",
        expect.objectContaining({
            body: JSON.stringify({ expectedVersion: 1, topicId: "topic-0", decision: "submitted" }),
        })
    );
});

it("keeps a new edit even when it returns to the submitted text", async () => {
    const saving = deferred<ReturnType<typeof response>>();
    mockFetch.mockImplementation(async (url, options) =>
        url.endsWith("/decisions") ? saving.promise : defaultFetch(url, options)
    );
    renderWithLocale(<WeeklyReviewEntry week={weekA} />, "en");
    await screen.findByText("Report A");
    fireEvent.change(screen.getAllByLabelText("Human decision")[0]!, {
        target: { value: "submitted" },
    });
    fireEvent.click(saveButton());
    fireEvent.change(screen.getAllByLabelText("Human decision")[0]!, {
        target: { value: "changed" },
    });
    fireEvent.change(screen.getAllByLabelText("Human decision")[0]!, {
        target: { value: "submitted" },
    });
    await act(async () => {
        saving.resolve(response({}));
    });
    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(screen.getAllByLabelText("Human decision")[0]).toHaveValue("submitted");
});

it("keeps generation disabled when the new week list fails", async () => {
    mockFetch.mockImplementation(async (url, options) =>
        url.endsWith(`weekStart=${weekB}`)
            ? response({ error: "review_unavailable" }, false)
            : defaultFetch(url, options)
    );
    renderWithLocale(<WeeklyReviewEntry week={weekA} />, "en");
    await screen.findByText("Report A");
    changeWeek(weekB);
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Generate review" })).toBeDisabled();
    expect(screen.queryByText("Report A")).not.toBeInTheDocument();
});
