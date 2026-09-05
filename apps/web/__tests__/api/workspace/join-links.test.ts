jest.mock("~/server/db", () => ({
    db: jest.requireActual("../../helpers/fake-db").fakeDb.db,
}));
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspacePermission: jest.fn(),
}));
jest.mock("~/server/auth", () => ({ getServerSession: jest.fn() }));

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { POST as ACCEPT } from "~/app/api/workspace/join-links/accept/route";
import { GET as PREVIEW } from "~/app/api/workspace/join-links/preview/route";
import { POST } from "~/app/api/workspace/join-links/route";
import { getServerSession } from "~/server/auth";
import {
    inviteCodes,
    userCompanyMemberships,
    users,
    workspaceAuditEvents,
    workspaceSettings,
} from "~/server/db/schema";

import { fakeDb } from "../../helpers/fake-db";
import { makeWorkspaceContext } from "../../helpers/workspace-context";
import { gateFor, jsonRequest } from "./_setup";

const gate = requireWorkspacePermission as jest.Mock;
const session = getServerSession as jest.Mock;

function linkRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        id: 3,
        code: "ABCD1234",
        companyId: 5n,
        role: "member",
        isActive: true,
        createdBy: "user-a",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        expiresAt: null,
        maxUses: null,
        useCount: 0,
        ...overrides,
    };
}

beforeEach(() => {
    fakeDb.reset();
    jest.clearAllMocks();
    session.mockResolvedValue({ user: { id: "user-x", email: "new@example.com", name: "Newt" } });
});

describe("POST /api/workspace/join-links/accept", () => {
    it("lands pending under the default approval policy", async () => {
        fakeDb.onSelect(inviteCodes, [linkRow()]);
        fakeDb.onSelect(users, []);
        fakeDb.onSelect(userCompanyMemberships, []);
        fakeDb.onSelect(workspaceSettings, []);

        const res = await ACCEPT(
            jsonRequest("/api/workspace/join-links/accept", "POST", { code: "abcd1234" })
        );

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({
            success: true,
            status: "pending",
            companyId: 5,
            redirectTo: "/employer/pending-approval",
            alreadyMember: false,
        });
        expect(res.cookies.get("pdr_active_company")?.value).toBe("5");
        expect(fakeDb.insertedInto(userCompanyMemberships)).toEqual([
            { userId: 1000n, companyId: 5n, role: "member", status: "pending" },
        ]);
        expect(fakeDb.updatesOf(inviteCodes)).toHaveLength(1);
        expect(fakeDb.insertedInto(workspaceAuditEvents)).toEqual([
            expect.objectContaining({
                action: "member.joined",
                detail: expect.objectContaining({ via: "join_link", status: "pending" }),
            }),
        ]);
    });

    it("lands active under the open policy", async () => {
        fakeDb.onSelect(inviteCodes, [linkRow()]);
        fakeDb.onSelect(users, []);
        fakeDb.onSelect(userCompanyMemberships, []);
        fakeDb.onSelect(workspaceSettings, [{ joinPolicy: "open", auditRetentionDays: null }]);

        const res = await ACCEPT(
            jsonRequest("/api/workspace/join-links/accept", "POST", { code: "ABCD1234" })
        );

        expect(res.status).toBe(200);
        const body = (await res.json()) as { status: string; redirectTo: string };
        expect(body.status).toBe("active");
        expect(body.redirectTo).toBe("/employer/documents");
        expect(fakeDb.insertedInto(userCompanyMemberships)[0]).toMatchObject({ status: "active" });
    });

    it("never mints an owner from a legacy owner link", async () => {
        fakeDb.onSelect(inviteCodes, [linkRow({ role: "owner" })]);
        fakeDb.onSelect(users, []);
        fakeDb.onSelect(userCompanyMemberships, []);

        await ACCEPT(jsonRequest("/api/workspace/join-links/accept", "POST", { code: "ABCD1234" }));

        expect(fakeDb.insertedInto(userCompanyMemberships)[0]).toMatchObject({ role: "admin" });
    });

    it("answers 410 for an exhausted link and does not burn a use", async () => {
        fakeDb.onSelect(inviteCodes, [linkRow({ maxUses: 2, useCount: 2 })]);

        const res = await ACCEPT(
            jsonRequest("/api/workspace/join-links/accept", "POST", { code: "ABCD1234" })
        );

        expect(res.status).toBe(410);
        expect(fakeDb.updates).toHaveLength(0);
    });

    it("reports an existing membership instead of creating a second one", async () => {
        fakeDb.onSelect(inviteCodes, [linkRow()]);
        fakeDb.onSelect(users, [{ id: 12 }]);
        fakeDb.onSelect(userCompanyMemberships, [{ status: "pending" }]);

        const res = await ACCEPT(
            jsonRequest("/api/workspace/join-links/accept", "POST", { code: "ABCD1234" })
        );

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toMatchObject({ alreadyMember: true, status: "pending" });
        expect(fakeDb.inserts).toHaveLength(0);
        expect(fakeDb.updates).toHaveLength(0);
    });
});

describe("POST /api/workspace/join-links", () => {
    it("creates an 8-character code with the requested limits and audits", async () => {
        gate.mockImplementation(gateFor(makeWorkspaceContext({ role: "admin" })));
        fakeDb.onReturning(inviteCodes, [
            linkRow({ role: "viewer", maxUses: 10, expiresAt: new Date() }),
        ]);

        const res = await POST(
            jsonRequest("/api/workspace/join-links", "POST", {
                role: "viewer",
                expiresInDays: 7,
                maxUses: 10,
            })
        );

        expect(res.status).toBe(201);
        const [inserted] = fakeDb.insertedInto(inviteCodes);
        expect(inserted?.code).toMatch(/^[0-9A-F]{8}$/);
        expect(inserted).toMatchObject({ role: "viewer", maxUses: 10, companyId: 5n });
        expect(inserted?.expiresAt).toBeInstanceOf(Date);

        const { link } = (await res.json()) as {
            link: { code: string; role: string; roleName: string; url: string; maxUses: number };
        };
        expect(link).toMatchObject({
            code: "ABCD1234",
            role: "viewer",
            roleName: "Viewer",
            maxUses: 10,
        });
        expect(link.url).toBe("http://localhost/signup?code=ABCD1234");
        expect(fakeDb.insertedInto(workspaceAuditEvents)).toEqual([
            expect.objectContaining({
                action: "join_link.created",
                targetType: "join_link",
                detail: expect.objectContaining({
                    code: inserted?.code,
                    role: "viewer",
                    maxUses: 10,
                }),
            }),
        ]);
    });

    it("never creates an owner link; an admin may create an admin link", async () => {
        gate.mockImplementation(gateFor(makeWorkspaceContext({ role: "admin" })));

        const owner = await POST(
            jsonRequest("/api/workspace/join-links", "POST", { role: "owner" })
        );
        expect(owner.status).toBe(400);
        expect(fakeDb.inserts).toHaveLength(0);

        fakeDb.onReturning(inviteCodes, [linkRow({ role: "admin" })]);
        const admin = await POST(
            jsonRequest("/api/workspace/join-links", "POST", { role: "admin" })
        );
        expect(admin.status).toBe(201);
        expect(fakeDb.insertedInto(inviteCodes)[0]).toMatchObject({ role: "admin" });
    });

    it("refuses a role whose permissions the caller lacks", async () => {
        gate.mockImplementation(
            gateFor(
                makeWorkspaceContext({
                    role: "lead",
                    permissions: ["members.invite", "documents.read"],
                })
            )
        );

        const res = await POST(
            jsonRequest("/api/workspace/join-links", "POST", { role: "member" })
        );
        expect(res.status).toBe(403);
    });
});

describe("GET /api/workspace/join-links/preview", () => {
    it("explains why a link is unusable", async () => {
        fakeDb.onSelect(inviteCodes, [], [linkRow({ isActive: false, workspaceName: "Acme" })]);

        const unknown = await PREVIEW(
            new Request("http://localhost/api/workspace/join-links/preview?code=NOPE")
        );
        await expect(unknown.json()).resolves.toEqual({ valid: false, reason: "unknown" });

        const inactive = await PREVIEW(
            new Request("http://localhost/api/workspace/join-links/preview?code=ABCD1234")
        );
        await expect(inactive.json()).resolves.toEqual({ valid: false, reason: "inactive" });
    });

    it("describes a usable link with the workspace's join policy", async () => {
        fakeDb.onSelect(inviteCodes, [linkRow({ workspaceName: "Acme" })]);
        fakeDb.onSelect(workspaceSettings, [{ joinPolicy: "open", auditRetentionDays: null }]);

        const res = await PREVIEW(
            new Request("http://localhost/api/workspace/join-links/preview?code=abcd1234")
        );

        await expect(res.json()).resolves.toEqual({
            valid: true,
            workspaceName: "Acme",
            role: "member",
            roleName: "Member",
            joinPolicy: "open",
        });
    });
});
