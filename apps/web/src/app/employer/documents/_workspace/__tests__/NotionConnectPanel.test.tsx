/** @jest-environment jsdom */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { createTranslator } from "use-intl";

import { englishMessages } from "~/i18n/messages";

import { NOTION_CONNECT_URL, NotionConnectPanel, syncSummary } from "../NotionConnectPanel";
import { ADD_TABS } from "../types";

/**
 * The Notion panel: one consent on Notion's screen connects a workspace, its
 * picked pages sync into Sources, and every connected workspace gets Sync
 * now, Choose pages (the same consent again) and Disconnect.
 */

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const fetchMock = jest.fn();
let statusBody: unknown;
let statusCode: number;

function respond(body: unknown, code = 200) {
    return Promise.resolve({
        ok: code < 400,
        status: code,
        json: () => Promise.resolve(body),
    });
}

const notionTab = ADD_TABS.flatMap(group => group.items).find(tab => tab.id === "notion")!;

function connection(overrides: Record<string, unknown> = {}) {
    return {
        connectionId: "41",
        workspaceName: "Acme HQ",
        status: "active",
        statusDetail: null,
        connectedBy: "Ada Admin",
        folderPath: "Notion/Acme HQ",
        lastSyncAt: "2026-10-22T12:00:00.000Z",
        lastSyncStatus: "ok",
        lastSyncError: null,
        lastSyncReport: { discovered: 12, stored: 3, failed: 0 },
        ...overrides,
    };
}

beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
});

beforeEach(() => {
    statusCode = 200;
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (url.endsWith("/status")) return respond({ data: statusBody }, statusCode);
        if (url.includes("/sync")) return respond({ data: { queued: 1 } }, 202);
        if (url.startsWith("/api/connectors/connections/") && init?.method === "DELETE") {
            return respond({ data: { deleted: true } });
        }
        return respond({}, 404);
    });
});

describe("NotionConnectPanel", () => {
    it("offers one-click connect when nothing is connected", async () => {
        statusBody = { configured: true, connections: [] };
        render(<NotionConnectPanel tab={notionTab} />);

        const connect = await screen.findByRole("link", { name: /connect notion/i });
        expect(connect).toHaveAttribute("href", NOTION_CONNECT_URL);
        expect(screen.getByText(/own consent screen/i)).toBeInTheDocument();
    });

    it("says the server is not configured instead of offering a dead button", async () => {
        statusBody = { configured: false, connections: [] };
        render(<NotionConnectPanel tab={notionTab} />);

        expect(await screen.findByText(/not configured on this server/i)).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: /connect notion/i })).not.toBeInTheDocument();
    });

    it("tells a member that connecting is for admins", async () => {
        statusCode = 403;
        statusBody = null;
        render(<NotionConnectPanel tab={notionTab} />);

        expect(await screen.findByText(/for workspace admins/i)).toBeInTheDocument();
    });

    it("shows a connected workspace with its folder and last sync", async () => {
        statusBody = { configured: true, connections: [connection()] };
        render(<NotionConnectPanel tab={notionTab} />);

        expect(await screen.findByText("Acme HQ")).toBeInTheDocument();
        expect(screen.getByText("Notion/Acme HQ")).toBeInTheDocument();
        expect(screen.getByText("12 pages · 3 updated")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /choose pages/i })).toHaveAttribute(
            "href",
            NOTION_CONNECT_URL
        );
        expect(
            screen.getByRole("link", { name: /connect another notion workspace/i })
        ).toBeInTheDocument();
    });

    it("syncs that one connection on Sync now", async () => {
        statusBody = { configured: true, connections: [connection()] };
        render(<NotionConnectPanel tab={notionTab} />);

        await userEvent.click(await screen.findByRole("button", { name: /sync now/i }));

        await waitFor(() =>
            expect(fetchMock).toHaveBeenCalledWith(
                "/api/connectors/notion/sync?connectionId=41",
                expect.objectContaining({ method: "POST" })
            )
        );
    });

    it("asks before disconnecting, then removes the connection", async () => {
        statusBody = { configured: true, connections: [connection()] };
        render(<NotionConnectPanel tab={notionTab} />);

        await userEvent.click(await screen.findByRole("button", { name: /^disconnect$/i }));
        statusBody = { configured: true, connections: [] };
        await userEvent.click(screen.getByRole("button", { name: /disconnect acme hq/i }));

        await waitFor(() =>
            expect(fetchMock).toHaveBeenCalledWith("/api/connectors/connections/41", {
                method: "DELETE",
            })
        );
        expect(await screen.findByRole("link", { name: /connect notion/i })).toBeInTheDocument();
    });

    it("offers reconnect for a revoked connection", async () => {
        statusBody = { configured: true, connections: [connection({ status: "revoked" })] };
        render(<NotionConnectPanel tab={notionTab} />);

        expect(await screen.findByText(/access was revoked/i)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /reconnect/i })).toHaveAttribute(
            "href",
            NOTION_CONNECT_URL
        );
        expect(screen.queryByRole("button", { name: /sync now/i })).not.toBeInTheDocument();
    });
});

describe("syncSummary", () => {
    const t = createTranslator({
        locale: "en",
        messages: englishMessages,
        namespace: "sources.notionConnect",
    });

    it("names what the last run did", () => {
        expect(syncSummary(t, { discovered: 1, stored: 0, failed: 2, truncated: true })).toBe(
            "1 page · 2 failed · page limit reached"
        );
        expect(syncSummary(t, null)).toBeNull();
    });
});
