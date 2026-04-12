/**
 * GitHub Repo Service
 *
 * Parses GitHub repository URLs and downloads repo archives as ZIP buffers.
 * The resulting ZIP is designed to be fed directly into the existing
 * document processing pipeline (processDocument Inngest function) which
 * already handles ZIP extraction, file filtering, and ingestion.
 */

const MAX_ZIP_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB

// ---------------------------------------------------------------------------
// Custom error classes
// ---------------------------------------------------------------------------

export class GitHubRepoNotFoundError extends Error {
    constructor(owner: string, repo: string) {
        super(
            `Repository "${owner}/${repo}" not found. Check that the URL is correct ` +
                `and that the repository is public (or provide an access token for private repos).`,
        );
        this.name = "GitHubRepoNotFoundError";
    }
}

export class GitHubAuthError extends Error {
    constructor(owner: string, repo: string, hadToken: boolean) {
        const hint = hadToken
            ? "The provided access token may lack permissions or has expired."
            : "This may be a private repository. Provide a personal access token with 'repo' scope.";
        super(
            `Access denied for "${owner}/${repo}". ${hint}`,
        );
        this.name = "GitHubAuthError";
    }
}

export class GitHubRateLimitError extends Error {
    constructor(retryAfter?: string) {
        const hint = retryAfter
            ? ` Retry after ${retryAfter} seconds.`
            : " Please wait before retrying or provide a GitHub access token for higher limits.";
        super(`GitHub API rate limit exceeded.${hint}`);
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
        throw new Error(`Invalid URL: "${url}"`);
    }

    if (parsed.hostname !== "github.com" && parsed.hostname !== "www.github.com") {
        throw new Error(
            `Not a GitHub URL: "${url}". Expected a URL with hostname "github.com".`,
        );
    }

    const segments = parsed.pathname
        .split("/")
        .filter((s) => s.length > 0);

    if (segments.length < 2) {
        throw new Error(
            `Invalid GitHub repository URL: "${url}". Expected format: https://github.com/owner/repo`,
        );
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
    accessToken?: string,
): Promise<Buffer> {
    const ref = branch ?? "";
    const url = `https://api.github.com/repos/${owner}/${repo}/zipball/${ref}`;

    const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "User-Agent": "Launchstack/1.0",
    };

    if (accessToken) {
        headers["Authorization"] = `Bearer ${accessToken}`;
    }

    console.log(
        `[GitHubRepo] Downloading ZIP: ${owner}/${repo}${ref ? `@${ref}` : ""} ` +
            `(auth=${!!accessToken})`,
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
        throw new Error(
            `GitHub API error: ${response.status} ${response.statusText}`,
        );
    }

    // Check Content-Length header first for early rejection
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_ZIP_SIZE_BYTES) {
        throw new Error(
            `Repository archive is too large (${(parseInt(contentLength, 10) / 1024 / 1024).toFixed(0)}MB). ` +
                `Maximum supported size is ${MAX_ZIP_SIZE_BYTES / 1024 / 1024}MB.`,
        );
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.length > MAX_ZIP_SIZE_BYTES) {
        throw new Error(
            `Repository archive is too large (${(buffer.length / 1024 / 1024).toFixed(0)}MB). ` +
                `Maximum supported size is ${MAX_ZIP_SIZE_BYTES / 1024 / 1024}MB.`,
        );
    }

    if (buffer.length < 100) {
        throw new Error(
            `Repository archive appears empty (${buffer.length} bytes). ` +
                `The repository may be empty or the branch may not exist.`,
        );
    }

    console.log(
        `[GitHubRepo] Downloaded ${(buffer.length / 1024 / 1024).toFixed(1)}MB ` +
            `for ${owner}/${repo}`,
    );

    return buffer;
}
