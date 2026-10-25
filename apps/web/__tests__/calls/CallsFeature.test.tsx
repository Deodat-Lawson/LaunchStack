/** @jest-environment jsdom */

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { CallsFeature } from "~/app/calls/_components/CallsFeature";
import { pausedCall, workerErrorPausedCall } from "~/app/calls/_fixtures/callSnapshots";
import type { CallSnapshot, CaptureDeviceSummary } from "@launchstack/pipelines/call-notes";
import { renderWithLocale } from "~/i18n/testing/render";

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
let captureDevices: CaptureDeviceSummary[];
const mac: CaptureDeviceSummary = {
    id: "mac-1",
    name: "Hank’s MacBook Air",
    appVersion: "1.2.3",
    os: "macOS",
    arch: "arm64",
    online: true,
    lastSeenAt: "2026-10-25T12:00:00.000Z",
    createdAt: "2026-10-25T10:00:00.000Z",
};
const mockDownload = jest.fn<Promise<MockResponse>, []>();
const mockConnect = jest.fn<Promise<MockResponse>, []>();
const mockRevoke = jest.fn<Promise<MockResponse>, [string]>();
let snapshots: CallSnapshot[];
const mockCommand = jest.fn<Promise<MockResponse>, [Record<string, unknown>]>();

beforeAll(() => {
    // Radix Select uses pointer and layout APIs that jsdom does not implement.
    Element.prototype.scrollIntoView = jest.fn();
    Element.prototype.hasPointerCapture = jest.fn(() => false);
    Element.prototype.releasePointerCapture = jest.fn();
});

beforeEach(() => {
    jest.clearAllMocks();
    mockCommand.mockReset();
    mockDownload.mockReset();
    mockConnect.mockReset();
    mockRevoke.mockReset();
    captureDevices = [mac];
    window.history.replaceState(null, "", "/");
    workerAvailable = true;
    snapshots = [];
    mockSearchParams = new URLSearchParams("feature=calls");
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (url === "/api/call-notes/worker")
            return response({
                available: workerAvailable && captureDevices.some(device => device.online),
                lastSeenAt: null,
                devices: captureDevices.map(device => ({
                    ...device,
                    online: workerAvailable && device.online,
                })),
            });
        if (url === "/api/call-notes/capture-app/downloads" && init?.method === "POST")
            return mockDownload();
        if (url === "/api/call-notes/capture-app/connect-codes" && init?.method === "POST")
            return mockConnect();
        if (
            typeof url === "string" &&
            url.startsWith("/api/call-notes/devices/") &&
            init?.method === "DELETE"
        )
            return mockRevoke(url);
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

it("does not start without an online Mac and enables Start when one connects", async () => {
    jest.useFakeTimers();
    workerAvailable = false;
    const view = render(<CallsFeature />);
    try {
        expect(
            await screen.findByRole("region", { name: "Capture on your Mac" })
        ).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /start capture/i })).toBeDisabled();
        expect(mockCommand).not.toHaveBeenCalled();
        workerAvailable = true;
        await act(async () => {
            jest.advanceTimersByTime(5_000);
        });
        expect(screen.getByRole("button", { name: /start capture/i })).toBeEnabled();
        expect(screen.getByText(`Connected: ${mac.name}`)).toBeInTheDocument();
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
    await waitFor(() =>
        expect(resume).toHaveAttribute("title", expect.stringMatching(/no mac is online/i))
    );
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

it("posts a download request, navigates the window to its URL, and waits for the Mac", async () => {
    workerAvailable = false;
    const downloadUrl = `${window.location.origin}/#LaunchStack-Capture.dmg`;
    mockDownload.mockResolvedValue(response({ code: "pairing-download", downloadUrl }, 201));
    render(<CallsFeature />);
    await userEvent
        .setup()
        .click(await screen.findByRole("button", { name: "Get Call Notes for Mac" }));
    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/call-notes/capture-app/downloads", { method: "POST" });
    expect(window.location.href).toBe(downloadUrl);
    expect(fetch).not.toHaveBeenCalledWith(downloadUrl, expect.anything());
    expect(
        await screen.findByText("Open LaunchStack Capture from your Downloads to finish")
    ).toBeInTheDocument();
});

it("changes the download waiting state to connected on the next device poll", async () => {
    jest.useFakeTimers();
    workerAvailable = false;
    captureDevices = [];
    mockDownload.mockResolvedValue(
        response(
            { code: "pairing-download", downloadUrl: `${window.location.origin}/#download` },
            201
        )
    );
    const view = render(<CallsFeature />);
    try {
        await userEvent
            .setup({ advanceTimers: jest.advanceTimersByTime })
            .click(await screen.findByRole("button", { name: "Get Call Notes for Mac" }));
        expect(
            await screen.findByText("Open LaunchStack Capture from your Downloads to finish")
        ).toBeInTheDocument();
        workerAvailable = true;
        captureDevices = [mac];
        await act(async () => {
            jest.advanceTimersByTime(5_000);
        });
        expect(screen.getByText(`Connected: ${mac.name}`)).toBeInTheDocument();
        expect(
            screen.queryByText("Open LaunchStack Capture from your Downloads to finish")
        ).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Start capture" })).toBeEnabled();
    } finally {
        view.unmount();
        jest.useRealTimers();
    }
});

it("focuses Connect this Mac for setup links and navigates to the returned deep link", async () => {
    mockSearchParams = new URLSearchParams("feature=calls&captureSetup=1");
    const deepLink = `${window.location.origin}/#launchstack-capture-pair`;
    mockConnect.mockResolvedValue(response({ code: "pairing-connect", deepLink }, 201));
    render(<CallsFeature />);
    const connect = await screen.findByRole("button", { name: "Connect this Mac" });
    expect(connect).toHaveFocus();
    await userEvent.setup().click(connect);
    expect(fetch).toHaveBeenCalledWith("/api/call-notes/capture-app/connect-codes", {
        method: "POST",
    });
    expect(window.location.href).toBe(deepLink);
});

it("confirms a device revocation before deleting it and refreshes the devices", async () => {
    mockRevoke.mockImplementation(async () => {
        captureDevices = [];
        return response(null, 204);
    });
    render(<CallsFeature />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: `Revoke ${mac.name}` }));
    expect(mockRevoke).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: `Revoke ${mac.name}?` });
    await user.click(within(dialog).getByRole("button", { name: "Revoke" }));
    expect(mockRevoke).toHaveBeenCalledWith(`/api/call-notes/devices/${mac.id}`);
    await waitFor(() =>
        expect(screen.queryByRole("button", { name: `Revoke ${mac.name}` })).not.toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: "Start capture" })).toBeDisabled();
});

it("lets the user cancel revocation without deleting the device", async () => {
    render(<CallsFeature />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: `Revoke ${mac.name}` }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(mockRevoke).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: `Revoke ${mac.name}` })).toBeInTheDocument();
});

it("omits targetDeviceId when only one Mac is online", async () => {
    captureDevices = [mac, { ...mac, id: "offline-mac", name: "Offline Mac", online: false }];
    mockCommand.mockResolvedValue(response(pausedCall));
    render(<CallsFeature />);
    const start = await screen.findByRole("button", { name: "Start capture" });
    await waitFor(() => expect(start).toBeEnabled());
    expect(screen.queryByRole("combobox", { name: "Capture device" })).not.toBeInTheDocument();
    await userEvent.setup().click(start);
    expect(mockCommand).toHaveBeenCalledTimes(1);
    expect(mockCommand.mock.calls[0]?.[0]).not.toHaveProperty("targetDeviceId");
});

it("sends the selected targetDeviceId when multiple Macs are online", async () => {
    const secondMac = { ...mac, id: "mac-2", name: "Office Mac Studio" };
    captureDevices = [mac, secondMac];
    mockCommand.mockResolvedValue(response(pausedCall));
    render(<CallsFeature />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("combobox", { name: "Capture device" }));
    await user.click(await screen.findByRole("option", { name: secondMac.name }));
    await user.click(screen.getByRole("button", { name: "Start capture" }));
    expect(mockCommand).toHaveBeenCalledWith(
        expect.objectContaining({
            kind: "start_capture",
            targetDeviceId: secondMac.id,
        })
    );
});

it("picks up captures started from the Mac and updates their live transcript through polling", async () => {
    jest.useFakeTimers();
    const view = render(<CallsFeature />);
    try {
        await screen.findByRole("main", { name: "Calls library" });
        const startedFromMac: CallSnapshot = {
            ...pausedCall,
            capture: { ...pausedCall.capture, desiredMode: "running", pausedReason: null },
        };
        snapshots = [startedFromMac];
        await act(async () => {
            jest.advanceTimersByTime(1_000);
        });
        const note = screen.getByRole("button", {
            name: new RegExp(`${pausedCall.note!.title}.*Live`, "i"),
        });
        await userEvent.setup({ advanceTimers: jest.advanceTimersByTime }).click(note);
        await userEvent
            .setup({ advanceTimers: jest.advanceTimersByTime })
            .click(screen.getByRole("button", { name: "Show transcript" }));
        const nextSegment = {
            ...pausedCall.transcript[0]!,
            id: "mac-segment",
            receiveOrder: 3,
            text: "This arrived from the Mac.",
        };
        snapshots = [
            { ...startedFromMac, transcript: [...startedFromMac.transcript, nextSegment] },
        ];
        await act(async () => {
            jest.advanceTimersByTime(1_000);
        });
        expect(
            within(screen.getByLabelText("Company transcript")).getByText(nextSegment.text)
        ).toBeInTheDocument();
        expect(mockCommand).not.toHaveBeenCalled();
    } finally {
        view.unmount();
        jest.useRealTimers();
    }
});

it("uses Chinese setup copy through the shared catalogue", async () => {
    captureDevices = [];
    renderWithLocale(<CallsFeature />, "zh-CN");
    expect(await screen.findByRole("button", { name: "获取 Mac 版通话笔记" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "连接此 Mac" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始录制" })).toBeDisabled();
});

it.each([
    ["silence", "Stopped automatically — no audio"],
    ["call_ended", "Stopped automatically — call ended"],
    [null, "Completed"],
] as const)("shows an autonomous end from the next call poll (%s)", async (stopReason, label) => {
    jest.useFakeTimers();
    mockSearchParams = new URLSearchParams(`feature=calls&call=${pausedCall.id}`);
    snapshots = [
        {
            ...pausedCall,
            capture: { ...pausedCall.capture, desiredMode: "running", pausedReason: null },
        },
    ];
    const view = render(<CallsFeature />);
    try {
        expect(await screen.findByRole("button", { name: "Stop capture" })).toBeInTheDocument();
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
                    stopReason,
                },
            },
        ];
        await act(async () => {
            jest.advanceTimersByTime(1_000);
        });
        expect(screen.getByRole("status", { name: "Capture status" })).toHaveTextContent(label);
        expect(screen.queryByRole("button", { name: "Stop capture" })).not.toBeInTheDocument();
        expect(mockCommand).not.toHaveBeenCalled();
    } finally {
        view.unmount();
        jest.useRealTimers();
    }
});
