import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";

import { POST } from "~/app/api/updateCompany/route";
import { validateRequestBody } from "~/lib/validation";
import { db } from "~/server/db/index";
import { recordAuditEvent } from "~/lib/authz/audit";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn();

jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

jest.mock("~/lib/authz/audit", () => ({
    recordAuditEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("~/lib/validation", () => {
    const actual = jest.requireActual("~/lib/validation");
    return {
        ...actual,
        validateRequestBody: jest.fn(),
    };
});

jest.mock("~/server/db/index", () => ({
    db: {
        select: jest.fn(),
        update: jest.fn(),
    },
}));

jest.mock("@launchstack/llm/embeddings", () => ({
    getCompanyCredentialsPlaintext: jest.fn(),
    upsertCompanyCredentials: jest.fn(),
    beginReindex: jest.fn(),
    getCompanyReindexState: jest.fn().mockResolvedValue({ active: null }),
}));

jest.mock("~/lib/ai/validate-credentials", () => ({
    validateEmbeddingCredentials: jest.fn(),
}));

jest.mock("~/server/inngest/client", () => ({
    inngest: { send: jest.fn() },
}));

function mockCtx(role: string, companyId = BigInt(7)) {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ role, companyId, authUserId: "user-123", userPk: BigInt(1) }),
    });
}

describe("POST /api/updateCompany", () => {
    const makeRequest = (body: unknown) =>
        new Request("http://localhost/api/updateCompany", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("updates company settings for an owner", async () => {
        mockCtx("owner");
        (validateRequestBody as jest.Mock).mockResolvedValue({
            success: true,
            data: {
                name: "Acme Corp",
                employerPasskey: "EMP123",
                employeePasskey: "EMP456",
                numberOfEmployees: "25",
            },
        });

        const mockReturning = jest.fn().mockResolvedValue([{ id: 7 }]);
        const mockWhereUpdate = jest.fn().mockReturnValue({ returning: mockReturning });
        const mockSet = jest.fn().mockReturnValue({ where: mockWhereUpdate });
        (db.update as jest.Mock).mockReturnValue({ set: mockSet });

        const response = await POST(makeRequest({}));
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json).toEqual({
            success: true,
            message: "Company settings updated.",
        });
        expect(mockSet).toHaveBeenCalledWith({
            name: "Acme Corp",
            employerpasskey: "EMP123",
            employeepasskey: "EMP456",
            numberOfEmployees: "25",
        });
        // The audit row names the keys that changed, never the passkeys.
        expect(recordAuditEvent).toHaveBeenCalledWith(
            db,
            expect.objectContaining({
                action: "settings.changed",
                targetType: "workspace",
                actorUserId: "user-123",
                detail: {
                    keys: ["name", "numberOfEmployees", "employerpasskey", "employeepasskey"],
                },
            })
        );
        const auditCalls = JSON.stringify(
            (recordAuditEvent as jest.Mock).mock.calls,
            (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)
        );
        expect(auditCalls).not.toContain("EMP123");
    });

    it("updates company settings for an admin", async () => {
        mockCtx("admin");
        (validateRequestBody as jest.Mock).mockResolvedValue({
            success: true,
            data: { name: "Acme Corp" },
        });

        const mockReturning = jest.fn().mockResolvedValue([{ id: 7 }]);
        const mockWhereUpdate = jest.fn().mockReturnValue({ returning: mockReturning });
        const mockSet = jest.fn().mockReturnValue({ where: mockWhereUpdate });
        (db.update as jest.Mock).mockReturnValue({ set: mockSet });

        const response = await POST(makeRequest({}));

        expect(response.status).toBe(200);
    });

    it("returns 401 when workspace context fails", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: false,
            response: new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
            }),
        });

        const response = await POST(makeRequest({}));

        expect(response.status).toBe(401);
        expect(validateRequestBody).not.toHaveBeenCalled();
    });

    it("returns 403 when the membership lacks settings.manage", async () => {
        mockCtx("member");
        (validateRequestBody as jest.Mock).mockResolvedValue({
            success: true,
            data: { name: "Acme Corp" },
        });

        const response = await POST(makeRequest({}));
        const json = await response.json();

        expect(response.status).toBe(403);
        expect(json.permission).toBe("settings.manage");
        expect(validateRequestBody).not.toHaveBeenCalled();
        expect(db.update).not.toHaveBeenCalled();
    });

    it("bubbles validation failure response", async () => {
        mockCtx("owner");

        const validationResponse = new Response(
            JSON.stringify({ success: false, message: "Invalid payload" }),
            { status: 400 }
        );

        (validateRequestBody as jest.Mock).mockResolvedValue({
            success: false,
            response: validationResponse,
        });

        const response = await POST(makeRequest({}));
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json).toEqual({ success: false, message: "Invalid payload" });
    });

    it("returns 404 when company record is missing", async () => {
        mockCtx("owner");
        (validateRequestBody as jest.Mock).mockResolvedValue({
            success: true,
            data: {
                name: "Acme Corp",
                employerPasskey: "EMP123",
                employeePasskey: "EMP456",
                numberOfEmployees: "15",
            },
        });

        const mockReturning = jest.fn().mockResolvedValue([]);
        const mockWhereUpdate = jest.fn().mockReturnValue({ returning: mockReturning });
        const mockSet = jest.fn().mockReturnValue({ where: mockWhereUpdate });
        (db.update as jest.Mock).mockReturnValue({ set: mockSet });

        const response = await POST(makeRequest({}));
        const json = await response.json();

        expect(response.status).toBe(404);
        expect(json).toEqual({
            success: false,
            message: "Unable to update company record.",
        });
    });
});
