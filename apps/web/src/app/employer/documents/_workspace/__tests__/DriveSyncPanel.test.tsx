/** @jest-environment jsdom */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import type { DriveStatus } from "../driveStatus";
import { DriveSyncPanel } from "../settings/DriveSyncPanel";

/**
 * Settings → Integrations → "Synced from Google Drive": Drive is added from
 * Add source now, so this card only manages what was picked. Whether a picked
 * folder can bring its contents is decided by the grant, and the card must
 * say which case this is instead of letting a folder import nothing in
 * silence; each pick says where its files are; Stop syncing and Sync now
 * work from here.
 */

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const fetchMock = jest.fn();
let status: DriveStatus;

function respond(body: unknown, statusCode = 200) {
    return Promise.resolve({
        ok: statusCode < 400,
        status: statusCode,
        json: () => Promise.resolve(body),
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
        lastSyncAt: null,
        lastSyncStatus: null,
        lastSyncError: null,
        lastSyncReport: null,
        picker: { apiKey: "k", appId: "1", scriptUrl: "https://apis.google.com/js/api.js" },
        folderAccess: { enabled: true, granted: true },
        ...overrides,
    };
}

beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
});

beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) => {
        if (url.endsWith("/status")) return respond({ data: status });
        if (url.endsWith("/items")) return respond({ data: { removed: 1 } });
        if (url.endsWith("/sync")) return respond({ data: { queued: true } }, 202);
        return respond({}, 404);
    });
});

describe("DriveSyncPanel connection", () => {
    it("shows nothing where Drive isn't set up, or isn't this person's to manage", async () => {
        status = { ...connected(), configured: false, connected: false };
        const { container, unmount } = render(<DriveSyncPanel />);
        await waitFor(() => expect(container).toBeEmptyDOMElement());
        unmount();

        fetchMock.mockImplementation(() => respond({ message: "Forbidden" }, 403));
        const forbidden = render(<DriveSyncPanel />);
        await waitFor(() => expect(forbidden.container).toBeEmptyDOMElement());
    });

    it("points to Add source when nothing is connected yet", async () => {
        status = {
            ...connected(),
            connected: false,
            connectionId: undefined,
            status: undefined,
        };
        render(<DriveSyncPanel />);

        expect(await screen.findByText(/Nothing syncs from Google Drive yet/)).toBeInTheDocument();
        expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("reconnects with the folder access the connection had", async () => {
        status = connected({ status: "revoked", folderAccess: { enabled: true, granted: true } });
        render(<DriveSyncPanel />);

        expect(await screen.findByRole("link", { name: "Reconnect Google Drive" })).toHaveAttribute(
            "href",
            "/api/connectors/google/oauth/start?access=folders"
        );
    });
});

describe("DriveSyncPanel folder access", () => {
    it("offers folder access when the server can import folders but this grant can't", async () => {
        status = connected({ folderAccess: { enabled: true, granted: false } });
        render(<DriveSyncPanel />);

        expect(
            await screen.findByText("Allow folder access to import folders")
        ).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Allow folder access" })).toHaveAttribute(
            "href",
            "/api/connectors/google/oauth/start?access=folders"
        );
    });

    it("says only picked files come in when the server hasn't turned folder import on", async () => {
        status = connected({ folderAccess: { enabled: false, granted: false } });
        render(<DriveSyncPanel />);

        expect(
            await screen.findByText(/Only files you pick one by one come in/)
        ).toBeInTheDocument();
        expect(screen.getByText("GOOGLE_DRIVE_FOLDER_ACCESS_ENABLED")).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "Allow folder access" })).not.toBeInTheDocument();
    });

    it("names a picked folder that came back empty, and why", async () => {
        status = connected({
            folderAccess: { enabled: true, granted: false },
            pickedItems: [
                { fileId: "f1", kind: "folder", name: "Acme Seed Data Room", mimeType: null },
            ],
            lastSyncStatus: "ok",
            lastSyncReport: { stored: 0, unchanged: 0, failed: 0, emptyFolders: ["f1"] },
        });
        render(<DriveSyncPanel />);

        expect(
            await screen.findByText(
                "Nothing came in from “Acme Seed Data Room”: this connection can't see inside folders."
            )
        ).toBeInTheDocument();
        expect(screen.getByText("Its contents need folder access")).toBeInTheDocument();
    });
});

describe("DriveSyncPanel picked list", () => {
    it("shows where each pick's files are", async () => {
        status = connected({
            pickedItems: [
                {
                    fileId: "f1",
                    kind: "folder",
                    name: "Acme Seed Data Room",
                    mimeType: null,
                    folderPath: "Deals/Acme Seed Data Room",
                },
                { fileId: "f2", kind: "folder", name: "Customer research", mimeType: null },
                {
                    fileId: "d1",
                    kind: "file",
                    name: "Board deck",
                    mimeType: null,
                    folderPath: "Deals",
                },
                { fileId: "d2", kind: "file", name: "Pitch notes", mimeType: null },
                {
                    fileId: "f9",
                    kind: "folder",
                    name: "Someone else's room",
                    mimeType: null,
                    folderPath: null,
                    folderHidden: true,
                },
            ],
        });
        render(<DriveSyncPanel />);

        expect(await screen.findByText("In Deals / Acme Seed Data Room")).toBeInTheDocument();
        expect(screen.getByText("Becomes its own folder on the next sync")).toBeInTheDocument();
        // A file picked into a folder from Add source, and one picked before that.
        expect(screen.getByText("In Deals")).toBeInTheDocument();
        expect(screen.getByText("In Google Drive")).toBeInTheDocument();
        expect(screen.getByText("In a private folder of whoever picked it")).toBeInTheDocument();
    });

    it("stops syncing a pick and starts a sync on request", async () => {
        status = connected({
            pickedItems: [{ fileId: "d1", kind: "file", name: "Board deck", mimeType: null }],
        });
        render(<DriveSyncPanel />);
        const user = userEvent.setup();

        await user.click(await screen.findByRole("button", { name: "Stop syncing Board deck" }));
        const remove = fetchMock.mock.calls.find(
            ([url, init]) =>
                String(url).endsWith("/items") && (init as RequestInit)?.method === "DELETE"
        );
        expect(JSON.parse((remove![1] as RequestInit).body as string)).toEqual({
            fileIds: ["d1"],
        });

        await user.click(screen.getByRole("button", { name: "Sync now" }));
        await waitFor(() =>
            expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/sync"))).toBe(true)
        );
    });
});
