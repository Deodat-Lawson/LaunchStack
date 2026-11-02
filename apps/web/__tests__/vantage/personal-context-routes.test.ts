/** @jest-environment node */
import { NextResponse } from "next/server";
import { ContextPortErrorV0 } from "@launchstack/pipelines/vantage/context-v0";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import {
    loadPersonalContext,
    savePersonalRoles,
    setPersonalStar,
} from "~/server/vantage/personal-context";
import { GET } from "~/app/api/vantage/context-v0/personal/route";
import { PATCH } from "~/app/api/vantage/context-v0/roles/route";
import { PUT } from "~/app/api/vantage/context-v0/stars/[documentId]/route";
import { POST } from "~/app/api/vantage/context-v0/snapshot/route";

jest.mock("~/lib/require-workspace-context", () => ({ requireWorkspacePermission: jest.fn() }));
jest.mock("~/server/vantage/personal-context", () => ({
    loadPersonalContext: jest.fn(),
    savePersonalRoles: jest.fn(),
    setPersonalStar: jest.fn(),
}));
const actor = { companyId: 1n, userPk: 7n, authUserId: "session-user" };
function request(path: string, method: string, value: unknown, origin = "http://localhost:3000") {
    return new Request(`http://localhost:3000/api/vantage/context-v0/${path}`, {
        method,
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify(value),
    });
}
beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(requireWorkspacePermission).mockResolvedValue({
        success: true,
        data: actor,
    } as never);
});
it("returns 401 without reading data when signed out", async () => {
    jest.mocked(requireWorkspacePermission).mockResolvedValue({
        success: false,
        response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    expect((await GET()).status).toBe(401);
    expect(loadPersonalContext).not.toHaveBeenCalled();
});
it("uses the server actor and prevents shared caching", async () => {
    jest.mocked(loadPersonalContext).mockResolvedValue({ ready: true } as never);
    const response = await GET();
    expect(requireWorkspacePermission).toHaveBeenCalledWith("documents.read");
    expect(loadPersonalContext).toHaveBeenCalledWith(actor);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ ready: true });
});
it("rejects a cross-origin mutation", async () => {
    const response = await PATCH(request("roles", "PATCH", {}, "https://outside.example"));
    expect(response.status).toBe(403);
    expect(savePersonalRoles).not.toHaveBeenCalled();
});
it("accepts the configured public origin behind a container port mapping", async () => {
    const previous = process.env.BETTER_AUTH_URL;
    process.env.BETTER_AUTH_URL = "https://app.example.test";
    try {
        jest.mocked(savePersonalRoles).mockResolvedValue({ revision: 1 });
        const response = await PATCH(
            new Request("http://localhost:3000/api/vantage/context-v0/roles", {
                method: "PATCH",
                headers: { "Content-Type": "application/json", Origin: "https://app.example.test" },
                body: JSON.stringify({ roleIds: ["founder"], expectedRevision: 0 }),
            })
        );
        expect(response.status).toBe(200);
        expect(savePersonalRoles).toHaveBeenCalled();
    } finally {
        if (previous === undefined) delete process.env.BETTER_AUTH_URL;
        else process.env.BETTER_AUTH_URL = previous;
    }
});
it("rejects malformed JSON before mutation", async () => {
    const response = await PATCH(
        new Request("http://localhost:3000/api/vantage/context-v0/roles", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: "{",
        })
    );
    expect(response.status).toBe(400);
    expect(savePersonalRoles).not.toHaveBeenCalled();
});
it("passes a scoped star change and maps revision conflicts", async () => {
    jest.mocked(setPersonalStar).mockRejectedValue(
        new ContextPortErrorV0("Reload before saving.", 409)
    );
    const response = await PUT(request("stars/12", "PUT", { starred: true, expectedRevision: 2 }), {
        params: Promise.resolve({ documentId: "12" }),
    });
    expect(response.status).toBe(409);
    expect(setPersonalStar).toHaveBeenCalledWith(actor, "12", {
        starred: true,
        expectedRevision: 2,
    });
});
it("returns incomplete snapshot coverage as 409 rather than a wrapped response", async () => {
    jest.mocked(loadPersonalContext).mockResolvedValue({
        snapshot: null,
        diagnostics: { coverage: { missing: [] } },
    } as never);
    const response = await POST(request("snapshot", "POST", { expectedRevision: 3 }));
    expect(response.status).toBe(409);
    expect((await response.json()).diagnostics).toEqual({ coverage: { missing: [] } });
    expect(loadPersonalContext).toHaveBeenCalledWith(actor, undefined, 3);
});
it("rejects client-supplied actor scope on the snapshot endpoint", async () => {
    const response = await POST(
        request("snapshot", "POST", { expectedRevision: 3, companyId: "other" })
    );
    expect(response.status).toBe(400);
    expect(loadPersonalContext).not.toHaveBeenCalled();
});
it("returns the complete personal snapshot", async () => {
    const snapshot = { id: "snapshot", revision: 3, sources: [] };
    jest.mocked(loadPersonalContext).mockResolvedValue({ snapshot } as never);
    const response = await POST(request("snapshot", "POST", { expectedRevision: 3 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(snapshot);
});
it("hides driver errors and sensitive SQL parameters", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(loadPersonalContext).mockRejectedValue(new Error("secret SQL document content"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
    expect(log).toHaveBeenCalledWith("[vantage-personal-context] Request failed.");
    log.mockRestore();
});
