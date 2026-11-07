/**
 * GitHub Repo Service
 *
 * Parses GitHub repository URLs and downloads repo archives as ZIP buffers.
 * The resulting ZIP is designed to be fed directly into the existing
 * document processing pipeline (processDocument Inngest function) which
 * already handles ZIP extraction, file filtering, and ingestion.
 */

import type { Copy } from "~/i18n/copy";
import { englishCopy } from "~/i18n/translate";

const MAX_ZIP_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB

// ---------------------------------------------------------------------------
// Custom error classes
// ---------------------------------------------------------------------------

/**
 * A reason the repository can't be indexed, for the person who asked:
 * `message` is the English, `copy` its key (`upload.server.github`) for the
 * route to word in the reader's language.
 */
export class GitHubRepoError extends Error {
    readonly copy: Copy;

    constructor(copy: Copy) {
        super(englishCopy(copy));
        this.name = "GitHubRepoError";
        this.copy = copy;
    }
}

export class GitHubRepoNotFoundError extends GitHubRepoError {
    constructor(owner: string, repo: string) {
        super({ key: "upload.server.github.repoNotFound", values: { repo: `${owner}/${repo}` } });
        this.name = "GitHubRepoNotFoundError";
    }
}

export class GitHubAuthError extends GitHubRepoError {
    constructor(owner: string, repo: string, hadToken: boolean) {
        super({
            key: hadToken
                ? "upload.server.github.accessDeniedToken"
                : "upload.server.github.accessDeniedNoToken",
            values: { repo: `${owner}/${repo}` },
        });
        this.name = "GitHubAuthError";
    }
}

export class GitHubRateLimitError extends GitHubRepoError {
    constructor(retryAfter?: string) {
        super(
            retryAfter
                ? {
                      key: "upload.server.github.rateLimitRetryAfter",
                      values: { seconds: retryAfter },
                  }
                : { key: "upload.server.github.rateLimit" }
        );
        this.name = "GitHubRateLimitError";
    }
}

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

export interface ParsedGitHubUrl {
    owner: string;
    repo: string;
}

/**
 * Parse a GitHub URL into owner and repo.
 *
 * Accepts formats:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo.git
 * - https://github.com/owner/repo/tree/main
 * - https://github.com/owner/repo/blob/main/README.md
 * - http://github.com/owner/repo
 */
export function parseGitHubUrl(url: string): ParsedGitHubUrl {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new GitHubRepoError({ key: "upload.server.github.invalidUrl", values: { url } });
    }

    if (parsed.hostname !== "github.com" && parsed.hostname !== "www.github.com") {
        throw new GitHubRepoError({ key: "upload.server.github.notGithub", values: { url } });
    }

    const segments = parsed.pathname.split("/").filter(s => s.length > 0);

    if (segments.length < 2) {
        throw new GitHubRepoError({ key: "upload.server.github.invalidRepoUrl", values: { url } });
    }

    const owner = segments[0]!;
    let repo = segments[1]!;

    // Strip .git suffix
    if (repo.endsWith(".git")) {
        repo = repo.slice(0, -4);
    }

    return { owner, repo };
}

// ---------------------------------------------------------------------------
// ZIP download
// ---------------------------------------------------------------------------

/**
 * Download a GitHub repository as a ZIP archive.
 *
 * Uses the GitHub API's zipball endpoint which works for public repos
 * without authentication and for private repos with a token.
 */
export async function downloadGitHubRepoZip(
    owner: string,
    repo: string,
    branch?: string,
    accessToken?: string
): Promise<Buffer> {
    const ref = branch ?? "";
    const url = `https://api.github.com/repos/${owner}/${repo}/zipball/${ref}`;

    const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "User-Agent": "Launchstack/1.0",
    };

    if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
    }

    console.log(
        `[GitHubRepo] Downloading ZIP: ${owner}/${repo}${ref ? `@${ref}` : ""} ` +
            `(auth=${!!accessToken})`
    );

    const response = await fetch(url, {
        headers,
        redirect: "follow",
    });

    if (response.status === 404) {
        throw new GitHubRepoNotFoundError(owner, repo);
    }

    if (response.status === 401 || response.status === 403) {
        throw new GitHubAuthError(owner, repo, !!accessToken);
    }

    if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after") ?? undefined;
        throw new GitHubRateLimitError(retryAfter);
    }

    if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    // Check Content-Length header first for early rejection
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_ZIP_SIZE_BYTES) {
        throw new GitHubRepoError({
            key: "upload.server.github.tooLarge",
            values: {
                mb: (parseInt(contentLength, 10) / 1024 / 1024).toFixed(0),
                max: String(MAX_ZIP_SIZE_BYTES / 1024 / 1024),
            },
        });
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.length > MAX_ZIP_SIZE_BYTES) {
        throw new GitHubRepoError({
            key: "upload.server.github.tooLarge",
            values: {
                mb: (buffer.length / 1024 / 1024).toFixed(0),
                max: String(MAX_ZIP_SIZE_BYTES / 1024 / 1024),
            },
        });
    }

    if (buffer.length < 100) {
        throw new GitHubRepoError({
            key: "upload.server.github.empty",
            values: { bytes: String(buffer.length) },
        });
    }

    console.log(
        `[GitHubRepo] Downloaded ${(buffer.length / 1024 / 1024).toFixed(1)}MB ` +
            `for ${owner}/${repo}`
    );

    return buffer;
}
