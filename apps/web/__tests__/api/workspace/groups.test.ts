jest.mock("~/server/db", () => ({
    db: jest.requireActual("../../helpers/fake-db").fakeDb.db,
}));
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspacePermission: jest.fn(),
}));

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { POST as ADD_MEMBERS } from "~/app/api/workspace/groups/[id]/members/route";
import { DELETE } from "~/app/api/workspace/groups/[id]/route";
import { POST } from "~/app/api/workspace/groups/route";
import {
    documentGrants,
    folderGrants,
    userCompanyMemberships,
    workspaceAuditEvents,
    workspaceGroupMembers,
    workspaceGroups,
} from "~/server/db/schema";

import { fakeDb } from "../../helpers/fake-db";
import { makeWorkspaceContext } from "../../helpers/workspace-context";
import { gateFor, jsonRequest, params } from "./_setup";

const gate = requireWorkspacePermission as jest.Mock;
const LEGAL = { id: 2, name: "Legal", slug: "legal", description: null };

beforeEach(() => {
    fakeDb.reset();
    jest.clearAllMocks();
    gate.mockImplementation(gateFor(makeWorkspaceContext({ role: "admin" })));
});

describe("DELETE /api/workspace/groups/[id]", () => {
    it("removes the group's folder and document grants and reports how many", async () => {
        fakeDb.onSelect(workspaceGroups, [LEGAL]);
        fakeDb.onReturning(folderGrants, [{ id: 1 }, { id: 2 }]);
        fakeDb.onReturning(documentGrants, [{ id: 3 }]);

        const res = await DELETE(
            jsonRequest("/api/workspace/groups/2", "DELETE"),
            params({ id: "2" })
        );

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({ success: true, removedGrants: 3 });
        expect(fakeDb.deletesOf(folderGrants)).toBe(1);
        expect(fakeDb.deletesOf(documentGrants)).toBe(1);
        expect(fakeDb.deletesOf(workspaceGroups)).toBe(1);
        expect(fakeDb.insertedInto(workspaceAuditEvents)).toEqual([
            expect.objectContaining({
                action: "group.deleted",
                detail: { name: "Legal", removedGrants: 3 },
            }),
        ]);
    });

    it("answers 404 for another workspace's group", async () => {
        const res = await DELETE(
            jsonRequest("/api/workspace/groups/2", "DELETE"),
            params({ id: "2" })
        );
        expect(res.status).toBe(404);
    });
});

describe("POST /api/workspace/groups", () => {
    it("creates a group with a slug unique in the workspace", async () => {
        fakeDb.onSelect(
            workspaceGroups,
            [{ slug: "legal" }],
            [{ ...LEGAL, id: 1000, slug: "legal-2" }]
        );

        const res = await POST(jsonRequest("/api/workspace/groups", "POST", { name: "Legal" }));

        expect(res.status).toBe(201);
        expect(fakeDb.insertedInto(workspaceGroups)[0]).toMatchObject({
            name: "Legal",
            slug: "legal-2",
        });
        await expect(res.json()).resolves.toEqual({
            group: {
                id: 1000,
                name: "Legal",
                slug: "legal-2",
                description: null,
                memberCount: 0,
                members: [],
            },
        });
    });

    it("requires groups.manage", async () => {
        gate.mockImplementation(gateFor(makeWorkspaceContext({ role: "member" })));
        const res = await POST(jsonRequest("/api/workspace/groups", "POST", { name: "Legal" }));
        expect(res.status).toBe(403);
    });
});

describe("POST /api/workspace/groups/[id]/members", () => {
    it("adds only active members, skipping ones already in the group", async () => {
        fakeDb.onSelect(workspaceGroups, [LEGAL]);
        fakeDb.onSelect(userCompanyMemberships, [{ userId: 8n }, { userId: 9n }]);
        fakeDb.onSelect(workspaceGroupMembers, [{ userId: 9n }], []);

        const res = await ADD_MEMBERS(
            jsonRequest("/api/workspace/groups/2/members", "POST", { userIds: [8, 9, 9] }),
            params({ id: "2" })
        );

        expect(res.status).toBe(200);
        expect(fakeDb.insertedInto(workspaceGroupMembers)).toEqual([
            expect.objectContaining({ groupId: 2n, userId: 8n }),
        ]);
        expect(fakeDb.insertedInto(workspaceAuditEvents)).toEqual([
            expect.objectContaining({ action: "group.member_added", detail: { userId: 8 } }),
        ]);
    });

    it("rejects a user who is not an active member", async () => {
        fakeDb.onSelect(workspaceGroups, [LEGAL]);
        fakeDb.onSelect(userCompanyMemberships, []);

        const res = await ADD_MEMBERS(
            jsonRequest("/api/workspace/groups/2/members", "POST", { userIds: [8] }),
            params({ id: "2" })
        );

        expect(res.status).toBe(400);
        expect(fakeDb.inserts).toHaveLength(0);
    });
});
