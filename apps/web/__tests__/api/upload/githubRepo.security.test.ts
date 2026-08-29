/**
 * POST /api/upload/github-repo — session-derived identity. SSRF exposure is
 * limited by design: parseGitHubUrl pins the hostname to github.com and the
 * ZIP download is pinned to api.github.com (asserted in the service tests).
 */

const mockRequireWorkspaceContext = jest.fn();

jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspaceContext: () => mockRequireWorkspaceContext(),
}));

jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_request: Request, _config: unknown, handler: () => Promise<Response>) =>
        handler(),
}));

jest.mock("~/lib/rate-limiter", () => ({
    RateLimitPresets: { standard: {}, strict: {} },
}));

jest.mock("~/server/services/document-upload", () => ({
    processDocumentUpload: jest.fn(),
}));

jest.mock("~/server/services/github-repo", () => {
    const actual = jest.requireActual("~/server/services/github-repo");
    return {
        ...actual,
        downloadGitHubRepoZip: jest.fn(),
    };
});

jest.mock("~/server/storage/vercel-blob", () => ({
    putFile: jest.fn(),
}));

// The route falls back to the workspace's GitHub connection when no token is
// pasted; mocked to "nothing connected" so the fallback chain ends at the
// request-supplied token, as before connections existed.
const mockGetCompanyAccessToken = jest.fn().mockResolvedValue(null);
jest.mock("~/server/services/connectors/connection-store", () => ({
    getCompanyAccessToken: (...args: unknown[]) => mockGetCompanyAccessToken(...args),
}));

import { POST } from "~/app/api/upload/github-repo/route";
import { processDocumentUpload } from "~/server/services/document-upload";
import { downloadGitHubRepoZip } from "~/server/services/github-repo";
import { putFile } from "~/server/storage/vercel-blob";

const processDocumentUploadMock = processDocumentUpload as jest.MockedFunction<
    typeof processDocumentUpload
>;

function mockAuthenticated() {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: {
            authUserId: "user_session",
            userPk: BigInt(31),
            companyId: BigInt(6),
            role: "owner",
            status: "verified",
        },
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
    return new Request("http://localhost/api/upload/github-repo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

describe("POST /api/upload/github-repo", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAuthenticated();
        (downloadGitHubRepoZip as jest.Mock).mockResolvedValue(Buffer.from("zip"));
        (putFile as jest.Mock).mockResolvedValue({ url: "https://blob.example/repo.zip" });
        processDocumentUploadMock.mockResolvedValue({
            jobId: "job-gh",
            eventIds: ["evt"],
            storageType: "s3",
            document: {
                id: 5,
                url: "https://blob.example/repo.zip",
                title: "o/r",
                category: "code",
            },
            resolvedDocumentUrl: "https://blob.example/repo.zip",
        } as never);
    });

    it("returns 401 when there is no workspace context", async () => {
        mockUnauthenticated();
        const response = await POST(
            requestFor({ userId: "user_session", repoUrl: "https://github.com/o/r" })
        );
        expect(response.status).toBe(401);
        expect(processDocumentUploadMock).not.toHaveBeenCalled();
    });

    it("rejects non-GitHub hostnames", async () => {
        const response = await POST(
            requestFor({ userId: "user_session", repoUrl: "https://evil.example.com/o/r" })
        );
        expect(response.status).toBe(400);
        expect(downloadGitHubRepoZip).not.toHaveBeenCalled();
    });

    it("uses the session user, ignoring a spoofed body userId", async () => {
        const response = await POST(
            requestFor({ userId: "attacker", repoUrl: "https://github.com/octo/repo" })
        );

        expect(response.status).toBe(202);
        expect(processDocumentUploadMock).toHaveBeenCalledWith(
            expect.objectContaining({
                user: { userId: "user_session", companyId: BigInt(6) },
            })
        );
    });
});
