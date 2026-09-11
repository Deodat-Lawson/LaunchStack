/**
 * Repo workspaces — the persistent, synced server-side home of a connected
 * repository (design: Repo Explainer Rebuild rev 4, stages A–C).
 *
 * Everything in this vertical is port-based: git operations, filesystem
 * access, and credentials are injected so the pure logic (graph ranking,
 * bundle derivation, sync decisions) stays deterministic and testable
 * without a network, a database, or a real GitHub remote.
 */
/** `owner/repo`, the display and lookup form. */
export function repoFullName(ref) {
    return `${ref.owner}/${ref.repo}`;
}
export const CONTEXT_BUNDLE_SCHEMA_VERSION = 1;
// ---------------------------------------------------------------------------
// Workspace + sync records (DB shapes live in ./schema.ts)
// ---------------------------------------------------------------------------
export const REPO_WORKSPACE_STATUSES = ["pending", "active", "error", "disconnected"];
export const SYNC_REQUEST_STATUSES = ["pending", "running", "completed", "failed"];
export const SYNC_REASONS = ["connect", "webhook", "poll", "manual"];
// ---------------------------------------------------------------------------
// Explainer job payloads (DB shapes live in ./schema.ts)
// ---------------------------------------------------------------------------
export const REPO_EXPLAINER_JOB_STATUSES = ["queued", "running", "completed", "failed"];
export const DIAGRAM_TYPES = ["architecture", "sequence", "class", "er", "component"];
//# sourceMappingURL=types.js.map