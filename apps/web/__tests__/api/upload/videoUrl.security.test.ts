/**
 * POST /api/upload/video-url — session-derived identity and SSRF guard.
 */

const mockClerk: { userId: string | null } = { userId: null };

jest.mock("@clerk/nextjs/server", () => ({
    auth: () => Promise.resolve({ userId: mockClerk.userId }),
}));

jest.mock("node:dns/promises", () => ({
    lookup: jest.fn(),
}));

jest.mock("~/server/db", () => ({
    db: { select: jest.fn() },
}));

jest.mock("~/server/services/document-upload", () => ({
    processVideoUrlUpload: jest.fn(),
}));

import { lookup } from "node:dns/promises";
import { POST } from "~/app/api/upload/video-url/route";
import { db } from "~/server/db";
import { processVideoUrlUpload } from "~/server/services/document-upload";

const lookupMock = lookup as jest.MockedFunction<typeof lookup>;
const processVideoUrlUploadMock = processVideoUrlUpload as jest.MockedFunction<
    typeof processVideoUrlUpload
>;

function mockUserLookup(user: { id: number; userId: string; companyId: bigint } | null) {
    const where = jest.fn().mockResolvedValue(user ? [user] : []);
    const from = jest.fn().mockReturnValue({ where });
    (db.select as jest.Mock).mockReturnValue({ from });
}

function requestFor(body: Record<string, unknown>) {
    return new Request("http://localhost/api/upload/video-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

const VALID_BODY = {
    userId: "user_session",
    videoUrl: "https://videos.example.com/talk.mp4",
    category: "training",
};

describe("POST /api/upload/video-url", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockClerk.userId = "user_session";
        mockUserLookup({ id: 21, userId: "user_session", companyId: 4n });
        lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
        processVideoUrlUploadMock.mockResolvedValue({
            jobId: "job-1",
            document: { id: 9, url: VALID_BODY.videoUrl, title: "talk", category: "training" },
        } as never);
    });

    it("returns 401 when there is no Clerk session", async () => {
        mockClerk.userId = null;
        const response = await POST(requestFor(VALID_BODY));
        expect(response.status).toBe(401);
        expect(processVideoUrlUploadMock).not.toHaveBeenCalled();
    });

    it("rejects a literal private-IP video URL (SSRF)", async () => {
        const response = await POST(
            requestFor({ ...VALID_BODY, videoUrl: "http://127.0.0.1:8000/internal.mp4" })
        );
        expect(response.status).toBe(400);
        expect(processVideoUrlUploadMock).not.toHaveBeenCalled();
    });

    it("rejects a video URL resolving to a private address (SSRF)", async () => {
        lookupMock.mockResolvedValue([{ address: "192.168.0.9", family: 4 }] as never);
        const response = await POST(requestFor(VALID_BODY));
        expect(response.status).toBe(400);
        expect(processVideoUrlUploadMock).not.toHaveBeenCalled();
    });

    it("processes a public URL with the session user, ignoring a spoofed body userId", async () => {
        const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const response = await POST(requestFor({ ...VALID_BODY, userId: "attacker" }));

            expect(response.status).toBe(201);
            expect(processVideoUrlUploadMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    user: { userId: "user_session", companyId: 4n },
                    videoUrl: VALID_BODY.videoUrl,
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
