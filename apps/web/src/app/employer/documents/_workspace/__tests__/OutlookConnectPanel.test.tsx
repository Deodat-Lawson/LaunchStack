/** @jest-environment jsdom */

import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { toast } from "sonner";

import {
    MICROSOFT_APPS_URL,
    OUTLOOK_CONNECT_URL,
    OutlookConnectPanel,
} from "../OutlookConnectPanel";
import { ADD_TABS } from "../types";

/**
 * The Outlook panel's main states: not enabled (worded for an operator and
 * for everyone else), connect, reconnect, and connected, where the member
 * picks mail folders from the tree (child folders included), adds a search,
 * syncs, removes what syncs, and disconnects behind a confirmation that says
 * what Microsoft still holds.
 */

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const fetchMock = jest.fn();
let statusBody: Record<string, unknown>;
let statusCode: number;
let itemsCode: number;
let foldersCode: number;

function respond(body: unknown, code = 200) {
    return Promise.resolve({
        ok: code < 400,
        status: code,
        json: () => Promise.resolve(body),
    });
}

const outlookTab = ADD_TABS.flatMap(group => group.items).find(tab => tab.id === "outlook")!;

const FOLDERS = [
    { id: "AAMkInbox", name: "Inbox", path: "Inbox", parentId: null },
    { id: "AAMkSent", name: "Sent Items", path: "Sent Items", parentId: null },
    { id: "AAMkClients", name: "Clients", path: "Clients", parentId: null },
    { id: "AAMkAcme", name: "Acme", path: "Clients/Acme", parentId: "AAMkClients" },
];

function connected(overrides: Record<string, unknown> = {}) {
    return {
        configured: true,
        connected: true,
        canConnect: true,
        canConfigure: false,
        connectUrl: OUTLOOK_CONNECT_URL,
        connectionId: "61",
        status: "active",
        statusDetail: null,
        accountEmail: "ada@acme.com",
        folder: "Outlook/ada@acme.com",
        scope: [{ id: "9", kind: "folder", value: "AAMkInbox", name: "Inbox" }],
        lastSyncAt: "2026-11-10T08:00:00.000Z",
        lastSyncStatus: "ok",
        lastSyncError: null,
        lastSyncReport: { conversations: 4, attachments: 1, unchanged: 12, failed: 0 },
        ...overrides,
    };
}

function calls(method: string, url: string) {
    return fetchMock.mock.calls.filter(
        ([calledUrl, init]: [string, RequestInit | undefined]) =>
            calledUrl === url && (init?.method ?? "GET") === method
    );
}

function bodyOf(call: unknown[]): unknown {
    const body = (call[1] as RequestInit).body;
    return JSON.parse(typeof body === "string" ? body : "null");
}

beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
});

beforeEach(() => {
    statusCode = 200;
    itemsCode = 200;
    foldersCode = 200;
    jest.mocked(toast.success).mockClear();
    jest.mocked(toast.error).mockClear();
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (url === "/api/connectors/outlook" && method === "GET") {
            return respond({ data: statusBody }, statusCode);
        }
        if (url === "/api/connectors/outlook" && method === "DELETE") {
            return respond({
                data: { deleted: true, providerRevoked: false, removeAppUrl: MICROSOFT_APPS_URL },
            });
        }
        if (url === "/api/connectors/outlook/folders") {
            return respond({ data: { folders: FOLDERS } }, foldersCode);
        }
        if (url === "/api/connectors/outlook/items") return respond({ data: {} }, itemsCode);
        if (url === "/api/connectors/outlook/sync") return respond({ data: { queued: true } }, 202);
        return respond({}, 404);
    });
});

describe("OutlookConnectPanel", () => {
    it("tells a member whom to ask when the server has Outlook switched off", async () => {
        statusBody = { configured: false, connected: false, canConnect: true, canConfigure: false };
        render(<OutlookConnectPanel tab={outlookTab} />);

        expect(
            await screen.findByText("Outlook is not enabled on this server")
        ).toBeInTheDocument();
        expect(screen.getByText(/ask whoever runs launchstack/i)).toBeInTheDocument();
        expect(screen.queryByText("OUTLOOK_CONNECTOR_ENABLED=true")).not.toBeInTheDocument();
        expect(screen.queryByRole("link", { name: /connect outlook/i })).not.toBeInTheDocument();
    });

    it("tells an operator which switches to set", async () => {
        statusBody = { configured: false, connected: false, canConnect: true, canConfigure: true };
        render(<OutlookConnectPanel tab={outlookTab} />);

        expect(await screen.findByText("OUTLOOK_CONNECTOR_ENABLED=true")).toBeInTheDocument();
        expect(screen.getByText("Mail.Read")).toBeInTheDocument();
        expect(screen.queryByText(/ask whoever runs launchstack/i)).not.toBeInTheDocument();
    });

    it("offers Connect through Microsoft's door, with what connecting gives", async () => {
        statusBody = {
            configured: true,
            connected: false,
            canConnect: true,
            connectUrl: OUTLOOK_CONNECT_URL,
        };
        render(<OutlookConnectPanel tab={outlookTab} />);

        const connect = await screen.findByRole("link", { name: "Connect Outlook" });
        expect(connect).toHaveAttribute(
            "href",
            "/api/connectors/microsoft/oauth/start?provider=outlook"
        );
        expect(screen.getByText("Pick mail folders or Outlook searches")).toBeInTheDocument();
        expect(screen.getByText(/a folder only you can see/i)).toBeInTheDocument();
    });

    it("explains why a role that cannot add sources cannot connect", async () => {
        statusBody = { configured: true, connected: false, canConnect: false };
        render(<OutlookConnectPanel tab={outlookTab} />);

        expect(await screen.findByText(/can’t connect a mailbox/i)).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: /connect outlook/i })).not.toBeInTheDocument();
    });

    it("offers Reconnect, with Microsoft's reason, when access was revoked", async () => {
        statusBody = connected({ status: "revoked", statusDetail: "AADSTS70000" });
        render(<OutlookConnectPanel tab={outlookTab} />);

        expect(await screen.findByText("Reconnect your Outlook")).toBeInTheDocument();
        expect(screen.getByText(/AADSTS70000/)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Reconnect Outlook" })).toHaveAttribute(
            "href",
            OUTLOOK_CONNECT_URL
        );
        // A mailbox that will not be reconnected can still be removed.
        expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    });

    it("says it could not load, and loads on retry", async () => {
        statusCode = 500;
        statusBody = connected();
        render(<OutlookConnectPanel tab={outlookTab} />);

        expect(await screen.findByRole("alert")).toHaveTextContent(/could not load/i);
        statusCode = 200;
        await userEvent.click(screen.getByRole("button", { name: "Try again" }));

        expect(await screen.findByText("ada@acme.com")).toBeInTheDocument();
    });

    it("shows the account, where mail lands, what syncs and the last run", async () => {
        statusBody = connected({
            scope: [
                { id: "9", kind: "folder", value: "AAMkInbox", name: "Inbox" },
                { id: "10", kind: "query", value: "from:fund", name: "from:fund" },
            ],
        });
        render(<OutlookConnectPanel tab={outlookTab} />);

        expect(await screen.findByText("ada@acme.com")).toBeInTheDocument();
        expect(screen.getByText("Outlook/ada@acme.com")).toBeInTheDocument();
        expect(screen.getByText("Syncing from Outlook (2)")).toBeInTheDocument();
        expect(screen.getByText("from:fund")).toBeInTheDocument();
        expect(
            screen.getByText(
                "Last run: 4 conversations and 1 attachment imported, 12 unchanged, 0 failed."
            )
        ).toBeInTheDocument();
    });

    it("shows a failed sync's reason", async () => {
        statusBody = connected({ lastSyncStatus: "error", lastSyncError: "Graph was away" });
        render(<OutlookConnectPanel tab={outlookTab} />);

        expect(await screen.findByRole("alert")).toHaveTextContent(
            "Last sync failed: Graph was away"
        );
    });

    it("picks a child folder from the tree and starts syncing it under its path", async () => {
        statusBody = connected();
        const onImported = jest.fn();
        render(<OutlookConnectPanel tab={outlookTab} onImported={onImported} />);

        await userEvent.click(await screen.findByRole("button", { name: "Choose folders" }));
        const tree = await screen.findByRole("tree");
        // Already syncing: ticked and locked.
        expect(within(tree).getByRole("checkbox", { name: /inbox/i })).toBeDisabled();
        // Child folders stay folded away until their parent is opened.
        expect(within(tree).queryByText("Acme")).not.toBeInTheDocument();
        await userEvent.click(
            within(tree).getByRole("button", { name: "Show folders inside Clients" })
        );
        await userEvent.click(within(tree).getByRole("checkbox", { name: "Acme" }));
        await userEvent.click(screen.getByRole("button", { name: "Add 1 folder" }));

        await waitFor(() => expect(calls("POST", "/api/connectors/outlook/items")).toHaveLength(1));
        expect(bodyOf(calls("POST", "/api/connectors/outlook/items")[0])).toEqual({
            items: [{ kind: "folder", value: "AAMkAcme", name: "Clients/Acme" }],
        });
        await waitFor(() => expect(calls("POST", "/api/connectors/outlook/sync")).toHaveLength(1));
        expect(toast.success).toHaveBeenCalledWith("1 folder added. Syncing now.");
        expect(onImported).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole("tree")).not.toBeInTheDocument();
    });

    it("says so when the folders cannot be loaded", async () => {
        statusBody = connected();
        foldersCode = 500;
        render(<OutlookConnectPanel tab={outlookTab} />);

        await userEvent.click(await screen.findByRole("button", { name: "Choose folders" }));

        expect(await screen.findByRole("alert")).toHaveTextContent(
            /could not load your mail folders/i
        );
        expect(screen.getByRole("button", { name: "Add folders" })).toBeDisabled();
    });

    it("adds a search and starts syncing", async () => {
        statusBody = connected();
        render(<OutlookConnectPanel tab={outlookTab} />);

        const box = await screen.findByRole("textbox", { name: "Outlook search to sync" });
        expect(screen.getByRole("button", { name: "Add search" })).toBeDisabled();
        await userEvent.type(box, "from:fund subject:term");
        await userEvent.click(screen.getByRole("button", { name: "Add search" }));

        await waitFor(() => expect(calls("POST", "/api/connectors/outlook/items")).toHaveLength(1));
        expect(bodyOf(calls("POST", "/api/connectors/outlook/items")[0])).toEqual({
            items: [{ kind: "query", value: "from:fund subject:term" }],
        });
        await waitFor(() =>
            expect(toast.success).toHaveBeenCalledWith("Search added. Syncing now.")
        );
        expect(box).toHaveValue("");
    });

    it("keeps the search and says so when it could not be saved", async () => {
        statusBody = connected();
        itemsCode = 400;
        render(<OutlookConnectPanel tab={outlookTab} />);

        const box = await screen.findByRole("textbox", { name: "Outlook search to sync" });
        await userEvent.type(box, "from:fund");
        await userEvent.click(screen.getByRole("button", { name: "Add search" }));

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not save the search"));
        expect(box).toHaveValue("from:fund");
        expect(calls("POST", "/api/connectors/outlook/sync")).toHaveLength(0);
    });

    it("syncs now, and removes a folder from the sync", async () => {
        statusBody = connected();
        render(<OutlookConnectPanel tab={outlookTab} />);

        await userEvent.click(await screen.findByRole("button", { name: "Sync now" }));
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Sync requested"));

        await userEvent.click(
            screen.getByRole("button", { name: "Stop syncing Inbox. Imported mail is kept." })
        );
        await waitFor(() =>
            expect(calls("DELETE", "/api/connectors/outlook/items")).toHaveLength(1)
        );
        expect(bodyOf(calls("DELETE", "/api/connectors/outlook/items")[0])).toEqual({
            ids: ["9"],
        });
    });

    it("will not sync with nothing chosen", async () => {
        statusBody = connected({ scope: [], lastSyncReport: null });
        render(<OutlookConnectPanel tab={outlookTab} />);

        expect(await screen.findByText(/nothing chosen yet/i)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Sync now" })).toBeDisabled();
    });

    it("leaves a member who lost upload access with Disconnect only", async () => {
        statusBody = connected({ canConnect: false });
        render(<OutlookConnectPanel tab={outlookTab} />);

        expect(await screen.findByText(/syncing is paused/i)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Choose folders" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Sync now" })).not.toBeInTheDocument();
        expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    });

    it("disconnects only after confirming, and says what Microsoft still holds", async () => {
        statusBody = connected();
        const opened = jest.spyOn(window, "open").mockImplementation(() => null);
        render(<OutlookConnectPanel tab={outlookTab} />);

        await userEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
        const dialog = await screen.findByRole("dialog");
        expect(dialog).toHaveTextContent("Disconnect Outlook?");
        expect(dialog).toHaveTextContent(/deletes its saved access to ada@acme.com/i);
        expect(dialog).toHaveTextContent(/until you remove it there/i);
        expect(calls("DELETE", "/api/connectors/outlook")).toHaveLength(0);

        await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
        expect(calls("DELETE", "/api/connectors/outlook")).toHaveLength(0);

        await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));
        await userEvent.click(
            within(await screen.findByRole("dialog")).getByRole("button", { name: "Disconnect" })
        );

        await waitFor(() => expect(calls("DELETE", "/api/connectors/outlook")).toHaveLength(1));
        await waitFor(() => expect(toast.success).toHaveBeenCalled());
        const [title, options] = jest.mocked(toast.success).mock.calls[0]! as [
            string,
            { description: string; action: { label: string; onClick: () => void } },
        ];
        expect(title).toBe("Outlook disconnected. Imported mail was kept.");
        expect(options.description).toMatch(/remove it from your Microsoft account/i);
        expect(`${title} ${options.description}`).not.toMatch(/revoked/i);
        options.action.onClick();
        expect(opened).toHaveBeenCalledWith(
            "https://myapps.microsoft.com",
            "_blank",
            "noopener,noreferrer"
        );
        opened.mockRestore();
    });

    it("lets a mailbox connected before the switch went off still be disconnected", async () => {
        statusBody = connected({ configured: false });
        render(<OutlookConnectPanel tab={outlookTab} />);

        expect(
            await screen.findByText(
                /ada@acme.com was connected before the connector was turned off/i
            )
        ).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));
        await userEvent.click(
            within(await screen.findByRole("dialog")).getByRole("button", { name: "Disconnect" })
        );

        await waitFor(() => expect(calls("DELETE", "/api/connectors/outlook")).toHaveLength(1));
    });
});
