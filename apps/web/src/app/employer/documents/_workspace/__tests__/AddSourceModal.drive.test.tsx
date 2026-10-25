/** @jest-environment jsdom */

import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { AddSourceModal } from "../AddSourceModal";
import type { DriveStatus } from "../driveStatus";
import type { OpenPickerOptions, PickedDoc } from "../useGooglePicker";
import { followDriveSync, SYNC_FOLLOW_MS } from "../useDriveSource";

/**
 * Google Drive is not a tab of its own: it is somewhere to add from. Files
 * picks Drive files and Folder picks a Drive folder, into the folder the
 * destination bar names, and they stay in sync. Connecting starts from the
 * same button; people who can't pick (not connection managers) never see it,
 * and the Folder tab offers Drive only where a folder can bring its contents.
 */

jest.mock("next/navigation", () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));
jest.mock("sonner", () => ({
    toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

const mockOpenPicker = jest.fn<Promise<void>, [OpenPickerOptions]>();
jest.mock("../useGooglePicker", () => ({
    useGooglePicker: () => ({ openPicker: mockOpenPicker, opening: false }),
}));

const fetchMock = jest.fn();
/** What the Drive status route answers; a number is an error status. */
let driveStatus: DriveStatus | number;

function respond(body: unknown, status = 200) {
    return Promise.resolve({
        ok: status < 400,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
    });
}

function connected(overrides: Partial<DriveStatus> = {}): DriveStatus {
    return {
        configured: true,
        connected: true,
        connectionId: "7",
        status: "active",
        accountEmail: "alex.rivera@example.com",
        pickedItems: [],
        picker: { apiKey: "k", appId: "1", scriptUrl: "https://apis.google.com/js/api.js" },
        folderAccess: { enabled: true, granted: true },
        ...overrides,
    };
}

function notConnected(folderImport: boolean): DriveStatus {
    return {
        configured: true,
        connected: false,
        picker: { apiKey: "k", appId: "1", scriptUrl: "https://apis.google.com/js/api.js" },
        folderAccess: { enabled: folderImport, granted: false },
    };
}

/** The body of the Drive items POST. */
function addedBody(): Record<string, unknown> {
    const call = fetchMock.mock.calls.find(
        ([url, init]) =>
            url === "/api/connectors/google-drive/items" &&
            (init as RequestInit | undefined)?.method === "POST"
    );
    if (!call) throw new Error("nothing was added from Drive");
    return JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;
}

beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
});

beforeEach(() => {
    mockOpenPicker.mockReset();
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) => {
        if (url === "/api/connectors/google") return respond({ enabled: false, connected: false });
        if (url === "/api/connectors/google-drive/status") {
            return typeof driveStatus === "number"
                ? respond({ message: "Forbidden" }, driveStatus)
                : respond({ data: driveStatus });
        }
        if (url === "/api/connectors/google-drive/picker-token") {
            return respond({ data: { accessToken: "token" } });
        }
        if (url === "/api/connectors/google-drive/items") return respond({ data: { count: 1 } });
        if (url === "/api/connectors/google-drive/sync") {
            return respond({ data: { queued: true } }, 202);
        }
        return respond({}, 404);
    });
});

function mount(initialTab: "files" | "folder" | "drive") {
    const onUploaded = jest.fn();
    render(
        <AddSourceModal
            open
            onClose={jest.fn()}
            userId="user_1"
            initialTab={initialTab}
            defaultCategory="Q4 planning"
            folders={["Q4 planning", "Unfiled"]}
            onUploaded={onUploaded}
        />
    );
    return { onUploaded };
}

/** Make the next Picker opening come back with `docs`. */
function pickerReturns(docs: PickedDoc[]) {
    mockOpenPicker.mockImplementation(options => {
        options.onPicked(docs);
        return Promise.resolve();
    });
}

describe("Google Drive in Add source", () => {
    it("has no Google Drive tab of its own", async () => {
        driveStatus = connected();
        mount("files");

        const nav = screen.getByRole("navigation", { name: /ways to add/i });
        expect(within(nav).queryByRole("button", { name: /google drive/i })).toBeNull();
        expect(await screen.findByRole("button", { name: "From Google Drive" })).toBeVisible();
    });
});

it("opens an old link to the Drive tab on Files", async () => {
    driveStatus = connected();
    mount("drive");

    expect(await screen.findByRole("button", { name: "From Google Drive" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Browse files" })).toBeVisible();
});

describe("Files → From Google Drive", () => {
    it("picks files into the destination folder, starts the sync, and closes", async () => {
        driveStatus = connected();
        const { onUploaded } = mount("files");
        const user = userEvent.setup();
        pickerReturns([
            { fileId: "d1", name: "Board deck.pdf", mimeType: "application/pdf", kind: "file" },
        ]);

        await user.click(await screen.findByRole("button", { name: "From Google Drive" }));

        await waitFor(() => expect(onUploaded).toHaveBeenCalled());
        expect(mockOpenPicker.mock.calls[0]![0].target).toBe("files");
        expect(addedBody()).toEqual({
            items: [
                {
                    fileId: "d1",
                    name: "Board deck.pdf",
                    mimeType: "application/pdf",
                    kind: "file",
                },
            ],
            destination: "Q4 planning",
        });
        expect(
            fetchMock.mock.calls.some(([url]) => url === "/api/connectors/google-drive/sync")
        ).toBe(true);
        expect(screen.getByText(/Files you pick from Google Drive stay in sync/)).toBeVisible();
    });

    it("stays open with the server's reason when the folder refuses", async () => {
        driveStatus = connected();
        fetchMock.mockImplementationOnce(() => respond({ enabled: false, connected: false }));
        const { onUploaded } = mount("files");
        const user = userEvent.setup();
        const base = fetchMock.getMockImplementation()!;
        fetchMock.mockImplementation((url: string, init?: RequestInit) =>
            url === "/api/connectors/google-drive/items"
                ? respond({ message: "You do not have edit access to this folder." }, 403)
                : base(url, init)
        );
        pickerReturns([{ fileId: "d1", name: "Board deck.pdf", mimeType: "", kind: "file" }]);

        await user.click(await screen.findByRole("button", { name: "From Google Drive" }));

        const { toast } = jest.requireMock<{ toast: { error: jest.Mock } }>("sonner");
        await waitFor(() =>
            expect(toast.error).toHaveBeenCalledWith("You do not have edit access to this folder.")
        );
        expect(onUploaded).not.toHaveBeenCalled();
    });

    it("connects first when Drive isn't connected", async () => {
        driveStatus = notConnected(true);
        mount("files");

        expect(await screen.findByRole("link", { name: "Connect Google Drive" })).toHaveAttribute(
            "href",
            "/api/connectors/google/oauth/start"
        );
    });

    it("isn't offered to someone who can't manage the workspace's connections", async () => {
        driveStatus = 403;
        mount("files");

        await waitFor(() =>
            expect(
                fetchMock.mock.calls.some(([url]) => url === "/api/connectors/google-drive/status")
            ).toBe(true)
        );
        expect(screen.getByRole("button", { name: "Browse files" })).toBeVisible();
        expect(screen.queryByRole("button", { name: "From Google Drive" })).toBeNull();
        expect(screen.queryByRole("link", { name: /Google Drive/ })).toBeNull();
    });
});

describe("Folder → From Google Drive", () => {
    it("picks a folder, rebuilt inside the destination", async () => {
        driveStatus = connected();
        const { onUploaded } = mount("folder");
        const user = userEvent.setup();
        pickerReturns([
            {
                fileId: "f1",
                name: "Acme Seed Data Room",
                mimeType: "application/vnd.google-apps.folder",
                kind: "folder",
            },
        ]);

        await user.click(await screen.findByRole("button", { name: "From Google Drive" }));

        await waitFor(() => expect(onUploaded).toHaveBeenCalled());
        expect(mockOpenPicker.mock.calls[0]![0].target).toBe("folders");
        expect(addedBody()).toMatchObject({ destination: "Q4 planning" });
    });

    it("adds a pasted folder link into the destination", async () => {
        driveStatus = connected();
        const { onUploaded } = mount("folder");
        const user = userEvent.setup();

        await user.type(
            await screen.findByLabelText("Or paste a Drive folder link"),
            "https://drive.google.com/drive/folders/sa-dataroom?usp=sharing"
        );
        await user.click(screen.getByRole("button", { name: "Add folder" }));

        await waitFor(() => expect(onUploaded).toHaveBeenCalled());
        expect(addedBody()).toEqual({
            link: "https://drive.google.com/drive/folders/sa-dataroom?usp=sharing",
            destination: "Q4 planning",
        });
    });

    it("checks a pasted link before sending it", async () => {
        driveStatus = connected();
        mount("folder");
        const user = userEvent.setup();

        await user.type(await screen.findByLabelText("Or paste a Drive folder link"), "hello");
        await user.click(screen.getByRole("button", { name: "Add folder" }));

        expect(
            screen.getByText("That isn't a Google Drive link. In Drive, use Share › Copy link.")
        ).toBeVisible();
        expect(
            fetchMock.mock.calls.some(([url]) => url === "/api/connectors/google-drive/items")
        ).toBe(false);
    });

    it("asks for folder access first when this grant can't read folders", async () => {
        driveStatus = connected({ folderAccess: { enabled: true, granted: false } });
        mount("folder");

        expect(await screen.findByRole("link", { name: "From Google Drive" })).toHaveAttribute(
            "href",
            "/api/connectors/google/oauth/start?access=folders"
        );
        expect(screen.getByText(/Google asks once/)).toBeVisible();
        expect(screen.queryByLabelText("Or paste a Drive folder link")).toBeNull();
    });

    it("connects with folder access straight away from here", async () => {
        driveStatus = notConnected(true);
        mount("folder");

        expect(await screen.findByRole("link", { name: "Connect Google Drive" })).toHaveAttribute(
            "href",
            "/api/connectors/google/oauth/start?access=folders"
        );
    });

    it("isn't offered where this server can't import a folder's contents", async () => {
        driveStatus = connected({ folderAccess: { enabled: false, granted: false } });
        mount("folder");

        await waitFor(() =>
            expect(
                fetchMock.mock.calls.some(([url]) => url === "/api/connectors/google-drive/status")
            ).toBe(true)
        );
        expect(screen.getByRole("button", { name: "Choose folder" })).toBeVisible();
        expect(screen.queryByRole("button", { name: "From Google Drive" })).toBeNull();
        expect(screen.queryByRole("link", { name: /Google Drive/ })).toBeNull();
    });
});

describe("after a pick, once the sync lands", () => {
    afterEach(() => jest.useRealTimers());

    async function poll() {
        await jest.advanceTimersByTimeAsync(3000);
    }

    it("lets the workspace read its list again — only when a newer run has finished", async () => {
        jest.useFakeTimers();
        const onSynced = jest.fn();
        const runs = [
            { lastSyncAt: "2026-10-24T10:00:00.000Z", lastSyncStatus: "ok" },
            { lastSyncAt: "2026-10-24T10:00:00.000Z", lastSyncStatus: "running" },
            { lastSyncAt: "2026-10-24T10:00:09.000Z", lastSyncStatus: "ok" },
        ];
        fetchMock.mockImplementation(() =>
            respond({ data: { ...connected(), ...(runs.shift() ?? {}) } })
        );

        followDriveSync("2026-10-24T10:00:00.000Z", onSynced);
        await poll(); // the run hasn't started
        await poll(); // running
        expect(onSynced).not.toHaveBeenCalled();
        await poll(); // done
        expect(onSynced).toHaveBeenCalledTimes(1);
        await poll();
        expect(onSynced).toHaveBeenCalledTimes(1);
    });

    it("gives up when no run turns up", async () => {
        jest.useFakeTimers();
        const onSynced = jest.fn();
        fetchMock.mockImplementation(() =>
            respond({ data: connected({ lastSyncAt: null, lastSyncStatus: null }) })
        );

        followDriveSync(null, onSynced);
        await jest.advanceTimersByTimeAsync(SYNC_FOLLOW_MS + 10_000);
        const polls = fetchMock.mock.calls.length;
        await jest.advanceTimersByTimeAsync(30_000);

        expect(onSynced).not.toHaveBeenCalled();
        expect(fetchMock.mock.calls.length).toBe(polls);
    });
});
