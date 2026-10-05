/** @jest-environment jsdom */

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { CallsFeature } from "~/app/calls/_components/CallsFeature";
import { pausedCall, workerErrorPausedCall } from "~/app/calls/_fixtures/callSnapshots";
import type { CallSnapshot } from "@launchstack/pipelines/call-notes/contracts";

const mockRouterPush = jest.fn();
let mockSearchParams = new URLSearchParams("feature=calls");
jest.mock("next/navigation", () => ({
    usePathname: () => "/employer/documents",
    useRouter: () => ({ push: mockRouterPush }),
    useSearchParams: () => mockSearchParams,
}));
jest.mock("~/app/calls/_components/CallsChat", () => ({ CallsChat: () => null }));
jest.mock("react-markdown", () => ({
    __esModule: true,
    default: ({ children }: { children: string }) => children,
}));
jest.mock("remark-gfm", () => ({ __esModule: true, default: () => undefined }));

type MockResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
function response(body: unknown, status = 200): MockResponse {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}
let workerAvailable: boolean;
let snapshots: CallSnapshot[];
const mockCommand = jest.fn<Promise<MockResponse>, [Record<string, unknown>]>();

beforeEach(() => {
    jest.clearAllMocks();
    mockCommand.mockReset();
    workerAvailable = true;
    snapshots = [];
    mockSearchParams = new URLSearchParams("feature=calls");
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (url === "/api/call-notes/worker")
            return response({ available: workerAvailable, lastSeenAt: null });
        if (init?.method === "POST") {
            if (typeof init.body !== "string") throw new Error("Expected a JSON command body");
            return mockCommand(JSON.parse(init.body) as Record<string, unknown>);
        }
        return response(
            url === "/api/call-notes"
                ? snapshots
                : (snapshots.find(
                      snapshot => url === `/api/call-notes/${encodeURIComponent(snapshot.id)}`
                  ) ?? pausedCall)
        );
    }) as unknown as typeof fetch;
});

it("starts a capture and opens the returned Call", async () => {
    mockCommand.mockResolvedValue(response(pausedCall));
    render(<CallsFeature />);
    const start = await screen.findByRole("button", { name: /start capture/i });
    await waitFor(() => expect(start).toBeEnabled());
    await userEvent.setup().click(start);
    await waitFor(() =>
        expect(mockRouterPush).toHaveBeenCalledWith(
            expect.stringContaining(`call=${encodeURIComponent(pausedCall.id)}`)
        )
    );
});

it("resumes the same Call after a worker-error pause and preserves its Transcript", async () => {
    snapshots = [workerErrorPausedCall];
    mockSearchParams = new URLSearchParams(`feature=calls&call=${workerErrorPausedCall.id}`);
    let finishResume: (response: MockResponse) => void = () => undefined;
    mockCommand.mockReturnValueOnce(
        new Promise<MockResponse>(resolve => {
            finishResume = resolve;
        })
    );
    render(<CallsFeature />);
    const user = userEvent.setup();
    const resume = await screen.findByRole("button", { name: "Resume capture" });
    await waitFor(() => expect(resume).toBeEnabled());
    expect(screen.getByRole("alert")).toHaveTextContent(/resume continues this call/i);

    await user.click(resume);
    expect(mockCommand).toHaveBeenCalledWith({
        schemaVersion: "call-notes/v2",
        kind: "resume_capture",
        requestId: expect.any(String),
        callId: workerErrorPausedCall.id,
    });
    expect(resume).toBeDisabled();
    expect(resume).toHaveTextContent("Resuming…");
    expect(screen.getByRole("button", { name: "Stop capture" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Start capture" })).toBeDisabled();
    await user.click(resume);
    expect(mockCommand).toHaveBeenCalledTimes(1);

    const resumedCall: CallSnapshot = {
        ...workerErrorPausedCall,
        capture: {
            ...workerErrorPausedCall.capture,
            desiredMode: "running",
            pausedReason: null,
            lifecycle: "connecting",
            activeAttemptId: "attempt-worker-error-2",
            attemptCount: 2,
        },
    };
    snapshots = [resumedCall];
    await act(async () => finishResume(response(resumedCall)));
    expect(screen.getByRole("status", { name: "Capture status" })).toHaveTextContent("Connecting");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume capture" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop capture" })).toBeEnabled();
    expect(mockRouterPush).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Show transcript" }));
    const transcript = screen.getByLabelText("Company transcript");
    for (const segment of workerErrorPausedCall.transcript) {
        expect(within(transcript).getByText(segment.text)).toBeInTheDocument();
    }
});

it("does not start while the worker is offline and enables Start when it returns", async () => {
    jest.useFakeTimers();
    workerAvailable = false;
    const view = render(<CallsFeature />);
    try {
        expect(await screen.findByText(/worker is offline/i)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /start capture/i })).toBeDisabled();
        expect(mockCommand).not.toHaveBeenCalled();
        workerAvailable = true;
        await act(async () => {
            jest.advanceTimersByTime(5_000);
        });
        expect(screen.getByRole("button", { name: /start capture/i })).toBeEnabled();
        expect(screen.queryByText(/worker is offline/i)).not.toBeInTheDocument();
    } finally {
        view.unmount();
        jest.useRealTimers();
    }
});

it("disables Resume but keeps Stop available when worker availability is lost", async () => {
    workerAvailable = false;
    snapshots = [pausedCall];
    mockSearchParams = new URLSearchParams(`feature=calls&call=${pausedCall.id}`);
    mockCommand.mockResolvedValue(
        response({
            ...pausedCall,
            status: "finalizing",
            capture: { ...pausedCall.capture, desiredMode: "stopped", lifecycle: "finalizing" },
        })
    );
    render(<CallsFeature />);
    const user = userEvent.setup({ skipHover: true });
    const stop = await screen.findByRole("button", { name: /stop capture/i });
    expect(stop).toBeEnabled();
    const resume = screen.getByRole("button", { name: "Resume capture" });
    expect(resume).toBeDisabled();
    await waitFor(() => expect(resume).toHaveAttribute("title", expect.stringMatching(/offline/i)));
    await user.click(resume);
    expect(mockCommand).not.toHaveBeenCalled();
    await user.click(stop);
    await waitFor(() =>
        expect(screen.getByRole("status", { name: "Capture status" })).toHaveTextContent(
            "Finalizing"
        )
    );
    expect(mockCommand).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "stop_capture", callId: pausedCall.id })
    );
});

it("retries an uncertain Start with the original request identity", async () => {
    mockCommand
        .mockRejectedValueOnce(new Error("network interrupted"))
        .mockResolvedValueOnce(response(pausedCall));
    render(<CallsFeature />);
    const start = await screen.findByRole("button", { name: /start capture/i });
    await waitFor(() => expect(start).toBeEnabled());
    const user = userEvent.setup();
    await user.click(start);
    expect(await screen.findByRole("alert")).toHaveTextContent(/network interrupted/i);
    await user.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(mockRouterPush).toHaveBeenCalled());
    expect(mockCommand.mock.calls[1]?.[0]).toEqual(mockCommand.mock.calls[0]?.[0]);
});

it("loads a selected Call outside the default history page", async () => {
    mockSearchParams = new URLSearchParams(`feature=calls&call=${pausedCall.id}`);
    render(<CallsFeature />);
    expect(
        await screen.findByRole("heading", { level: 1, name: pausedCall.note!.title })
    ).toBeInTheDocument();
});

it("shows completion when final audio predates the Stop response", async () => {
    mockSearchParams = new URLSearchParams(`feature=calls&call=${pausedCall.id}`);
    snapshots = [pausedCall];
    jest.useFakeTimers();
    mockCommand.mockImplementation(async () => {
        snapshots = [
            {
                ...pausedCall,
                updatedAt: "2030-01-01T00:00:00.000Z",
                status: "finalizing",
                capture: { ...pausedCall.capture, desiredMode: "stopped", lifecycle: "finalizing" },
            },
        ];
        return response(snapshots[0]);
    });
    const view = render(<CallsFeature />);
    try {
        await userEvent
            .setup({ advanceTimers: jest.advanceTimersByTime })
            .click(await screen.findByRole("button", { name: /stop capture/i }));
        await waitFor(() =>
            expect(screen.getByRole("status", { name: "Capture status" })).toHaveTextContent(
                "Finalizing"
            )
        );
        snapshots = [
            {
                ...pausedCall,
                status: "completed",
                capture: {
                    ...pausedCall.capture,
                    desiredMode: "stopped",
                    lifecycle: "completed",
                    outcome: "complete",
                    activeAttemptId: null,
                },
            },
        ];
        await act(async () => {
            jest.advanceTimersByTime(1_000);
        });
        await waitFor(() =>
            expect(screen.getByRole("status", { name: "Capture status" })).toHaveTextContent(
                "Completed"
            )
        );
        expect(screen.queryByRole("button", { name: /stopping/i })).not.toBeInTheDocument();
    } finally {
        view.unmount();
        jest.useRealTimers();
    }
});
