/**
 * Access policy for the agent-sessions connector.
 *
 * Same posture as agent-knowledge: the connector reads the filesystem of the
 * machine running this server, which is the point on a laptop or self-hosted
 * box and an arbitrary-read primitive on a shared host — so it is off unless a
 * deployment opts in. Unlike agent-knowledge there is no project-roots
 * allowlist: session transcripts live only under the fixed `~/.claude` and
 * `~/.codex` roots, and the request may narrow the scan (by project slug),
 * never widen it.
 */

function isTruthy(value: string | undefined): boolean {
    if (!value) return false;
    const normalized = value.trim().toLowerCase();
    return (
        normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on"
    );
}

export function isAgentSessionsConnectorEnabled(
    flag: string | undefined = process.env.AGENT_SESSIONS_CONNECTOR_ENABLED
): boolean {
    return isTruthy(flag);
}

/**
 * Project "slugs" are directory names under `~/.claude/projects` — a single
 * path segment. Anything with a separator or a `..` is a traversal attempt,
 * not a slug.
 */
export function isValidProjectSlug(slug: string): boolean {
    return /^[A-Za-z0-9._-]+$/.test(slug) && slug !== "." && slug !== "..";
}
