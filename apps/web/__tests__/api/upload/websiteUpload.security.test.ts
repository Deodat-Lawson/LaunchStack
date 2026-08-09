/**
 * POST /api/upload/website — session-derived identity and SSRF guard.
 */

const mockClerk: { userId: string | null } = { userId: null };

jest.mock("@clerk/nextjs/server", () => ({
    auth: () => Promise.resolve({ userId: mockClerk.userId }),
}));

jest.mock("node:dns/promises", () => ({
    lookup: jest.fn(),
}));

const mockInngestSend = jest.fn();
jest.mock("~/server/inngest/client", () => ({
    inngest: { send: (...args: unknown[]) => mockInngestSend(...args) },
}));

jest.mock("~/server/db", () => ({
    db: { select: jest.fn() },
}));

jest.mock("~/lib/active-workspace", () => ({
    resolveActiveCompanyForUser: jest.fn(),
}));

jest.mock("~/server/services/document-upload", () => ({
    processDocumentUpload: jest.fn(),
}));

jest.mock("~/lib/storage", () => ({
    uploadFile: jest.fn(),
}));

import { lookup } from "node:dns/promises";
import { POST } from "~/app/api/upload/website/route";
import { db } from "~/server/db";
import { resolveActiveCompanyForUser } from "~/lib/active-workspace";
import { uploadFile } from "~/lib/storage";
import { processDocumentUpload } from "~/server/services/document-upload";

const lookupMock = lookup as jest.MockedFunction<typeof lookup>;
const uploadFileMock = uploadFile as jest.MockedFunction<typeof uploadFile>;
const processDocumentUploadMock = processDocumentUpload as jest.MockedFunction<
    typeof processDocumentUpload
>;
const resolveActiveCompanyForUserMock = resolveActiveCompanyForUser as jest.MockedFunction<
    typeof resolveActiveCompanyForUser
>;

function mockUserLookup(user: { id: number; userId: string; companyId: bigint } | null) {
    const where = jest.fn().mockResolvedValue(user ? [user] : []);
    const from = jest.fn().mockReturnValue({ where });
    (db.select as jest.Mock).mockReturnValue({ from });
}

function requestFor(body: Record<string, unknown>) {
    return new Request("http://localhost/api/upload/website", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

/** Minimal Response stand-in for the manual-redirect fetch loop. */
function fetchResponse(
    status: number,
    headers: Record<string, string> = {},
    html = ""
): Response {
    const lower = Object.fromEntries(
        Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
    );
    return {
        status,
        ok: status >= 200 && status < 300,
        headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
        body: undefined,
        url: "https://example.com/docs",
        arrayBuffer: () => Promise.resolve(Buffer.from(html, "utf-8").buffer),
    } as unknown as Response;
}

const originalFetch = global.fetch;
const fetchMock = jest.fn();

describe("POST /api/upload/website", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockClerk.userId = "user_session";
        mockUserLookup({ id: 11, userId: "user_session", companyId: 3n });
        resolveActiveCompanyForUserMock.mockResolvedValue(3n);
        mockInngestSend.mockResolvedValue({ ids: ["evt-1"] });
        global.fetch = fetchMock as unknown as typeof fetch;
    });

    afterAll(() => {
        global.fetch = originalFetch;
    });

    it("returns 401 when there is no Clerk session", async () => {
        mockClerk.userId = null;
        const response = await POST(
            requestFor({ userId: "user_session", url: "https://example.com" })
        );
        expect(response.status).toBe(401);
        expect(mockInngestSend).not.toHaveBeenCalled();
    });

    it("rejects a literal private-IP URL (SSRF)", async () => {
        const response = await POST(
            requestFor({ userId: "user_session", url: "http://169.254.169.254/latest/meta-data/" })
        );
        const json = await response.json();
        expect(response.status).toBe(400);
        expect(json.error).toContain("private or internal address");
        expect(lookupMock).not.toHaveBeenCalled();
        expect(mockInngestSend).not.toHaveBeenCalled();
    });

    it("rejects a hostname that resolves to a private address (SSRF), even in crawl mode", async () => {
        lookupMock.mockResolvedValue([{ address: "10.1.2.3", family: 4 }] as never);
        const response = await POST(
            requestFor({ userId: "user_session", url: "https://internal.corp.example/", crawl: true })
        );
        expect(response.status).toBe(400);
        expect(mockInngestSend).not.toHaveBeenCalled();
    });

    it("rejects a redirect chain that lands on a private address (single-page mode)", async () => {
        lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
        // Public seed URL answers with a redirect into the internal network.
        fetchMock.mockResolvedValue(
            fetchResponse(302, { Location: "http://192.168.0.10/admin" })
        );

        const response = await POST(
            requestFor({ userId: "user_session", url: "https://example.com/docs" })
        );
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.error).toContain("private or internal address");
        // The private hop itself was never fetched: only the public seed was.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(uploadFileMock).not.toHaveBeenCalled();
        expect(processDocumentUploadMock).not.toHaveBeenCalled();
    });

    it("rejects a redirect to a hex-mapped IPv6 loopback (single-page mode)", async () => {
        lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
        fetchMock.mockResolvedValue(
            fetchResponse(301, { Location: "http://[::ffff:7f00:1]/" })
        );

        const response = await POST(
            requestFor({ userId: "user_session", url: "https://example.com/docs" })
        );

        expect(response.status).toBe(400);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(processDocumentUploadMock).not.toHaveBeenCalled();
    });

    it("indexes a page that follows a public redirect chain", async () => {
        lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
        fetchMock
            .mockResolvedValueOnce(
                fetchResponse(301, { Location: "https://example.com/docs" })
            )
            .mockResolvedValueOnce(
                fetchResponse(
                    200,
                    { "Content-Type": "text/html" },
                    "<html><head><title>Docs</title></head><body>hi</body></html>"
                )
            );
        uploadFileMock.mockResolvedValue({
            url: "https://storage.example/webpage.html",
            provider: "s3",
        } as never);
        processDocumentUploadMock.mockResolvedValue({
            jobId: "job-1",
            eventIds: ["evt-1"],
            document: { id: 5 },
        } as never);

        const response = await POST(
            requestFor({ userId: "user_session", url: "https://example.com/start" })
        );
        const json = await response.json();

        expect(response.status).toBe(202);
        expect(json.success).toBe(true);
        // Both hops fetched with manual redirect handling (guard per hop).
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            "https://example.com/docs",
            expect.objectContaining({ redirect: "manual" })
        );
        expect(processDocumentUploadMock).toHaveBeenCalled();
    });

    it("dispatches a crawl with the session user, ignoring a spoofed body userId", async () => {
        const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
        try {
            lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);

            const response = await POST(
                requestFor({ userId: "attacker", url: "https://example.com/docs", crawl: true })
            );

            expect(response.status).toBe(202);
            expect(mockInngestSend).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: "website/crawl.requested",
                    data: expect.objectContaining({
                        userId: "user_session",
                        companyId: "3",
                    }),
                })
            );
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining("Ignoring body userId=attacker")
            );
        } finally {
            consoleWarnSpy.mockRestore();
        }
    });
});
