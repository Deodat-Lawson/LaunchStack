/**
 * One Outlook sync run, with the real connector reading the Microsoft
 * stand-in over a routed `fetch` and the host's database-backed pieces
 * replaced by in-memory ones.
 *
 * What is pinned down: the delta links are stored whole and only when the
 * run succeeded; mail deleted in Outlook is flagged missing (an incremental
 * run cannot say what went, so the folders are walked once more inside the
 * same lease, without storing anything twice); a grant that lost mail access
 * flips the connection to "reconnect"; and a suspended or departed owner
 * never reaches Microsoft at all.
 */

import type {
    DiscoveredKnowledgeItem,
    KnowledgeItem,
    StoredKnowledgeItem,
} from "@launchstack/pipelines/connectors";

import type { ConnectorConnection } from "~/server/db/schema/connectors";

const STAND_IN_ORIGIN = "http://127.0.0.1:3031";
jest.mock("~/env", () => ({
    env: {
        server: {
            MICROSOFT_OAUTH_CLIENT_ID: "cid",
            MICROSOFT_OAUTH_CLIENT_SECRET: "sec",
            MICROSOFT_STAND_IN_URL: "http://127.0.0.1:3031/dev/stand-ins/microsoft",
            OUTLOOK_CONNECTOR_ENABLED: "true",
            EMBEDDING_SECRETS_KEY: "k",
        },
        client: {},
    },
}));

const mockOwnerRows = jest.fn(async () => [{ authUserId: "auth-ada", email: "ada@acme.com" }]);
jest.mock("~/server/db", () => ({
    db: {
        select: () => ({
            from: () => ({ where: () => ({ limit: () => mockOwnerRows() }) }),
        }),
    },
}));

jest.mock("~/server/services/connectors/connection-store", () => ({
    getConnectionById: jest.fn(),
}));
jest.mock("~/server/services/connectors/personal-connections", () => ({
    personalSyncStanding: jest.fn(),
    closePersonalConnectionsNow: jest.fn(),
    sweepMailboxOfClosedConnection: jest.fn(),
}));
jest.mock("~/server/services/microsoft/connections", () => ({
    getMicrosoftAccessToken: jest.fn(),
    markMicrosoftConnectionRevoked: jest.fn(),
}));
jest.mock("~/server/services/connectors/outlook/folder", () => ({
    ensurePrivateOutlookFolder: jest.fn(async () => ({ path: "Outlook/ada@acme.com" })),
}));
jest.mock("~/server/services/connectors/outlook/store", () => ({
    ensureSyncState: jest.fn(),
    claimSyncLease: jest.fn(),
    getSyncState: jest.fn(),
    listScope: jest.fn(),
    releaseSyncLease: jest.fn(),
}));
jest.mock("~/server/services/connectors/outlook/sink", () => ({
    createOutlookSink: jest.fn(),
    listKnownSourceIds: jest.fn(),
    markMissingDocuments: jest.fn(),
}));

import { handleMicrosoftRequest } from "~/app/dev/stand-ins/microsoft/dispatch";
import { mailFolderId } from "~/app/dev/stand-ins/microsoft/seed-mail";
import {
    MORGAN,
    TENANT_ID,
    deleteMessage,
    microsoftWorld,
    resetMicrosoftWorld,
} from "~/app/dev/stand-ins/microsoft/world";
import { getConnectionById } from "~/server/services/connectors/connection-store";
import { ensurePrivateOutlookFolder } from "~/server/services/connectors/outlook/folder";
import * as sinkModule from "~/server/services/connectors/outlook/sink";
import * as storeModule from "~/server/services/connectors/outlook/store";
import { runOutlookSync } from "~/server/services/connectors/outlook/sync-service";
import * as personal from "~/server/services/connectors/personal-connections";
import * as microsoftConnections from "~/server/services/microsoft/connections";

const mockSink = jest.mocked(sinkModule);
const mockStore = jest.mocked(storeModule);
const mockPersonal = jest.mocked(personal);
const mockMicrosoft = jest.mocked(microsoftConnections);

const CONNECTION_ID = 61;
const COMPANY = BigInt(5);
const ADA = BigInt(3);
const INBOX = mailFolderId(MORGAN, "inbox");

function connection(overrides: Partial<ConnectorConnection> = {}): ConnectorConnection {
    return {
        id: CONNECTION_ID,
        companyId: COMPANY,
        provider: "outlook",
        providerAccountId: MORGAN.oid,
        providerAccountEmail: "ada@acme.com",
        grantedByUserId: ADA,
        refreshTokenCiphertext: "sealed",
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

// ── What the database would hold ───────────────────────────────────────

/** Stored documents by source id → fingerprint, and how often each was stored. */
const stored = new Map<string, string>();
const storeCalls: string[] = [];
let deltaLinks: Record<string, string> | null = null;

const sink = {
    async lastSyncedHash(item: DiscoveredKnowledgeItem) {
        return stored.get(item.sourceId) ?? null;
    },
    async store(item: KnowledgeItem): Promise<StoredKnowledgeItem> {
        storeCalls.push(item.sourceId);
        const revised = stored.has(item.sourceId);
        stored.set(item.sourceId, item.contentHash);
        return { sourceId: item.sourceId, documentId: 1, versionId: 1, jobId: "j", revised };
    },
};

// ── The stand-in ───────────────────────────────────────────────────────

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

/** A conversation whose every message sits in Morgan's inbox, and those messages. */
function inboxOnlyConversation(): { conversationId: string; messageIds: string[] } {
    const mine = Object.values(microsoftWorld().messages).filter(m => m.oid === MORGAN.oid);
    const byConversation = new Map<string, typeof mine>();
    for (const message of mine) {
        byConversation.set(message.conversationId, [
            ...(byConversation.get(message.conversationId) ?? []),
            message,
        ]);
    }
    for (const [conversationId, messages] of byConversation) {
        if (messages.every(m => m.folderId === INBOX && !m.isDraft)) {
            return { conversationId, messageIds: messages.map(m => m.id) };
        }
    }
    throw new Error("the stand-in has no conversation that lives only in the inbox");
}

const realFetch = global.fetch;

beforeEach(async () => {
    jest.clearAllMocks();
    stored.clear();
    storeCalls.length = 0;
    deltaLinks = null;
    resetMicrosoftWorld();
    global.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
        handleMicrosoftRequest(new Request(input, init))) as typeof fetch;

    jest.mocked(getConnectionById).mockResolvedValue(connection());
    mockPersonal.personalSyncStanding.mockResolvedValue("active");
    mockPersonal.sweepMailboxOfClosedConnection.mockResolvedValue(null);
    mockMicrosoft.getMicrosoftAccessToken.mockResolvedValue(
        await accessToken(["openid", "offline_access", "Mail.Read"])
    );
    mockStore.claimSyncLease.mockResolvedValue(true);
    mockStore.listScope.mockResolvedValue([
        {
            id: BigInt(1),
            connectionId: CONNECTION_ID,
            kind: "folder",
            value: INBOX,
            name: "Inbox",
            createdAt: new Date(),
        },
    ]);
    mockStore.getSyncState.mockImplementation(async () => ({
        connectionId: CONNECTION_ID,
        deltaLinks,
        lastSyncAt: null,
        lastSyncStatus: "running",
        lastSyncError: null,
        lastSyncReport: null,
        syncLockedAt: new Date(),
    }));
    mockStore.releaseSyncLease.mockImplementation(async (_id, params) => {
        if (params.status === "ok" && params.deltaLinks) deltaLinks = params.deltaLinks;
    });
    mockSink.createOutlookSink.mockResolvedValue(sink);
    mockSink.listKnownSourceIds.mockImplementation(async () => [...stored.keys()]);
});

afterEach(() => {
    global.fetch = realFetch;
});

function lastRelease() {
    return mockStore.releaseSyncLease.mock.calls.at(-1)![1];
}

describe("runOutlookSync", () => {
    it("stores the chosen folder's conversations in the owner's folder and keeps the delta links", async () => {
        const result = await runOutlookSync(CONNECTION_ID);

        expect(result.outcome).toBe("synced");
        expect(ensurePrivateOutlookFolder).toHaveBeenCalledWith({
            companyId: COMPANY,
            ownerUserPk: ADA,
            ownerAuthUserId: "auth-ada",
            accountEmail: "ada@acme.com",
        });
        expect(mockSink.createOutlookSink).toHaveBeenCalledWith({
            companyId: COMPANY,
            connectionId: CONNECTION_ID,
            userId: "auth-ada",
            category: "Outlook/ada@acme.com",
        });
        expect(stored.size).toBeGreaterThan(0);
        // One link per chosen folder, stored whole with the "ok".
        expect(lastRelease()).toMatchObject({ status: "ok" });
        expect(Object.keys(deltaLinks ?? {})).toEqual([INBOX]);
        expect(lastRelease().report).toMatchObject({
            conversations: [...stored.keys()].filter(id => !id.includes(":")).length,
            failed: 0,
        });
        expect(mockSink.markMissingDocuments).not.toHaveBeenCalled();
        expect(mockPersonal.sweepMailboxOfClosedConnection).toHaveBeenCalledWith(
            COMPANY,
            CONNECTION_ID,
            "Outlook/ada@acme.com"
        );
    });

    it("costs nothing to store when nothing changed", async () => {
        await runOutlookSync(CONNECTION_ID);
        storeCalls.length = 0;

        const result = await runOutlookSync(CONNECTION_ID);

        expect(result.outcome).toBe("clean");
        expect(storeCalls).toEqual([]);
        expect(mockSink.listKnownSourceIds).toHaveBeenCalledTimes(2);
    });

    it("flags mail deleted in Outlook as missing, without storing the rest again", async () => {
        await runOutlookSync(CONNECTION_ID);
        const victim = inboxOnlyConversation();
        expect(stored.has(victim.conversationId)).toBe(true);
        const linksBefore = { ...deltaLinks };
        storeCalls.length = 0;

        for (const id of victim.messageIds) deleteMessage(microsoftWorld(), id);
        const result = await runOutlookSync(CONNECTION_ID);

        expect(result.outcome).toBe("synced");
        // The incremental run only knew that messages went; the walk that
        // followed it, inside the same lease, named what is gone.
        expect(mockStore.claimSyncLease).toHaveBeenCalledTimes(2);
        expect(mockSink.markMissingDocuments).toHaveBeenCalledTimes(1);
        const [company, connectionId, gone] = mockSink.markMissingDocuments.mock.calls[0]!;
        expect(company).toBe(COMPANY);
        expect(connectionId).toBe(CONNECTION_ID);
        expect(gone).toContain(victim.conversationId);
        expect(gone.every(id => id.split(":")[0] === victim.conversationId)).toBe(true);
        // Flagged, not removed, and nothing unchanged was stored a second time.
        expect(stored.has(victim.conversationId)).toBe(true);
        expect(storeCalls).toEqual([]);
        expect(lastRelease().report).toMatchObject({
            recheckedAfterRemovals: true,
            missing: gone.length,
        });
        // The links moved on, so the removal is not reported again next time.
        expect(deltaLinks![INBOX]).not.toBe(linksBefore[INBOX]);
        mockSink.markMissingDocuments.mockClear();
        expect((await runOutlookSync(CONNECTION_ID)).outcome).toBe("clean");
        expect(mockSink.markMissingDocuments).not.toHaveBeenCalled();
    });

    it("keeps the old delta links when a run fails, so its changes are seen again", async () => {
        await runOutlookSync(CONNECTION_ID);
        const linksBefore = { ...deltaLinks };
        const victim = inboxOnlyConversation();
        for (const id of victim.messageIds) deleteMessage(microsoftWorld(), id);
        mockSink.markMissingDocuments.mockRejectedValueOnce(new Error("database is away"));

        await expect(runOutlookSync(CONNECTION_ID)).rejects.toThrow("database is away");

        expect(lastRelease()).toEqual({ status: "error", error: "database is away" });
        expect(deltaLinks).toEqual(linksBefore);
        expect(mockMicrosoft.markMicrosoftConnectionRevoked).not.toHaveBeenCalled();
    });

    it("turns a grant that can no longer read mail into a reconnect", async () => {
        mockMicrosoft.getMicrosoftAccessToken.mockResolvedValue(
            await accessToken(["openid", "offline_access", "Files.Read.All"])
        );

        await expect(runOutlookSync(CONNECTION_ID)).rejects.toThrow();

        expect(mockMicrosoft.markMicrosoftConnectionRevoked).toHaveBeenCalledWith(
            CONNECTION_ID,
            expect.stringContaining("Reconnect")
        );
        expect(lastRelease()).toMatchObject({ status: "error" });
        expect(deltaLinks).toBeNull();
        expect(stored.size).toBe(0);
    });

    it("pauses for a suspended owner and closes a departed owner's connection, before any token is minted", async () => {
        mockPersonal.personalSyncStanding.mockResolvedValue("paused");
        expect(await runOutlookSync(CONNECTION_ID)).toMatchObject({ outcome: "skipped" });
        expect(mockPersonal.closePersonalConnectionsNow).not.toHaveBeenCalled();

        mockPersonal.personalSyncStanding.mockResolvedValue("departed");
        expect(await runOutlookSync(CONNECTION_ID)).toMatchObject({ outcome: "skipped" });
        expect(mockPersonal.closePersonalConnectionsNow).toHaveBeenCalledWith(COMPANY, ADA);

        expect(mockStore.claimSyncLease).not.toHaveBeenCalled();
        expect(mockMicrosoft.getMicrosoftAccessToken).not.toHaveBeenCalled();
        expect(stored.size).toBe(0);
    });

    it("skips a connection that is not Outlook's, is revoked, or has nothing chosen", async () => {
        jest.mocked(getConnectionById).mockResolvedValueOnce(connection({ provider: "gmail" }));
        expect(await runOutlookSync(CONNECTION_ID)).toMatchObject({ outcome: "skipped" });

        jest.mocked(getConnectionById).mockResolvedValueOnce(connection({ status: "revoked" }));
        expect(await runOutlookSync(CONNECTION_ID)).toMatchObject({ outcome: "skipped" });
        expect(mockStore.claimSyncLease).not.toHaveBeenCalled();

        mockStore.listScope.mockResolvedValueOnce([]);
        expect(await runOutlookSync(CONNECTION_ID)).toEqual({
            outcome: "skipped",
            reason: "no mail folders or searches selected",
        });
        expect(lastRelease()).toMatchObject({ status: "ok", report: { noScope: true } });
        expect(mockMicrosoft.getMicrosoftAccessToken).not.toHaveBeenCalled();
    });

    it("leaves a run alone when another holds the lease", async () => {
        mockStore.claimSyncLease.mockResolvedValue(false);

        expect(await runOutlookSync(CONNECTION_ID)).toEqual({
            outcome: "skipped",
            reason: "another sync holds the lease",
        });
        expect(mockStore.releaseSyncLease).not.toHaveBeenCalled();
    });
});
