/** @jest-environment jsdom */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { DriveConnectPanel } from "../DriveConnectPanel";
import type { DriveStatus } from "../driveStatus";
import { ADD_TABS } from "../types";

/**
 * The Drive panel's folder-import states: whether a picked folder can bring
 * its contents is decided by the grant, and the panel must say which case
 * this is instead of letting a folder import nothing in silence — plus the
 * paste-a-link path that only exists when folders can be read.
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

const driveTab = ADD_TABS.flatMap(group => group.items).find(tab => tab.id === "drive")!;

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
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (url.endsWith("/status")) return respond({ data: status });
        if (url.endsWith("/items") && init?.method === "POST") {
            const body = JSON.parse(init.body as string) as { link?: string };
            if (body.link?.includes("not-shared")) {
                return respond(
                    {
                        message:
                            "alex.rivera@example.com can't open that link. Ask its owner to share it with alex.rivera@example.com, then paste it again.",
                    },
                    404
                );
            }
            return respond({ data: { count: 1 }, message: "“Acme Seed Data Room” added." });
        }
        if (url.endsWith("/sync")) return respond({ data: { queued: true } }, 202);
        return respond({}, 404);
    });
});

describe("DriveConnectPanel folder access", () => {
    it("asks for one reconnect when the server can import folders but this grant can't", async () => {
        status = connected({ folderAccess: { enabled: true, granted: false } });
        render(<DriveConnectPanel tab={driveTab} />);

        expect(
            await screen.findByText("Allow folder access to import folders")
        ).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Allow folder access" })).toBeInTheDocument();
        expect(screen.queryByLabelText("Paste a folder link")).not.toBeInTheDocument();
    });

    it("says only picked files come in when the server hasn't turned folder import on", async () => {
        status = connected({ folderAccess: { enabled: false, granted: false } });
        render(<DriveConnectPanel tab={driveTab} />);

        expect(
            await screen.findByText(/Only files you pick one by one come in/)
        ).toBeInTheDocument();
        expect(screen.getByText("GOOGLE_DRIVE_FOLDER_ACCESS_ENABLED")).toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: "Allow folder access" })
        ).not.toBeInTheDocument();
        expect(screen.queryByLabelText("Paste a folder link")).not.toBeInTheDocument();
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
        render(<DriveConnectPanel tab={driveTab} />);

        expect(
            await screen.findByText(
                "Nothing came in from “Acme Seed Data Room”: this connection can't see inside folders."
            )
        ).toBeInTheDocument();
        expect(screen.getByText("Its contents need folder access")).toBeInTheDocument();
    });

    it("shows where each picked folder's files are", async () => {
        status = connected({
            pickedItems: [
                {
                    fileId: "f1",
                    kind: "folder",
                    name: "Acme Seed Data Room",
                    mimeType: null,
                    folderPath: "Acme Seed Data Room",
                },
                { fileId: "f2", kind: "folder", name: "Customer research", mimeType: null },
                { fileId: "d1", kind: "file", name: "Pitch notes", mimeType: null },
            ],
        });
        render(<DriveConnectPanel tab={driveTab} />);

        expect(await screen.findByText("In Acme Seed Data Room")).toBeInTheDocument();
        expect(screen.getByText("Becomes its own folder on the next sync")).toBeInTheDocument();
        expect(screen.getByText("In Google Drive")).toBeInTheDocument();
    });
});

describe("DriveConnectPanel status check", () => {
    it("says a failed check failed, instead of calling Drive not configured", async () => {
        fetchMock.mockImplementation(() => respond({ message: "Database connection error" }, 503));
        render(<DriveConnectPanel tab={driveTab} />);

        expect(await screen.findByText(/Couldn.t check Google Drive just now/)).toBeInTheDocument();
        expect(screen.queryByText(/not configured on this server/)).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    });
});

describe("DriveConnectPanel paste a folder link", () => {
    it("checks the link before sending it", async () => {
        status = connected();
        render(<DriveConnectPanel tab={driveTab} />);
        const user = userEvent.setup();

        await user.type(await screen.findByLabelText("Paste a folder link"), "hello there");
        await user.click(screen.getByRole("button", { name: "Add folder" }));

        expect(
            screen.getByText("That isn't a Google Drive link. In Drive, use Share › Copy link.")
        ).toBeInTheDocument();
        expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/items"))).toBe(false);
    });

    it("adds the folder, then starts a sync", async () => {
        status = connected();
        render(<DriveConnectPanel tab={driveTab} />);
        const user = userEvent.setup();

        await user.type(
            await screen.findByLabelText("Paste a folder link"),
            "https://drive.google.com/drive/folders/sa-dataroom?usp=sharing"
        );
        await user.click(screen.getByRole("button", { name: "Add folder" }));

        await waitFor(() =>
            expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/sync"))).toBe(true)
        );
        const add = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/items"))!;
        expect(JSON.parse((add[1] as RequestInit).body as string)).toEqual({
            link: "https://drive.google.com/drive/folders/sa-dataroom?usp=sharing",
        });
        expect(screen.getByLabelText("Paste a folder link")).toHaveValue("");
    });

    it("shows the server's reason when the account can't open the link", async () => {
        status = connected();
        render(<DriveConnectPanel tab={driveTab} />);
        const user = userEvent.setup();

        await user.type(
            await screen.findByLabelText("Paste a folder link"),
            "https://drive.google.com/drive/folders/1not-shared-with-alex"
        );
        await user.click(screen.getByRole("button", { name: "Add folder" }));

        expect(
            await screen.findByText(/Ask its owner to share it with alex.rivera@example.com/)
        ).toBeInTheDocument();
        expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/sync"))).toBe(false);
    });
});
