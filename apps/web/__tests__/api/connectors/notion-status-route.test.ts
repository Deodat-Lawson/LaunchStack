/**
 * GET /api/connectors/notion/status is readable by any member, for their own
 * Notion connections only (loadNotionStatus filters by owner): a Notion
 * connection is per-user, and someone who lost upload access must still see
 * theirs to disconnect it. Google Drive's status stays with connector admins.
 */

import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";

import type { WorkspaceContextResult } from "~/lib/require-workspace-context";

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
jest.mock("~/server/services/connectors/notion/status", () => ({ loadNotionStatus: jest.fn() }));
jest.mock("~/server/services/connectors/connection-store", () => ({
    listConnectionsForCompany: jest.fn(async () => []),
}));
jest.mock("~/server/services/connectors/google-drive/store", () => ({
    getSyncState: jest.fn(),
    listPickedItems: jest.fn(),
}));
jest.mock("~/server/services/connectors/config", () => ({
    getPickerPublicConfig: () => null,
    isConnectorConfigured: () => true,
}));
jest.mock("~/server/services/google-drive/config", () => ({
    grantsFolderAccess: () => false,
    isDriveFolderAccessEnabled: () => false,
}));
jest.mock("~/server/db", () => ({ db: {} }));

import { GET } from "~/app/api/connectors/[provider]/status/route";
import { loadNotionStatus } from "~/server/services/connectors/notion/status";

function signInAs(role: string) {
    const ctx = makeWorkspaceContext({ role, userPk: BigInt(37), companyId: BigInt(5) });
    mockRequireWorkspaceContext.mockResolvedValue({ success: true, data: ctx });
    return ctx;
}

function status(provider: string) {
    return GET(new Request(`http://localhost/api/connectors/${provider}/status`), {
        params: Promise.resolve({ provider }),
    });
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe("GET /api/connectors/[provider]/status", () => {
    it("shows a viewer their own Notion connections, saying they cannot connect", async () => {
        const ctx = signInAs("viewer");
        const body = { configured: true, canConnect: false, connections: [] };
        jest.mocked(loadNotionStatus).mockResolvedValue(body);

        const response = await status("notion");

        expect(response.status).toBe(200);
        expect(loadNotionStatus).toHaveBeenCalledWith(ctx);
        expect(((await response.json()) as { data: unknown }).data).toEqual(body);
    });

    it("keeps Google Drive's status for connector admins", async () => {
        signInAs("member");

        const response = await status("google-drive");

        expect(response.status).toBe(403);
        expect(loadNotionStatus).not.toHaveBeenCalled();
    });
});
