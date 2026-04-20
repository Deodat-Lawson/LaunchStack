import {
    parseGitHubUrl,
    downloadGitHubRepoZip,
    GitHubRepoNotFoundError,
    GitHubAuthError,
    GitHubRateLimitError,
} from "../github-repo";

// ---------------------------------------------------------------------------
// parseGitHubUrl
// ---------------------------------------------------------------------------

describe("parseGitHubUrl", () => {
    it("parses a standard GitHub URL", () => {
        const result = parseGitHubUrl("https://github.com/vercel/next.js");
        expect(result).toEqual({ owner: "vercel", repo: "next.js" });
    });

    it("handles trailing slash", () => {
        const result = parseGitHubUrl("https://github.com/vercel/next.js/");
        expect(result).toEqual({ owner: "vercel", repo: "next.js" });
    });

    it("strips .git suffix", () => {
        const result = parseGitHubUrl("https://github.com/vercel/next.js.git");
        expect(result).toEqual({ owner: "vercel", repo: "next.js" });
    });

    it("handles extra path segments (/tree/main)", () => {
        const result = parseGitHubUrl(
            "https://github.com/vercel/next.js/tree/canary",
        );
        expect(result).toEqual({ owner: "vercel", repo: "next.js" });
    });

    it("handles /blob/main/README.md path", () => {
        const result = parseGitHubUrl(
            "https://github.com/vercel/next.js/blob/main/README.md",
        );
        expect(result).toEqual({ owner: "vercel", repo: "next.js" });
    });

    it("handles http (no S) URL", () => {
        const result = parseGitHubUrl("http://github.com/owner/repo");
        expect(result).toEqual({ owner: "owner", repo: "repo" });
    });

    it("handles www.github.com", () => {
        const result = parseGitHubUrl("https://www.github.com/owner/repo");
        expect(result).toEqual({ owner: "owner", repo: "repo" });
    });

    it("throws for non-GitHub URL", () => {
        expect(() => parseGitHubUrl("https://gitlab.com/owner/repo")).toThrow(
            "Not a GitHub URL",
        );
    });

    it("throws for URL with missing repo component", () => {
        expect(() => parseGitHubUrl("https://github.com/owner")).toThrow(
            "Invalid GitHub repository URL",
        );
    });

    it("throws for completely invalid URL", () => {
        expect(() => parseGitHubUrl("not-a-url")).toThrow("Invalid URL");
    });

    it("throws for empty string", () => {
        expect(() => parseGitHubUrl("")).toThrow("Invalid URL");
    });
});

// ---------------------------------------------------------------------------
// downloadGitHubRepoZip
// ---------------------------------------------------------------------------

describe("downloadGitHubRepoZip", () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
    });

    function mockFetch(status: number, body?: Buffer | string, headers?: Record<string, string>) {
        const responseHeaders = new Headers(headers ?? {});
        global.fetch = jest.fn().mockResolvedValue({
            ok: status >= 200 && status < 300,
            status,
            statusText: status === 200 ? "OK" : "Error",
            headers: responseHeaders,
            arrayBuffer: async () => {
                const b = body ?? Buffer.alloc(200);
                return typeof b === "string" ? Buffer.from(b).buffer : b.buffer;
            },
        });
    }

    it("returns a buffer on success", async () => {
        const fakeZip = Buffer.alloc(1024, 0x50); // 1KB of data
        mockFetch(200, fakeZip);

        const result = await downloadGitHubRepoZip("owner", "repo");
        expect(Buffer.isBuffer(result)).toBe(true);
        expect(result.length).toBe(1024);

        // Verify the fetch was called with correct URL
        expect(global.fetch).toHaveBeenCalledWith(
            "https://api.github.com/repos/owner/repo/zipball/",
            expect.objectContaining({
                headers: expect.objectContaining({
                    Accept: "application/vnd.github+json",
                    "User-Agent": "Launchstack/1.0",
                }),
            }),
        );
    });

    it("includes branch in the URL when provided", async () => {
        mockFetch(200, Buffer.alloc(200));

        await downloadGitHubRepoZip("owner", "repo", "develop");

        expect(global.fetch).toHaveBeenCalledWith(
            "https://api.github.com/repos/owner/repo/zipball/develop",
            expect.anything(),
        );
    });

    it("includes Authorization header when token is provided", async () => {
        mockFetch(200, Buffer.alloc(200));

        await downloadGitHubRepoZip("owner", "repo", undefined, "ghp_token123");

        expect(global.fetch).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                headers: expect.objectContaining({
                    Authorization: "Bearer ghp_token123",
                }),
            }),
        );
    });

    it("throws GitHubRepoNotFoundError on 404", async () => {
        mockFetch(404);

        await expect(
            downloadGitHubRepoZip("owner", "nonexistent"),
        ).rejects.toThrow(GitHubRepoNotFoundError);
    });

    it("throws GitHubAuthError on 401 without token", async () => {
        mockFetch(401);

        await expect(
            downloadGitHubRepoZip("owner", "private-repo"),
        ).rejects.toThrow(GitHubAuthError);

        try {
            await downloadGitHubRepoZip("owner", "private-repo");
        } catch (e) {
            expect((e as Error).message).toContain("personal access token");
        }
    });

    it("throws GitHubAuthError on 403 with token (permissions issue)", async () => {
        mockFetch(403);

        await expect(
            downloadGitHubRepoZip("owner", "repo", undefined, "ghp_expired"),
        ).rejects.toThrow(GitHubAuthError);

        try {
            await downloadGitHubRepoZip("owner", "repo", undefined, "ghp_expired");
        } catch (e) {
            expect((e as Error).message).toContain("lack permissions");
        }
    });

    it("throws GitHubRateLimitError on 429", async () => {
        mockFetch(429, undefined, { "retry-after": "60" });

        await expect(
            downloadGitHubRepoZip("owner", "repo"),
        ).rejects.toThrow(GitHubRateLimitError);
    });

    it("throws on empty buffer (< 100 bytes)", async () => {
        mockFetch(200, Buffer.alloc(50));

        await expect(
            downloadGitHubRepoZip("owner", "repo"),
        ).rejects.toThrow("appears empty");
    });

    it("throws on oversized Content-Length header", async () => {
        mockFetch(200, Buffer.alloc(200), {
            "content-length": String(600 * 1024 * 1024),
        });

        await expect(
            downloadGitHubRepoZip("owner", "repo"),
        ).rejects.toThrow("too large");
    });
});
