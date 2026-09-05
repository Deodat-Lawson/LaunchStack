jest.mock("~/server/db", () => ({
    db: jest.requireActual("../../helpers/fake-db").fakeDb.db,
}));
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspacePermission: jest.fn(),
}));
jest.mock("~/server/auth", () => ({ getServerSession: jest.fn() }));
jest.mock("~/server/auth/email", () => ({ sendAuthEmail: jest.fn().mockResolvedValue(undefined) }));

import { company } from "@launchstack/store/schema";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { POST as ACCEPT } from "~/app/api/workspace/invitations/accept/route";
import { GET as PREVIEW } from "~/app/api/workspace/invitations/preview/route";
import { POST } from "~/app/api/workspace/invitations/route";
import { getServerSession } from "~/server/auth";
import { sendAuthEmail } from "~/server/auth/email";
import {
    userCompanyMemberships,
    users,
    workspaceAuditEvents,
    workspaceInvitations,
} from "~/server/db/schema";
import { hashInvitationToken } from "~/server/workspace/invitations";

import { fakeDb } from "../../helpers/fake-db";
import { makeWorkspaceContext } from "../../helpers/workspace-context";
import { gateFor, jsonRequest } from "./_setup";

const gate = requireWorkspacePermission as jest.Mock;
const session = getServerSession as jest.Mock;
const email = sendAuthEmail as jest.Mock;

const FUTURE = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 60_000);

function invitationRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        id: 41,
        companyId: 5n,
        email: "bob@example.com",
        role: "member",
        groupIds: [] as bigint[],
        tokenHash: hashInvitationToken("tok"),
        invitedBy: "user-a",
        expiresAt: FUTURE,
        acceptedAt: null,
        acceptedByUserId: null,
        revokedAt: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        ...overrides,
    };
}

beforeEach(() => {
    fakeDb.reset();
    jest.clearAllMocks();
});

describe("POST /api/workspace/invitations", () => {
    it("answers 409 when the email already holds a membership here", async () => {
        gate.mockImplementation(gateFor(makeWorkspaceContext({ role: "owner" })));
        fakeDb.onSelect(userCompanyMemberships, [{ status: "active" }]);

        const res = await POST(
            jsonRequest("/api/workspace/invitations", "POST", {
                email: "Bob@Example.com",
                role: "member",
            })
        );

        expect(res.status).toBe(409);
        expect(fakeDb.inserts).toHaveLength(0);
        expect(email).not.toHaveBeenCalled();
    });

    it("refuses to invite an owner", async () => {
        gate.mockImplementation(gateFor(makeWorkspaceContext({ role: "owner" })));

        const res = await POST(
            jsonRequest("/api/workspace/invitations", "POST", {
                email: "bob@example.com",
                role: "owner",
            })
        );

        expect(res.status).toBe(400);
    });

    it("refuses a role whose permissions the caller lacks", async () => {
        gate.mockImplementation(
            gateFor(
                makeWorkspaceContext({
                    role: "lead",
                    permissions: ["members.invite", "members.view", "documents.read"],
                })
            )
        );

        const res = await POST(
            jsonRequest("/api/workspace/invitations", "POST", {
                email: "bob@example.com",
                role: "member",
            })
        );

        expect(res.status).toBe(403);
    });

    it("lets an admin invite another admin", async () => {
        gate.mockImplementation(gateFor(makeWorkspaceContext({ role: "admin" })));
        fakeDb.onSelect(userCompanyMemberships, []);
        fakeDb.onSelect(workspaceInvitations, []);
        fakeDb.onReturning(workspaceInvitations, [invitationRow({ role: "admin" })]);

        const res = await POST(
            jsonRequest("/api/workspace/invitations", "POST", {
                email: "bob@example.com",
                role: "admin",
            })
        );

        expect(res.status).toBe(201);
        expect(fakeDb.insertedInto(workspaceInvitations)[0]).toMatchObject({ role: "admin" });
    });

    it("stores a hashed token, audits, and emails the accept link", async () => {
        gate.mockImplementation(gateFor(makeWorkspaceContext({ role: "owner" })));
        fakeDb.onSelect(userCompanyMemberships, []);
        fakeDb.onSelect(workspaceInvitations, []);
        fakeDb.onReturning(workspaceInvitations, [invitationRow()]);
        fakeDb.onSelect(company, [{ name: "Acme" }]);
        fakeDb.onSelect(users, [{ userId: "user-a", name: "Ann", email: "ann@example.com" }]);

        const res = await POST(
            jsonRequest("/api/workspace/invitations", "POST", {
                email: "Bob@Example.com ",
                role: "member",
            })
        );

        expect(res.status).toBe(201);
        const body = (await res.json()) as {
            invitation: { email: string; status: string; roleName: string; invitedBy: unknown };
            acceptUrl: string;
        };
        expect(body.acceptUrl).toMatch(/^http:\/\/localhost\/invite\/[A-Za-z0-9_-]{40,}$/);
        expect(body.invitation).toMatchObject({
            email: "bob@example.com",
            status: "pending",
            roleName: "Member",
            invitedBy: { name: "Ann", email: "ann@example.com" },
        });

        const [inserted] = fakeDb.insertedInto(workspaceInvitations);
        const token = body.acceptUrl.split("/invite/")[1]!;
        expect(inserted).toMatchObject({
            email: "bob@example.com",
            role: "member",
            tokenHash: hashInvitationToken(token),
        });
        expect(inserted?.tokenHash).not.toContain(token);

        expect(fakeDb.insertedInto(workspaceAuditEvents)).toEqual([
            expect.objectContaining({ action: "member.invited", targetType: "invitation" }),
        ]);
        expect(email).toHaveBeenCalledWith(
            expect.objectContaining({
                to: "bob@example.com",
                subject: "You're invited to Acme on LaunchStack",
                text: expect.stringContaining(body.acceptUrl),
            })
        );
        const text = (email.mock.calls[0]![0] as { text: string }).text;
        expect(text).toContain("Ann");
        expect(text).toContain("Member");
        expect(text).toContain("expires");
    });
});

describe("POST /api/workspace/invitations/accept", () => {
    it("answers 403 when the session email differs from the invitee", async () => {
        session.mockResolvedValue({
            user: { id: "user-x", email: "someone.else@example.com", name: "X" },
        });
        fakeDb.onSelect(workspaceInvitations, [invitationRow()]);

        const res = await ACCEPT(
            jsonRequest("/api/workspace/invitations/accept", "POST", { token: "tok" })
        );

        expect(res.status).toBe(403);
        await expect(res.json()).resolves.toEqual({
            error: "This invitation was sent to a different email address.",
        });
        expect(fakeDb.inserts).toHaveLength(0);
    });

    it("answers 410 for an expired invitation and 404 for an unknown token", async () => {
        session.mockResolvedValue({
            user: { id: "user-x", email: "bob@example.com", name: "Bob" },
        });
        fakeDb.onSelect(workspaceInvitations, [invitationRow({ expiresAt: PAST })], []);

        const expired = await ACCEPT(
            jsonRequest("/api/workspace/invitations/accept", "POST", { token: "tok" })
        );
        expect(expired.status).toBe(410);

        const unknown = await ACCEPT(
            jsonRequest("/api/workspace/invitations/accept", "POST", { token: "nope" })
        );
        expect(unknown.status).toBe(404);
    });

    it("creates the users row, an active membership, and audits member.joined", async () => {
        session.mockResolvedValue({
            user: { id: "user-x", email: "BOB@example.com", name: "Bob" },
        });
        fakeDb.onSelect(workspaceInvitations, [invitationRow()]);
        fakeDb.onSelect(users, []);
        fakeDb.onSelect(userCompanyMemberships, []);

        const res = await ACCEPT(
            jsonRequest("/api/workspace/invitations/accept", "POST", { token: "tok" })
        );

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({
            success: true,
            companyId: 5,
            redirectTo: "/employer/documents",
            alreadyMember: false,
        });
        expect(res.cookies.get("pdr_active_company")?.value).toBe("5");

        expect(fakeDb.insertedInto(users)).toEqual([
            { userId: "user-x", name: "Bob", email: "bob@example.com", companyId: 5n },
        ]);
        expect(fakeDb.insertedInto(userCompanyMemberships)).toEqual([
            { userId: 1000n, companyId: 5n, role: "member", status: "active" },
        ]);
        expect(fakeDb.updatesOf(workspaceInvitations)).toEqual([
            expect.objectContaining({ acceptedByUserId: 1000n }),
        ]);
        expect(fakeDb.insertedInto(workspaceAuditEvents)).toEqual([
            expect.objectContaining({
                action: "member.joined",
                actorUserId: "user-x",
                detail: expect.objectContaining({ via: "invitation", invitationId: 41 }),
            }),
        ]);
    });

    it("reports alreadyMember for an active member without touching the membership", async () => {
        session.mockResolvedValue({
            user: { id: "user-x", email: "bob@example.com", name: "Bob" },
        });
        fakeDb.onSelect(workspaceInvitations, [invitationRow()]);
        fakeDb.onSelect(users, [{ id: 12 }]);
        fakeDb.onSelect(userCompanyMemberships, [{ status: "active" }]);

        const res = await ACCEPT(
            jsonRequest("/api/workspace/invitations/accept", "POST", { token: "tok" })
        );

        expect(res.status).toBe(200);
        expect(((await res.json()) as { alreadyMember: boolean }).alreadyMember).toBe(true);
        expect(fakeDb.insertedInto(userCompanyMemberships)).toHaveLength(0);
        expect(fakeDb.updatesOf(userCompanyMemberships)).toHaveLength(0);
    });

    it("answers 409 for a suspended member", async () => {
        session.mockResolvedValue({
            user: { id: "user-x", email: "bob@example.com", name: "Bob" },
        });
        fakeDb.onSelect(workspaceInvitations, [invitationRow()]);
        fakeDb.onSelect(users, [{ id: 12 }]);
        fakeDb.onSelect(userCompanyMemberships, [{ status: "suspended" }]);

        const res = await ACCEPT(
            jsonRequest("/api/workspace/invitations/accept", "POST", { token: "tok" })
        );

        expect(res.status).toBe(409);
    });
});

describe("GET /api/workspace/invitations/preview", () => {
    it("shows the workspace and role without any ids", async () => {
        fakeDb.onSelect(workspaceInvitations, [
            {
                companyId: 5n,
                email: "bob@example.com",
                role: "member",
                expiresAt: FUTURE,
                acceptedAt: null,
                revokedAt: null,
                workspaceName: "Acme",
                workspaceSlug: "acme",
            },
        ]);

        const res = await PREVIEW(
            new Request("http://localhost/api/workspace/invitations/preview?token=tok")
        );

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({
            workspaceName: "Acme",
            workspaceSlug: "acme",
            role: "member",
            roleName: "Member",
            email: "bob@example.com",
            expiresAt: FUTURE.toISOString(),
            status: "pending",
        });
    });

    it("answers 404 for an unknown token", async () => {
        const res = await PREVIEW(
            new Request("http://localhost/api/workspace/invitations/preview?token=zzz")
        );
        expect(res.status).toBe(404);
    });
});
