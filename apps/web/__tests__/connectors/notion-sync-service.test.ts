/**
 * The Notion sync run's token handling: Notion sends no expiry, so a 401 is
 * the first sign a token died. The run refreshes once and retries; a token
 * Notion still refuses after that is a dead grant, and the connection is
 * marked revoked so the panel offers reconnect instead of retrying forever.
 */

import type { NotionClient } from "@launchstack/pipelines/connectors/notion";

import type { ConnectorConnection, NotionSyncState } from "~/server/db/schema/connectors";

const mockClientsByToken = new Map<string, NotionClient>();

jest.mock("~/server/services/connectors/connection-store", () => ({
    getConnectionById: jest.fn(),
    getConnectionAccessToken: jest.fn(),
    refreshConnectionAccessToken: jest.fn(),
    markConnectionRevoked: jest.fn(),
}));
jest.mock("~/server/services/connectors/notion/store", () => ({
    ensureSyncState: jest.fn(),
    claimSyncLease: jest.fn(),
    getSyncState: jest.fn(),
    releaseSyncLease: jest.fn(),
    rememberFolder: jest.fn(),
}));
jest.mock("~/server/services/connectors/notion/sink", () => ({
    createNotionSink: jest.fn(),
    listKnownSourceIds: jest.fn(),
    markMissingDocuments: jest.fn(),
}));
jest.mock("~/server/services/connectors/notion/folder", () => ({
    ensureNotionFolder: jest.fn(async () => ({ path: "Notion/Acme HQ", categoryId: 9 })),
}));
jest.mock("~/server/db", () => {
    const chain = {
        from: () => chain,
        where: () => chain,
        limit: async () => [{ authUserId: "auth-ada" }],
    };
    return { db: { select: () => chain } };
});
jest.mock("@launchstack/pipelines/connectors/notion", () => {
    const actual = jest.requireActual<Record<string, unknown>>(
        "@launchstack/pipelines/connectors/notion"
    );
    return {
        ...actual,
        createNotionClient: ({ accessToken }: { accessToken: string }) => {
            const client = mockClientsByToken.get(accessToken);
            if (!client) throw new Error(`no fake client for ${accessToken}`);
            return client;
        },
    };
});

import { NotionAuthError } from "@launchstack/pipelines/connectors/notion";
import * as connectionStoreModule from "~/server/services/connectors/connection-store";
import * as sinkModuleExports from "~/server/services/connectors/notion/sink";
import * as syncStoreModule from "~/server/services/connectors/notion/store";
import { runNotionSync } from "~/server/services/connectors/notion/sync-service";

const mockConnectionStore = jest.mocked(connectionStoreModule);
const mockSyncStore = jest.mocked(syncStoreModule);
const mockSinkModule = jest.mocked(sinkModuleExports);

const CONNECTION: ConnectorConnection = {
    id: 41,
    companyId: 7n,
    provider: "notion",
    providerAccountId: "bot-1",
    providerAccountEmail: "Acme HQ",
    grantedByUserId: 3n,
    refreshTokenCiphertext: "sealed-refresh",
    encryptionKeyVersion: 1,
    scopes: "",
    status: "active",
    lastRefreshError: null,
    createdAt: new Date("2026-10-22T00:00:00.000Z"),
    updatedAt: null,
    accessTokenCiphertext: "sealed-access",
    accessTokenExpiresAt: null,
    ownerUserId: null,
};

const SYNC_STATE: NotionSyncState = {
    connectionId: 41,
    folderCategoryId: 9,
    lastSyncAt: null,
    lastSyncStatus: null,
    lastSyncError: null,
    lastSyncReport: null,
    syncLockedAt: null,
};

function workingClient(pageIds: string[]): NotionClient {
    return {
        async searchPages() {
            return {
                results: pageIds.map(id => ({
                    object: "page",
                    id,
                    last_edited_time: "2026-10-22T10:00:00.000Z",
                    properties: { Name: { type: "title", title: [{ plain_text: id }] } },
                })),
                has_more: false,
                next_cursor: null,
            };
        },
        async getPageMarkdown(id) {
            return { id, markdown: `Body of ${id}`, truncated: false };
        },
    };
}

const deadClient: NotionClient = {
    async searchPages() {
        throw new NotionAuthError("API token is invalid.");
    },
    async getPageMarkdown() {
        throw new NotionAuthError("API token is invalid.");
    },
};

const stored: string[] = [];

beforeEach(() => {
    jest.clearAllMocks();
    mockClientsByToken.clear();
    stored.length = 0;
    mockConnectionStore.getConnectionById.mockResolvedValue(CONNECTION);
    mockSyncStore.claimSyncLease.mockResolvedValue(true);
    mockSyncStore.getSyncState.mockResolvedValue(SYNC_STATE);
    mockSinkModule.listKnownSourceIds.mockResolvedValue([]);
    mockSinkModule.createNotionSink.mockResolvedValue({
        async store(item: { sourceId: string }) {
            stored.push(item.sourceId);
            return {
                sourceId: item.sourceId,
                documentId: 1,
                versionId: 1,
                jobId: null,
                revised: false,
            };
        },
    });
});

describe("runNotionSync", () => {
    it("syncs with the stored token when Notion accepts it", async () => {
        mockConnectionStore.getConnectionAccessToken.mockResolvedValue("stored");
        mockClientsByToken.set("stored", workingClient(["p-1", "p-2"]));

        const result = await runNotionSync(41);

        expect(result.outcome).toBe("synced");
        expect(stored).toEqual(["p-1", "p-2"]);
        expect(mockConnectionStore.refreshConnectionAccessToken).not.toHaveBeenCalled();
        expect(mockSyncStore.releaseSyncLease).toHaveBeenCalledWith(
            41,
            expect.objectContaining({ status: "ok" })
        );
    });

    it("refreshes once and retries after a 401", async () => {
        mockConnectionStore.getConnectionAccessToken.mockResolvedValue("stale");
        mockConnectionStore.refreshConnectionAccessToken.mockResolvedValue("fresh");
        mockClientsByToken.set("stale", deadClient);
        mockClientsByToken.set("fresh", workingClient(["p-1"]));

        const result = await runNotionSync(41);

        expect(result.outcome).toBe("synced");
        expect(mockConnectionStore.refreshConnectionAccessToken).toHaveBeenCalledTimes(1);
        expect(stored).toEqual(["p-1"]);
        expect(mockConnectionStore.markConnectionRevoked).not.toHaveBeenCalled();
    });

    it("marks the connection revoked when Notion refuses the refreshed token too", async () => {
        mockConnectionStore.getConnectionAccessToken.mockResolvedValue("stale");
        mockConnectionStore.refreshConnectionAccessToken.mockResolvedValue("also-dead");
        mockClientsByToken.set("stale", deadClient);
        mockClientsByToken.set("also-dead", deadClient);

        await expect(runNotionSync(41)).rejects.toBeInstanceOf(NotionAuthError);

        expect(mockConnectionStore.markConnectionRevoked).toHaveBeenCalledWith(
            41,
            "Notion access was revoked — reconnect required"
        );
        expect(mockSyncStore.releaseSyncLease).toHaveBeenCalledWith(41, {
            status: "error",
            error: "Notion access was revoked — reconnect required",
        });
    });

    it("flags pages that are no longer shared", async () => {
        mockConnectionStore.getConnectionAccessToken.mockResolvedValue("stored");
        mockClientsByToken.set("stored", workingClient(["p-1"]));
        mockSinkModule.listKnownSourceIds.mockResolvedValue(["p-1", "p-gone"]);

        await runNotionSync(41);

        expect(mockSinkModule.markMissingDocuments).toHaveBeenCalledWith(7n, 41, ["p-gone"]);
    });

    it("skips a revoked connection without claiming the lease", async () => {
        mockConnectionStore.getConnectionById.mockResolvedValue({
            ...CONNECTION,
            status: "revoked",
        });

        const result = await runNotionSync(41);

        expect(result).toEqual({ outcome: "skipped", reason: "connection is revoked — reconnect" });
        expect(mockSyncStore.claimSyncLease).not.toHaveBeenCalled();
    });
});
