jest.mock("~/server/db", () => ({
    db: jest.requireActual("../../helpers/fake-db").fakeDb.db,
}));
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspacePermission: jest.fn(),
    requireWorkspaceContext: jest.fn(),
}));

import {
    requireWorkspaceContext,
    requireWorkspacePermission,
} from "~/lib/require-workspace-context";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import {
    DELETE as REMOVE_MEMBERS,
    POST as ADD_MEMBERS,
} from "~/app/api/workspace/groups/[id]/members/route";
import { DELETE, PATCH } from "~/app/api/workspace/groups/[id]/route";
import { GET, POST } from "~/app/api/workspace/groups/route";
import {
    documentGrants,
    folderGrants,
    userCompanyMemberships,
    workspaceActivity,
    workspaceAuditEvents,
    workspaceGroupMembers,
    workspaceGroups,
    workspaceSessionGrants,
} from "~/server/db/schema";

import { fakeDb } from "../../helpers/fake-db";
import { makeWorkspaceContext } from "../../helpers/workspace-context";
import { gateFor, jsonRequest, params } from "./_setup";

const gate = requireWorkspacePermission as jest.Mock;
const context = requireWorkspaceContext as jest.Mock;

/** Created by "user-c" — neither the admin nor the member below. */
const LEGAL = { id: 2, name: "Legal", slug: "legal", description: null, createdBy: "user-c" };

const ADMIN = makeWorkspaceContext({ role: "admin", authUserId: "user-a" });
const MEMBER = makeWorkspaceContext({ role: "member", authUserId: "user-m", userPk: 9n });
const GUEST = makeWorkspaceContext({ role: "guest", authUserId: "user-g", userPk: 11n });

function as(ctx: WorkspaceContext) {
    gate.mockImplementation(gateFor(ctx));
    context.mockImplementation(async () => ({ success: true, data: ctx }));
}

beforeEach(() => {
    fakeDb.reset();
    jest.clearAllMocks();
    as(ADMIN);
});

describe("DELETE /api/workspace/groups/[id]", () => {
    it("removes the group's folder, document and chat grants and reports how many", async () => {
        fakeDb.onSelect(workspaceGroups, [LEGAL]);
        fakeDb.onReturning(folderGrants, [{ id: 1 }, { id: 2 }]);
        fakeDb.onReturning(documentGrants, [{ id: 3 }]);
        fakeDb.onReturning(workspaceSessionGrants, [{ id: 4 }]);

        const res = await DELETE(
            jsonRequest("/api/workspace/groups/2", "DELETE"),
            params({ id: "2" })
        );

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({ success: true, removedGrants: 4 });
        expect(fakeDb.deletesOf(folderGrants)).toBe(1);
        expect(fakeDb.deletesOf(documentGrants)).toBe(1);
        expect(fakeDb.deletesOf(workspaceSessionGrants)).toBe(1);
        expect(fakeDb.deletesOf(workspaceGroups)).toBe(1);
        expect(fakeDb.insertedInto(workspaceAuditEvents)).toEqual([
            expect.objectContaining({
                action: "group.deleted",
                detail: { name: "Legal", removedGrants: 4 },
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

describe("GET /api/workspace/groups", () => {
    it("tells the caller which groups they manage", async () => {
        as(MEMBER);
        fakeDb.onSelect(workspaceGroups, [
            LEGAL,
            { id: 3, name: "Sales", slug: "sales", description: null, createdBy: "user-m" },
        ]);

        const res = await GET(new Request("http://localhost/api/workspace/groups"));

        expect(res.status).toBe(200);
        const body = (await res.json()) as { groups: { id: number; canManage: boolean }[] };
        expect(body.groups.map(g => [g.id, g.canManage])).toEqual([
            [2, false],
            [3, true],
        ]);
    });
});

describe("POST /api/workspace/groups", () => {
    it("creates a group with a slug unique in the workspace", async () => {
        fakeDb.onSelect(
            workspaceGroups,
            [{ slug: "legal" }],
            [{ ...LEGAL, id: 1000, slug: "legal-2", createdBy: "user-a" }]
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
                createdBy: "user-a",
                canManage: true,
            },
        });
    });

    it("lets a plain Member create a group, which they then manage", async () => {
        as(MEMBER);
        fakeDb.onSelect(
            workspaceGroups,
            [],
            [{ id: 1000, name: "Design", slug: "design", description: null, createdBy: "user-m" }]
        );

        const res = await POST(jsonRequest("/api/workspace/groups", "POST", { name: "Design" }));

        expect(res.status).toBe(201);
        expect(fakeDb.insertedInto(workspaceGroups)[0]).toMatchObject({
            name: "Design",
            createdBy: "user-m",
        });
        const body = (await res.json()) as { group: { canManage: boolean } };
        expect(body.group.canManage).toBe(true);
    });

    it("records created_group in the team feed", async () => {
        as(MEMBER);
        fakeDb.onSelect(
            workspaceGroups,
            [],
            [{ id: 1000, name: "Design", slug: "design", description: null, createdBy: "user-m" }]
        );

        await POST(jsonRequest("/api/workspace/groups", "POST", { name: "Design" }));

        expect(fakeDb.insertedInto(workspaceActivity)).toEqual([
            expect.objectContaining({
                actorUserId: "user-m",
                verb: "created_group",
                targetType: "group",
                targetId: "1000",
                targetLabel: "Design",
            }),
        ]);
        expect(fakeDb.insertedInto(workspaceAuditEvents)).toEqual([
            expect.objectContaining({ action: "group.created" }),
        ]);
    });

    it("refuses a Guest", async () => {
        as(GUEST);
        const res = await POST(jsonRequest("/api/workspace/groups", "POST", { name: "Legal" }));
        expect(res.status).toBe(403);
        expect(fakeDb.inserts).toHaveLength(0);
    });
});

describe("changing a group: creator or groups.manage", () => {
    const MINE = { ...LEGAL, createdBy: "user-m" };

    it("lets the creator rename their group", async () => {
        as(MEMBER);
        fakeDb.onSelect(workspaceGroups, [MINE], [{ ...MINE, name: "Legal team" }]);

        const res = await PATCH(
            jsonRequest("/api/workspace/groups/2", "PATCH", { name: "Legal team" }),
            params({ id: "2" })
        );

        expect(res.status).toBe(200);
        expect(fakeDb.updatesOf(workspaceGroups)).toEqual([{ name: "Legal team" }]);
    });

    it("lets the creator add and remove people", async () => {
        as(MEMBER);
        fakeDb.onSelect(workspaceGroups, [MINE]);
        fakeDb.onSelect(userCompanyMemberships, [{ userId: 8n }]);
        fakeDb.onSelect(workspaceGroupMembers, [], []);

        const added = await ADD_MEMBERS(
            jsonRequest("/api/workspace/groups/2/members", "POST", { userIds: [8] }),
            params({ id: "2" })
        );
        expect(added.status).toBe(200);
        expect(fakeDb.insertedInto(workspaceGroupMembers)).toEqual([
            expect.objectContaining({ groupId: 2n, userId: 8n, addedBy: "user-m" }),
        ]);

        fakeDb.onReturning(workspaceGroupMembers, [{ userId: 8n }]);
        const removed = await REMOVE_MEMBERS(
            jsonRequest("/api/workspace/groups/2/members", "DELETE", { userIds: [8] }),
            params({ id: "2" })
        );
        expect(removed.status).toBe(200);
        expect(fakeDb.deletesOf(workspaceGroupMembers)).toBe(1);
    });

    it("lets the creator delete their group", async () => {
        as(MEMBER);
        fakeDb.onSelect(workspaceGroups, [MINE]);
        const res = await DELETE(
            jsonRequest("/api/workspace/groups/2", "DELETE"),
            params({ id: "2" })
        );
        expect(res.status).toBe(200);
        expect(fakeDb.deletesOf(workspaceGroups)).toBe(1);
    });

    it("answers 403 to a member who did not create it, and changes nothing", async () => {
        as(MEMBER);
        fakeDb.onSelect(workspaceGroups, [LEGAL]);
        fakeDb.onSelect(userCompanyMemberships, [{ userId: 8n }]);

        const responses = [
            await PATCH(
                jsonRequest("/api/workspace/groups/2", "PATCH", { name: "Mine now" }),
                params({ id: "2" })
            ),
            await DELETE(jsonRequest("/api/workspace/groups/2", "DELETE"), params({ id: "2" })),
            await ADD_MEMBERS(
                jsonRequest("/api/workspace/groups/2/members", "POST", { userIds: [9] }),
                params({ id: "2" })
            ),
            await REMOVE_MEMBERS(
                jsonRequest("/api/workspace/groups/2/members", "DELETE", { userIds: [8] }),
                params({ id: "2" })
            ),
        ];

        expect(responses.map(r => r.status)).toEqual([403, 403, 403, 403]);
        expect(fakeDb.inserts).toHaveLength(0);
        expect(fakeDb.updates).toHaveLength(0);
        expect(fakeDb.deletes).toHaveLength(0);
    });

    it("lets a groups.manage holder change anyone's group", async () => {
        as(ADMIN);
        fakeDb.onSelect(workspaceGroups, [LEGAL], [{ ...LEGAL, name: "Counsel" }]);

        const res = await PATCH(
            jsonRequest("/api/workspace/groups/2", "PATCH", { name: "Counsel" }),
            params({ id: "2" })
        );

        expect(res.status).toBe(200);
        const body = (await res.json()) as { group: { name: string; canManage: boolean } };
        expect(body.group).toMatchObject({ name: "Counsel", canManage: true });
    });

    it("stops a creator who has since become a Guest", async () => {
        as(makeWorkspaceContext({ role: "guest", authUserId: "user-m", userPk: 9n }));
        fakeDb.onSelect(workspaceGroups, [MINE]);
        const res = await DELETE(
            jsonRequest("/api/workspace/groups/2", "DELETE"),
            params({ id: "2" })
        );
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
