/**
 * Typed fetch wrappers for the agent-sessions connector API. Mirrors the
 * response shapes built in ~/app/api/connectors/agent-sessions/route.ts and
 * ~/server/services/agent-sessions-connector.ts — keep the three in sync.
 */

export type SessionTool = "claude-code" | "codex";

export interface SessionImportState {
    documentId: number;
    syncedAt: string | null;
    /** The local file changed after the last import; a re-import would revise. */
    stale: boolean;
}

export interface AgentSessionItem {
    sourceId: string;
    tool: SessionTool;
    title: string;
    preview: string | null;
    projectSlug: string | null;
    projectPath: string | null;
    gitBranch: string | null;
    bytes: number;
    modifiedAt: string;
    relativePath: string;
    archived: boolean;
    /** Modified minutes ago — the session may still be running. */
    active: boolean;
    imported: SessionImportState | null;
}

export interface SessionRoot {
    toolId: SessionTool;
    dir: string;
    exists: boolean;
    sessionCount: number;
}

export interface SessionsPreview {
    enabled: boolean;
    roots: SessionRoot[];
    truncated: boolean;
    items: AgentSessionItem[];
    skipped: { sourceId: string; reason: string; detail?: string }[];
}

export interface ImportReport {
    counts: {
        discovered: number;
        stored: number;
        created: number;
        revised: number;
        skipped: number;
        failed: number;
    };
    stored: { sourceId: string; documentId: number; versionId: number; revised: boolean }[];
    skipped: { sourceId: string; reason: string; detail?: string }[];
    failed: { sourceId: string; error: string }[];
    missing: string[];
}

/** Error carrying the server's message and HTTP status. */
export class AgentSessionsApiError extends Error {
    constructor(
        message: string,
        public readonly status?: number
    ) {
        super(message);
        this.name = "AgentSessionsApiError";
    }

    /** The connector env gate, as opposed to a role/auth refusal. */
    get connectorDisabled(): boolean {
        return this.status === 403 && this.message.includes("AGENT_SESSIONS_CONNECTOR_ENABLED");
    }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
    const res = await fetch(input, init);
    const body = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        data?: T;
        message?: string;
        error?: string;
    };
    if (!res.ok || body.success === false) {
        throw new AgentSessionsApiError(
            body.message ?? body.error ?? `Request failed (HTTP ${res.status})`,
            res.status
        );
    }
    return body.data as T;
}

export async function fetchSessionsPreview(): Promise<SessionsPreview> {
    return request("/api/connectors/agent-sessions?maxSessions=1000");
}

/** Import exactly these sessions. */
export async function importSessions(sourceIds: string[]): Promise<ImportReport> {
    return request("/api/connectors/agent-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceIds }),
    });
}

/** Import everything new or changed, newest first (server-side batch cap). */
export async function importAllSessions(): Promise<ImportReport> {
    return request("/api/connectors/agent-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
    });
}
