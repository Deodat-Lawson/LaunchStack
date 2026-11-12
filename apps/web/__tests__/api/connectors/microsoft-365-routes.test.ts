/**
 * The Microsoft 365 routes (/api/connectors/microsoft-files/*). The connection
 * is the workspace's, so every one of them needs `connectors.manage`: a
 * member is refused on status, items, browse, sync and deleted before
 * anything is read. For someone who manages connections: status says what
 * is connected and picked; picking names the folder it goes to and is
 * checked like an upload into it; picking something again lets back in what
 * was deleted here under it; Sync now only sends the event; and disconnecting
 * deletes the stored grant without claiming Microsoft revoked anything.
 */
import type { NextResponse } from "next/server";

jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_request: Request, _config: unknown, handler: () => Promise<NextResponse>) =>
        handler(),
}));
jest.mock("~/server/services/connectors/workspace-guard", () => ({
    requireConnectorAdmin: jest.fn(),
    notConfiguredResponse: jest.fn(
        () => new Response(JSON.stringify({ message: "not configured" }), { status: 403 })
    ),
}));
jest.mock("~/server/services/connectors/config", () => ({
    isConnectorConfigured: jest.fn(() => true),
    // As the real one: Microsoft 365 is not one of the generic OAuth providers.
    isOAuthProvider: (provider: string) =>
        ["slack", "github", "linkedin", "notion"].includes(provider),
    getConnectorConfig: jest.fn(),
    PROVIDER_MODULES: {},
}));
jest.mock("~/server/services/connectors/connection-store", () => ({
    listConnectionsForCompany: jest.fn(),
    getConnectionById: jest.fn(),
    deleteConnection: jest.fn(),
}));
jest.mock("~/server/services/connectors/microsoft-365/store", () => ({
    addPickedItems: jest.fn(),
    listPickedItems: jest.fn(),
    removePickedItems: jest.fn(),
    getSyncState: jest.fn(),
}));
jest.mock("~/server/services/connectors/microsoft-365/resolve-link", () => ({
    ...jest.requireActual<object>("~/server/services/connectors/microsoft-365/resolve-link"),
    resolveMicrosoft365Link: jest.fn(),
}));
jest.mock("~/server/services/connectors/deleted-items", () => ({
    isListableDriveRow: (row: { pickedRootId: string | null; sourceId: string }) =>
        row.pickedRootId !== row.sourceId,
    listDeletedItems: jest.fn(),
    forgetDeletedItems: jest.fn(),
    forgetDeletedUnderPicks: jest.fn(),
    summarizeDeletedItems: jest.fn(() => ({ items: [], others: 0 })),
}));
jest.mock("~/server/services/folder-access", () => ({ canEditFolder: jest.fn() }));
jest.mock("~/server/services/microsoft/config", () => ({
    MICROSOFT_365_PROVIDER: "microsoft-365",
    graphApiBaseUrl: () => "https://graph.test/v1.0",
}));
jest.mock("~/server/services/microsoft/connections", () => ({
    getMicrosoftAccessToken: jest.fn(async () => "access-token"),
    markMicrosoftConnectionRevoked: jest.fn(),
}));
jest.mock("~/server/services/microsoft/oauth", () => ({
    MicrosoftAuthError: class MicrosoftAuthError extends Error {
        invalidGrant = false;
    },
}));
jest.mock("~/server/inngest/client", () => ({ inngest: { send: jest.fn() } }));
jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("~/lib/authz/audit", () => ({ recordAuditEvent: jest.fn() }));
jest.mock("~/server/public-origin", () => ({ publicOrigin: () => "https://app.test" }));
jest.mock("~/server/services/connectors/gmail/connections", () => ({
    revokeGoogleToken: jest.fn(),
}));

import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";
import type { WorkspaceContextResult } from "~/lib/require-workspace-context";

const mockRequireWorkspaceContext = jest.fn<Promise<WorkspaceContextResult>, []>();
jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

import { DELETE as disconnect } from "~/app/api/connectors/connections/[connectionId]/route";
import { GET as browse } from "~/app/api/connectors/microsoft-files/browse/route";
import { DELETE as restoreDeleted } from "~/app/api/connectors/microsoft-files/deleted/route";
import {
    DELETE as removeItems,
    GET as listItems,
    POST as addItems,
} from "~/app/api/connectors/microsoft-files/items/route";
import { GET as status } from "~/app/api/connectors/microsoft-files/status/route";
import { POST as sync } from "~/app/api/connectors/microsoft-files/sync/route";
import { recordAuditEvent } from "~/lib/authz/audit";
import { inngest } from "~/server/inngest/client";
import type { ConnectorConnection } from "~/server/db/schema/connectors";
import { isConnectorConfigured } from "~/server/services/connectors/config";
import * as connectionStore from "~/server/services/connectors/connection-store";
import {
    forgetDeletedItems,
    forgetDeletedUnderPicks,
    listDeletedItems,
    type DeletedItemRow,
} from "~/server/services/connectors/deleted-items";
import { resolveMicrosoft365Link } from "~/server/services/connectors/microsoft-365/resolve-link";
import * as store from "~/server/services/connectors/microsoft-365/store";
import { requireConnectorAdmin } from "~/server/services/connectors/workspace-guard";
import { canEditFolder } from "~/server/services/folder-access";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

const admin = makeWorkspaceContext({ role: "admin", userPk: BigInt(11) });
const member = makeWorkspaceContext({ role: "member", userPk: BigInt(12) });
const mockConnections = jest.mocked(connectionStore);
const mockStore = jest.mocked(store);

const BASE = "https://app.example.com/api/connectors/microsoft-files";

function row(overrides: Partial<ConnectorConnection> = {}): ConnectorConnection {
    return {
        id: 7,
        companyId: admin.companyId,
        provider: "microsoft-365",
        providerAccountId: "oid-1",
        providerAccountEmail: "morgan@contoso.com",
        grantedByUserId: BigInt(11),
        ownerUserId: null,
        refreshTokenCiphertext: "sealed",
        status: "active",
        lastRefreshError: null,
        createdAt: new Date("2026-11-01T00:00:00Z"),
        updatedAt: new Date("2026-11-02T00:00:00Z"),
        ...overrides,
    } as ConnectorConnection;
}

function json(path: string, method: string, body?: unknown): Request {
    return new Request(`${BASE}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
    return (await response.json()) as Record<string, unknown>;
}

function asAdmin() {
    jest.mocked(requireConnectorAdmin).mockResolvedValue({ ok: true, ctx: admin });
}

function asMember() {
    jest.mocked(requireConnectorAdmin).mockResolvedValue({
        ok: false,
        response: new Response(JSON.stringify({ message: "forbidden" }), {
            status: 403,
        }) as NextResponse,
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    asAdmin();
    jest.mocked(isConnectorConfigured).mockReturnValue(true);
    mockConnections.listConnectionsForCompany.mockResolvedValue([row()]);
    mockStore.listPickedItems.mockResolvedValue([]);
    mockStore.getSyncState.mockResolvedValue(null);
    jest.mocked(listDeletedItems).mockResolvedValue([]);
    jest.mocked(canEditFolder).mockResolvedValue(true);
});

describe("a member, who doesn't manage connections", () => {
    beforeEach(asMember);

    it.each([
        ["GET status", () => status(json("/status", "GET"))],
        ["GET items", () => listItems(json("/items", "GET"))],
        [
            "POST items",
            () => addItems(json("/items", "POST", { items: [{ driveId: "d", itemId: "i" }] })),
        ],
        [
            "DELETE items",
            () => removeItems(json("/items", "DELETE", { items: [{ driveId: "d", itemId: "i" }] })),
        ],
        ["GET browse", () => browse(json("/browse", "GET"))],
        ["GET browse (sites)", () => browse(json("/browse?sites=clients", "GET"))],
        ["POST sync", () => sync(json("/sync", "POST", {}))],
        [
            "DELETE deleted",
            () => restoreDeleted(json("/deleted", "DELETE", { connectionId: "7", all: true })),
        ],
    ])("is refused on %s before anything is read", async (_name, call) => {
        const response = await call();
        expect(response.status).toBe(403);
        expect(mockConnections.listConnectionsForCompany).not.toHaveBeenCalled();
        expect(mockStore.addPickedItems).not.toHaveBeenCalled();
        expect(mockStore.removePickedItems).not.toHaveBeenCalled();
        expect(inngest.send).not.toHaveBeenCalled();
        expect(forgetDeletedItems).not.toHaveBeenCalled();
    });

    it("can't disconnect the workspace's Microsoft 365 connection", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({ success: true, data: member });
        mockConnections.getConnectionById.mockResolvedValue(row({ companyId: member.companyId }));
        const response = await disconnect(
            new Request("https://app.example.com/api/connectors/connections/7", {
                method: "DELETE",
            }),
            { params: Promise.resolve({ connectionId: "7" }) }
        );
        expect(response.status).toBe(403);
        expect(mockConnections.deleteConnection).not.toHaveBeenCalled();
    });
});

describe("GET status", () => {
    it("says the server isn't configured without looking for a connection", async () => {
        jest.mocked(isConnectorConfigured).mockReturnValue(false);
        const response = await status(json("/status", "GET"));
        expect((await bodyOf(response)).data).toEqual({ configured: false, connected: false });
        expect(mockConnections.listConnectionsForCompany).not.toHaveBeenCalled();
    });

    it("says nothing is connected yet", async () => {
        mockConnections.listConnectionsForCompany.mockResolvedValue([]);
        const response = await status(json("/status", "GET"));
        expect((await bodyOf(response)).data).toEqual({ configured: true, connected: false });
    });

    it("gives the account, what was picked and the last run", async () => {
        mockStore.listPickedItems.mockResolvedValue([
            {
                id: 1n,
                connectionId: 7,
                driveId: "b!drive",
                itemId: "01DECK",
                kind: "file",
                name: "Deck.pdf",
                mimeType: "application/pdf",
                webUrl: "https://contoso.sharepoint.com/Deck.pdf",
                addedByUserPk: 11,
                createdAt: new Date(),
                folderCategoryId: null,
                destination: "Deals/Acme",
            },
        ]);
        mockStore.getSyncState.mockResolvedValue({
            connectionId: 7,
            lastSyncAt: new Date("2026-11-10T09:00:00Z"),
            lastSyncStatus: "ok",
            lastSyncError: null,
            lastSyncReport: { stored: 1, unchanged: 0, failed: 0 },
            syncLockedAt: null,
        });

        const data = (await bodyOf(await status(json("/status", "GET")))).data as Record<
            string,
            unknown
        >;
        expect(data).toMatchObject({
            configured: true,
            connected: true,
            connectionId: "7",
            status: "active",
            accountEmail: "morgan@contoso.com",
            lastSyncAt: "2026-11-10T09:00:00.000Z",
            lastSyncStatus: "ok",
            lastSyncReport: { stored: 1 },
            deletedHere: { items: [], others: 0 },
        });
        expect(data.pickedItems).toEqual([
            {
                sourceId: "b!drive:01DECK",
                driveId: "b!drive",
                itemId: "01DECK",
                kind: "file",
                name: "Deck.pdf",
                mimeType: "application/pdf",
                webUrl: "https://contoso.sharepoint.com/Deck.pdf",
                folderPath: "Deals/Acme",
                folderHidden: false,
            },
        ]);
    });

    it("shows a revoked connection as one to reconnect, rather than hiding it", async () => {
        mockConnections.listConnectionsForCompany.mockResolvedValue([row({ status: "revoked" })]);
        const data = (await bodyOf(await status(json("/status", "GET")))).data;
        expect(data).toMatchObject({ connected: true, status: "revoked", connectionId: "7" });
    });
});

describe("POST items", () => {
    const resolved = {
        driveId: "b!drive",
        itemId: "01ROOM",
        kind: "folder" as const,
        name: "Data room",
        mimeType: null,
        webUrl: "https://contoso.sharepoint.com/sites/Deals/Data%20room",
    };

    it("saves a pasted link's item with the folder it goes to and who picked it", async () => {
        jest.mocked(resolveMicrosoft365Link).mockResolvedValue({ ok: true, item: resolved });
        const response = await addItems(
            json("/items", "POST", {
                link: "https://contoso.sharepoint.com/:f:/s/Deals/Eroom",
                destination: "Deals/Acme/",
            })
        );
        expect(response.status).toBe(200);
        expect(mockStore.addPickedItems).toHaveBeenCalledWith(7, [resolved], 11, "Deals/Acme");
        expect((await bodyOf(response)).message).toBe('"Data room" added.');
    });

    it("lets back in what was deleted here under the pick", async () => {
        jest.mocked(resolveMicrosoft365Link).mockResolvedValue({ ok: true, item: resolved });
        await addItems(json("/items", "POST", { link: "https://contoso.sharepoint.com/x/y" }));
        expect(forgetDeletedUnderPicks).toHaveBeenCalledWith(7, ["b!drive:01ROOM"]);
    });

    it("needs edit access to the folder, as an upload into it would", async () => {
        jest.mocked(canEditFolder).mockResolvedValue(false);
        const response = await addItems(
            json("/items", "POST", {
                link: "https://contoso.sharepoint.com/x/y",
                destination: "Board only",
            })
        );
        expect(response.status).toBe(403);
        expect(resolveMicrosoft365Link).not.toHaveBeenCalled();
        expect(mockStore.addPickedItems).not.toHaveBeenCalled();
    });

    it("answers 404 with who to ask when the account can't open the link", async () => {
        jest.mocked(resolveMicrosoft365Link).mockResolvedValue({
            ok: false,
            reason: "not-found",
            message: "x",
            copy: {
                key: "sources.server.microsoft365.linkNotFound",
                values: { account: "morgan@contoso.com" },
            },
        });
        const response = await addItems(
            json("/items", "POST", { link: "https://contoso.sharepoint.com/x/y" })
        );
        expect(response.status).toBe(404);
        expect((await bodyOf(response)).message).toContain(
            "Ask its owner to share it with morgan@contoso.com"
        );
        expect(mockStore.addPickedItems).not.toHaveBeenCalled();
    });

    it("looks browsed items up at Microsoft rather than trusting the client's names", async () => {
        const realFetch = global.fetch;
        const asked: string[] = [];
        global.fetch = (async (input: string) => {
            asked.push(input);
            return new Response(
                JSON.stringify({
                    id: "01DECK",
                    name: "Deck.pdf",
                    webUrl: "https://contoso.sharepoint.com/Deck.pdf",
                    file: { mimeType: "application/pdf" },
                    parentReference: { driveId: "b!drive" },
                }),
                { status: 200 }
            );
        }) as typeof fetch;
        try {
            const response = await addItems(
                json("/items", "POST", {
                    items: [{ driveId: "b!drive", itemId: "01DECK", name: "Not this name" }],
                    destination: "Deals",
                })
            );
            expect(response.status).toBe(200);
        } finally {
            global.fetch = realFetch;
        }
        expect(asked).toEqual(["https://graph.test/v1.0/drives/b!drive/items/01DECK"]);
        expect(mockStore.addPickedItems).toHaveBeenCalledWith(
            7,
            [
                {
                    driveId: "b!drive",
                    itemId: "01DECK",
                    kind: "file",
                    name: "Deck.pdf",
                    mimeType: "application/pdf",
                    webUrl: "https://contoso.sharepoint.com/Deck.pdf",
                },
            ],
            11,
            "Deals"
        );
    });

    it("refuses while the connection needs reconnecting", async () => {
        mockConnections.listConnectionsForCompany.mockResolvedValue([row({ status: "revoked" })]);
        const response = await addItems(
            json("/items", "POST", { link: "https://contoso.sharepoint.com/x/y" })
        );
        expect(response.status).toBe(400);
        expect((await bodyOf(response)).message).toBe(
            "Microsoft access was revoked. Reconnect first."
        );
    });

    it("refuses a body that names neither a link nor items", async () => {
        const response = await addItems(json("/items", "POST", { destination: "Deals" }));
        expect(response.status).toBe(400);
        expect(mockStore.addPickedItems).not.toHaveBeenCalled();
    });
});

describe("DELETE items", () => {
    it("stops syncing the named picks", async () => {
        const items = [{ driveId: "b!drive", itemId: "01ROOM" }];
        const response = await removeItems(json("/items", "DELETE", { items }));
        expect(response.status).toBe(200);
        expect(mockStore.removePickedItems).toHaveBeenCalledWith(7, items);
    });
});

describe("GET browse", () => {
    it("refuses a query that mixes places", async () => {
        const response = await browse(json("/browse?siteId=s&driveId=d", "GET"));
        expect(response.status).toBe(400);
        const orphan = await browse(json("/browse?itemId=only", "GET"));
        expect(orphan.status).toBe(400);
    });

    it("lists a folder's children for the browser", async () => {
        const realFetch = global.fetch;
        const asked: string[] = [];
        global.fetch = (async (input: string) => {
            asked.push(input);
            return new Response(
                JSON.stringify({
                    value: [
                        { id: "f1", name: "b.pdf", file: { mimeType: "application/pdf" } },
                        { id: "d1", name: "Archive", folder: { childCount: 1 } },
                    ],
                }),
                { status: 200 }
            );
        }) as typeof fetch;
        let response: Response;
        try {
            response = await browse(json("/browse?driveId=b!drive&itemId=01ROOM", "GET"));
        } finally {
            global.fetch = realFetch;
        }
        expect(response.status).toBe(200);
        expect(asked[0]).toContain("/drives/b!drive/items/01ROOM/children");
        const data = (await bodyOf(response)).data as { items: { name: string }[] };
        expect(data.items.map(item => item.name)).toEqual(["Archive", "b.pdf"]);
    });
});

describe("POST sync", () => {
    it("only sends the event: the worker runs the sync", async () => {
        const response = await sync(json("/sync", "POST", {}));
        expect(response.status).toBe(202);
        expect(inngest.send).toHaveBeenCalledWith({
            name: "microsoft-365/sync.requested",
            data: { connectionId: "7", companyId: admin.companyId.toString(), force: undefined },
        });
    });

    it("refuses while the connection needs reconnecting, or when nothing is connected", async () => {
        mockConnections.listConnectionsForCompany.mockResolvedValue([row({ status: "revoked" })]);
        expect((await sync(json("/sync", "POST", {}))).status).toBe(400);
        mockConnections.listConnectionsForCompany.mockResolvedValue([]);
        expect((await sync(json("/sync", "POST", {}))).status).toBe(404);
        expect(inngest.send).not.toHaveBeenCalled();
    });
});

describe("DELETE deleted", () => {
    const deleted = (sourceId: string, pickedRootId: string | null): DeletedItemRow => ({
        connectionId: 7,
        sourceId,
        pickedRootId,
        title: sourceId,
        deletedByUserPk: 11,
        deletedAt: new Date(),
    });

    it("forgets what came through a folder, never a file whose own pick went with it", async () => {
        jest.mocked(listDeletedItems).mockResolvedValue([
            deleted("b!d:in-folder", "b!d:room"),
            deleted("b!d:solo", "b!d:solo"),
        ]);
        jest.mocked(forgetDeletedItems).mockResolvedValue(1);
        const response = await restoreDeleted(
            json("/deleted", "DELETE", { connectionId: "7", all: true })
        );
        expect(response.status).toBe(200);
        expect(forgetDeletedItems).toHaveBeenCalledWith(7, { sourceIds: ["b!d:in-folder"] });
    });

    it("can't reach another workspace's connection", async () => {
        const response = await restoreDeleted(
            json("/deleted", "DELETE", { connectionId: "99", all: true })
        );
        expect(response.status).toBe(404);
        expect(forgetDeletedItems).not.toHaveBeenCalled();
    });
});

describe("disconnecting", () => {
    it("deletes the stored grant, audits it, and doesn't claim Microsoft revoked anything", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({ success: true, data: admin });
        mockConnections.getConnectionById.mockResolvedValue(row());
        mockConnections.deleteConnection.mockResolvedValue({
            accessToken: null,
            refreshToken: "refresh",
        });
        const realFetch = global.fetch;
        const fetchSpy = jest.fn();
        global.fetch = fetchSpy as unknown as typeof fetch;
        let response: Response;
        try {
            response = await disconnect(
                new Request("https://app.example.com/api/connectors/connections/7", {
                    method: "DELETE",
                }),
                { params: Promise.resolve({ connectionId: "7" }) }
            );
        } finally {
            global.fetch = realFetch;
        }

        expect(response.status).toBe(200);
        const body = await bodyOf(response);
        expect(body.data).toEqual({ deleted: true, providerRevoked: false });
        expect(String(body.message)).toMatch(/provider-side grant may still exist/);
        expect(mockConnections.deleteConnection).toHaveBeenCalledWith(7);
        // There is no revocation endpoint to call, so nothing is called.
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(recordAuditEvent).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                action: "connector.disconnected",
                targetId: "microsoft-365",
                detail: expect.objectContaining({ connectionId: 7, providerRevoked: false }),
            })
        );
    });
});
