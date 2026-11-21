/**
 * Where a public link (ADR-016) lives, in one place for the middleware, the
 * page and the tests. Dependency-free so the middleware can import it.
 *
 * - `/s/<token>`: the page people open.
 * - `/s/<token>.md`: the same file as Markdown, for an AI agent. The page's
 *   own address with an `Accept` that wants Markdown and not HTML gets the
 *   same. Both are served by `/api/s/<token>/markdown`.
 */

/** 32 random bytes as base64url. */
export const PUBLIC_LINK_TOKEN_PATTERN = "[A-Za-z0-9_-]{43}";

const MARKDOWN_PATH = new RegExp(`^/s/(${PUBLIC_LINK_TOKEN_PATTERN})\\.md$`);
const PAGE_PATH = new RegExp(`^/s/(${PUBLIC_LINK_TOKEN_PATTERN})$`);

/** The internal path that answers a Markdown request for a public link, or null. */
export function publicLinkMarkdownRewrite(pathname: string, accept: string | null): string | null {
    const explicit = MARKDOWN_PATH.exec(pathname);
    if (explicit) return `/api/s/${explicit[1]}/markdown`;
    const page = PAGE_PATH.exec(pathname);
    const wants = (accept ?? "").toLowerCase();
    if (page && wants.includes("text/markdown") && !wants.includes("text/html")) {
        return `/api/s/${page[1]}/markdown`;
    }
    return null;
}
