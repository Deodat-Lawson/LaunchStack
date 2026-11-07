/** @jest-environment jsdom */

import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import { FeedbackProvider, useFeedback } from "~/components/feedback/FeedbackProvider";
import type { CreateFeedbackInput } from "~/lib/feedback/contract";

/**
 * The reporter dialog end to end against a mocked API: whether it shows at
 * all, what a one-line bug sends, what switching technical details off
 * leaves out, the duplicate hint on feature requests, and that a closed
 * dialog keeps its draft.
 */

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
    useRouter: () => ({ push: mockPush, replace: jest.fn() }),
}));

// The page capture draws the DOM into an image; jsdom has no canvas.
jest.mock("~/lib/feedback/screenshot", () => ({
    CAPTURE_SKIP_ATTRIBUTE: "data-feedback-capture",
    capturePage: jest.fn(() => Promise.resolve(new Blob(["png"], { type: "image/png" }))),
}));

// jsdom has no ResizeObserver; the kit's Switch measures itself with one.
global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
} as unknown as typeof ResizeObserver;

const fetchMock = jest.fn();
let access = { enabled: true, triager: false };
let similar: unknown[] = [];

function urlOf(input: RequestInfo | URL): string {
    return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function json(body: unknown, status = 200) {
    return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
    });
}

function sentPayload(): { payload: CreateFeedbackInput; files: File[] } {
    const call = fetchMock.mock.calls.find(
        ([input, init]) =>
            urlOf(input as RequestInfo) === "/api/feedback" &&
            (init as RequestInit | undefined)?.method === "POST"
    );
    if (!call) throw new Error("nothing was sent");
    const form = (call[1] as RequestInit).body as FormData;
    return {
        payload: JSON.parse(form.get("payload") as string) as CreateFeedbackInput,
        files: form.getAll("files") as File[],
    };
}

beforeEach(() => {
    access = { enabled: true, triager: false };
    similar = [];
    mockPush.mockReset();
    fetchMock.mockReset();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = urlOf(input);
        if (url === "/api/feedback/me") return json(access);
        if (url === "/api/feedback" && init?.method === "POST")
            return json({ report: { id: 7, kind: "bug", title: "x" } }, 201);
        if (url.startsWith("/api/feedback?scope=ideas")) return json({ items: similar });
        if (/\/api\/feedback\/\d+\/vote$/.test(url)) return json({ votes: 4, voted: true });
        return json({}, 404);
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    window.localStorage.clear();
    let n = 0;
    URL.createObjectURL = jest.fn(() => `blob:test/${(n += 1)}`);
    URL.revokeObjectURL = jest.fn();
});

/** Something on the page that opens the dialog, as the account menu does. */
function Opener() {
    const feedback = useFeedback();
    return (
        <>
            <button type="button" onClick={() => feedback.open({ kind: "bug" })}>
                open bug
            </button>
            <button type="button" onClick={() => feedback.open({ kind: "idea" })}>
                open idea
            </button>
            <span data-testid="enabled">{String(feedback.enabled)}</span>
        </>
    );
}

function renderReporter() {
    return render(
        <FeedbackProvider>
            <Opener />
        </FeedbackProvider>
    );
}

async function openDialog(kind: "bug" | "idea" = "bug") {
    await waitFor(() => expect(screen.getByTestId("enabled")).toHaveTextContent("true"));
    fireEvent.click(screen.getByText(kind === "bug" ? "open bug" : "open idea"));
    return screen.findByTestId("feedback-dialog");
}

describe("FeedbackProvider", () => {
    it("shows nothing while the instance has named no triager", async () => {
        access = { enabled: false, triager: false };
        renderReporter();
        await waitFor(() =>
            expect(fetchMock).toHaveBeenCalledWith("/api/feedback/me", expect.anything())
        );
        await act(async () => undefined);
        expect(screen.getByTestId("enabled")).toHaveTextContent("false");
        expect(screen.queryByTestId("feedback-launcher")).not.toBeInTheDocument();
        fireEvent.click(screen.getByText("open bug"));
        expect(screen.queryByTestId("feedback-dialog")).not.toBeInTheDocument();
    });

    it("shows the Feedback button when reports are taken, unless it was hidden", async () => {
        const { unmount } = renderReporter();
        expect(await screen.findByTestId("feedback-launcher")).toHaveTextContent("Feedback");
        unmount();
        window.localStorage.setItem("feedback.launcher.hidden.v1", "1");
        renderReporter();
        await waitFor(() => expect(screen.getByTestId("enabled")).toHaveTextContent("true"));
        expect(screen.queryByTestId("feedback-launcher")).not.toBeInTheDocument();
    });
});

describe("FeedbackDialog", () => {
    it("sends a one-line bug with the page and its technical details", async () => {
        renderReporter();
        const dialog = await openDialog();
        const send = within(dialog).getByTestId("feedback-send");
        expect(send).toBeDisabled();

        fireEvent.change(within(dialog).getByTestId("feedback-title"), {
            target: { value: "  Upload stops at 90%  " },
        });
        fireEvent.click(within(dialog).getByTestId("feedback-severity-blocking"));
        expect(send).toBeEnabled();
        fireEvent.click(send);

        expect(await screen.findByTestId("feedback-sent")).toHaveTextContent("bug #7");
        const { payload, files } = sentPayload();
        expect(payload).toMatchObject({
            kind: "bug",
            title: "Upload stops at 90%",
            body: "",
            severity: "blocking",
        });
        expect(payload.context?.path).toBe(window.location.pathname + window.location.search);
        expect(payload.context?.browser ?? payload.context?.userAgent).toBeTruthy();
        expect(payload.context?.viewport).toEqual({
            width: window.innerWidth,
            height: window.innerHeight,
        });
        expect(files).toHaveLength(0);

        fireEvent.click(screen.getByTestId("feedback-sent-view"));
        expect(mockPush).toHaveBeenCalledWith(
            "/employer/documents?feature=feedback&at=%2Fmine%2F7"
        );
    });

    it("sends only the page when technical details are switched off", async () => {
        renderReporter();
        const dialog = await openDialog();
        fireEvent.change(within(dialog).getByTestId("feedback-title"), {
            target: { value: "Theme flickers" },
        });
        fireEvent.click(within(dialog).getByTestId("feedback-technical"));
        fireEvent.click(within(dialog).getByTestId("feedback-send"));
        await screen.findByTestId("feedback-sent");
        expect(sentPayload().payload.context).toEqual({
            path: window.location.pathname + window.location.search,
        });
    });

    it("attaches a captured screenshot", async () => {
        renderReporter();
        const dialog = await openDialog();
        fireEvent.click(within(dialog).getByTestId("feedback-capture"));
        const images = await within(dialog).findByTestId("feedback-images");
        expect(within(images).getAllByRole("img")).toHaveLength(1);
        fireEvent.change(within(dialog).getByTestId("feedback-title"), {
            target: { value: "Chart overlaps" },
        });
        fireEvent.click(within(dialog).getByTestId("feedback-send"));
        await screen.findByTestId("feedback-sent");
        const { files } = sentPayload();
        expect(files).toHaveLength(1);
        expect(files[0]!.type).toBe("image/png");
    });

    it("refuses files that aren't images", async () => {
        renderReporter();
        const dialog = await openDialog();
        const input = within(dialog).getByTestId("feedback-file-input");
        fireEvent.change(input, {
            target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] },
        });
        expect(await within(dialog).findByRole("status")).toHaveTextContent(
            "Only PNG, JPEG, WebP or GIF images can be attached."
        );
        expect(within(dialog).queryByTestId("feedback-images")).not.toBeInTheDocument();
    });

    it("keeps the draft when the dialog is closed by accident", async () => {
        renderReporter();
        let dialog = await openDialog();
        fireEvent.change(within(dialog).getByTestId("feedback-title"), {
            target: { value: "Half-typed thought" },
        });
        fireEvent.keyDown(dialog, { key: "Escape" });
        await waitFor(() => expect(screen.queryByTestId("feedback-dialog")).not.toBeInTheDocument());
        dialog = await openDialog();
        expect(within(dialog).getByTestId("feedback-title")).toHaveValue("Half-typed thought");
    });

    it("offers matching feature requests to vote for instead", async () => {
        similar = [
            {
                id: 3,
                kind: "idea",
                title: "Export a chat as Word",
                status: "planned",
                severity: null,
                votes: 3,
                voted: false,
                mine: false,
                replies: 1,
                attachments: 0,
                createdAt: "2026-10-20T00:00:00Z",
                updatedAt: "2026-10-21T00:00:00Z",
            },
        ];
        renderReporter();
        const dialog = await openDialog("idea");
        fireEvent.change(within(dialog).getByTestId("feedback-title"), {
            target: { value: "Export chats" },
        });
        const box = await within(dialog).findByTestId("feedback-similar", undefined, {
            timeout: 2000,
        });
        expect(box).toHaveTextContent("Export a chat as Word");
        expect(
            fetchMock.mock.calls.some(([input]) =>
                urlOf(input as RequestInfo).includes("q=Export+chats")
            )
        ).toBe(true);

        fireEvent.click(within(box).getByTestId("feedback-similar-vote"));
        await waitFor(() =>
            expect(fetchMock).toHaveBeenCalledWith(
                "/api/feedback/3/vote",
                expect.objectContaining({ method: "PUT" })
            )
        );
        await waitFor(() => expect(within(box).getByTestId("feedback-similar-vote")).toHaveTextContent("4"));
    });

    it("says so when sending too often", async () => {
        fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
            const url = urlOf(input);
            if (url === "/api/feedback/me") return json(access);
            if (url === "/api/feedback" && init?.method === "POST")
                return json({ error: "Too many requests" }, 429);
            return json({}, 404);
        });
        renderReporter();
        const dialog = await openDialog();
        fireEvent.change(within(dialog).getByTestId("feedback-title"), {
            target: { value: "Again" },
        });
        fireEvent.click(within(dialog).getByTestId("feedback-send"));
        expect(await within(dialog).findByTestId("feedback-error")).toHaveTextContent(
            "You've sent several reports in a short time."
        );
        // Nothing typed is lost.
        expect(within(dialog).getByTestId("feedback-title")).toHaveValue("Again");
    });
});
