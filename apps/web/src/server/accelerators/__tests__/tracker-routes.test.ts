import type {
    CatalogueProgram,
    TrackerOpportunity,
    TrackerTask,
} from "@launchstack/pipelines/accelerators";

import type * as MockRequireWorkspaceContext from "../../../../__tests__/helpers/mock-require-workspace-context";
import { makeWorkspaceContext } from "../../../../__tests__/helpers/workspace-context";

import type { WorkspaceContextResult } from "~/lib/require-workspace-context";
import { AcceleratorAccessError, resolveAcceleratorMember } from "~/server/accelerators/access";

const mockRequireWorkspaceContext = jest.fn<Promise<WorkspaceContextResult>, []>();
jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../../../__tests__/helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);
jest.mock("~/server/accelerators/access", () => ({
    ...jest.requireActual("~/server/accelerators/access"),
    resolveAcceleratorMember: jest.fn(async () => undefined),
}));
const mockCatalogueProgram = jest.fn();
jest.mock("@launchstack/pipelines/accelerators/db", () => ({
    getCatalogueProgram: (...args: unknown[]) => mockCatalogueProgram(...args),
}));
const mockList = jest.fn();
const mockGet = jest.fn();
const mockSave = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockCreateTask = jest.fn();
const mockUpdateTask = jest.fn();
const mockDeleteTask = jest.fn();
jest.mock("@launchstack/pipelines/accelerators/tracker-db", () => ({
    listTrackerOpportunities: (...args: unknown[]) => mockList(...args),
    getTrackerOpportunity: (...args: unknown[]) => mockGet(...args),
    saveTrackerOpportunity: (...args: unknown[]) => mockSave(...args),
    updateTrackerOpportunity: (...args: unknown[]) => mockUpdate(...args),
    deleteTrackerOpportunity: (...args: unknown[]) => mockDelete(...args),
    createTrackerTask: (...args: unknown[]) => mockCreateTask(...args),
    updateTrackerTask: (...args: unknown[]) => mockUpdateTask(...args),
    deleteTrackerTask: (...args: unknown[]) => mockDeleteTask(...args),
}));

import { NextRequest, NextResponse } from "next/server";

import { GET as list, POST as save } from "~/app/api/accelerators/tracker/route";
import {
    DELETE as remove,
    GET as detail,
    PATCH as edit,
} from "~/app/api/accelerators/tracker/[id]/route";
import { POST as addTask } from "~/app/api/accelerators/tracker/[id]/tasks/route";
import {
    DELETE as removeTask,
    PATCH as editTask,
} from "~/app/api/accelerators/tracker/[id]/tasks/[taskId]/route";
import { saveOpportunity } from "~/server/accelerators/tracker";

const id = "88888888-8888-4888-8888-888888888888";
const taskId = "99999999-9999-4999-8999-999999999999";
const deadline = "2027-01-15T18:00:00Z";
const opportunity: TrackerOpportunity = {
    id,
    programId: "program",
    cycleId: null,
    priority: "medium",
    status: "shortlisted",
    notes: "Private notes",
    submittedOn: null,
    nextAction: null,
    plannedDeadline: null,
    plannedDeadlineOn: null,
    createdAt: "2026-11-07T00:00:00.000Z",
    updatedAt: "2026-11-07T00:00:00.000Z",
    tasks: [],
};
const task: TrackerTask = {
    id: taskId,
    opportunityId: id,
    title: "Collect deck",
    dueOn: null,
    priority: "high",
    done: false,
    completedAt: null,
    createdAt: opportunity.createdAt,
    updatedAt: opportunity.updatedAt,
};
const params = { params: Promise.resolve({ id }) };
const taskParams = { params: Promise.resolve({ id, taskId }) };
function request(method: string, body?: unknown) {
    return new NextRequest("http://x/api/accelerators/tracker", {
        method,
        ...(body === undefined
            ? {}
            : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    });
}
const mockRecheck = jest.mocked(resolveAcceleratorMember);

beforeEach(() => {
    jest.clearAllMocks();
    const member = makeWorkspaceContext({ companyId: 9n, authUserId: "u1" });
    mockRequireWorkspaceContext.mockResolvedValue({ success: true, data: member });
    mockRecheck.mockResolvedValue(member);
    mockCatalogueProgram.mockResolvedValue({
        program: {
            id: "program",
            cycles: [
                { id: "spring", deadlineAt: deadline },
                { id: "fall", deadlineAt: null, dateOnly: "2027-03-01" },
            ],
        } as CatalogueProgram,
        contentHash: "hash",
    });
    mockList.mockResolvedValue([opportunity]);
    mockGet.mockImplementation(async (company: bigint) => (company === 9n ? opportunity : null));
    mockSave.mockResolvedValue(opportunity);
    mockUpdate.mockResolvedValue(opportunity);
    mockDelete.mockResolvedValue(undefined);
    mockCreateTask.mockResolvedValue(task);
    mockUpdateTask.mockResolvedValue(task);
    mockDeleteTask.mockResolvedValue(undefined);
});

describe("tracker routes and service", () => {
    it("reads company-private opportunities and tasks without changing status or starting matching", async () => {
        const response = await list(request("GET"));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ opportunities: [opportunity] });
        expect(mockList).toHaveBeenCalledWith(9n);
        expect((await detail(request("GET"), params)).status).toBe(200);
        expect(mockSave).not.toHaveBeenCalled();
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("saves only the session company and snapshots the selected catalogue cycle deadline", async () => {
        const response = await save(request("POST", { programId: "program", cycleId: "spring" }));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ opportunity });
        expect(mockSave).toHaveBeenCalledWith(
            9n,
            { programId: "program", cycleId: "spring" },
            { at: deadline, on: null }
        );
        expect(mockRecheck).toHaveBeenCalledWith("u1", 9n, "documents.edit");
    });

    it("rejects cycles outside the Program before writing and rejects client company ids", async () => {
        expect(
            (await save(request("POST", { programId: "program", cycleId: "other-program-cycle" })))
                .status
        ).toBe(400);
        expect(
            (await save(request("POST", { programId: "program", companyId: "10" }))).status
        ).toBe(400);
        expect(mockSave).not.toHaveBeenCalled();
        expect((await edit(request("PATCH", { cycleId: "not-in-program" }), params)).status).toBe(
            400
        );
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("allows Program-only upgrade and prevents retargeting a historical cycle", async () => {
        expect((await edit(request("PATCH", { cycleId: "spring" }), params)).status).toBe(200);
        expect(mockUpdate).toHaveBeenCalledWith(
            9n,
            id,
            { cycleId: "spring" },
            { at: deadline, on: null }
        );
        mockUpdate.mockClear();
        mockGet.mockResolvedValue({ ...opportunity, cycleId: "spring", status: "rejected" });
        expect((await edit(request("PATCH", { cycleId: "fall" }), params)).status).toBe(409);
        expect(mockUpdate).not.toHaveBeenCalled();
        // Saving the later cycle uses a separate save operation, not a historical PATCH.
        expect(
            (await save(request("POST", { programId: "program", cycleId: "fall" }))).status
        ).toBe(200);
        // A date-only deadline is planned against as a date, never given an invented time.
        expect(mockSave).toHaveBeenCalledWith(
            9n,
            { programId: "program", cycleId: "fall" },
            { at: null, on: "2027-03-01" }
        );
    });

    it("leaves the planned deadline unchanged on normal edits, even if the catalogue changes", async () => {
        mockGet.mockResolvedValue({ ...opportunity, cycleId: "spring", plannedDeadline: deadline });
        const response = await edit(
            request("PATCH", { status: "applied", submittedOn: "2026-11-07", priority: "low" }),
            params
        );
        expect(response.status).toBe(200);
        expect(mockCatalogueProgram).not.toHaveBeenCalled();
        expect(mockUpdate).toHaveBeenCalledWith(
            9n,
            id,
            { status: "applied", submittedOn: "2026-11-07", priority: "low" },
            null
        );
    });

    it("uses the session company on all task mutations and deletion", async () => {
        expect(
            (await addTask(request("POST", { title: "Collect deck", priority: "high" }), params))
                .status
        ).toBe(200);
        expect(mockCreateTask).toHaveBeenCalledWith(9n, id, {
            title: "Collect deck",
            priority: "high",
        });
        expect((await editTask(request("PATCH", { done: true }), taskParams)).status).toBe(200);
        expect(mockUpdateTask).toHaveBeenCalledWith(9n, id, taskId, { done: true });
        expect((await removeTask(request("DELETE"), taskParams)).status).toBe(200);
        expect(mockDeleteTask).toHaveBeenCalledWith(9n, id, taskId);
        expect((await remove(request("DELETE"), params)).status).toBe(200);
        expect(mockDelete).toHaveBeenCalledWith(9n, id);
    });

    it("does not expose another company's opportunity or accept edits to it", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: true,
            data: makeWorkspaceContext({ companyId: 10n }),
        });
        expect((await detail(request("GET"), params)).status).toBe(404);
        expect(mockGet).toHaveBeenLastCalledWith(10n, id);
        expect((await edit(request("PATCH", { notes: "overwrite" }), params)).status).toBe(404);
        expect(mockUpdate).not.toHaveBeenCalled();
        mockList.mockResolvedValue([]);
        const response = await list(request("GET"));
        expect(await response.json()).toEqual({ opportunities: [] });
        expect(mockList).toHaveBeenCalledWith(10n);
    });

    it.each([
        { permissions: ["documents.read" as const] },
        {
            scope: {
                kind: "only" as const,
                allowedCategories: [],
                allowedDocumentIds: [1],
                deniedDocumentIds: [],
            },
        },
        { status: "suspended" as const },
    ])("denies every mutation before storage when access is insufficient (%o)", async overrides => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: true,
            data: makeWorkspaceContext({ companyId: 9n, ...overrides }),
        });
        const responses = await Promise.all([
            save(request("POST", { programId: "program" })),
            edit(request("PATCH", { notes: "edit" }), params),
            remove(request("DELETE"), params),
            addTask(request("POST", { title: "Task" }), params),
            editTask(request("PATCH", { done: true }), taskParams),
            removeTask(request("DELETE"), taskParams),
        ]);
        expect(responses.map(response => response.status)).toEqual([403, 403, 403, 403, 403, 403]);
        for (const mock of [
            mockGet,
            mockSave,
            mockUpdate,
            mockDelete,
            mockCreateTask,
            mockUpdateTask,
            mockDeleteTask,
        ])
            expect(mock).not.toHaveBeenCalled();
    });

    it("protects direct service calls too", async () => {
        await expect(
            saveOpportunity(makeWorkspaceContext({ permissions: ["documents.read"] }), {
                programId: "program",
            })
        ).rejects.toBeInstanceOf(AcceleratorAccessError);
        expect(mockSave).not.toHaveBeenCalled();
    });

    it("withholds reads after access revocation and preserves authentication errors", async () => {
        mockRecheck.mockRejectedValue(new AcceleratorAccessError());
        const response = await list(request("GET"));
        expect(response.status).toBe(403);
        expect(await response.json()).not.toHaveProperty("opportunities");
        mockRequireWorkspaceContext.mockResolvedValue({
            success: false,
            response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        });
        expect((await save(request("POST", { programId: "program" }))).status).toBe(401);
    });

    it("reports malformed JSON, invalid ids, and stored pending status as invalid input", async () => {
        expect(
            (
                await save(
                    new NextRequest("http://x/api/accelerators/tracker", {
                        method: "POST",
                        body: "{",
                    })
                )
            ).status
        ).toBe(400);
        expect(
            (await detail(request("GET"), { params: Promise.resolve({ id: "invalid" }) })).status
        ).toBe(400);
        expect((await edit(request("PATCH", { status: "pending" }), params)).status).toBe(400);
    });
});
