/** @jest-environment jsdom */

import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import {
    QUEUE_STAGE_IDS,
    type ProcessingQueueItem,
    type ProcessingQueueResponse,
    type QueueStage,
} from "~/lib/processing-queue/types";

import { translatorFor } from "~/i18n/translate";

import { ProcessingQueuePane } from "../processing/ProcessingQueuePane";
import { resetProcessingQueueForTests } from "../processing/queueStore";
import { resetLocalTasksForTests } from "../processing/uploadTasks";

/**
 * The Processing tab against a stubbed queue: sections in the right order,
 * stage bars that assistive tech can read, Retry on a failed file, "Mine",
 * and what it says when there is nothing to show.
 */

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const NOW = Date.now();
const iso = (offset: number) => new Date(NOW + offset).toISOString();

function stages(active: QueueStage["id"], status: QueueStage["status"] = "active"): QueueStage[] {
    const at = QUEUE_STAGE_IDS.indexOf(active);
    return QUEUE_STAGE_IDS.map((id, i) => ({
        id,
        status: i < at ? "done" : i === at ? status : "pending",
        startedAt: i <= at ? iso(-5_000) : null,
        endedAt: i < at ? iso(-4_000) : null,
        ...(id === "indexing" && i === at ? { done: 30, total: 120 } : {}),
    }));
}

function item(overrides: Partial<ProcessingQueueItem>): ProcessingQueueItem {
    return {
        jobId: "job",
        documentId: 1,
        name: "file.pdf",
        folder: "Board",
        mimeType: "application/pdf",
        addedById: "me",
        mine: true,
        state: "running",
        stage: "indexing",
        stages: stages("indexing"),
        attempt: 1,
        maxAttempts: 8,
        nextAttemptAt: null,
        error: null,
        pageCount: 12,
        provider: "Docling",
        createdAt: iso(-60_000),
        startedAt: iso(-30_000),
        completedAt: null,
        canRetry: false,
        retryCount: 0,
        ...overrides,
    };
}

let queue: ProcessingQueueResponse;
let fetchMock: jest.Mock;

function respond(body: unknown, status = 200) {
    return Promise.resolve({
        ok: status < 400,
        status,
        json: () => Promise.resolve(body),
    });
}

beforeEach(() => {
    resetProcessingQueueForTests();
    resetLocalTasksForTests();
    window.localStorage.clear();
    queue = {
        items: [
            item({ jobId: "running", name: "Q3 board deck.pdf" }),
            item({
                jobId: "failed",
                name: "Vendor contract.docx",
                state: "failed",
                stage: "reading",
                stages: stages("reading", "failed"),
                completedAt: iso(-60_000),
                documentId: 77,
                error: "pipeline dead after max attempts: Document converter /convert failed: 503",
                canRetry: true,
                addedById: "them",
                mine: false,
            }),
            item({
                jobId: "waiting",
                name: "Notes.md",
                state: "waiting",
                stage: "waiting",
                stages: stages("waiting"),
            }),
            item({
                jobId: "done",
                name: "Update.pdf",
                state: "done",
                stage: "ready",
                stages: QUEUE_STAGE_IDS.map(id => ({
                    id,
                    status: "done" as const,
                    startedAt: iso(-20_000),
                    endedAt: iso(-10_000),
                })),
                completedAt: iso(-10_000),
            }),
        ],
        connectors: [],
        summary: { running: 1, waiting: 1, retrying: 0, failed: 1, done: 1 },
        serverTime: iso(0),
    };
    fetchMock = jest.fn((url: string, init?: RequestInit) => {
        if (url.startsWith("/api/profile/people")) {
            return respond({
                people: {
                    them: {
                        authUserId: "them",
                        name: "Priya Natarajan",
                        email: "priya@example.com",
                        displayName: "Priya Natarajan",
                        title: null,
                        pronouns: null,
                        avatarUrl: null,
                        member: true,
                    },
                },
            });
        }
        if (url === "/api/documents/77/retry" && init?.method === "POST") {
            const requeued = item({
                jobId: "failed",
                name: "Vendor contract.docx",
                state: "waiting",
                stage: "waiting",
                stages: stages("waiting"),
                mine: false,
                addedById: "them",
            });
            // The server re-queued it: later polls see it waiting too.
            queue = {
                ...queue,
                items: queue.items.map(i => (i.jobId === "failed" ? requeued : i)),
            };
            return respond({ status: "retrying", stage: "extraction", retryCount: 1 }, 202);
        }
        if (url === "/api/documents/processing-queue") return respond(queue);
        return respond({}, 404);
    });
    global.fetch = fetchMock as unknown as typeof fetch;
});

function mount(props: Partial<React.ComponentProps<typeof ProcessingQueuePane>> = {}) {
    return render(<ProcessingQueuePane viewerId="me" storageScope="me:1" {...props} />);
}

describe("ProcessingQueuePane", () => {
    it("lists files under Needs attention, Running now, Waiting and Finished, in that order", async () => {
        mount();
        expect(await screen.findByText("Q3 board deck.pdf")).toBeInTheDocument();
        const headings = screen.getAllByRole("heading", { level: 2 }).map(h => h.textContent);
        expect(headings).toEqual(["Needs attention1", "Running now1", "Waiting1", "Finished1"]);
        expect(screen.getByTestId("processing-summary")).toHaveTextContent(
            "1 running · 1 waiting · 1 needs attention"
        );
    });

    it("draws each file's stage as a progressbar a screen reader can read", async () => {
        mount();
        await screen.findByText("Q3 board deck.pdf");
        const bar = screen.getByRole("progressbar", { name: "Q3 board deck.pdf: processing" });
        expect(bar).toHaveAttribute("aria-valuenow", "4");
        expect(bar).toHaveAttribute("aria-valuemax", "6");
        expect(bar.getAttribute("aria-valuetext")).toMatch(
            /^Indexing for search · 25% — step 5 of 6$/
        );
        expect(within(bar).getAllByText("Indexing")[0]).toBeInTheDocument();
        // A finished file has no bar of its own.
        expect(
            screen.queryByRole("progressbar", { name: "Update.pdf: processing" })
        ).not.toBeInTheDocument();
    });

    it("says why a file stopped, who added it, and retries it", async () => {
        const user = userEvent.setup();
        mount();
        const failedRow = (await screen.findByText("Vendor contract.docx")).closest("li")!;
        expect(within(failedRow).getByText("Stopped while reading")).toBeInTheDocument();
        // Worded like the Sources rail words it, never the raw error.
        expect(
            within(failedRow).getByText(
                translatorFor("en", "sources.failure")("categories.ocr_unavailable.message")
            )
        ).toBeInTheDocument();
        expect(within(failedRow).queryByText(/convert failed/)).not.toBeInTheDocument();
        await waitFor(() =>
            expect(within(failedRow).getByText("Added by Priya Natarajan")).toBeInTheDocument()
        );

        await user.click(within(failedRow).getByRole("button", { name: /Retry/ }));
        await waitFor(() =>
            expect(fetchMock).toHaveBeenCalledWith(
                "/api/documents/77/retry",
                expect.objectContaining({ method: "POST" })
            )
        );
        const row = (await screen.findByText("Vendor contract.docx")).closest("li")!;
        await waitFor(() => expect(row).toHaveAttribute("data-state", "waiting"));
    });

    it("narrows to the viewer's own files and remembers it", async () => {
        const user = userEvent.setup();
        const first = mount();
        await screen.findByText("Vendor contract.docx");
        await user.click(screen.getByRole("radio", { name: "Mine" }));
        expect(screen.queryByText("Vendor contract.docx")).not.toBeInTheDocument();
        expect(screen.getByText("Q3 board deck.pdf")).toBeInTheDocument();
        first.unmount();

        resetProcessingQueueForTests();
        mount();
        await screen.findByText("Q3 board deck.pdf");
        expect(screen.getByRole("radio", { name: "Mine" })).toHaveAttribute("data-state", "on");
    });

    it("clears finished files for this viewer only", async () => {
        const user = userEvent.setup();
        mount();
        await screen.findByText("Update.pdf");
        await user.click(screen.getByRole("button", { name: "Clear finished" }));
        expect(screen.queryByText("Update.pdf")).not.toBeInTheDocument();
        expect(JSON.parse(window.localStorage.getItem("processing.cleared.v1:me:1")!)).toEqual([
            "done",
        ]);
    });

    it("opens a file, and offers Add a source when nothing is processing", async () => {
        const user = userEvent.setup();
        const onOpenDocument = jest.fn();
        const first = mount({ onOpenDocument });
        await user.click(await screen.findByRole("button", { name: "Open" }));
        expect(onOpenDocument).toHaveBeenCalledWith(1);
        first.unmount();

        resetProcessingQueueForTests();
        queue = {
            ...queue,
            items: [],
            summary: { running: 0, waiting: 0, retrying: 0, failed: 0, done: 0 },
        };
        const onAddSource = jest.fn();
        mount({ onAddSource });
        expect(await screen.findByText("Files you add show up here")).toBeInTheDocument();
        expect(screen.getByTestId("processing-summary")).toHaveTextContent("Nothing is processing");
        await user.click(screen.getAllByRole("button", { name: /Add a source/ })[0]!);
        expect(onAddSource).toHaveBeenCalled();
    });

    it("announces a file that finishes, and tells the workspace", async () => {
        jest.useFakeTimers({ advanceTimers: true });
        const onSettled = jest.fn();
        mount({ onSettled });
        await screen.findByText("Q3 board deck.pdf");
        queue = {
            ...queue,
            items: queue.items.map(i =>
                i.jobId === "running"
                    ? { ...i, state: "done", stage: "ready", completedAt: new Date().toISOString() }
                    : i
            ),
        };
        await act(async () => {
            jest.advanceTimersByTime(2_100);
        });
        await waitFor(() =>
            expect(screen.getByTestId("processing-announcer")).toHaveTextContent(
                "Q3 board deck.pdf is ready."
            )
        );
        expect(onSettled).toHaveBeenCalled();
        jest.useRealTimers();
    });
});
