/**
 * Access policy for the agent-knowledge connector.
 *
 * The connector reads the filesystem of whatever machine runs this server. On
 * a developer laptop or a self-hosted box that is the point; on a shared host
 * it would be an arbitrary-read primitive pointed at someone else's disk. So
 * the route is off unless a deployment opts in, and the set of project
 * directories it may scan is fixed by configuration rather than by the
 * request body.
 */

import path from "node:path";

export interface ProjectRootDecision {
    /** Directories that passed the allowlist, in request order. */
    readonly allowed: string[];
    /** Requested directories outside every configured root. */
    readonly rejected: string[];
}

function isTruthy(value: string | undefined): boolean {
    if (!value) return false;
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function isAgentKnowledgeConnectorEnabled(
    flag: string | undefined = process.env.AGENT_KNOWLEDGE_CONNECTOR_ENABLED
): boolean {
    return isTruthy(flag);
}

/**
 * Configured project roots, absolute and de-duplicated. Splitting on
 * `path.delimiter` (not `,`) keeps Windows drive letters intact.
 */
export function configuredProjectRoots(
    raw: string | undefined = process.env.AGENT_KNOWLEDGE_PROJECT_ROOTS
): string[] {
    if (!raw) return [];
    const seen = new Set<string>();
    for (const part of raw.split(path.delimiter)) {
        const trimmed = part.trim();
        if (trimmed.length === 0) continue;
        seen.add(path.resolve(trimmed));
    }
    return [...seen];
}

/** True when `candidate` is `root` or sits underneath it. */
export function isWithinRoot(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Resolve the project directories a request may scan.
 *
 * With no explicit request the caller gets every configured root — the common
 * "sync everything" case. An explicit list is filtered against those roots;
 * `..` cannot be used to climb out because both sides are resolved first.
 */
export function resolveProjectRoots(
    requested: readonly string[] | undefined,
    roots: readonly string[] = configuredProjectRoots()
): ProjectRootDecision {
    if (!requested || requested.length === 0) {
        return { allowed: [...roots], rejected: [] };
    }

    const allowed: string[] = [];
    const rejected: string[] = [];

    for (const entry of requested) {
        const resolved = path.resolve(entry);
        if (roots.some(root => isWithinRoot(root, resolved))) {
            if (!allowed.includes(resolved)) allowed.push(resolved);
        } else if (!rejected.includes(resolved)) {
            rejected.push(resolved);
        }
    }

    return { allowed, rejected };
}
