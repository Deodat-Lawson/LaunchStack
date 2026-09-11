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
import { PATCH, DELETE } from "~/app/api/workspace/members/[id]/route";
import { POST as LEAVE } from "~/app/api/workspace/members/leave/route";
import { GET } from "~/app/api/workspace/members/route";
import {
    documentGrants,
    folderGrants,
    userCompanyMemberships,
    workspaceAuditEvents,
} from "~/server/db/schema";

import { fakeDb } from "../../helpers/fake-db";
import { makeWorkspaceContext } from "../../helpers/workspace-context";
import { gateFor, jsonRequest, memberRow, params } from "./_setup";

const gate = requireWorkspacePermission as jest.Mock;
const context = requireWorkspaceContext as jest.Mock;

function auditActions(): string[] {
    return fakeDb.insertedInto(workspaceAuditEvents).map(row => String(row.action));
}

beforeEach(() => {
    fakeDb.reset();
    jest.clearAllMocks();
});

describe("PATCH /api/workspace/members/[id]", () => {
    it("refuses to change the caller's own membership", async () => {
        const ctx = makeWorkspaceContext({ role: "owner", userPk: 7n });
        gate.mockImplementation(gateFor(ctx));

        const res = await PATCH(
            jsonRequest("/api/workspace/members/7", "PATCH", { role: "member" }),
            params({ id: "7" })
        );

        expect(res.status).toBe(403);
        expect(fakeDb.updates).toHaveLength(0);
    });

    it("refuses an admin acting on an owner; only an owner acts on an owner", async () => {
        const ctx = makeWorkspaceContext({ role: "admin", userPk: 7n });
        gate.mockImplementation(gateFor(ctx));
        fakeDb.onSelect(userCompanyMemberships, [memberRow({ role: "owner" })]);

        const res = await PATCH(
            jsonRequest("/api/workspace/members/8", "PATCH", { status: "suspended" }),
            params({ id: "8" })
        );

        expect(res.status).toBe(403);
        expect(fakeDb.updates).toHaveLength(0);
    });

    it("lets an admin change and suspend another admin", async () => {
        const ctx = makeWorkspaceContext({ role: "admin", userPk: 7n });
        gate.mockImplementation(gateFor(ctx));
        fakeDb.onSelect(userCompanyMemberships, [memberRow({ role: "admin" })]);

        const res = await PATCH(
            jsonRequest("/api/workspace/members/8", "PATCH", {
                role: "member",
                status: "suspended",
            }),
            params({ id: "8" })
        );

        expect(res.status).toBe(200);
        expect(fakeDb.updatesOf(userCompanyMemberships)).toEqual([
            { role: "member", status: "suspended" },
        ]);
        expect(auditActions()).toEqual(["member.role_changed", "member.suspended"]);
    });

    it("lets an admin promote a member to admin, but nobody assigns owner", async () => {
        const ctx = makeWorkspaceContext({ role: "admin", userPk: 7n });
        gate.mockImplementation(gateFor(ctx));
        fakeDb.onSelect(userCompanyMemberships, [memberRow({ role: "member" })]);

        const toOwner = await PATCH(
            jsonRequest("/api/workspace/members/8", "PATCH", { role: "owner" }),
            params({ id: "8" })
        );
        expect(toOwner.status).toBe(400);
        expect(fakeDb.updates).toHaveLength(0);

        const toAdmin = await PATCH(
            jsonRequest("/api/workspace/members/8", "PATCH", { role: "admin" }),
            params({ id: "8" })
        );
        expect(toAdmin.status).toBe(200);
        expect(fakeDb.updatesOf(userCompanyMemberships)).toEqual([{ role: "admin" }]);
    });

    it("refuses a role whose permissions the caller lacks", async () => {
        const ctx = makeWorkspaceContext({
            role: "lead",
            userPk: 7n,
            permissions: ["members.manage", "members.view", "documents.read"],
        });
        gate.mockImplementation(gateFor(ctx));
        fakeDb.onSelect(userCompanyMemberships, [memberRow({ role: "viewer" })]);

        const res = await PATCH(
            jsonRequest("/api/workspace/members/8", "PATCH", { role: "member" }),
            params({ id: "8" })
        );

        expect(res.status).toBe(403);
    });

    it("refuses demoting the last owner", async () => {
        const ctx = makeWorkspaceContext({ role: "owner", userPk: 7n });
        gate.mockImplementation(gateFor(ctx));
        // The same row answers the target lookup and the active-owner count.
        fakeDb.onSelect(userCompanyMemberships, [memberRow({ role: "owner" })]);

        const res = await PATCH(
            jsonRequest("/api/workspace/members/8", "PATCH", { role: "member" }),
            params({ id: "8" })
        );

        expect(res.status).toBe(409);
        expect(fakeDb.updates).toHaveLength(0);
    });

    it("approves a pending member and records member.approved", async () => {
        const ctx = makeWorkspaceContext({ role: "owner", userPk: 7n });
        gate.mockImplementation(gateFor(ctx));
        fakeDb.onSelect(userCompanyMemberships, [memberRow({ status: "pending" })]);

        const res = await PATCH(
            jsonRequest("/api/workspace/members/8", "PATCH", { status: "active" }),
            params({ id: "8" })
        );

        expect(res.status).toBe(200);
        const body = (await res.json()) as { id: number; roleName: string; isSelf: boolean };
        expect(body.id).toBe(8);
        expect(body.roleName).toBe("Member");
        expect(body.isSelf).toBe(false);
        expect(fakeDb.updatesOf(userCompanyMemberships)).toEqual([{ status: "active" }]);
        expect(auditActions()).toEqual(["member.approved"]);
    });

    it("records member.role_changed with from/to", async () => {
        const ctx = makeWorkspaceContext({ role: "owner", userPk: 7n });
        gate.mockImplementation(gateFor(ctx));
        fakeDb.onSelect(userCompanyMemberships, [memberRow({ role: "member" })]);

        const res = await PATCH(
            jsonRequest("/api/workspace/members/8", "PATCH", { role: "viewer" }),
            params({ id: "8" })
        );

        expect(res.status).toBe(200);
        const [event] = fakeDb.insertedInto(workspaceAuditEvents);
        expect(event).toMatchObject({
            action: "member.role_changed",
            targetType: "member",
            targetId: "8",
            detail: { from: "member", to: "viewer" },
        });
    });

    it("rejects a body with nothing to change", async () => {
        const ctx = makeWorkspaceContext({ role: "owner", userPk: 7n });
        gate.mockImplementation(gateFor(ctx));

        const res = await PATCH(
            jsonRequest("/api/workspace/members/8", "PATCH", {}),
            params({ id: "8" })
        );

        expect(res.status).toBe(400);
    });
});

describe("DELETE /api/workspace/members/[id]", () => {
    it("lets an admin remove another admin but not an owner", async () => {
        const ctx = makeWorkspaceContext({ role: "admin", userPk: 7n });
        gate.mockImplementation(gateFor(ctx));
        fakeDb.onSelect(
            userCompanyMemberships,
            [memberRow({ role: "owner" })],
            [memberRow({ role: "admin" })]
        );

        const owner = await DELETE(
            jsonRequest("/api/workspace/members/8", "DELETE"),
            params({ id: "8" })
        );
        expect(owner.status).toBe(403);
        expect(fakeDb.deletes).toHaveLength(0);

        const admin = await DELETE(
            jsonRequest("/api/workspace/members/8", "DELETE"),
            params({ id: "8" })
        );
        expect(admin.status).toBe(200);
        expect(fakeDb.deletesOf(userCompanyMemberships)).toBe(1);
    });

    it("removes the membership, group seats, and user grants, then audits", async () => {
        const ctx = makeWorkspaceContext({ role: "owner", userPk: 7n });
        gate.mockImplementation(gateFor(ctx));
        fakeDb.onSelect(userCompanyMemberships, [memberRow({ role: "member" })]);

        const res = await DELETE(
            jsonRequest("/api/workspace/members/8", "DELETE"),
            params({ id: "8" })
        );

        expect(res.status).toBe(200);
        expect(fakeDb.deletesOf(userCompanyMemberships)).toBe(1);
        expect(fakeDb.deletesOf(folderGrants)).toBe(1);
        expect(fakeDb.deletesOf(documentGrants)).toBe(1);
        expect(auditActions()).toEqual(["member.removed"]);
    });
});

describe("POST /api/workspace/members/leave", () => {
    it("refuses the last owner", async () => {
        const ctx = makeWorkspaceContext({ role: "owner", userPk: 7n });
        context.mockResolvedValue({ success: true, data: ctx });
        fakeDb.onSelect(userCompanyMemberships, [{ userId: 7n }]);

        const res = await LEAVE();

        expect(res.status).toBe(409);
        expect(fakeDb.deletes).toHaveLength(0);
    });

    it("lets a member leave and points them at the workspace picker", async () => {
        const ctx = makeWorkspaceContext({ role: "member", userPk: 7n });
        context.mockResolvedValue({ success: true, data: ctx });

        const res = await LEAVE();

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({ success: true, redirectTo: "/workspaces" });
        expect(auditActions()).toEqual(["member.left"]);
    });
});

describe("GET /api/workspace/members", () => {
    it("sorts pending first, then by role rank, and counts by status", async () => {
        const ctx = makeWorkspaceContext({ role: "owner", userPk: 7n });
        gate.mockImplementation(gateFor(ctx));
        fakeDb.onSelect(userCompanyMemberships, [
            memberRow({ id: 7, name: "Ann", role: "owner", authUserId: "user-a" }),
            memberRow({ id: 9, name: "Cal", role: "viewer", status: "pending" }),
            memberRow({ id: 8, name: "Bea", role: "admin", status: "suspended" }),
        ]);

        const res = await GET();

        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            members: { id: number; isSelf: boolean }[];
            counts: Record<string, number>;
        };
        expect(body.members.map(m => m.id)).toEqual([9, 7, 8]);
        expect(body.members[1]?.isSelf).toBe(true);
        expect(body.counts).toEqual({ active: 1, pending: 1, suspended: 1 });
    });
});
