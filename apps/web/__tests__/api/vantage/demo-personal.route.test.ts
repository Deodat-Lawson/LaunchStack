/** @jest-environment node */
import { NextRequest } from "next/server";
import { VantageError } from "@launchstack/pipelines/vantage";
import { ContextPortErrorV0 } from "@launchstack/pipelines/vantage/context-v0";
const mockGate = jest.fn();
const mockService = { personalContext: jest.fn(), updatePersonal: jest.fn() };
jest.mock("~/lib/require-workspace-context", () => ({ requireWorkspaceContext: jest.fn() }));
jest.mock("~/server/vantage/demo-service", () => ({
    assertVantageContextDemoEnabled: () => mockGate(),
    createVantageContextDemoService: () => mockService,
}));
import { GET, PATCH } from "~/app/api/vantage/demo/personal/route";
const request = (method = "GET", body?: unknown, query = "") =>
    new NextRequest(`http://localhost:3105/api/vantage/demo/personal${query}`, {
        method,
        ...(body === undefined
            ? {}
            : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    });
const roles = {
    operation: "roles",
    roleIds: ["founder", "engineering"],
    primaryRoleId: "engineering",
    expectedRevision: 0,
    week: "2026-10-12",
};
describe("development-only authenticated Joseph personal routes", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGate.mockReset();
        mockService.personalContext.mockResolvedValue({
            ready: false,
            persistence: "server-process-memory",
        });
        mockService.updatePersonal.mockResolvedValue({ ready: false });
    });
    it("checks the explicit demo gate before reading or mutating personal state", async () => {
        mockGate.mockImplementation(() => {
            throw new VantageError("Not found.", 404, "not_found");
        });
        expect((await GET(request())).status).toBe(404);
        expect((await PATCH(request("PATCH", roles))).status).toBe(404);
        expect(mockService.personalContext).not.toHaveBeenCalled();
        expect(mockService.updatePersonal).not.toHaveBeenCalled();
    });
    it("forwards only a reporting week, never a client identity selector", async () => {
        const response = await GET(
            request("GET", undefined, "?week=2026-10-12&companyId=other&principalRef=another")
        );
        expect(response.status).toBe(200);
        expect(mockService.personalContext).toHaveBeenCalledWith("2026-10-12");
        expect(await response.json()).toMatchObject({
            ready: false,
            persistence: "server-process-memory",
        });
        expect((await GET(request("GET", undefined, "?week=invalid"))).status).toBe(400);
    });
    it("preserves multi-role and primary-preference changes with an expected revision", async () => {
        expect((await PATCH(request("PATCH", roles))).status).toBe(200);
        expect(mockService.updatePersonal).toHaveBeenCalledWith("2026-10-12", {
            operation: "roles",
            roleIds: ["founder", "engineering"],
            primaryRoleId: "engineering",
            expectedRevision: 0,
        });
    });
    it("passes exact canonical document IDs for star and removal requests", async () => {
        for (const starred of [true, false])
            expect(
                (
                    await PATCH(
                        request("PATCH", {
                            operation: "star",
                            documentId: "workspace-document/123",
                            starred,
                            expectedRevision: 2,
                        })
                    )
                ).status
            ).toBe(200);
        expect(mockService.updatePersonal).toHaveBeenLastCalledWith(undefined, {
            operation: "star",
            documentId: "workspace-document/123",
            starred: false,
            expectedRevision: 2,
        });
    });
    it.each([
        { ...roles, companyId: "foreign" },
        { ...roles, principalRef: "foreign" },
        { ...roles, expectedRevision: -1 },
        { ...roles, expectedRevision: 0.5 },
        { ...roles, roleIds: Array(17).fill("founder") },
        { operation: "star", documentId: "123", starred: true, expectedRevision: 0 },
        {
            operation: "star",
            documentId: "workspace-document/123",
            starred: true,
            expectedRevision: 0,
            version: "forged",
        },
    ])("rejects malformed or extra authority/version fields %#", async body => {
        expect((await PATCH(request("PATCH", body))).status).toBe(400);
        expect(mockService.updatePersonal).not.toHaveBeenCalled();
    });
    it("rejects invalid JSON and nonobject request bodies", async () => {
        expect((await PATCH(request("PATCH", []))).status).toBe(400);
        const malformed = new NextRequest("http://localhost:3105/api/vantage/demo/personal", {
            method: "PATCH",
            body: "{invalid",
            headers: { "content-type": "application/json" },
        });
        expect((await PATCH(malformed)).status).toBe(400);
        expect(mockService.updatePersonal).not.toHaveBeenCalled();
    });
    it.each([400, 403, 409, 503] as const)(
        "sanitizes provider error details while preserving status%s",
        async status => {
            mockService.updatePersonal.mockRejectedValue(
                new ContextPortErrorV0("PRIVATE_SOURCE_OR_SQL_MARKER", status)
            );
            const response = await PATCH(request("PATCH", roles));
            expect(response.status).toBe(status);
            expect(JSON.stringify(await response.json())).not.toContain(
                "PRIVATE_SOURCE_OR_SQL_MARKER"
            );
        }
    );
    it("preserves unauthenticated denial from trusted server context", async () => {
        mockService.personalContext.mockRejectedValue(
            new VantageError("Sign in.", 401, "unauthorized")
        );
        expect((await GET(request())).status).toBe(401);
    });
});
