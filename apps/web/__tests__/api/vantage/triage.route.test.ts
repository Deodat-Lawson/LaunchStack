/**
 * Week 1 disables the program view even for founders, before any shared
 * evidence can be collected. Non-owner workspace roles cannot use Vantage.
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

import { GET } from "~/app/api/vantage/triage/route";
import { VANTAGE_FOUNDER_ONLY, VANTAGE_SHARING_DISABLED } from "~/server/vantage/access";

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
    process.env.VANTAGE_TEST_MODE = "false";
    mockLoadTriage.mockResolvedValue(triage);
});

describe("GET /api/vantage/triage", () => {
    it.each(["admin", "member", "viewer", "guest"])(
        "returns 403 to a %s without reading",
        async role => {
            signInAs(role);

            const response = await GET();

            expect(response.status).toBe(403);
            expect(await response.json()).toEqual({
                error: VANTAGE_FOUNDER_ONLY,
                code: "pilot_access_denied",
            });
            expect(mockLoadTriage).not.toHaveBeenCalled();
        }
    );

    it("keeps program sharing disabled for the owner", async () => {
        process.env.VANTAGE_TEST_MODE = "true";
        process.env.VANTAGE_TEST_COMPANY_ID = "42";
        process.env.VANTAGE_TEST_USER_IDS = "user-1";
        process.env.DATABASE_URL = "postgres://test:test@localhost:55434/vantage_test";
        process.env.VANTAGE_TEST_DATABASE_URL = process.env.DATABASE_URL;
        signInAs("owner");

        const response = await GET();

        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({
            error: VANTAGE_SHARING_DISABLED,
            code: "sharing_disabled",
        });
        expect(mockLoadTriage).not.toHaveBeenCalled();
    });

    it("does not treat program permissions as founder ownership", async () => {
        signInAs("program-lead", ["settings.manage"]);

        const response = await GET();

        expect(response.status).toBe(403);
        expect(mockLoadTriage).not.toHaveBeenCalled();
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
});

const savedEnvironment = { ...process.env };
afterEach(() => {
    process.env = { ...savedEnvironment };
});
