/** @jest-environment jsdom */
import React from "react";
import { addDays } from "@launchstack/pipelines/vantage/week";
import { TextEncoder, TextDecoder } from "node:util";
import { ReadableStream } from "node:stream/web";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { renderWithLocale } from "~/i18n/testing/render";
import { ThisWeekScreen } from "~/app/employer/tools/vantage/_screens/ThisWeekScreen";

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
    return {
        ok,
        status: ok ? 200 : 403,
        text: async () => JSON.stringify(value),
        json: async () => value,
    };
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
                recommendation: null,
                proposedOwner: null,
                proposedDue: null,
                helpRequested: null,
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
    if (url.endsWith("/context"))
        return response({
            enabled: true,
            scopedEvidenceEnabled: false,
            documents: [{ id: "current-context", title: "Current context" }],
            canConfigure: false,
            policy: null,
            preferences: null,
        });
    if (options?.method === "POST") {
        if (url === "/api/vantage/reviews") {
            const text =
                ["gathering", "writing", "checking", "saving"]
                    .map(stage => JSON.stringify({ type: "stage", stage }))
                    .join("\n") +
                "\n" +
                JSON.stringify({ type: "result", result: report("generated") }) +
                "\n";
            return {
                ok: true,
                status: 200,
                body: new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode(text));
                        controller.close();
                    },
                }),
            };
        }
        return response({ version: 2 });
    }
    return response(report(url.split("/").at(-1)!));
}
function history(id: string) {
    fireEvent.change(screen.getByRole("combobox", { name: "Report history" }), {
        target: { value: id },
    });
}
let displayedWeek = weekA;
function changeWeek(value: string) {
    while (displayedWeek !== value) {
        const previous = displayedWeek > value;
        fireEvent.click(
            screen.getByRole("button", { name: previous ? "Previous week" : "Next week" })
        );
        displayedWeek = addDays(displayedWeek, previous ? -7 : 7);
    }
}
function saveButton() {
    return screen.getAllByRole("button", { name: "Record decision" })[0]!;
}
beforeEach(() => {
    displayedWeek = weekA;
    Object.defineProperty(globalThis, "TextEncoder", { configurable: true, value: TextEncoder });
    Object.defineProperty(globalThis, "TextDecoder", { configurable: true, value: TextDecoder });
    sessionStorage.clear();
    mockFetch.mockReset().mockImplementation(async (url, options) => defaultFetch(url, options));
    global.fetch = mockFetch;
    Object.defineProperty(global.crypto, "randomUUID", {
        configurable: true,
        value: () => "test-key",
    });
});

it("namespaces drafts by report and restores them when returning to history", async () => {
    renderWithLocale(<ThisWeekScreen week={weekA} />, "en");
    await screen.findByText("Report A");
    fireEvent.change(screen.getAllByLabelText("Your decision")[0]!, {
        target: { value: "A only" },
    });
    history("history");
    await screen.findByRole("heading", { name: "Report history" });
    expect(screen.getAllByLabelText("Your decision")[0]).toHaveValue("");
    history("A");
    await screen.findByText("Report A");
    expect(screen.getAllByLabelText("Your decision")[0]).toHaveValue("A only");
});

it("preserves both newer same-topic edits and other-topic edits while a save waits", async () => {
    const saving = deferred<ReturnType<typeof response>>();
    mockFetch.mockImplementation(async (url, options) =>
        url.endsWith("/decisions") ? saving.promise : defaultFetch(url, options)
    );
    renderWithLocale(<ThisWeekScreen week={weekA} />, "en");
    await screen.findByText("Report A");
    fireEvent.change(screen.getAllByLabelText("Your decision")[0]!, {
        target: { value: "submitted" },
    });
    fireEvent.click(saveButton());
    fireEvent.change(screen.getAllByLabelText("Your decision")[0]!, {
        target: { value: "newer" },
    });
    fireEvent.change(screen.getAllByLabelText("Your decision")[1]!, {
        target: { value: "other topic" },
    });
    await act(async () => {
        saving.resolve(response({}));
    });
    fireEvent.click(screen.getByRole("button", { name: "Decision 1: Question" }));
    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(screen.getAllByLabelText("Your decision")[0]).toHaveValue("newer");
    expect(screen.getAllByLabelText("Your decision")[1]).toHaveValue("other topic");
});

it("uses the true active pointer while displaying history and filters the chosen week", async () => {
    renderWithLocale(<ThisWeekScreen week={weekA} />, "en");
    await screen.findByText("Report A");
    expect(screen.queryByRole("option", { name: /2026-11-02/ })).not.toBeInTheDocument();
    history("history");
    await screen.findByRole("heading", { name: "Report history" });
    fireEvent.click(screen.getByRole("button", { name: /Generate review|Regenerate/ }));
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
    renderWithLocale(<ThisWeekScreen week={weekA} />, "en");
    await screen.findByRole("alert");
    expect(mockFetch).toHaveBeenCalledWith("/api/vantage/reviews/context", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: /Generate review|Regenerate/ }));
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
    renderWithLocale(<ThisWeekScreen week={weekA} />, "en");
    changeWeek(weekB);
    expect(screen.getByRole("button", { name: /Generate review|Regenerate/ })).toBeDisabled();
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
    renderWithLocale(<ThisWeekScreen week={weekA} />, "en");
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
    fireEvent.click(screen.getByRole("button", { name: "Sources used" }));
    expect(screen.getByText("Current context")).toBeInTheDocument();
    expect(screen.queryByText("Old context")).not.toBeInTheDocument();
});

it("does not reload an old report after a save completes in a new week", async () => {
    const saving = deferred<ReturnType<typeof response>>();
    mockFetch.mockImplementation(async (url, options) =>
        url.endsWith("/decisions") ? saving.promise : defaultFetch(url, options)
    );
    renderWithLocale(<ThisWeekScreen week={weekA} />, "en");
    await screen.findByText("Report A");
    fireEvent.change(screen.getAllByLabelText("Your decision")[0]!, {
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
    renderWithLocale(<ThisWeekScreen week={weekA} />, "en");
    await screen.findByText("Report A");
    fireEvent.change(screen.getAllByLabelText("Your decision")[0]!, {
        target: { value: "submitted" },
    });
    fireEvent.change(screen.getAllByLabelText("Your decision")[1]!, { target: { value: "keep" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getAllByLabelText("Your decision")[0]).toHaveValue(""));
    expect(screen.getAllByLabelText("Your decision")[1]).toHaveValue("keep");
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
    renderWithLocale(<ThisWeekScreen week={weekA} />, "en");
    await screen.findByText("Report A");
    fireEvent.change(screen.getAllByLabelText("Your decision")[0]!, {
        target: { value: "submitted" },
    });
    fireEvent.click(saveButton());
    fireEvent.change(screen.getAllByLabelText("Your decision")[0]!, {
        target: { value: "changed" },
    });
    fireEvent.change(screen.getAllByLabelText("Your decision")[0]!, {
        target: { value: "submitted" },
    });
    await act(async () => {
        saving.resolve(response({}));
    });
    fireEvent.click(screen.getByRole("button", { name: "Decision 1: Question" }));
    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(screen.getAllByLabelText("Your decision")[0]).toHaveValue("submitted");
});

it("keeps generation disabled when the new week list fails", async () => {
    mockFetch.mockImplementation(async (url, options) =>
        url.endsWith(`weekStart=${weekB}`)
            ? response({ error: "review_unavailable" }, false)
            : defaultFetch(url, options)
    );
    renderWithLocale(<ThisWeekScreen week={weekA} />, "en");
    await screen.findByText("Report A");
    changeWeek(weekB);
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: /Generate review|Regenerate/ })).toBeDisabled();
    expect(screen.queryByText("Report A")).not.toBeInTheDocument();
});

it("keeps the accepted report and marks the observed stage when quality checks fail", async () => {
    mockFetch.mockImplementation(async (url, options) => {
        if (url !== "/api/vantage/reviews" || options?.method !== "POST")
            return defaultFetch(url, options);
        return {
            ok: true,
            status: 200,
            body: new ReadableStream({
                start(controller) {
                    for (const event of [
                        { type: "stage", stage: "gathering" },
                        { type: "stage", stage: "writing" },
                        { type: "stage", stage: "checking" },
                        { type: "error", error: "candidate_not_admitted", status: 409 },
                    ])
                        controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + "\n"));
                    controller.close();
                },
            }),
        };
    });
    renderWithLocale(<ThisWeekScreen week={weekA} />, "en");
    await screen.findByText("Report A");
    fireEvent.click(screen.getByRole("button", { name: /Generate review|Regenerate/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
        "The new report did not pass quality checks, so your previous report is still shown."
    );
    expect(screen.getByText("Report A")).toBeInTheDocument();
    expect(document.querySelector('[data-stage="checking"]')).toHaveAttribute(
        "data-state",
        "failedStatus"
    );
    expect(document.querySelector('[data-stage="saving"]')).toHaveAttribute(
        "data-state",
        "pending"
    );
});

it("does not advance a stalled server stage on the elapsed timer", async () => {
    let finish!: () => void;
    mockFetch.mockImplementation(async (url, options) => {
        if (url !== "/api/vantage/reviews" || options?.method !== "POST")
            return defaultFetch(url, options);
        return {
            ok: true,
            status: 200,
            body: new ReadableStream({
                start(controller) {
                    controller.enqueue(
                        new TextEncoder().encode('{"type":"stage","stage":"gathering"}\n')
                    );
                    finish = () => {
                        controller.enqueue(
                            new TextEncoder().encode(
                                JSON.stringify({ type: "result", result: report("generated") }) +
                                    "\n"
                            )
                        );
                        controller.close();
                    };
                },
            }),
        };
    });
    renderWithLocale(<ThisWeekScreen week={weekA} />, "en");
    await screen.findByText("Report A");
    fireEvent.click(screen.getByRole("button", { name: /Generate review|Regenerate/ }));
    await waitFor(() =>
        expect(document.querySelector('[data-stage="gathering"]')).toHaveAttribute(
            "data-state",
            "active"
        )
    );
    jest.useFakeTimers();
    try {
        act(() => {
            jest.advanceTimersByTime(60000);
        });
        expect(document.querySelector('[data-stage="gathering"]')).toHaveAttribute(
            "data-state",
            "active"
        );
        expect(document.querySelector('[data-stage="writing"]')).toHaveAttribute(
            "data-state",
            "pending"
        );
        await act(async () => {
            finish();
        });
    } finally {
        jest.useRealTimers();
    }
    expect(await screen.findByText("Report generated")).toBeInTheDocument();
    expect(document.querySelector('[data-stage="writing"]')).toHaveAttribute(
        "data-state",
        "pending"
    );
});
