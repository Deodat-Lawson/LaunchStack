/**
 * GET /api/vantage/triage is the program's side of the table: the UI only
 * shows it to `settings.manage`, and the route has to refuse everyone else
 * before it reads anything — hiding the rail entry is not the gate.
 */

import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";
import type * as NextServer from "next/server";

import type { Permission } from "~/lib/authz/permissions";
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

const mockLoadTriage = jest.fn();
jest.mock("~/server/vantage/service", () => ({
    loadTriage: (...args: unknown[]) => mockLoadTriage(...args),
}));

// The real pipeline module pulls in the database; the route only needs the
// error class for its status mapping.
jest.mock("@launchstack/pipelines/vantage", () => ({
    VantageError: class VantageError extends Error {
        readonly status: number;
        readonly code: string;
        constructor(message: string, status: number, code: string) {
            super(message);
            this.status = status;
            this.code = code;
        }
    },
}));

import { VantageError } from "@launchstack/pipelines/vantage";

import { GET } from "~/app/api/vantage/triage/route";

const triage = {
    today: "2026-10-03",
    helpRequests: [],
    missedCommitments: [],
    dueSoon: [],
    deadlines: [{ id: "d1", title: "Demo day", dueOn: "2026-10-20", note: null }],
    lastEntryAt: null,
    daysSinceLastEntry: null,
    quiet: true,
};

function signInAs(role: string, permissions?: Permission[]) {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({
            role,
            authUserId: "user-1",
            companyId: BigInt(42),
            ...(permissions ? { permissions } : {}),
        }),
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    mockLoadTriage.mockResolvedValue(triage);
});

describe("GET /api/vantage/triage", () => {
    it.each(["member", "viewer"])("returns 403 to a %s without reading", async role => {
        signInAs(role);
        expect(makeWorkspaceContext({ role }).can("settings.manage")).toBe(false);

        const response = await GET();

        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({
            error: "Only a workspace admin can see program triage.",
            permission: "settings.manage",
        });
        expect(mockLoadTriage).not.toHaveBeenCalled();
    });

    it.each(["admin", "owner"])("returns the workspace's triage to an %s", async role => {
        signInAs(role);

        const response = await GET();

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(triage);
        expect(mockLoadTriage).toHaveBeenCalledWith({ companyId: BigInt(42) });
    });

    it("gates on the permission, not the role name", async () => {
        signInAs("program-lead", ["settings.manage"]);

        const response = await GET();

        expect(response.status).toBe(200);
        expect(mockLoadTriage).toHaveBeenCalledTimes(1);
    });

    it("passes an auth failure through untouched", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: false,
            response: jest
                .requireActual<typeof NextServer>("next/server")
                .NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        });

        const response = await GET();

        expect(response.status).toBe(401);
        expect(mockLoadTriage).not.toHaveBeenCalled();
    });

    it("maps a VantageError from the read to its own status", async () => {
        signInAs("admin");
        mockLoadTriage.mockRejectedValue(new VantageError("Gone", 404, "not_found"));

        const response = await GET();

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: "Gone", code: "not_found" });
    });
});
