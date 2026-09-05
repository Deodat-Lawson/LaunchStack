jest.mock("~/server/db", () => ({
    db: jest.requireActual("../../helpers/fake-db").fakeDb.db,
}));
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspacePermission: jest.fn(),
}));

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { DELETE, PATCH } from "~/app/api/workspace/roles/[id]/route";
import { GET, POST } from "~/app/api/workspace/roles/route";
import { userCompanyMemberships, workspaceAuditEvents, workspaceRoles } from "~/server/db/schema";

import { fakeDb } from "../../helpers/fake-db";
import { makeWorkspaceContext } from "../../helpers/workspace-context";
import { gateFor, jsonRequest, params } from "./_setup";

const gate = requireWorkspacePermission as jest.Mock;

const reviewer = {
    id: 1000,
    companyId: 5n,
    slug: "reviewer",
    name: "Reviewer",
    description: null,
    permissions: ["documents.read", "members.view"],
    createdBy: "user-a",
    createdAt: new Date(),
    updatedAt: null,
};

beforeEach(() => {
    fakeDb.reset();
    jest.clearAllMocks();
});

describe("POST /api/workspace/roles", () => {
    it("rejects an owner-only permission even from an owner", async () => {
        gate.mockImplementation(gateFor(makeWorkspaceContext({ role: "owner" })));

        const res = await POST(
            jsonRequest("/api/workspace/roles", "POST", {
                name: "Treasurer",
                permissions: ["documents.read", "billing.manage"],
            })
        );

        expect(res.status).toBe(403);
        expect(fakeDb.inserts).toHaveLength(0);
    });

    it("rejects permissions the caller does not hold", async () => {
        gate.mockImplementation(
            gateFor(
                makeWorkspaceContext({
                    role: "lead",
                    permissions: ["roles.manage", "documents.read", "members.view"],
                })
            )
        );

        const res = await POST(
            jsonRequest("/api/workspace/roles", "POST", {
                name: "Uploader",
                permissions: ["documents.read", "documents.upload"],
            })
        );

        expect(res.status).toBe(403);
    });

    it("rejects a value outside the catalogue and a built-in name", async () => {
        gate.mockImplementation(gateFor(makeWorkspaceContext({ role: "owner" })));

        const unknown = await POST(
            jsonRequest("/api/workspace/roles", "POST", {
                name: "X",
                permissions: ["documents.fly"],
            })
        );
        expect(unknown.status).toBe(400);

        const builtin = await POST(
            jsonRequest("/api/workspace/roles", "POST", {
                name: "Admin",
                permissions: ["documents.read"],
            })
        );
        expect(builtin.status).toBe(400);
    });

    it("creates a custom role from the name and audits it", async () => {
        gate.mockImplementation(gateFor(makeWorkspaceContext({ role: "owner" })));
        fakeDb.onSelect(workspaceRoles, [], [reviewer]);

        const res = await POST(
            jsonRequest("/api/workspace/roles", "POST", {
                name: "Reviewer",
                permissions: ["documents.read", "members.view"],
            })
        );

        expect(res.status).toBe(201);
        const { role } = (await res.json()) as { role: Record<string, unknown> };
        expect(role).toMatchObject({
            id: 1000,
            slug: "reviewer",
            name: "Reviewer",
            builtin: false,
            assignable: true,
            editable: true,
            memberCount: 0,
        });
        expect(fakeDb.insertedInto(workspaceRoles)[0]).toMatchObject({
            slug: "reviewer",
            permissions: ["documents.read", "members.view"],
        });
        expect(fakeDb.insertedInto(workspaceAuditEvents)).toEqual([
            expect.objectContaining({ action: "role.created", targetId: "reviewer" }),
        ]);
    });
});

describe("GET /api/workspace/roles", () => {
    it("lists built-ins in rank order, then custom roles, with the catalogue", async () => {
        gate.mockImplementation(gateFor(makeWorkspaceContext({ role: "admin" })));
        fakeDb.onSelect(workspaceRoles, [reviewer]);
        fakeDb.onSelect(userCompanyMemberships, [
            { role: "owner" },
            { role: "editor" },
            { role: "reviewer" },
        ]);

        const res = await GET();

        const body = (await res.json()) as {
            roles: { slug: string; memberCount: number; assignable: boolean; editable: boolean }[];
            permissions: { key: string; ownerOnly: boolean }[];
        };
        expect(body.roles.map(r => r.slug)).toEqual([
            "owner",
            "admin",
            "member",
            "viewer",
            "guest",
            "reviewer",
        ]);
        expect(body.roles.map(r => r.memberCount)).toEqual([1, 0, 1, 0, 0, 1]);
        // An admin may hand out admin, member, viewer, guest, and custom roles — never owner.
        expect(body.roles.map(r => r.assignable)).toEqual([false, true, true, true, true, true]);
        expect(body.roles.find(r => r.slug === "reviewer")?.editable).toBe(true);
        expect(body.permissions.find(p => p.key === "billing.manage")?.ownerOnly).toBe(true);
    });
});

describe("PATCH and DELETE /api/workspace/roles/[id]", () => {
    it("audits added and removed permissions on update", async () => {
        gate.mockImplementation(gateFor(makeWorkspaceContext({ role: "owner" })));
        fakeDb.onSelect(workspaceRoles, [reviewer]);

        const res = await PATCH(
            jsonRequest("/api/workspace/roles/1000", "PATCH", {
                permissions: ["documents.read", "documents.upload"],
            }),
            params({ id: "1000" })
        );

        expect(res.status).toBe(200);
        expect(fakeDb.insertedInto(workspaceAuditEvents)[0]).toMatchObject({
            action: "role.updated",
            detail: { added: ["documents.upload"], removed: ["members.view"] },
        });
    });

    it("answers 409 with the member count when the role is still held", async () => {
        gate.mockImplementation(gateFor(makeWorkspaceContext({ role: "owner" })));
        fakeDb.onSelect(workspaceRoles, [reviewer]);
        fakeDb.onSelect(userCompanyMemberships, [
            { id: 1, userId: 8n },
            { id: 2, userId: 9n },
        ]);

        const res = await DELETE(
            jsonRequest("/api/workspace/roles/1000", "DELETE"),
            params({ id: "1000" })
        );

        expect(res.status).toBe(409);
        await expect(res.json()).resolves.toMatchObject({ memberCount: 2 });
        expect(fakeDb.deletes).toHaveLength(0);
    });

    it("moves holders to reassignTo and audits each change", async () => {
        gate.mockImplementation(gateFor(makeWorkspaceContext({ role: "owner" })));
        fakeDb.onSelect(workspaceRoles, [reviewer]);
        fakeDb.onSelect(userCompanyMemberships, [
            { id: 1, userId: 8n },
            { id: 2, userId: 9n },
        ]);

        const res = await DELETE(
            jsonRequest("/api/workspace/roles/1000", "DELETE", { reassignTo: "viewer" }),
            params({ id: "1000" })
        );

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({ success: true, reassigned: 2 });
        expect(fakeDb.updatesOf(userCompanyMemberships)).toEqual([
            { role: "viewer" },
            { role: "viewer" },
        ]);
        expect(fakeDb.insertedInto(workspaceAuditEvents).map(e => e.action)).toEqual([
            "member.role_changed",
            "member.role_changed",
            "role.deleted",
        ]);
        expect(fakeDb.deletesOf(workspaceRoles)).toBe(1);
    });
});
