/**
 * DELETE /api/vantage/topics/:id/decide is the Undo after a one-click
 * Commit: the topic goes back to undecided and the commitment it opened is
 * removed. It must act only inside the caller's workspace, take the topic
 * from the path and the commitment from `?commitment=`, and map the
 * pipeline's errors to their own status.
 */

import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";
import type * as NextServer from "next/server";

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

const mockUndoDecision = jest.fn();
const mockRecordDecision = jest.fn();

// The real pipeline module pulls in the database. The route needs the two
// calls and the error class; the request schemas it imports need the enums.
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
    VANTAGE_EVIDENCE_KINDS: ["note", "interview", "link", "task", "claim", "document"],
    VANTAGE_VISIBILITIES: ["private", "shared"],
    VANTAGE_COMMITMENT_STATUSES: ["open", "done", "missed", "dropped"],
    isIsoDate: (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value),
    undoDecision: (...args: unknown[]) => mockUndoDecision(...args),
    recordDecision: (...args: unknown[]) => mockRecordDecision(...args),
}));

import { NextRequest } from "next/server";

import { VantageError } from "@launchstack/pipelines/vantage";

import { DELETE } from "~/app/api/vantage/topics/[id]/decide/route";

const undone = {
    id: "t1",
    agendaId: "a1",
    title: "SSO for design partners",
    decision: null,
    decidedAt: null,
    commitmentId: null,
};

function signIn() {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ role: "member", authUserId: "user-1", companyId: BigInt(42) }),
    });
}

function undo(topicId: string, query = "") {
    return DELETE(
        new NextRequest(`http://localhost/api/vantage/topics/${topicId}/decide${query}`, {
            method: "DELETE",
        }),
        { params: Promise.resolve({ id: topicId }) }
    );
}

beforeEach(() => {
    jest.clearAllMocks();
    signIn();
    mockUndoDecision.mockResolvedValue(undone);
});

describe("DELETE /api/vantage/topics/:id/decide", () => {
    it("undoes the decision in the caller's workspace and removes the named commitment", async () => {
        const response = await undo("t1", "?commitment=c9");

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ topic: undone });
        expect(mockUndoDecision).toHaveBeenCalledTimes(1);
        expect(mockUndoDecision).toHaveBeenCalledWith({
            companyId: BigInt(42),
            topicId: "t1",
            commitmentId: "c9",
        });
        expect(mockRecordDecision).not.toHaveBeenCalled();
    });

    it("passes no commitment when the query has none", async () => {
        const response = await undo("t2");

        expect(response.status).toBe(200);
        expect(mockUndoDecision).toHaveBeenCalledWith({
            companyId: BigInt(42),
            topicId: "t2",
            commitmentId: null,
        });
    });

    it("maps a VantageError to its own status", async () => {
        mockUndoDecision.mockRejectedValue(
            new VantageError("That topic is not here.", 404, "not_found")
        );

        const response = await undo("missing", "?commitment=c9");

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({
            error: "That topic is not here.",
            code: "not_found",
        });
    });

    it("answers anything else with a 500 and no details", async () => {
        const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
        mockUndoDecision.mockRejectedValue(new Error("connection reset"));

        const response = await undo("t1");

        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: "Internal server error" });
        log.mockRestore();
    });

    it("passes an auth failure through untouched, without touching the topic", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: false,
            response: jest
                .requireActual<typeof NextServer>("next/server")
                .NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        });

        const response = await undo("t1", "?commitment=c9");

        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: "Unauthorized" });
        expect(mockUndoDecision).not.toHaveBeenCalled();
    });
});
