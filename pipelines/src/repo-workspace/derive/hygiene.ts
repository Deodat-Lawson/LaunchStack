/**
 * The hygiene manifest — the list of paths in a checkout that must never
 * reach the model or a published source, computed once at derive time
 * (design §3.3, failure mode "secrets in repo content").
 *
 * The patterns are the agent-knowledge connector's credential denylist,
 * reused rather than re-invented: one definition of "reads as secret
 * material" for the whole codebase.
 */

import { isDeniedFilename } from "@launchstack/pipelines/connectors/agent-knowledge";
import type { HygieneManifest, WorkspaceFile } from "../types";

/** Extra patterns that show up in application repos but not in agent-config
 * trees (which is all the connector's list had to cover). */
const REPO_DENIED_PATTERNS: readonly RegExp[] = [
    /^\.npmrc$/i,
    /^\.netrc$/i,
    /(^|\/)serviceaccount.*\.json$/i,
    /\.(kdbx|asc|gpg)$/i,
];

export function isDeniedPath(filePath: string): boolean {
    const basename = filePath.split("/").pop() ?? filePath;
    if (isDeniedFilename(basename)) return true;
    if (REPO_DENIED_PATTERNS.some(pattern => pattern.test(basename))) return true;
    return REPO_DENIED_PATTERNS.some(pattern => pattern.test(filePath));
}

export function buildHygieneManifest(files: WorkspaceFile[]): HygieneManifest {
    const deniedPaths = files
        .map(file => file.path)
        .filter(isDeniedPath)
        .sort();
    return { deniedPaths };
}

/** Fast membership check callers use to filter tool results. */
export function makeDeniedSet(manifest: HygieneManifest): ReadonlySet<string> {
    return new Set(manifest.deniedPaths);
}
