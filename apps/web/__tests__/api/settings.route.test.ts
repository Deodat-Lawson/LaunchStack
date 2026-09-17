/**
 * The settings API is auth plus a body parser over the store; what matters
 * is that the store's decisions come through with the right status.
 */

import type * as NextServer from "next/server";
import type * as MockRequireWorkspaceContext from "../helpers/mock-require-workspace-context";
import type * as WorkspaceContextHelper from "../helpers/workspace-context";
import { WorkspaceError } from "~/server/workspace/errors";

const mockCtx: { role: string | null } = { role: "owner" };

jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() =>
            mockCtx.role
                ? {
                      success: true,
                      data: jest
                          .requireActual<
                              typeof WorkspaceContextHelper
                          >("../helpers/workspace-context")
                          .makeWorkspaceContext({
                              authUserId: "u1",
                              companyId: 5n,
                              role: mockCtx.role,
                          }),
                  }
                : {
                      success: false,
                      response: jest
                          .requireActual<typeof NextServer>("next/server")
                          .NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
                  }
        )
);

const mockStore = {
    loadSettings: jest.fn(),
    writeSetting: jest.fn(),
};
jest.mock("~/server/settings/store", () => ({
    loadSettings: (...args: unknown[]) => mockStore.loadSettings(...args),
    writeSetting: (...args: unknown[]) => mockStore.writeSetting(...args),
}));

import { GET, PUT } from "~/app/api/settings/route";

beforeEach(() => {
    mockCtx.role = "owner";
    mockStore.loadSettings.mockReset();
    mockStore.writeSetting.mockReset();
});

describe("GET /api/settings", () => {
    it("passes the folder through and returns the payload", async () => {
        mockStore.loadSettings.mockResolvedValue({ settings: {}, viewer: {}, folder: "Legal" });
        const res = await GET(new Request("http://x/api/settings?folder=Legal"));
        expect(res.status).toBe(200);
        expect(mockStore.loadSettings).toHaveBeenCalledWith(
            expect.objectContaining({ authUserId: "u1" }),
            { folderPath: "Legal" }
        );
    });

    it("answers 401 without a session", async () => {
        mockCtx.role = null;
        const res = await GET(new Request("http://x/api/settings"));
        expect(res.status).toBe(401);
        expect(mockStore.loadSettings).not.toHaveBeenCalled();
    });
});

describe("PUT /api/settings", () => {
    const put = (body: unknown) =>
        PUT(
            new Request("http://x/api/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            })
        );

    it("rejects a body with neither a value nor a reset", async () => {
        const res = await put({ key: "appearance.theme", scope: "member" });
        expect(res.status).toBe(400);
        expect(mockStore.writeSetting).not.toHaveBeenCalled();
    });

    it("returns the store's resolved setting", async () => {
        mockStore.writeSetting.mockResolvedValue({ key: "appearance.theme", value: "dark" });
        const res = await put({ key: "appearance.theme", scope: "member", value: "dark" });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ setting: { key: "appearance.theme", value: "dark" } });
    });

    it("maps a store refusal to its status and sentence", async () => {
        mockStore.writeSetting.mockRejectedValue(
            new WorkspaceError(403, "Changing “Theme” needs settings.manage", {
                permission: "settings.manage",
            })
        );
        const res = await put({ key: "x", scope: "workspace", value: 1 });
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({
            error: "Changing “Theme” needs settings.manage",
            permission: "settings.manage",
        });
    });
});
