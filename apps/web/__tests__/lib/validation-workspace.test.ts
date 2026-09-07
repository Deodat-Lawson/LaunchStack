import * as validation from "~/lib/validation";
import {
    AcceptInvitationSchema,
    AuditQuerySchema,
    CreateInvitationSchema,
    CreateJoinLinkSchema,
    CreateRoleSchema,
    FolderAccessSchema,
    JoinWithInviteSchema,
    UpdateMemberSchema,
    WorkspaceSettingsPatchSchema,
} from "~/lib/validation";

describe("workspace validation schemas", () => {
    it("dropped the passkey and employee-management schemas", () => {
        for (const name of [
            "EmployerSignupSchema",
            "EmployeeSignupSchema",
            "ApproveEmployeeByIdSchema",
            "RemoveEmployeeSchema",
            "GenerateInviteCodeSchema",
            "ValidateInviteCodeSchema",
            "DeactivateInviteCodeSchema",
        ]) {
            expect((validation as Record<string, unknown>)[name]).toBeUndefined();
        }
    });

    it("lowercases and trims invitation emails", () => {
        expect(
            CreateInvitationSchema.parse({ email: "  Bob@Example.COM ", role: "member" })
        ).toEqual({
            email: "bob@example.com",
            role: "member",
        });
        expect(
            CreateInvitationSchema.safeParse({ email: "not-an-email", role: "member" }).success
        ).toBe(false);
        expect(CreateInvitationSchema.safeParse({ email: "a@b.co", role: "" }).success).toBe(false);
    });

    it("requires a member patch to change something valid", () => {
        expect(UpdateMemberSchema.safeParse({}).success).toBe(false);
        expect(UpdateMemberSchema.safeParse({ status: "pending" }).success).toBe(false);
        expect(UpdateMemberSchema.parse({ status: "suspended" })).toEqual({ status: "suspended" });
    });

    it("requires a token or an invitationId to accept", () => {
        expect(AcceptInvitationSchema.safeParse({ name: "Bob" }).success).toBe(false);
        expect(AcceptInvitationSchema.safeParse({ invitationId: 4 }).success).toBe(true);
    });

    it("bounds join-link expiry and use limits", () => {
        expect(CreateJoinLinkSchema.safeParse({ role: "member", expiresInDays: 0 }).success).toBe(
            false
        );
        expect(CreateJoinLinkSchema.safeParse({ role: "member", expiresInDays: 366 }).success).toBe(
            false
        );
        expect(CreateJoinLinkSchema.safeParse({ role: "member", maxUses: 10_001 }).success).toBe(
            false
        );
        expect(
            CreateJoinLinkSchema.parse({ role: "member", expiresInDays: null, maxUses: 5 })
        ).toEqual({
            role: "member",
            expiresInDays: null,
            maxUses: 5,
        });
    });

    it("accepts only catalogue permissions for roles", () => {
        expect(
            CreateRoleSchema.safeParse({ name: "X", permissions: ["documents.fly"] }).success
        ).toBe(false);
        expect(
            CreateRoleSchema.safeParse({ name: "X", permissions: ["documents.read"] }).success
        ).toBe(true);
    });

    it("validates grant principals and levels", () => {
        const good = {
            visibility: "restricted",
            grants: [{ principalType: "group", principalId: "3", level: "edit" }],
        };
        expect(FolderAccessSchema.safeParse(good).success).toBe(true);
        expect(
            FolderAccessSchema.safeParse({
                ...good,
                grants: [{ principalType: "team", principalId: "3", level: "edit" }],
            }).success
        ).toBe(false);
        expect(
            FolderAccessSchema.safeParse({
                ...good,
                grants: [{ principalType: "user", principalId: "3", level: "owner" }],
            }).success
        ).toBe(false);
    });

    it("coerces and bounds audit query params", () => {
        expect(AuditQuerySchema.parse({ limit: "50", cursor: "12", format: "csv" })).toEqual({
            limit: 50,
            cursor: 12,
            format: "csv",
        });
        expect(AuditQuerySchema.safeParse({ limit: "201" }).success).toBe(false);
        expect(AuditQuerySchema.parse({ from: "2026-01-01" }).from).toEqual(new Date("2026-01-01"));
    });

    it("keeps settings patches partial but non-empty", () => {
        expect(WorkspaceSettingsPatchSchema.safeParse({}).success).toBe(false);
        expect(WorkspaceSettingsPatchSchema.parse({ auditRetentionDays: null })).toEqual({
            auditRetentionDays: null,
        });
    });

    it("keeps the signup join alias body", () => {
        expect(
            JoinWithInviteSchema.parse({ name: " Amy ", email: "AMY@X.IO", inviteCode: " abcd " })
        ).toEqual({
            name: "Amy",
            email: "amy@x.io",
            inviteCode: "abcd",
        });
    });
});
