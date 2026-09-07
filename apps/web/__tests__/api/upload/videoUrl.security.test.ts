/**
 * POST /api/upload/video-url — session-derived identity and SSRF guard.
 */

import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";

const mockRequireWorkspaceContext = jest.fn();

jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

jest.mock("~/server/services/folder-access", () => ({
    FOLDER_EDIT_DENIED: "You do not have edit access to this folder.",
    canEditFolder: jest.fn().mockResolvedValue(true),
}));

jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_request: Request, _config: unknown, handler: () => Promise<Response>) =>
        handler(),
}));

jest.mock("~/lib/rate-limiter", () => ({
    RateLimitPresets: { standard: {}, strict: {} },
}));

jest.mock("node:dns/promises", () => ({
    lookup: jest.fn(),
}));

jest.mock("~/server/services/document-upload", () => ({
    processVideoUrlUpload: jest.fn(),
}));

import { lookup } from "node:dns/promises";
import { POST } from "~/app/api/upload/video-url/route";
import { processVideoUrlUpload } from "~/server/services/document-upload";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

const lookupMock = lookup as jest.MockedFunction<typeof lookup>;
const processVideoUrlUploadMock = processVideoUrlUpload as jest.MockedFunction<
    typeof processVideoUrlUpload
>;

function mockAuthenticated() {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({
            authUserId: "user_session",
            userPk: BigInt(21),
            companyId: BigInt(4),
            role: "owner",
        }),
    });
}

function mockUnauthenticated() {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: false,
        response: new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        }),
    });
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
        mockAuthenticated();
        lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
        processVideoUrlUploadMock.mockResolvedValue({
            jobId: "job-1",
            document: { id: 9, url: VALID_BODY.videoUrl, title: "talk", category: "training" },
        } as never);
    });

    it("returns 401 when there is no workspace context", async () => {
        mockUnauthenticated();
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
        const response = await POST(requestFor({ ...VALID_BODY, userId: "attacker" }));

        expect(response.status).toBe(201);
        expect(processVideoUrlUploadMock).toHaveBeenCalledWith(
            expect.objectContaining({
                user: { userId: "user_session", companyId: BigInt(4) },
                videoUrl: VALID_BODY.videoUrl,
            })
        );
    });
});
