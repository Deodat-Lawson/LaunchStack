/**
 * Repo workspaces — the persistent, synced server-side home of a connected
 * repository (design: Repo Explainer Rebuild rev 4, stages A–C).
 *
 * Everything in this vertical is port-based: git operations, filesystem
 * access, and credentials are injected so the pure logic (graph ranking,
 * bundle derivation, sync decisions) stays deterministic and testable
 * without a network, a database, or a real GitHub remote.
 */
/** Source-forge providers. Only GitHub today; the field exists so GitLab and
 * Bitbucket are additive rather than a migration. */
export type RepoProvider = "github";
export interface RepoRef {
    provider: RepoProvider;
    owner: string;
    repo: string;
}
/** `owner/repo`, the display and lookup form. */
export declare function repoFullName(ref: RepoRef): string;
export interface WorkspaceFile {
    /** Repo-relative POSIX path (`src/index.ts`), never absolute. */
    path: string;
    /** Size in bytes as reported by the filesystem. */
    size: number;
}
export interface SearchOptions {
    /** Simple suffix/prefix glob over paths, e.g. `*.ts` or `src/*`. */
    glob?: string;
    maxResults?: number;
    caseSensitive?: boolean;
}
export interface SearchMatch {
    path: string;
    /** 1-indexed line number. */
    line: number;
    /** The matching line, trimmed to a bounded length. */
    text: string;
}
/**
 * A read-only view over one commit's tree. Implementations must never follow
 * symlinks, never expose `.git`, and never return binary content.
 */
export interface WorkspaceView {
    readonly sha: string;
    /** Sorted, deterministic listing of every visible file. */
    listFiles(): Promise<WorkspaceFile[]>;
    /**
     * Read one file as UTF-8. Returns `null` for missing files, binaries
     * (NUL byte in the first 8 KiB), symlinks, and files over `maxBytes`.
     */
    readFile(path: string, maxBytes?: number): Promise<string | null>;
    /** Literal-substring or regex search across visible files. */
    searchText(pattern: string, options?: SearchOptions): Promise<SearchMatch[]>;
}
export interface EnsureMirrorResult {
    created: boolean;
    headSha: string;
}
export interface FetchResult {
    previousSha: string | null;
    headSha: string;
    /** True when the head moved at all (including force-pushes). */
    advanced: boolean;
    /** True when the previous head is not an ancestor of the new head. */
    nonFastForward: boolean;
}
/**
 * Git operations against a bare mirror. Credentials travel per-invocation
 * (an Authorization header), never into the on-disk remote URL or config.
 */
export interface GitPort {
    ensureMirror(input: {
        remoteUrl: string;
        mirrorPath: string;
        token?: string | null;
    }): Promise<EnsureMirrorResult>;
    fetchMirror(input: {
        mirrorPath: string;
        token?: string | null;
    }): Promise<FetchResult>;
    resolveHead(mirrorPath: string): Promise<string>;
    /**
     * Detached read-only checkout of `sha` into `worktreePath`. Takes the
     * token because a blob-filtered mirror lazily fetches file contents from
     * the promisor remote during checkout.
     */
    addWorktree(input: {
        mirrorPath: string;
        sha: string;
        worktreePath: string;
        token?: string | null;
    }): Promise<void>;
    removeWorktree(input: {
        mirrorPath: string;
        worktreePath: string;
    }): Promise<void>;
    /** Bytes on disk under the mirror, for quota accounting. */
    mirrorSizeBytes(mirrorPath: string): Promise<number>;
}
/** Resolves the token a workspace syncs with. Port so the workspace
 * connection (PR #363) can slot in; the default reads the environment. */
export type RepoCredentialResolver = (ref: RepoRef) => Promise<string | null>;
export interface FileSymbols {
    path: string;
    /** Names this file defines (functions, classes, exported consts …). */
    definitions: string[];
    /** Names this file references that it does not define. */
    references: string[];
}
/**
 * Extracts symbols from one file. Returns `null` when the language is not
 * supported — the file then simply does not participate in the graph.
 *
 * The default implementation is a deterministic lightweight extractor; the
 * port exists so a tree-sitter-backed extractor can replace it without
 * touching the graph or the map (design §2.3).
 */
export type SymbolExtractor = (path: string, content: string) => FileSymbols | null;
export interface RepoMapEntry {
    path: string;
    /** PageRank score, normalized so the entries sum to 1. */
    rank: number;
    /** The file's top definitions, most referenced first. */
    symbols: string[];
}
export interface RepoMap {
    entries: RepoMapEntry[];
    /** The token-budgeted textual rendering handed to the model. */
    rendered: string;
}
export interface MemoryFile {
    path: string;
    content: string;
    truncated: boolean;
}
export interface LanguageStat {
    language: string;
    files: number;
    bytes: number;
}
export interface DirectoryStat {
    path: string;
    files: number;
    bytes: number;
}
export interface RepoStats {
    totalFiles: number;
    totalBytes: number;
    languages: LanguageStat[];
    largestDirectories: DirectoryStat[];
}
/** Paths the model must never see, computed once at derive time. */
export interface HygieneManifest {
    deniedPaths: string[];
}
export declare const CONTEXT_BUNDLE_SCHEMA_VERSION = 1;
/**
 * The deterministic per-commit context bundle (design §3.3). Same SHA and
 * same deriver version ⇒ byte-identical bundle.
 */
export interface ContextBundle {
    schemaVersion: typeof CONTEXT_BUNDLE_SCHEMA_VERSION;
    sha: string;
    tree: string;
    map: RepoMap;
    memoryFiles: MemoryFile[];
    stats: RepoStats;
    hygiene: HygieneManifest;
}
export declare const REPO_WORKSPACE_STATUSES: readonly ["pending", "active", "error", "disconnected"];
export type RepoWorkspaceStatus = (typeof REPO_WORKSPACE_STATUSES)[number];
export declare const SYNC_REQUEST_STATUSES: readonly ["pending", "running", "completed", "failed"];
export type SyncRequestStatus = (typeof SYNC_REQUEST_STATUSES)[number];
export declare const SYNC_REASONS: readonly ["connect", "webhook", "poll", "manual"];
export type SyncReason = (typeof SYNC_REASONS)[number];
export declare const REPO_EXPLAINER_JOB_STATUSES: readonly ["queued", "running", "completed", "failed"];
export type RepoExplainerJobStatus = (typeof REPO_EXPLAINER_JOB_STATUSES)[number];
export declare const DIAGRAM_TYPES: readonly ["architecture", "sequence", "class", "er", "component"];
export type WorkspaceDiagramType = (typeof DIAGRAM_TYPES)[number];
/** Inngest event payloads (JSON-safe: bigints travel as strings). */
export interface RepoWorkspaceSyncEventData {
    workspaceId: string;
    syncRequestId?: string;
}
export interface RepoExplainerJobEventData {
    jobId: string;
    workspaceId: string;
    /** Serialized bigint — event payloads must be JSON. */
    companyId: string;
}
//# sourceMappingURL=types.d.ts.map