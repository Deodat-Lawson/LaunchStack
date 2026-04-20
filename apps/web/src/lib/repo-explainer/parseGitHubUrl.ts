/**
 * Parse GitHub URL to extract owner and repo name.
 *
 * Supports:
 * - https://github.com/owner/repo
 * - http://github.com/owner/repo
 * - github.com/owner/repo
 * - owner/repo
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  let value = url.trim();

  const patterns = [
    /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\/|$|\.git$)/i,
    /^github\.com\/([^/]+)\/([^/]+?)(?:\/|$|\.git$)/i,
    /^([^/]+)\/([^/]+?)$/,
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1] && match[2]) {
      return { owner: match[1], repo: match[2] };
    }
  }

  return null;
}

