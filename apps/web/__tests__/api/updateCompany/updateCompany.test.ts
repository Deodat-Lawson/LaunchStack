import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";

import { POST } from "~/app/api/updateCompany/route";
import { UpdateCompanySchema, validateRequestBody } from "~/lib/validation";
import { db } from "~/server/db/index";
import { recordAuditEvent } from "~/lib/authz/audit";
import {
    getCompanyCredentialsPlaintext,
    getCompanyReindexState,
    upsertCompanyCredentials,
} from "@launchstack/llm/embeddings";
import { validateEmbeddingCredentials } from "~/lib/ai/validate-credentials";
import { inngest } from "~/server/inngest/client";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn();
const mockIsCloud = jest.fn(() => false);

jest.mock("~/server/deployment", () => ({ isCloudDeployment: () => mockIsCloud() }));

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

describe("POST /api/updateCompany: the embeddings key and its endpoint URL", () => {
    const makeRequest = (query = "") =>
        new Request(`http://localhost/api/updateCompany${query}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
        });

    const stored = (openAIApiKey: string | null, openAIBaseUrl: string | null) =>
        (getCompanyCredentialsPlaintext as jest.Mock).mockResolvedValue({
            openAIApiKey,
            openAIBaseUrl,
            huggingFaceApiKey: null,
            ollamaBaseUrl: null,
            ollamaModel: null,
        });

    const body = (data: Record<string, unknown>) =>
        (validateRequestBody as jest.Mock).mockResolvedValue({
            success: true,
            data: { name: "Acme Corp", numberOfEmployees: "0", ...data },
        });

    beforeEach(() => {
        jest.clearAllMocks();
        mockIsCloud.mockReturnValue(false);
        mockCtx("owner");
        stored(null, null);
        const returning = jest.fn().mockResolvedValue([{ id: 7 }]);
        const where = jest.fn().mockReturnValue({ returning });
        (db.update as jest.Mock).mockReturnValue({ set: jest.fn().mockReturnValue({ where }) });
    });

    async function expectRefused(code: string, message: RegExp) {
        const response = await POST(makeRequest());
        const json = (await response.json()) as { success: boolean; code: string; message: string };
        expect(response.status).toBe(400);
        expect(json).toMatchObject({ success: false, code });
        expect(json.message).toMatch(message);
        // Nothing written, nothing scheduled.
        expect(upsertCompanyCredentials).not.toHaveBeenCalled();
        expect(db.update).not.toHaveBeenCalled();
        expect(inngest.send).not.toHaveBeenCalled();
    }

    it("refuses a new key with no URL in the request or stored", async () => {
        body({ embeddingOpenAIApiKey: "sk-new-key" });

        await expectRefused("EMBEDDING_ENDPOINT_REQUIRED", /endpoint URL this key belongs to/);
    });

    it("refuses before an index change can schedule a reindex", async () => {
        body({ embeddingOpenAIApiKey: "sk-new-key", embeddingIndexKey: "legacy-openai-1536" });

        await expectRefused("EMBEDDING_ENDPOINT_REQUIRED", /endpoint URL/);
        expect(getCompanyReindexState).not.toHaveBeenCalled();
    });

    it("saves a new key with its URL, normalized", async () => {
        body({
            embeddingOpenAIApiKey: "sk-new-key",
            embeddingOpenAIBaseUrl: "https://API.openai.com/v1/",
        });

        const response = await POST(makeRequest());

        expect(response.status).toBe(200);
        expect(upsertCompanyCredentials).toHaveBeenCalledWith(7, {
            openAIApiKey: "sk-new-key",
            openAIBaseUrl: "https://api.openai.com/v1",
        });
        const auditKeys = (recordAuditEvent as jest.Mock).mock.calls[0][1].detail.keys;
        expect(auditKeys).toEqual(expect.arrayContaining(["openAIApiKey", "openAIBaseUrl"]));
    });

    it("saves the key and URL alone, without the company's name, leaving the row untouched", async () => {
        // What Bring your own keys sends: credentials and nothing else.
        (validateRequestBody as jest.Mock).mockResolvedValue({
            success: true,
            data: {
                embeddingOpenAIApiKey: "sk-new-key",
                embeddingOpenAIBaseUrl: "https://api.openai.com/v1",
            },
        });

        const response = await POST(makeRequest());

        expect(response.status).toBe(200);
        expect(upsertCompanyCredentials).toHaveBeenCalledWith(7, {
            openAIApiKey: "sk-new-key",
            openAIBaseUrl: "https://api.openai.com/v1",
        });
        expect(db.update).not.toHaveBeenCalled();
        const auditKeys = (recordAuditEvent as jest.Mock).mock.calls[0][1].detail.keys;
        expect(auditKeys).toEqual(["openAIApiKey", "openAIBaseUrl"]);
    });

    it("pairs a new key with the URL already stored", async () => {
        stored("sk-old-key", "https://embeddings.example/v1");
        body({ embeddingOpenAIApiKey: "sk-new-key" });

        const response = await POST(makeRequest());

        expect(response.status).toBe(200);
        expect(upsertCompanyCredentials).toHaveBeenCalledWith(7, { openAIApiKey: "sk-new-key" });
    });

    it("refuses moving a stored key to a new URL without re-entering it", async () => {
        stored("sk-old-key", "https://embeddings.example/v1");
        body({ embeddingOpenAIBaseUrl: "https://other.example/v1" });

        await expectRefused("EMBEDDING_KEY_REQUIRED", /enter the API key for the new address/);
    });

    it("refuses giving a stored key with no URL an address without re-entering it", async () => {
        stored("sk-old-key", null);
        body({ embeddingOpenAIBaseUrl: "https://other.example/v1" });

        await expectRefused("EMBEDDING_KEY_REQUIRED", /enter the API key/);
    });

    it("refuses removing the URL from under a stored key", async () => {
        stored("sk-old-key", "https://embeddings.example/v1");
        body({ embeddingOpenAIBaseUrl: null });

        await expectRefused("EMBEDDING_ENDPOINT_REQUIRED", /needs its endpoint URL/);
    });

    it("accepts the same URL resent with no key", async () => {
        stored("sk-old-key", "https://embeddings.example/v1");
        body({ embeddingOpenAIBaseUrl: "https://embeddings.example/v1/" });

        expect((await POST(makeRequest())).status).toBe(200);
    });

    it("accepts a new URL with the key re-entered", async () => {
        stored("sk-old-key", "https://embeddings.example/v1");
        body({
            embeddingOpenAIApiKey: "sk-new-key",
            embeddingOpenAIBaseUrl: "https://other.example/v1",
        });

        expect((await POST(makeRequest())).status).toBe(200);
        expect(upsertCompanyCredentials).toHaveBeenCalledWith(7, {
            openAIApiKey: "sk-new-key",
            openAIBaseUrl: "https://other.example/v1",
        });
    });

    it("accepts a URL alone when no key is stored", async () => {
        body({ embeddingOpenAIBaseUrl: "https://embeddings.example/v1" });

        expect((await POST(makeRequest())).status).toBe(200);
    });

    it("accepts clearing the key and the URL together", async () => {
        stored("sk-old-key", "https://embeddings.example/v1");
        body({ embeddingOpenAIApiKey: null, embeddingOpenAIBaseUrl: null });

        expect((await POST(makeRequest())).status).toBe(200);
        expect(upsertCompanyCredentials).toHaveBeenCalledWith(7, {
            openAIApiKey: null,
            openAIBaseUrl: null,
        });
    });

    it("hosted: refuses a private address", async () => {
        mockIsCloud.mockReturnValue(true);
        body({
            embeddingOpenAIApiKey: "sk-new-key",
            embeddingOpenAIBaseUrl: "https://10.0.0.5/v1",
        });

        await expectRefused("INVALID_EMBEDDING_ENDPOINT", /private network/);
    });

    it("hosted: refuses plain http", async () => {
        mockIsCloud.mockReturnValue(true);
        body({
            embeddingOpenAIApiKey: "sk-new-key",
            embeddingOpenAIBaseUrl: "http://embeddings.example/v1",
        });

        await expectRefused("INVALID_EMBEDDING_ENDPOINT", /https:\/\//);
    });

    it("self-hosted: allows a server on the local network", async () => {
        body({
            embeddingOpenAIApiKey: "sk-new-key",
            embeddingOpenAIBaseUrl: "http://10.0.0.5:8000/v1",
        });

        expect((await POST(makeRequest())).status).toBe(200);
        expect(upsertCompanyCredentials).toHaveBeenCalledWith(7, {
            openAIApiKey: "sk-new-key",
            openAIBaseUrl: "http://10.0.0.5:8000/v1",
        });
    });

    it("refuses an address that isn't one", async () => {
        body({ embeddingOpenAIApiKey: "sk-new-key", embeddingOpenAIBaseUrl: "not a url" });

        await expectRefused("INVALID_EMBEDDING_ENDPOINT", /isn't a web address/);
    });

    it("?validate=true test-embeds against the URL being saved", async () => {
        (validateEmbeddingCredentials as jest.Mock).mockResolvedValue({ ok: true });
        body({
            embeddingIndexKey: undefined,
            embeddingOpenAIApiKey: "sk-new-key",
            embeddingOpenAIBaseUrl: "https://api.openai.com/v1",
        });
        const select = jest.fn().mockReturnValue({
            from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
        });
        (db.select as jest.Mock).mockImplementation(select);

        const response = await POST(makeRequest("?validate=true"));

        expect(response.status).toBe(200);
        expect(validateEmbeddingCredentials).toHaveBeenCalledWith(
            undefined,
            expect.objectContaining({
                openAIApiKey: "sk-new-key",
                openAIBaseUrl: "https://api.openai.com/v1",
            })
        );
    });

    it("?validate=true falls back to the stored URL when the request has none", async () => {
        (validateEmbeddingCredentials as jest.Mock).mockResolvedValue({ ok: true });
        stored("sk-old-key", "https://embeddings.example/v1");
        body({ embeddingIndexKey: "legacy-openai-1536", embeddingOpenAIApiKey: "sk-new-key" });
        (getCompanyReindexState as jest.Mock).mockResolvedValue({
            activeIndexKey: "legacy-openai-1536",
            status: "STABLE",
        });

        const response = await POST(makeRequest("?validate=true"));

        expect(response.status).toBe(200);
        expect(validateEmbeddingCredentials).toHaveBeenCalledWith(
            "legacy-openai-1536",
            expect.objectContaining({
                openAIApiKey: "sk-new-key",
                openAIBaseUrl: "https://embeddings.example/v1",
            })
        );
    });
});

describe("UpdateCompanySchema: name", () => {
    it("is optional, so credentials can be saved alone", () => {
        const parsed = UpdateCompanySchema.parse({ embeddingOpenAIApiKey: "sk-new-key" });
        expect(parsed.name).toBeUndefined();
        expect(parsed.embeddingOpenAIApiKey).toBe("sk-new-key");
    });

    it("still refuses an empty one", () => {
        expect(() => UpdateCompanySchema.parse({ name: "" })).toThrow("Company name is required");
    });
});

describe("UpdateCompanySchema: embeddingOpenAIBaseUrl", () => {
    it.each([
        [undefined, undefined],
        [null, null],
        ["", null],
        ["   ", null],
        ["  https://api.openai.com/v1  ", "https://api.openai.com/v1"],
    ])("%p parses to %p", (input, expected) => {
        const parsed = UpdateCompanySchema.parse({ name: "Acme", embeddingOpenAIBaseUrl: input });
        expect(parsed.embeddingOpenAIBaseUrl).toBe(expected);
    });
});
