/**
 * Parse GitHub URL to extract owner and repo name.
 *
 * Supports:
 * - https://github.com/owner/repo
 * - http://github.com/owner/repo
 * - github.com/owner/repo
 * - owner/repo
 */
export declare function parseGitHubUrl(url: string): {
    owner: string;
    repo: string;
} | null;
//# sourceMappingURL=parseGitHubUrl.d.ts.map
