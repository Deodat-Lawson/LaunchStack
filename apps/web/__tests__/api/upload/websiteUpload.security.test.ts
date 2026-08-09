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

const lookupMock = lookup as jest.MockedFunction<typeof lookup>;
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

describe("POST /api/upload/website", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockClerk.userId = "user_session";
        mockUserLookup({ id: 11, userId: "user_session", companyId: 3n });
        resolveActiveCompanyForUserMock.mockResolvedValue(3n);
        mockInngestSend.mockResolvedValue({ ids: ["evt-1"] });
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
