import type { NextResponse } from "next/server";
import {
    requireWorkspaceContext,
    requireWorkspacePermission,
    requireAuthIdentity,
    buildWorkspaceContext,
} from "~/lib/require-workspace-context";
import { BUILTIN_ROLE_PERMISSIONS, type Permission } from "~/lib/authz/permissions";
import { SCOPE_EVERYTHING } from "~/lib/authz/scope-types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetServerSession = jest.fn<Promise<{ user: { id: string } } | null>, []>();

jest.mock("~/server/auth", () => ({
    getServerSession: () => mockGetServerSession(),
}));

const mockDbSelect = jest.fn();

jest.mock("~/server/db", () => ({
    db: {
        select: (...args: unknown[]) => mockDbSelect(...args),
    },
}));

const mockResolveActiveCompanyForUser = jest.fn<
    Promise<bigint | null>,
    [number | bigint, number | bigint]
>();

jest.mock("~/lib/active-workspace", () => ({
    resolveActiveCompanyForUser: (userPk: number | bigint, defaultCompanyId: number | bigint) =>
        mockResolveActiveCompanyForUser(userPk, defaultCompanyId),
}));

const mockResolvePermissionsForRole = jest.fn<Promise<ReadonlySet<Permission>>, [bigint, string]>();

jest.mock("~/lib/authz/resolve", () => ({
    resolvePermissionsForRole: (companyId: bigint, role: string) =>
        mockResolvePermissionsForRole(companyId, role),
}));

const mockResolveDocumentScope = jest.fn();

jest.mock("~/lib/authz/scope", () => ({
    resolveDocumentScope: (...args: unknown[]) => mockResolveDocumentScope(...args),
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function setupUserQuery(rows: Record<string, unknown>[]) {
    const whereResult = jest.fn().mockResolvedValue(rows);
    const fromResult = jest.fn().mockReturnValue({ where: whereResult });
    mockDbSelect.mockReturnValueOnce({ from: fromResult });
}

function setupMembershipQuery(rows: Record<string, unknown>[]) {
    const whereResult = jest.fn().mockResolvedValue(rows);
    const fromResult = jest.fn().mockReturnValue({ where: whereResult });
    mockDbSelect.mockReturnValueOnce({ from: fromResult });
}

async function getJsonAndStatus(result: { success: false; response: NextResponse }) {
    const body = (await result.response.json()) as { error: string; permission?: string };
    const status = result.response.status;
    return { body, status };
}

const USER_ROW = { id: 7, companyId: BigInt(10) };

function signedInWithMembership(membership: Record<string, unknown>, companyId = BigInt(10)) {
    mockGetServerSession.mockResolvedValue({ user: { id: "auth_abc" } });
    setupUserQuery([USER_ROW]);
    mockResolveActiveCompanyForUser.mockResolvedValue(companyId);
    setupMembershipQuery([membership]);
}

// ---------------------------------------------------------------------------
// requireWorkspaceContext
// ---------------------------------------------------------------------------

describe("requireWorkspaceContext", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockResolvePermissionsForRole.mockImplementation(async (_companyId, role) => {
            const builtin = BUILTIN_ROLE_PERMISSIONS[role as keyof typeof BUILTIN_ROLE_PERMISSIONS];
            return builtin ?? new Set<Permission>();
        });
        mockResolveDocumentScope.mockResolvedValue(SCOPE_EVERYTHING);
    });

    it("returns 401 when there is no session", async () => {
        mockGetServerSession.mockResolvedValue(null);

        const result = await requireWorkspaceContext();

        expect(result.success).toBe(false);
        if (!result.success) {
            const { body, status } = await getJsonAndStatus(result);
            expect(status).toBe(401);
            expect(body.error).toBe("Unauthorized");
        }
    });

    it("returns 401 when session exists but no users row", async () => {
        mockGetServerSession.mockResolvedValue({ user: { id: "auth_abc" } });
        setupUserQuery([]);

        const result = await requireWorkspaceContext();

        expect(result.success).toBe(false);
        if (!result.success) {
            const { status } = await getJsonAndStatus(result);
            expect(status).toBe(401);
        }
    });

    it("returns 403 for a pending membership", async () => {
        signedInWithMembership({ role: "member", status: "pending" });

        const result = await requireWorkspaceContext();

        expect(result.success).toBe(false);
        if (!result.success) {
            const { body, status } = await getJsonAndStatus(result);
            expect(status).toBe(403);
            expect(body.error).toBe("Forbidden");
        }
        expect(mockResolvePermissionsForRole).not.toHaveBeenCalled();
    });

    it("returns 403 for a suspended membership", async () => {
        signedInWithMembership({ role: "admin", status: "suspended" });

        const result = await requireWorkspaceContext();

        expect(result.success).toBe(false);
        if (!result.success) {
            const { status } = await getJsonAndStatus(result);
            expect(status).toBe(403);
        }
    });

    it("returns a context with the membership role and its permissions", async () => {
        signedInWithMembership({ role: "owner", status: "active" });

        const result = await requireWorkspaceContext();

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.authUserId).toBe("auth_abc");
            expect(result.data.userPk).toBe(BigInt(7));
            expect(result.data.companyId).toBe(BigInt(10));
            expect(result.data.role).toBe("owner");
            expect(result.data.status).toBe("active");
            expect(result.data.can("members.manage")).toBe(true);
            expect(result.data.can("billing.manage")).toBe(true);
        }
        expect(mockResolveActiveCompanyForUser).toHaveBeenCalledWith(7, BigInt(10));
    });

    it("normalises the legacy editor slug to member and caps its permissions", async () => {
        signedInWithMembership({ role: "editor", status: "active" }, BigInt(20));
        mockResolvePermissionsForRole.mockResolvedValue(BUILTIN_ROLE_PERMISSIONS.member);

        const result = await requireWorkspaceContext();

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.companyId).toBe(BigInt(20));
            expect(result.data.role).toBe("member");
            expect(result.data.can("documents.upload")).toBe(true);
            expect(result.data.can("documents.delete")).toBe(false);
            expect(result.data.can("members.manage")).toBe(false);
        }
    });

    it("returns 403 when the resolved company has no membership", async () => {
        mockGetServerSession.mockResolvedValue({ user: { id: "auth_abc" } });
        setupUserQuery([USER_ROW]);
        mockResolveActiveCompanyForUser.mockResolvedValue(BigInt(10));
        setupMembershipQuery([]);

        const result = await requireWorkspaceContext();

        expect(result.success).toBe(false);
        if (!result.success) {
            const { status } = await getJsonAndStatus(result);
            expect(status).toBe(403);
        }
    });

    it("never reads the legacy global users.role", async () => {
        signedInWithMembership({ role: "viewer", status: "active" });

        const result = await requireWorkspaceContext();

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.role).toBe("viewer");
        }
        // The users SELECT projects id and companyId only.
        const projection = mockDbSelect.mock.calls[0]?.[0] as Record<string, unknown>;
        expect(Object.keys(projection).sort()).toEqual(["companyId", "id"]);
    });

    it("resolves the document scope lazily and only once", async () => {
        signedInWithMembership({ role: "member", status: "active" });

        const result = await requireWorkspaceContext();

        expect(result.success).toBe(true);
        if (result.success) {
            expect(mockResolveDocumentScope).not.toHaveBeenCalled();
            const [a, b] = await Promise.all([
                result.data.documentScope(),
                result.data.documentScope(),
            ]);
            expect(a).toBe(SCOPE_EVERYTHING);
            expect(b).toBe(SCOPE_EVERYTHING);
            expect(mockResolveDocumentScope).toHaveBeenCalledTimes(1);
            expect(mockResolveDocumentScope).toHaveBeenCalledWith({
                companyId: BigInt(10),
                userPk: BigInt(7),
                role: "member",
                permissions: BUILTIN_ROLE_PERMISSIONS.member,
            });
        }
    });

    it("returns 500 when resolveActiveCompanyForUser throws", async () => {
        mockGetServerSession.mockResolvedValue({ user: { id: "auth_abc" } });
        setupUserQuery([USER_ROW]);
        mockResolveActiveCompanyForUser.mockRejectedValue(new Error("DB connection failed"));

        const consoleSpy = jest.spyOn(console, "error").mockImplementation();

        const result = await requireWorkspaceContext();

        expect(result.success).toBe(false);
        if (!result.success) {
            const { body, status } = await getJsonAndStatus(result);
            expect(status).toBe(500);
            expect(body.error).toBe("Internal server error");
        }

        consoleSpy.mockRestore();
    });

    it("returns 403 when resolveActiveCompanyForUser returns null", async () => {
        mockGetServerSession.mockResolvedValue({ user: { id: "auth_abc" } });
        setupUserQuery([USER_ROW]);
        mockResolveActiveCompanyForUser.mockResolvedValue(null);

        const consoleSpy = jest.spyOn(console, "error").mockImplementation();

        const result = await requireWorkspaceContext();

        expect(result.success).toBe(false);
        if (!result.success) {
            const { status } = await getJsonAndStatus(result);
            expect(status).toBe(403);
        }

        consoleSpy.mockRestore();
    });

    it("returns 500 when the role cannot be resolved", async () => {
        signedInWithMembership({ role: "finance-lead", status: "active" });
        mockResolvePermissionsForRole.mockRejectedValue(new Error("boom"));
        const consoleSpy = jest.spyOn(console, "error").mockImplementation();

        const result = await requireWorkspaceContext();

        expect(result.success).toBe(false);
        if (!result.success) {
            const { status } = await getJsonAndStatus(result);
            expect(status).toBe(500);
        }
        consoleSpy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// requireWorkspacePermission
// ---------------------------------------------------------------------------

describe("requireWorkspacePermission", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockResolvePermissionsForRole.mockImplementation(async (_companyId, role) => {
            const builtin = BUILTIN_ROLE_PERMISSIONS[role as keyof typeof BUILTIN_ROLE_PERMISSIONS];
            return builtin ?? new Set<Permission>();
        });
    });

    it("passes when the membership holds the permission", async () => {
        signedInWithMembership({ role: "admin", status: "active" });

        const result = await requireWorkspacePermission("folders.manage");

        expect(result.success).toBe(true);
    });

    it("answers 403 naming the missing permission", async () => {
        signedInWithMembership({ role: "member", status: "active" });

        const result = await requireWorkspacePermission("documents.delete");

        expect(result.success).toBe(false);
        if (!result.success) {
            const { body, status } = await getJsonAndStatus(result);
            expect(status).toBe(403);
            expect(body.permission).toBe("documents.delete");
        }
    });

    it("propagates an upstream failure unchanged", async () => {
        mockGetServerSession.mockResolvedValue(null);

        const result = await requireWorkspacePermission("documents.read");

        expect(result.success).toBe(false);
        if (!result.success) {
            const { status } = await getJsonAndStatus(result);
            expect(status).toBe(401);
        }
    });
});

// ---------------------------------------------------------------------------
// buildWorkspaceContext
// ---------------------------------------------------------------------------

describe("buildWorkspaceContext", () => {
    it("answers can() from the given set and normalises the role", () => {
        const ctx = buildWorkspaceContext({
            authUserId: "u",
            userPk: BigInt(1),
            companyId: BigInt(2),
            role: "Employer",
            status: "active",
            permissions: new Set<Permission>(["documents.read"]),
            resolveScope: async () => SCOPE_EVERYTHING,
        });

        expect(ctx.role).toBe("admin");
        expect(ctx.can("documents.read")).toBe(true);
        expect(ctx.can("documents.upload")).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// requireAuthIdentity
// ---------------------------------------------------------------------------

describe("requireAuthIdentity", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("returns 401 when there is no session", async () => {
        mockGetServerSession.mockResolvedValue(null);

        const result = await requireAuthIdentity();

        expect(result.success).toBe(false);
        if (!result.success) {
            const { body, status } = await getJsonAndStatus(result);
            expect(status).toBe(401);
            expect(body.error).toBe("Unauthorized");
        }
    });

    it("returns authUserId when session exists", async () => {
        mockGetServerSession.mockResolvedValue({ user: { id: "auth_xyz" } });

        const result = await requireAuthIdentity();

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.authUserId).toBe("auth_xyz");
        }
    });

    it("does not query the database", async () => {
        mockGetServerSession.mockResolvedValue({ user: { id: "auth_xyz" } });

        await requireAuthIdentity();

        expect(mockDbSelect).not.toHaveBeenCalled();
    });
});
