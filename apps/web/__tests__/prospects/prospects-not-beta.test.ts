/**
 * Prospects is for every workspace: `/api/prospects/*` answers whether or
 * not the workspace has its beta apps on (Workspace › Labs), and never asks
 * the switch; History keeps its runs either way. Brand, the rest of Growth, still refuses with the switch off
 * (pinned in `__tests__/brand/brand-routes.test.ts`).
 */

jest.mock("@launchstack/pipelines/distribution/db", () => ({}));

const mockRequireWorkspaceContext = jest.fn();
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspaceContext: () => mockRequireWorkspaceContext(),
}));

const mockReadWorkspaceSetting = jest.fn(async () => false);
jest.mock("~/server/settings/store", () => ({
    readWorkspaceSetting: (...args: unknown[]) => mockReadWorkspaceSetting(...(args as [])),
}));

import { prospectsContext } from "~/app/api/prospects/_http";
import { PIPELINE_LOADERS } from "~/server/history/loaders";

beforeEach(() => {
    mockRequireWorkspaceContext.mockReset();
    mockReadWorkspaceSetting.mockClear();
});

describe("prospectsContext", () => {
    it("lets a member in while the workspace has beta apps off", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: true,
            data: { companyId: 7n, authUserId: "user-1", userPk: 3 },
        });
        const result = await prospectsContext();
        expect(result).toEqual({
            ok: true,
            ctx: { companyId: 7n, userId: "user-1", userPk: 3 },
        });
        expect(mockReadWorkspaceSetting).not.toHaveBeenCalled();
    });

    it("still answers for who is asking", async () => {
        const response = new Response(null, { status: 401 });
        mockRequireWorkspaceContext.mockResolvedValue({ success: false, response });
        const result = await prospectsContext();
        expect(result).toEqual({ ok: false, response });
    });
});

describe("History", () => {
    it("keeps Prospects' runs whatever the switch; only Vantage's rows go with it", () => {
        expect(PIPELINE_LOADERS.filter(loader => loader.beta).map(loader => loader.kind)).toEqual([
            "vantage",
        ]);
        expect(PIPELINE_LOADERS.some(loader => loader.kind === "distribution")).toBe(true);
    });
});
