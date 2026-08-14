import { NextResponse } from "next/server";
import {
  requireWorkspaceContext,
  requireClerkIdentity,
} from "~/lib/require-workspace-context";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAuth = jest.fn<
  Promise<{ userId: string | null }>,
  []
>();

jest.mock("@clerk/nextjs/server", () => ({
  auth: () => mockAuth(),
}));

const mockDbSelect = jest.fn();

jest.mock("~/server/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
  },
}));

const mockResolveActiveCompanyForUser = jest.fn<
  Promise<bigint>,
  [number | bigint, number | bigint, string]
>();

jest.mock("~/lib/active-workspace", () => ({
  resolveActiveCompanyForUser: (
    userPk: number | bigint,
    defaultCompanyId: number | bigint,
    status: string,
  ) => mockResolveActiveCompanyForUser(userPk, defaultCompanyId, status),
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
  const body = await result.response.json();
  const status = result.response.status;
  return { body, status };
}

// ---------------------------------------------------------------------------
// requireWorkspaceContext
// ---------------------------------------------------------------------------

describe("requireWorkspaceContext", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when there is no Clerk session", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const result = await requireWorkspaceContext();

    expect(result.success).toBe(false);
    if (!result.success) {
      const { body, status } = await getJsonAndStatus(result);
      expect(status).toBe(401);
      expect(body.error).toBe("Unauthorized");
    }
  });

  it("returns 401 when session exists but no users row", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_abc" });
    setupUserQuery([]);

    const result = await requireWorkspaceContext();

    expect(result.success).toBe(false);
    if (!result.success) {
      const { body, status } = await getJsonAndStatus(result);
      expect(status).toBe(401);
      expect(body.error).toBe("Unauthorized");
    }
  });

  it("returns 403 when user status is not verified", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_abc" });
    setupUserQuery([{ id: 1, companyId: BigInt(10), role: "employer", status: "pending" }]);

    const result = await requireWorkspaceContext();

    expect(result.success).toBe(false);
    if (!result.success) {
      const { body, status } = await getJsonAndStatus(result);
      expect(status).toBe(403);
      expect(body.error).toBe("Forbidden");
    }
  });

  it("returns context with default company when no cookie is set", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_abc" });
    setupUserQuery([{ id: 7, companyId: BigInt(10), role: "employer", status: "verified" }]);
    mockResolveActiveCompanyForUser.mockResolvedValue(BigInt(10));
    setupMembershipQuery([{ role: "owner" }]);

    const result = await requireWorkspaceContext();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clerkUserId).toBe("clerk_abc");
      expect(result.data.userPk).toBe(BigInt(7));
      expect(result.data.companyId).toBe(BigInt(10));
      expect(result.data.role).toBe("owner");
      expect(result.data.status).toBe("verified");
    }
  });

  it("returns context with cookie company when membership is valid", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_abc" });
    setupUserQuery([{ id: 7, companyId: BigInt(10), role: "employer", status: "verified" }]);
    mockResolveActiveCompanyForUser.mockResolvedValue(BigInt(20));
    setupMembershipQuery([{ role: "editor" }]);

    const result = await requireWorkspaceContext();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.companyId).toBe(BigInt(20));
      expect(result.data.role).toBe("editor");
    }
  });

  it("returns 403 when the resolved default company has no membership", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_abc" });
    setupUserQuery([{ id: 7, companyId: BigInt(10), role: "employer", status: "verified" }]);
    mockResolveActiveCompanyForUser.mockResolvedValue(BigInt(10));
    setupMembershipQuery([]);

    const result = await requireWorkspaceContext();

    expect(result.success).toBe(false);
    if (!result.success) {
      const { body, status } = await getJsonAndStatus(result);
      expect(status).toBe(403);
      expect(body.error).toBe("Forbidden");
    }
  });

  it("uses membership role when membership row exists", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_abc" });
    setupUserQuery([{ id: 7, companyId: BigInt(10), role: "employer", status: "verified" }]);
    mockResolveActiveCompanyForUser.mockResolvedValue(BigInt(10));
    setupMembershipQuery([{ role: "editor" }]);

    const result = await requireWorkspaceContext();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe("editor");
    }
  });

  it("never falls back to the legacy users.role", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_abc" });
    setupUserQuery([{ id: 7, companyId: BigInt(10), role: "employer", status: "verified" }]);
    mockResolveActiveCompanyForUser.mockResolvedValue(BigInt(10));
    setupMembershipQuery([{ role: "editor" }]);

    const result = await requireWorkspaceContext();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe("editor");
      expect(result.data.role).not.toBe("employer");
    }
  });

  it("returns 500 when resolveActiveCompanyForUser throws", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_abc" });
    setupUserQuery([{ id: 7, companyId: BigInt(10), role: "employer", status: "verified" }]);
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
    mockAuth.mockResolvedValue({ userId: "clerk_abc" });
    setupUserQuery([{ id: 7, companyId: BigInt(10), role: "employer", status: "verified" }]);
    mockResolveActiveCompanyForUser.mockResolvedValue(null as unknown as bigint);

    const consoleSpy = jest.spyOn(console, "error").mockImplementation();

    const result = await requireWorkspaceContext();

    expect(result.success).toBe(false);
    if (!result.success) {
      const { body, status } = await getJsonAndStatus(result);
      expect(status).toBe(403);
      expect(body.error).toBe("Forbidden");
    }

    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// requireClerkIdentity
// ---------------------------------------------------------------------------

describe("requireClerkIdentity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when there is no Clerk session", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const result = await requireClerkIdentity();

    expect(result.success).toBe(false);
    if (!result.success) {
      const { body, status } = await getJsonAndStatus(result);
      expect(status).toBe(401);
      expect(body.error).toBe("Unauthorized");
    }
  });

  it("returns clerkUserId when session exists", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_xyz" });

    const result = await requireClerkIdentity();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clerkUserId).toBe("clerk_xyz");
    }
  });

  it("does not query the database", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_xyz" });

    await requireClerkIdentity();

    expect(mockDbSelect).not.toHaveBeenCalled();
    expect(mockResolveActiveCompanyForUser).not.toHaveBeenCalled();
  });
});
