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
import { PATCH } from "~/app/api/workspace/join-links/[id]/route";
import { POST as RESET } from "~/app/api/workspace/join-links/[id]/reset/route";
import { getServerSession } from "~/server/auth";
import {
    inviteCodes,
    userCompanyMemberships,
    users,
    workspaceAuditEvents,
} from "~/server/db/schema";
import { newJoinCode } from "~/server/workspace/join-links";

import { fakeDb } from "../../helpers/fake-db";
import { makeWorkspaceContext } from "../../helpers/workspace-context";
import { gateFor, jsonRequest, params } from "./_setup";

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
        requiresApproval: false,
        ...overrides,
    };
}

beforeEach(() => {
    fakeDb.reset();
    jest.clearAllMocks();
    session.mockResolvedValue({ user: { id: "user-x", email: "new@example.com", name: "Newt" } });
});

describe("POST /api/workspace/join-links/accept", () => {
    it("lets people straight in: the link is the admin's approval", async () => {
        fakeDb.onSelect(inviteCodes, [linkRow()]);
        fakeDb.onSelect(users, []);
        fakeDb.onSelect(userCompanyMemberships, []);
        fakeDb.onReturning(inviteCodes, [{ id: 3 }]);

        const res = await ACCEPT(
            jsonRequest("/api/workspace/join-links/accept", "POST", { code: "abcd1234" })
        );

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({
            success: true,
            status: "active",
            companyId: 5,
            redirectTo: "/employer/documents",
            alreadyMember: false,
        });
        expect(res.cookies.get("pdr_active_company")?.value).toBe("5");
        expect(fakeDb.insertedInto(userCompanyMemberships)).toEqual([
            { userId: 1000n, companyId: 5n, role: "member", status: "active" },
        ]);
    });

    it("lands pending when the link requires approval", async () => {
        fakeDb.onSelect(inviteCodes, [linkRow({ requiresApproval: true })]);
        fakeDb.onSelect(users, []);
        fakeDb.onSelect(userCompanyMemberships, []);
        fakeDb.onReturning(inviteCodes, [{ id: 3 }]);

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

    it("accepts a 32-character code in either case", async () => {
        const code = newJoinCode();
        fakeDb.onSelect(inviteCodes, [linkRow({ code })]);
        fakeDb.onSelect(users, []);
        fakeDb.onSelect(userCompanyMemberships, []);
        fakeDb.onReturning(inviteCodes, [{ id: 3 }]);

        const res = await ACCEPT(
            jsonRequest("/api/workspace/join-links/accept", "POST", { code: code.toLowerCase() })
        );

        expect(res.status).toBe(200);
        expect(fakeDb.insertedInto(userCompanyMemberships)[0]).toMatchObject({ status: "active" });
    });

    it("answers 410 when someone else took the last seat first", async () => {
        fakeDb.onSelect(inviteCodes, [linkRow({ maxUses: 1, useCount: 0 })]);
        fakeDb.onSelect(users, []);
        fakeDb.onSelect(userCompanyMemberships, []);
        // The conditional claim finds the cap already reached.
        fakeDb.onReturning(inviteCodes, []);

        const res = await ACCEPT(
            jsonRequest("/api/workspace/join-links/accept", "POST", { code: "ABCD1234" })
        );

        expect(res.status).toBe(410);
        expect(fakeDb.insertedInto(userCompanyMemberships)).toHaveLength(0);
    });

    it("lets in someone already waiting for approval when the link admits straight in", async () => {
        fakeDb.onSelect(inviteCodes, [linkRow()]);
        fakeDb.onSelect(users, [{ id: 12 }]);
        fakeDb.onSelect(userCompanyMemberships, [{ status: "pending" }]);
        fakeDb.onReturning(inviteCodes, [{ id: 3 }]);

        const res = await ACCEPT(
            jsonRequest("/api/workspace/join-links/accept", "POST", { code: "ABCD1234" })
        );

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toMatchObject({ status: "active", alreadyMember: false });
        expect(fakeDb.insertedInto(userCompanyMemberships)).toHaveLength(0);
        expect(fakeDb.updatesOf(userCompanyMemberships)).toEqual([
            { role: "member", status: "active" },
        ]);
    });

    it("never mints an owner from a legacy owner link", async () => {
        fakeDb.onSelect(inviteCodes, [linkRow({ role: "owner" })]);
        fakeDb.onSelect(users, []);
        fakeDb.onSelect(userCompanyMemberships, []);
        fakeDb.onReturning(inviteCodes, [{ id: 3 }]);

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
        fakeDb.onSelect(inviteCodes, [linkRow({ requiresApproval: true })]);
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
    it("creates an unguessable code with the requested limits and audits", async () => {
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
        // 128 bits: a link that admits straight in must not be guessable.
        expect(inserted?.code).toMatch(/^[0-9A-F]{32}$/);
        expect(inserted).toMatchObject({
            role: "viewer",
            maxUses: 10,
            companyId: 5n,
            requiresApproval: false,
        });
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
        expect(link.url).toBe("http://localhost/join/abcd1234");
        expect(fakeDb.insertedInto(workspaceAuditEvents)).toEqual([
            expect.objectContaining({
                action: "join_link.created",
                targetType: "join_link",
                detail: expect.objectContaining({
                    // Only a prefix: audit readers may not all hold the link.
                    code: inserted?.code?.slice(0, 6),
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

    it("describes a usable link: workspace, role, approval, and who made it", async () => {
        fakeDb.onSelect(inviteCodes, [linkRow({ workspaceName: "Acme" })]);
        fakeDb.onSelect(users, [lookRow({ name: "Ada Admin" })]);

        const res = await PREVIEW(
            new Request("http://localhost/api/workspace/join-links/preview?code=abcd1234")
        );

        await expect(res.json()).resolves.toEqual({
            valid: true,
            workspaceName: "Acme",
            role: "member",
            roleName: "Member",
            requiresApproval: false,
            invitedBy: "Ada Admin",
        });
    });

    it("never shows the inviter's email on the public page", async () => {
        fakeDb.onSelect(inviteCodes, [linkRow({ workspaceName: "Acme" })]);
        fakeDb.onSelect(users, [lookRow({ name: "" })]);

        const res = await PREVIEW(
            new Request("http://localhost/api/workspace/join-links/preview?code=abcd1234")
        );

        const body = (await res.json()) as { invitedBy: string | null };
        expect(body.invitedBy).toBeNull();
    });

    it("treats an over-long code as unknown without a lookup", async () => {
        const res = await PREVIEW(
            new Request(`http://localhost/api/workspace/join-links/preview?code=${"A".repeat(65)}`)
        );
        await expect(res.json()).resolves.toEqual({ valid: false, reason: "unknown" });
    });
});

function lookRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        userPk: 1,
        authUserId: "user-a",
        name: "Ada",
        email: "ada@example.com",
        displayName: null,
        title: null,
        pronouns: null,
        timeZone: null,
        bio: null,
        workspaceDisplayName: null,
        workspaceTitle: null,
        membershipId: 9,
        ...overrides,
    };
}

describe("PATCH /api/workspace/join-links/[id]", () => {
    beforeEach(() => {
        gate.mockImplementation(gateFor(makeWorkspaceContext({ role: "admin" })));
    });

    it("switches a live link to require approval, keeping its URL, and audits", async () => {
        fakeDb.onSelect(inviteCodes, [linkRow()]);

        const res = await PATCH(
            jsonRequest("/api/workspace/join-links/3", "PATCH", { requiresApproval: true }),
            params({ id: "3" })
        );

        expect(res.status).toBe(200);
        const { link } = (await res.json()) as { link: { requiresApproval: boolean; url: string } };
        expect(link).toMatchObject({
            requiresApproval: true,
            url: "http://localhost/join/abcd1234",
        });
        expect(fakeDb.updatesOf(inviteCodes)).toEqual([{ requiresApproval: true }]);
        expect(fakeDb.insertedInto(workspaceAuditEvents)).toEqual([
            expect.objectContaining({
                action: "join_link.updated",
                detail: { requiresApproval: true },
            }),
        ]);
    });

    it("changes nothing and writes no audit row when nothing differs", async () => {
        fakeDb.onSelect(inviteCodes, [linkRow()]);

        const res = await PATCH(
            jsonRequest("/api/workspace/join-links/3", "PATCH", { requiresApproval: false }),
            params({ id: "3" })
        );

        expect(res.status).toBe(200);
        expect(fakeDb.updates).toHaveLength(0);
        expect(fakeDb.inserts).toHaveLength(0);
    });

    it("refuses to change a revoked link", async () => {
        fakeDb.onSelect(inviteCodes, [linkRow({ isActive: false })]);

        const res = await PATCH(
            jsonRequest("/api/workspace/join-links/3", "PATCH", { requiresApproval: false }),
            params({ id: "3" })
        );

        expect(res.status).toBe(409);
    });

    it("won't let someone who can't hand out the link's role loosen it", async () => {
        gate.mockImplementation(
            gateFor(
                makeWorkspaceContext({
                    role: "lead",
                    permissions: ["members.invite", "documents.read"],
                })
            )
        );
        fakeDb.onSelect(inviteCodes, [linkRow({ role: "admin", requiresApproval: true })]);

        const res = await PATCH(
            jsonRequest("/api/workspace/join-links/3", "PATCH", { requiresApproval: false }),
            params({ id: "3" })
        );

        expect(res.status).toBe(403);
        expect(fakeDb.updates).toHaveLength(0);
    });
});

describe("POST /api/workspace/join-links/[id]/reset", () => {
    beforeEach(() => {
        gate.mockImplementation(gateFor(makeWorkspaceContext({ role: "admin" })));
    });

    it("retires the old code and issues a new one with the same terms", async () => {
        const createdAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
        const expiresAt = new Date(createdAt.getTime() + 30 * 24 * 60 * 60 * 1000);
        fakeDb.onSelect(inviteCodes, [
            linkRow({ maxUses: 5, useCount: 4, requiresApproval: true, createdAt, expiresAt }),
        ]);
        fakeDb.onReturning(inviteCodes, [
            linkRow({ id: 4, code: "FFFF0000", requiresApproval: true, maxUses: 5 }),
        ]);

        const before = Date.now();
        const res = await RESET(
            jsonRequest("/api/workspace/join-links/3/reset", "POST", {}),
            params({ id: "3" })
        );

        expect(res.status).toBe(201);
        expect(fakeDb.updatesOf(inviteCodes)).toEqual([{ isActive: false }]);
        const [inserted] = fakeDb.insertedInto(inviteCodes);
        expect(inserted?.code).toMatch(/^[0-9A-F]{32}$/);
        expect(inserted).toMatchObject({ role: "member", maxUses: 5, requiresApproval: true });
        // A 30-day link is 30 days again, counted from the reset.
        const lifetime = (inserted?.expiresAt as Date).getTime() - before;
        expect(Math.round(lifetime / (24 * 60 * 60 * 1000))).toBe(30);

        const { link } = (await res.json()) as { link: { url: string } };
        expect(link.url).toBe("http://localhost/join/ffff0000");
        expect(fakeDb.insertedInto(workspaceAuditEvents)).toEqual([
            expect.objectContaining({
                action: "join_link.revoked",
                detail: expect.objectContaining({ reset: true }),
            }),
            expect.objectContaining({
                action: "join_link.created",
                detail: expect.objectContaining({ replaces: 3 }),
            }),
        ]);
    });

    it("refuses to reset a link that was already revoked", async () => {
        fakeDb.onSelect(inviteCodes, [linkRow({ isActive: false })]);

        const res = await RESET(
            jsonRequest("/api/workspace/join-links/3/reset", "POST", {}),
            params({ id: "3" })
        );

        expect(res.status).toBe(409);
        expect(fakeDb.inserts).toHaveLength(0);
    });
});
