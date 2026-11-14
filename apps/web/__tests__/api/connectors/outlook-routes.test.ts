/**
 * The Outlook routes: /api/connectors/outlook (status, disconnect),
 * /folders, /items and /sync.
 *
 * A mailbox is its member's own. Any member reads their own status and may
 * disconnect; choosing what syncs and syncing need `documents.upload`; and
 * every route looks the connection up by the caller, so nobody (an admin
 * included) reads or operates a colleague's mailbox connection. Disconnect
 * deletes the stored token and says, truthfully, that Microsoft's own
 * listing of the app is for the member to remove.
 *
 * The folder picker's route runs against the Microsoft stand-in over a
 * routed `fetch`, so the tree it answers is the one Graph's shapes produce.
 */

import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";

import type { WorkspaceContextResult } from "~/lib/require-workspace-context";
import type { ConnectorConnection } from "~/server/db/schema/connectors";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn<Promise<WorkspaceContextResult>, []>();
jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);
jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_request: Request, _preset: unknown, handler: () => Promise<Response>) =>
        handler(),
}));

const STAND_IN_ORIGIN = "http://127.0.0.1:3031";
const mockEnv = {
    server: {
        MICROSOFT_OAUTH_CLIENT_ID: "cid" as string | undefined,
        MICROSOFT_OAUTH_CLIENT_SECRET: "sec",
        MICROSOFT_OAUTH_TENANT_ID: undefined,
        MICROSOFT_STAND_IN_URL: `${STAND_IN_ORIGIN}/dev/stand-ins/microsoft`,
        OUTLOOK_CONNECTOR_ENABLED: "true" as string | undefined,
        EMBEDDING_SECRETS_KEY: "k",
        // The generic OAuth layer reads these when it is imported.
        SLACK_CLIENT_ID: undefined,
        SLACK_CLIENT_SECRET: undefined,
    },
    client: {},
};
jest.mock("~/env", () => ({
    get env() {
        return mockEnv;
    },
}));

jest.mock("~/server/services/microsoft/connections", () => ({
    getOutlookConnectionForUser: jest.fn(),
    getMicrosoftAccessToken: jest.fn(),
}));
jest.mock("~/server/services/connectors/outlook/store", () => ({
    listScope: jest.fn(),
    getSyncState: jest.fn(),
    addScope: jest.fn(),
    removeScope: jest.fn(),
    deleteOutlookConnection: jest.fn(),
}));
jest.mock("~/server/inngest/client", () => ({ inngest: { send: jest.fn() } }));
jest.mock("~/lib/authz/audit", () => ({ recordAuditEvent: jest.fn() }));
jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("~/server/services/connectors/workspace-guard", () => ({
    notConfiguredResponse: jest.fn(),
    requireConnectorGrantor: jest.fn(),
}));
jest.mock("~/server/services/connectors/oauth-state", () => ({ createOAuthState: jest.fn() }));

import { handleMicrosoftRequest } from "~/app/dev/stand-ins/microsoft/dispatch";
import { MORGAN, TENANT_ID, resetMicrosoftWorld } from "~/app/dev/stand-ins/microsoft/world";
import { GET as startProviderOAuth } from "~/app/api/connectors/[provider]/oauth/start/route";
import { GET as listFolders } from "~/app/api/connectors/outlook/folders/route";
import {
    DELETE as removeItems,
    GET as listItems,
    POST as addItems,
} from "~/app/api/connectors/outlook/items/route";
import { DELETE as disconnect, GET as status } from "~/app/api/connectors/outlook/route";
import { POST as sync } from "~/app/api/connectors/outlook/sync/route";
import { recordAuditEvent } from "~/lib/authz/audit";
import { inngest } from "~/server/inngest/client";
import * as outlookStore from "~/server/services/connectors/outlook/store";
import * as microsoftConnections from "~/server/services/microsoft/connections";
import { requireConnectorGrantor } from "~/server/services/connectors/workspace-guard";

const mockStore = jest.mocked(outlookStore);
const mockConnections = jest.mocked(microsoftConnections);

const ADA = BigInt(3);
const BEN = BigInt(4);
const COMPANY = BigInt(5);

function row(overrides: Partial<ConnectorConnection> = {}): ConnectorConnection {
    return {
        id: 61,
        companyId: COMPANY,
        provider: "outlook",
        providerAccountId: MORGAN.oid,
        providerAccountEmail: "ada@acme.com",
        grantedByUserId: ADA,
        refreshTokenCiphertext: "sealed-refresh",
        encryptionKeyVersion: 1,
        scopes: "Mail.Read offline_access",
        status: "active",
        lastRefreshError: null,
        createdAt: new Date("2026-11-07T00:00:00.000Z"),
        updatedAt: null,
        accessTokenCiphertext: null,
        accessTokenExpiresAt: null,
        ownerUserId: ADA,
        ...overrides,
    };
}

function signInAs(role: string, userPk: bigint) {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ role, userPk, companyId: COMPANY }),
    });
}

/** Ada's connection is the only one; anyone else has none. */
function onlyAdaIsConnected(connection = row()) {
    mockConnections.getOutlookConnectionForUser.mockImplementation(async (_company, owner) =>
        owner === ADA ? connection : null
    );
}

function request(path: string, method = "GET", body?: unknown): Request {
    return new Request(`http://localhost${path}`, {
        method,
        ...(body === undefined
            ? {}
            : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
}

async function dataOf<T>(response: Response): Promise<T> {
    return ((await response.json()) as { data: T }).data;
}

async function messageOf(response: Response): Promise<string> {
    return ((await response.json()) as { message?: string }).message ?? "";
}

beforeEach(() => {
    jest.clearAllMocks();
    mockEnv.server.OUTLOOK_CONNECTOR_ENABLED = "true";
    mockEnv.server.MICROSOFT_OAUTH_CLIENT_ID = "cid";
    mockStore.listScope.mockResolvedValue([]);
    mockStore.getSyncState.mockResolvedValue(null);
    mockStore.deleteOutlookConnection.mockResolvedValue(true);
    mockStore.removeScope.mockResolvedValue(1);
});

describe("GET /api/connectors/outlook", () => {
    it("tells a member with no mailbox where to connect", async () => {
        signInAs("member", BEN);
        onlyAdaIsConnected();

        const body = await dataOf<Record<string, unknown>>(
            await status(request("/api/connectors/outlook"))
        );

        expect(body).toEqual({
            configured: true,
            connected: false,
            canConnect: true,
            canConfigure: false,
            connectUrl: "/api/connectors/microsoft/oauth/start?provider=outlook",
        });
    });

    it("answers the caller's own connection: account, folder, scope and last sync", async () => {
        signInAs("member", ADA);
        onlyAdaIsConnected();
        mockStore.listScope.mockResolvedValue([
            {
                id: BigInt(9),
                connectionId: 61,
                kind: "folder",
                value: "AAMkInbox",
                name: "Inbox",
                createdAt: new Date(),
            },
        ]);
        mockStore.getSyncState.mockResolvedValue({
            connectionId: 61,
            deltaLinks: { AAMkInbox: "https://graph/delta" },
            lastSyncAt: new Date("2026-11-10T08:00:00.000Z"),
            lastSyncStatus: "ok",
            lastSyncError: null,
            lastSyncReport: { conversations: 2 },
            syncLockedAt: null,
        });

        const body = await dataOf<Record<string, unknown>>(
            await status(request("/api/connectors/outlook"))
        );

        expect(body).toMatchObject({
            configured: true,
            connected: true,
            connectionId: "61",
            status: "active",
            accountEmail: "ada@acme.com",
            folder: "Outlook/ada@acme.com",
            scope: [{ id: "9", kind: "folder", value: "AAMkInbox", name: "Inbox" }],
            lastSyncAt: "2026-11-10T08:00:00.000Z",
            lastSyncStatus: "ok",
            lastSyncReport: { conversations: 2 },
        });
        // The delta links are sync state, never something a browser needs.
        expect(JSON.stringify(body)).not.toContain("graph/delta");
        expect(JSON.stringify(body)).not.toContain("sealed-refresh");
    });

    it("never shows an admin a colleague's mailbox: the lookup is by the caller", async () => {
        signInAs("owner", BEN);
        onlyAdaIsConnected();

        const body = await dataOf<{ connected: boolean }>(
            await status(request("/api/connectors/outlook"))
        );

        expect(body.connected).toBe(false);
        expect(mockConnections.getOutlookConnectionForUser).toHaveBeenCalledWith(COMPANY, BEN);
        expect(mockStore.listScope).not.toHaveBeenCalled();
    });

    it("says the server has it switched off, and who could switch it on", async () => {
        mockEnv.server.OUTLOOK_CONNECTOR_ENABLED = undefined;
        onlyAdaIsConnected();

        signInAs("member", BEN);
        expect(await dataOf(await status(request("/api/connectors/outlook")))).toEqual({
            configured: false,
            connected: false,
            canConnect: true,
            canConfigure: false,
        });

        signInAs("owner", BEN);
        expect(
            await dataOf<{ canConfigure: boolean }>(
                await status(request("/api/connectors/outlook"))
            )
        ).toMatchObject({ configured: false, canConfigure: true });
    });

    it("lets a viewer who connected earlier still see their mailbox, without connect rights", async () => {
        signInAs("viewer", ADA);
        onlyAdaIsConnected();

        const body = await dataOf<Record<string, unknown>>(
            await status(request("/api/connectors/outlook"))
        );

        expect(body).toMatchObject({ connected: true, canConnect: false });
    });
});

describe("DELETE /api/connectors/outlook", () => {
    it("deletes the caller's connection, audits it, and says what Microsoft still holds", async () => {
        signInAs("member", ADA);
        onlyAdaIsConnected();

        const response = await disconnect(request("/api/connectors/outlook", "DELETE"));
        const payload = (await response.json()) as {
            message: string;
            data: Record<string, unknown>;
        };

        expect(response.status).toBe(200);
        expect(mockStore.deleteOutlookConnection).toHaveBeenCalledWith(61);
        // Nothing was revoked at Microsoft, and nothing claims it was.
        expect(payload.data).toEqual({
            deleted: true,
            providerRevoked: false,
            removeAppUrl: "https://myapps.microsoft.com",
        });
        expect(payload.message).toContain("deleted its saved access");
        expect(payload.message).toContain("https://myapps.microsoft.com");
        expect(payload.message).not.toMatch(/revoked/i);
        expect(recordAuditEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                companyId: COMPANY,
                action: "connector.disconnected",
                targetType: "connector",
                targetId: "outlook",
                detail: {
                    connectionId: 61,
                    accountEmail: "ada@acme.com",
                    providerRevoked: false,
                },
            })
        );
    });

    it("lets a viewer who lost upload access still disconnect their own mailbox", async () => {
        signInAs("viewer", ADA);
        onlyAdaIsConnected();

        expect((await disconnect(request("/api/connectors/outlook", "DELETE"))).status).toBe(200);
        expect(mockStore.deleteOutlookConnection).toHaveBeenCalledWith(61);
    });

    it("cannot reach a colleague's connection, whatever the caller's role", async () => {
        signInAs("owner", BEN);
        onlyAdaIsConnected();

        const response = await disconnect(request("/api/connectors/outlook", "DELETE"));

        expect(await dataOf(response)).toEqual({ deleted: false, providerRevoked: false });
        expect(mockStore.deleteOutlookConnection).not.toHaveBeenCalled();
        expect(recordAuditEvent).not.toHaveBeenCalled();
    });
});

describe("choosing what syncs, and syncing", () => {
    const calls: [string, () => Promise<Response>][] = [
        ["GET /folders", () => listFolders(request("/api/connectors/outlook/folders"))],
        ["GET /items", () => listItems(request("/api/connectors/outlook/items"))],
        [
            "POST /items",
            () =>
                addItems(
                    request("/api/connectors/outlook/items", "POST", {
                        items: [{ kind: "folder", value: "AAMkInbox", name: "Inbox" }],
                    })
                ),
        ],
        [
            "DELETE /items",
            () => removeItems(request("/api/connectors/outlook/items", "DELETE", { ids: ["9"] })),
        ],
        ["POST /sync", () => sync(request("/api/connectors/outlook/sync", "POST", {}))],
    ];

    it.each(calls)("%s refuses a member without documents.upload", async (_name, call) => {
        signInAs("viewer", ADA);
        onlyAdaIsConnected();

        expect((await call()).status).toBe(403);
        expect(mockConnections.getMicrosoftAccessToken).not.toHaveBeenCalled();
        expect(mockStore.addScope).not.toHaveBeenCalled();
        expect(mockStore.removeScope).not.toHaveBeenCalled();
        expect(inngest.send).not.toHaveBeenCalled();
    });

    it.each(calls)(
        "%s gives an admin nothing of a colleague's mailbox: they must connect their own",
        async (_name, call) => {
            signInAs("owner", BEN);
            onlyAdaIsConnected();

            const response = await call();

            expect(response.status).toBe(404);
            expect(await messageOf(response)).toBe("Connect Outlook first.");
            expect(mockConnections.getMicrosoftAccessToken).not.toHaveBeenCalled();
            expect(mockStore.addScope).not.toHaveBeenCalled();
            expect(mockStore.removeScope).not.toHaveBeenCalled();
            expect(inngest.send).not.toHaveBeenCalled();
        }
    );

    it.each(calls)("%s refuses when the server has Outlook switched off", async (_name, call) => {
        mockEnv.server.OUTLOOK_CONNECTOR_ENABLED = undefined;
        signInAs("member", ADA);
        onlyAdaIsConnected();

        const response = await call();

        expect(response.status).toBe(403);
        expect(await messageOf(response)).toContain("OUTLOOK_CONNECTOR_ENABLED=true");
    });

    it.each(calls)("%s asks for a reconnect when access was revoked", async (_name, call) => {
        signInAs("member", ADA);
        onlyAdaIsConnected(row({ status: "revoked" }));

        const response = await call();

        expect(response.status).toBe(400);
        expect(await messageOf(response)).toBe("Outlook access was revoked. Reconnect first.");
    });

    it("saves folders and searches, naming a search after itself", async () => {
        signInAs("member", ADA);
        onlyAdaIsConnected();

        const response = await addItems(
            request("/api/connectors/outlook/items", "POST", {
                items: [
                    { kind: "folder", value: "AAMkClientsAcme=", name: "Clients/Acme" },
                    { kind: "query", value: "  from:fund subject:term sheet " },
                ],
            })
        );

        expect(response.status).toBe(200);
        expect(mockStore.addScope).toHaveBeenCalledWith(61, [
            { kind: "folder", value: "AAMkClientsAcme=", name: "Clients/Acme" },
            {
                kind: "query",
                value: "from:fund subject:term sheet",
                name: "from:fund subject:term sheet",
            },
        ]);
        expect(await messageOf(response)).toBe("2 items added.");
    });

    it("refuses a folder id that is not one Graph could have issued", async () => {
        signInAs("member", ADA);
        onlyAdaIsConnected();

        const response = await addItems(
            request("/api/connectors/outlook/items", "POST", {
                items: [{ kind: "folder", value: "inbox')/messages?$top=1", name: "Inbox" }],
            })
        );

        expect(response.status).toBe(400);
        expect(mockStore.addScope).not.toHaveBeenCalled();
    });

    it("removes scope rows from the caller's own connection only", async () => {
        signInAs("member", ADA);
        onlyAdaIsConnected();

        const response = await removeItems(
            request("/api/connectors/outlook/items", "DELETE", { ids: ["9", "12"] })
        );

        expect(response.status).toBe(200);
        expect(mockStore.removeScope).toHaveBeenCalledWith(61, [BigInt(9), BigInt(12)]);
    });

    it("will not start a sync with nothing chosen", async () => {
        signInAs("member", ADA);
        onlyAdaIsConnected();

        const response = await sync(request("/api/connectors/outlook/sync", "POST", {}));

        expect(response.status).toBe(400);
        expect(await messageOf(response)).toBe("Pick at least one mail folder or search to sync.");
        expect(inngest.send).not.toHaveBeenCalled();
    });

    it("queues a sync of the caller's connection and answers 202", async () => {
        signInAs("member", ADA);
        onlyAdaIsConnected();
        mockStore.listScope.mockResolvedValue([
            {
                id: BigInt(9),
                connectionId: 61,
                kind: "folder",
                value: "AAMkInbox",
                name: "Inbox",
                createdAt: new Date(),
            },
        ]);

        const response = await sync(
            request("/api/connectors/outlook/sync", "POST", { force: true })
        );

        expect(response.status).toBe(202);
        expect(inngest.send).toHaveBeenCalledWith({
            name: "outlook/sync.requested",
            data: { connectionId: "61", companyId: "5", force: true },
        });
    });

    it("answers a malformed sync body with 400, not a crash", async () => {
        signInAs("member", ADA);
        onlyAdaIsConnected();

        const response = await sync(
            new Request("http://localhost/api/connectors/outlook/sync", {
                method: "POST",
                body: "{not json",
            })
        );

        expect(response.status).toBe(400);
        expect(inngest.send).not.toHaveBeenCalled();
    });
});

describe("GET /api/connectors/outlook/folders (against the Microsoft stand-in)", () => {
    const realFetch = global.fetch;
    const BASE = `${STAND_IN_ORIGIN}/dev/stand-ins/microsoft`;
    const REDIRECT = `${STAND_IN_ORIGIN}/api/connectors/microsoft/oauth/callback`;

    function post(path: string, form: Record<string, string>) {
        return handleMicrosoftRequest(
            new Request(`${BASE}${path}`, {
                method: "POST",
                headers: { "content-type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams(form),
            })
        );
    }

    /** Consent as Morgan with the given scopes and exchange the code. */
    async function accessToken(scopes: string[]): Promise<string> {
        const consent = await post("/consent", {
            decision: "allow",
            client_id: "cid",
            redirect_uri: REDIRECT,
            state: "n",
            scope: scopes.join(" "),
            account: MORGAN.oid,
        });
        const code = new URL(consent.headers.get("location")!).searchParams.get("code")!;
        const res = await post(`/${TENANT_ID}/oauth2/v2.0/token`, {
            grant_type: "authorization_code",
            code,
            client_id: "cid",
            client_secret: "sec",
            redirect_uri: REDIRECT,
        });
        return ((await res.json()) as { access_token: string }).access_token;
    }

    beforeEach(() => {
        resetMicrosoftWorld();
        global.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
            handleMicrosoftRequest(new Request(input, init))) as typeof fetch;
    });
    afterEach(() => {
        global.fetch = realFetch;
    });

    interface Folder {
        id: string;
        name: string;
        path: string;
        parentId: string | null;
    }

    it("answers the whole tree, child folders under their parents, housekeeping left out", async () => {
        signInAs("member", ADA);
        onlyAdaIsConnected();
        mockConnections.getMicrosoftAccessToken.mockResolvedValue(
            await accessToken(["openid", "offline_access", "Mail.Read"])
        );

        const response = await listFolders(request("/api/connectors/outlook/folders"));
        const { folders } = await dataOf<{ folders: Folder[] }>(response);

        expect(response.status).toBe(200);
        const names = folders.map(folder => folder.name);
        // The folders people think in lead.
        expect(names[0]).toBe("Inbox");
        expect(names).toEqual(expect.arrayContaining(["Inbox", "Sent Items"]));
        for (const noise of ["Junk Email", "Deleted Items", "Drafts", "Outbox"]) {
            expect(names).not.toContain(noise);
        }
        // Child folders come with the tree, each naming a parent that is listed before it.
        const children = folders.filter(folder => folder.parentId !== null);
        expect(children.length).toBeGreaterThan(0);
        for (const child of children) {
            const parentAt = folders.findIndex(folder => folder.id === child.parentId);
            expect(parentAt).toBeGreaterThanOrEqual(0);
            expect(parentAt).toBeLessThan(folders.indexOf(child));
            expect(child.path).toBe(`${folders[parentAt]!.path}/${child.name}`);
        }
        // Every id is one the scope route will accept back.
        for (const folder of folders) expect(folder.id).toMatch(/^[A-Za-z0-9_\-+/=]+$/);
    });

    it("answers an error, not a tree, when the grant cannot read mail", async () => {
        signInAs("member", ADA);
        onlyAdaIsConnected();
        mockConnections.getMicrosoftAccessToken.mockResolvedValue(
            await accessToken(["openid", "offline_access", "Files.Read.All"])
        );
        const quiet = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await listFolders(request("/api/connectors/outlook/folders"));

        quiet.mockRestore();
        expect(response.status).toBeGreaterThanOrEqual(400);
    });
});

describe("GET /api/connectors/outlook/oauth/start (the generic route)", () => {
    it("refuses Outlook and points at Microsoft's own door", async () => {
        signInAs("owner", ADA);

        const response = await startProviderOAuth(request("/api/connectors/outlook/oauth/start"), {
            params: Promise.resolve({ provider: "outlook" }),
        });

        expect(response.status).toBe(400);
        expect(await messageOf(response)).toBe(
            "Outlook connects via /api/connectors/microsoft/oauth/start?provider=outlook."
        );
        expect(requireConnectorGrantor).not.toHaveBeenCalled();
    });
});
