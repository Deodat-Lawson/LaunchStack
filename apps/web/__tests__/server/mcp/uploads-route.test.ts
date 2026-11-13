/**
 * PUT /api/mcp/uploads/<token>: the route's own job is the shape of the token,
 * the MCP switch, and turning staging's refusals into statuses a CLI can act
 * on. Staging itself (single use, expiry, the cap) is covered against a real
 * database in assistant-documents.integration.test.ts.
 */
import { PUT, POST } from "~/app/api/mcp/uploads/[token]/route";

jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_request: Request, _config: unknown, run: () => Promise<Response>) => run(),
}));

const mockEnabled = { value: true };
jest.mock("~/server/mcp/config", () => ({ isMcpEnabled: () => mockEnabled.value }));

jest.mock("~/server/mcp/staging", () => {
    class StagingError extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    }
    return { StagingError, MAX_STAGED_BYTES: 128 * 1024 * 1024, receiveUpload: jest.fn() };
});

const staging = jest.requireMock<{
    receiveUpload: jest.Mock;
    StagingError: new (code: string, message: string) => Error;
}>("~/server/mcp/staging");

const TOKEN = "a".repeat(43);

function put(token: string, body = "%PDF", headers: Record<string, string> = {}) {
    return PUT(
        new Request(`http://localhost/api/mcp/uploads/${token}`, { method: "PUT", body, headers }),
        { params: Promise.resolve({ token }) }
    );
}

beforeEach(() => {
    staging.receiveUpload.mockReset();
    mockEnabled.value = true;
});

it("stores the body and answers 201 with the upload id", async () => {
    staging.receiveUpload.mockResolvedValue({ id: "upload_x", filename: "deck.pdf", sizeBytes: 4 });
    const response = await put(TOKEN, "%PDF", { "content-length": "4" });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ ok: true, uploadId: "upload_x", sizeBytes: 4 });
    expect(staging.receiveUpload).toHaveBeenCalledWith(TOKEN, expect.anything(), 4);
});

it("accepts POST the same way (curl --data-binary)", async () => {
    staging.receiveUpload.mockResolvedValue({ id: "upload_x", filename: "d.pdf", sizeBytes: 1 });
    const response = await POST(
        new Request(`http://localhost/api/mcp/uploads/${TOKEN}`, { method: "POST", body: "x" }),
        { params: Promise.resolve({ token: TOKEN }) }
    );
    expect(response.status).toBe(201);
});

it("answers 404 for a token of the wrong shape without touching storage", async () => {
    for (const token of [
        "short",
        "has space and more characters here xx",
        "../../etc/passwd-aaaaaaaaaaaaaaa",
    ]) {
        expect((await put(token)).status).toBe(404);
    }
    expect(staging.receiveUpload).not.toHaveBeenCalled();
});

it("answers 404 when the MCP server is off", async () => {
    mockEnabled.value = false;
    expect((await put(TOKEN)).status).toBe(404);
    expect(staging.receiveUpload).not.toHaveBeenCalled();
});

it.each([
    ["gone", 404],
    ["too_large", 413],
    ["empty", 400],
    ["expired", 410],
])("maps a %s refusal to %i with its message", async (code, status) => {
    staging.receiveUpload.mockRejectedValue(new staging.StagingError(code, `refused: ${code}`));
    const response = await put(TOKEN);
    expect(response.status).toBe(status);
    const body = (await response.json()) as { error: string; code: string; maxBytes?: number };
    expect(body).toMatchObject({ error: `refused: ${code}`, code });
    if (code === "too_large") expect(body.maxBytes).toBe(128 * 1024 * 1024);
});

it("hides an unexpected failure behind a generic 500", async () => {
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);
    staging.receiveUpload.mockRejectedValue(new Error("s3 connection refused at 10.0.0.3"));
    const response = await put(TOKEN);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("10.0.0.3");
    logged.mockRestore();
});
