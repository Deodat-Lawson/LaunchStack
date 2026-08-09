/**
 * POST /api/upload/github-repo — session-derived identity. SSRF exposure is
 * limited by design: parseGitHubUrl pins the hostname to github.com and the
 * ZIP download is pinned to api.github.com (asserted in the service tests).
 */

const mockClerk: { userId: string | null } = { userId: null };

jest.mock("@clerk/nextjs/server", () => ({
    auth: () => Promise.resolve({ userId: mockClerk.userId }),
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

import { POST } from "~/app/api/upload/github-repo/route";
import { db } from "~/server/db";
import { resolveActiveCompanyForUser } from "~/lib/active-workspace";
import { processDocumentUpload } from "~/server/services/document-upload";
import { downloadGitHubRepoZip } from "~/server/services/github-repo";
import { putFile } from "~/server/storage/vercel-blob";

const processDocumentUploadMock = processDocumentUpload as jest.MockedFunction<
    typeof processDocumentUpload
>;

function mockUserLookup(user: { id: number; userId: string; companyId: bigint } | null) {
    const where = jest.fn().mockResolvedValue(user ? [user] : []);
    const from = jest.fn().mockReturnValue({ where });
    (db.select as jest.Mock).mockReturnValue({ from });
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
        mockClerk.userId = "user_session";
        mockUserLookup({ id: 31, userId: "user_session", companyId: 6n });
        (resolveActiveCompanyForUser as jest.Mock).mockResolvedValue(6n);
        (downloadGitHubRepoZip as jest.Mock).mockResolvedValue(Buffer.from("zip"));
        (putFile as jest.Mock).mockResolvedValue({ url: "https://blob.example/repo.zip" });
        processDocumentUploadMock.mockResolvedValue({
            jobId: "job-gh",
            eventIds: ["evt"],
            storageType: "s3",
            document: { id: 5, url: "https://blob.example/repo.zip", title: "o/r", category: "code" },
            resolvedDocumentUrl: "https://blob.example/repo.zip",
        } as never);
    });

    it("returns 401 when there is no Clerk session", async () => {
        mockClerk.userId = null;
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
        const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const response = await POST(
                requestFor({ userId: "attacker", repoUrl: "https://github.com/octo/repo" })
            );

            expect(response.status).toBe(202);
            expect(processDocumentUploadMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    user: { userId: "user_session", companyId: 6n },
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
