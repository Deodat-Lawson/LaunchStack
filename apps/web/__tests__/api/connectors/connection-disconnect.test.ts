/**
 * DELETE /api/connectors/connections/:id — who may remove a connection.
 *
 * A per-user connection (Notion) is its owner's to remove, whatever their
 * role. Anything else needs connectors.manage, which is also how an admin
 * offboards someone else's per-user connection. A member asking for another
 * member's per-user connection is told it does not exist. Every disconnect
 * revokes the grant and is audited.
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
jest.mock("~/server/services/connectors/connection-store", () => ({
    getConnectionById: jest.fn(),
    deleteConnection: jest.fn(),
}));
jest.mock("~/server/services/connectors/revoke", () => ({
    revokeConnectionTokens: jest.fn(async () => true),
}));
jest.mock("~/lib/authz/audit", () => ({ recordAuditEvent: jest.fn() }));
jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("~/server/public-origin", () => ({ publicOrigin: () => "https://app.test" }));

import { DELETE } from "~/app/api/connectors/connections/[connectionId]/route";
import { recordAuditEvent } from "~/lib/authz/audit";
import * as connectionStore from "~/server/services/connectors/connection-store";
import { revokeConnectionTokens } from "~/server/services/connectors/revoke";

const mockStore = jest.mocked(connectionStore);

const ADA = BigInt(3);
const BEN = BigInt(4);

function row(overrides: Partial<ConnectorConnection>): ConnectorConnection {
    return {
        id: 41,
        companyId: BigInt(5),
        provider: "notion",
        providerAccountId: "bot-1",
        providerAccountEmail: "Acme HQ",
        grantedByUserId: ADA,
        refreshTokenCiphertext: "sealed-refresh",
        encryptionKeyVersion: 1,
        scopes: "",
        status: "active",
        lastRefreshError: null,
        createdAt: new Date("2026-11-07T00:00:00.000Z"),
        updatedAt: null,
        accessTokenCiphertext: "sealed-access",
        accessTokenExpiresAt: null,
        ownerUserId: ADA,
        ...overrides,
    };
}

function signInAs(role: string, userPk: bigint) {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ role, userPk, companyId: BigInt(5) }),
    });
}

function disconnect(id = "41") {
    return DELETE(
        new Request(`http://localhost/api/connectors/connections/${id}`, { method: "DELETE" }),
        { params: Promise.resolve({ connectionId: id }) }
    );
}

beforeEach(() => {
    jest.clearAllMocks();
    mockStore.deleteConnection.mockResolvedValue({ accessToken: "a", refreshToken: "r" });
});

describe("DELETE /api/connectors/connections/:id", () => {
    it("lets a member remove their own Notion connection, revoked and audited", async () => {
        signInAs("member", ADA);
        mockStore.getConnectionById.mockResolvedValue(row({}));

        const response = await disconnect();

        expect(response.status).toBe(200);
        expect(mockStore.deleteConnection).toHaveBeenCalledWith(41);
        expect(revokeConnectionTokens).toHaveBeenCalledWith(
            "notion",
            { accessToken: "a", refreshToken: "r" },
            "https://app.test"
        );
        expect(recordAuditEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                action: "connector.disconnected",
                targetId: "notion",
                detail: expect.objectContaining({ connectionId: 41, offboarding: false }),
            })
        );
    });

    it("lets a viewer remove a Notion connection they made before losing upload access", async () => {
        signInAs("viewer", ADA);
        mockStore.getConnectionById.mockResolvedValue(row({}));

        expect((await disconnect()).status).toBe(200);
        expect(mockStore.deleteConnection).toHaveBeenCalledWith(41);
    });

    it("tells a member another member's Notion connection does not exist", async () => {
        signInAs("member", BEN);
        mockStore.getConnectionById.mockResolvedValue(row({}));

        const response = await disconnect();

        expect(response.status).toBe(404);
        expect(mockStore.deleteConnection).not.toHaveBeenCalled();
        expect(recordAuditEvent).not.toHaveBeenCalled();
    });

    it("lets an admin offboard someone else's Notion connection, and marks it so", async () => {
        signInAs("admin", BEN);
        mockStore.getConnectionById.mockResolvedValue(row({}));

        expect((await disconnect()).status).toBe(200);
        expect(mockStore.deleteConnection).toHaveBeenCalledWith(41);
        expect(recordAuditEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                detail: expect.objectContaining({ ownerUserId: "3", offboarding: true }),
            })
        );
    });

    it("keeps workspace connections behind connectors.manage", async () => {
        signInAs("member", ADA);
        mockStore.getConnectionById.mockResolvedValue(
            row({ provider: "slack", ownerUserId: null, providerAccountId: "T1" })
        );

        const response = await disconnect();

        expect(response.status).toBe(403);
        expect(mockStore.deleteConnection).not.toHaveBeenCalled();
    });

    it("never reaches another workspace's row", async () => {
        signInAs("admin", ADA);
        mockStore.getConnectionById.mockResolvedValue(row({ companyId: BigInt(99) }));

        expect((await disconnect()).status).toBe(404);
        expect(mockStore.deleteConnection).not.toHaveBeenCalled();
    });
});
