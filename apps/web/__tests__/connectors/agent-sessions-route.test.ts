/**
 * Route-level gates. The connector reads the server's filesystem, so "who may
 * call this, and what may they narrow the scan to" is the part that must not
 * regress.
 */

import type * as MockRequireWorkspaceContext from "../helpers/mock-require-workspace-context";

const mockEnv = {
    server: {
        AGENT_SESSIONS_CONNECTOR_ENABLED: undefined as string | undefined,
    },
};
const mockRequireWorkspaceContext = jest.fn();

// A getter, not `env: mockEnv` — jest hoists mock factories above the const,
// so the binding is only safe to read once a handler actually runs.
jest.mock("~/env", () => ({
    get env() {
        return mockEnv;
    },
}));
jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);
jest.mock("~/server/services/agent-sessions-connector", () => ({
    previewAgentSessionsDetailed: jest.fn(),
    runAgentSessionsSync: jest.fn(),
}));

import { GET, POST } from "~/app/api/connectors/agent-sessions/route";
import {
    previewAgentSessionsDetailed,
    runAgentSessionsSync,
} from "~/server/services/agent-sessions-connector";

import { makeWorkspaceContext } from "../helpers/workspace-context";

const mockPreview = previewAgentSessionsDetailed as jest.Mock;
const mockSync = runAgentSessionsSync as jest.Mock;

const HIDES_BOARD = {
    kind: "except" as const,
    deniedCategories: ["Board"],
    deniedDocumentIds: [],
    allowedDocumentIds: [],
};

function signedInAs(role: string, scope = HIDES_BOARD) {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ authUserId: "user_abc", companyId: 7n, role, scope }),
    });
}

function signedOut() {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: false,
        response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    });
}

interface ApiBody {
    message?: string;
    data: {
        counts?: Record<string, number>;
        items?: { relativePath: string; projectSlug: string | null }[];
        missing?: string[];
    };
}

async function readBody(response: Response): Promise<ApiBody> {
    return (await response.json()) as ApiBody;
}

function postRequest(body?: unknown): Request {
    return new Request("http://test/api/connectors/agent-sessions", {
        method: "POST",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}

function getRequest(query = ""): Request {
    return new Request(`http://test/api/connectors/agent-sessions${query}`);
}

beforeEach(() => {
    jest.clearAllMocks();
    mockEnv.server.AGENT_SESSIONS_CONNECTOR_ENABLED = "true";
    signedInAs("owner");
    mockPreview.mockResolvedValue({ roots: [], items: [], skipped: [], truncated: false });
    mockSync.mockResolvedValue({
        connectorId: "agent-sessions",
        startedAt: "2026-08-30T10:00:00.000Z",
        finishedAt: "2026-08-30T10:00:01.000Z",
        durationMs: 1000,
        discovered: 2,
        stored: [
            { sourceId: "a", documentId: 1, versionId: 1, jobId: "j1", revised: false },
            { sourceId: "b", documentId: 2, versionId: 2, jobId: "j2", revised: true },
        ],
        skipped: [],
        failed: [],
        scan: { roots: [], items: [], skipped: [], truncated: false },
        truncated: false,
    });
});

describe("POST /api/connectors/agent-sessions", () => {
    it("rejects an unauthenticated call before touching the filesystem", async () => {
        signedOut();

        const response = await POST(postRequest({}));

        expect(response.status).toBe(401);
        expect(mockSync).not.toHaveBeenCalled();
    });

    it("rejects a member — imported sessions need connectors.manage", async () => {
        signedInAs("member");

        const response = await POST(postRequest({}));

        expect(response.status).toBe(403);
        expect(mockSync).not.toHaveBeenCalled();
    });

    it("stays off unless the deployment opts in", async () => {
        mockEnv.server.AGENT_SESSIONS_CONNECTOR_ENABLED = undefined;

        const response = await POST(postRequest({}));

        expect(response.status).toBe(403);
        expect((await readBody(response)).message).toContain("AGENT_SESSIONS_CONNECTOR_ENABLED");
        expect(mockSync).not.toHaveBeenCalled();
    });

    it("syncs with defaults when the body is empty", async () => {
        const response = await POST(postRequest());

        expect(response.status).toBe(202);
        const payload = await readBody(response);
        expect(payload.data.counts).toEqual(
            expect.objectContaining({ discovered: 2, stored: 2, created: 1, revised: 1 })
        );
        expect(mockSync).toHaveBeenCalledWith(
            expect.objectContaining({ companyId: 7n, userId: "user_abc" })
        );
    });

    it("refuses a project slug that is really a path", async () => {
        const response = await POST(postRequest({ projects: ["../../etc"] }));

        expect(response.status).toBe(400);
        expect(mockSync).not.toHaveBeenCalled();
    });

    it("passes real slugs through — including the leading-dash encoding", async () => {
        const response = await POST(postRequest({ projects: ["-Users-me-app"] }));

        expect(response.status).toBe(202);
        expect(mockSync).toHaveBeenCalledWith(
            expect.objectContaining({ projects: ["-Users-me-app"] })
        );
    });

    it("rejects a malformed option instead of silently dropping it", async () => {
        const response = await POST(postRequest({ tools: ["cursor"] }));

        expect(response.status).toBe(400);
        expect(mockSync).not.toHaveBeenCalled();
    });

    it("imports a selected session and reports ids the machine no longer has", async () => {
        const known = "agent-sessions://claude-code/aaaaaaaa-1111-4111-8111-111111111111";
        const gone = "agent-sessions://codex/bbbbbbbb-2222-4222-8222-222222222222";
        mockSync.mockResolvedValue({
            connectorId: "agent-sessions",
            startedAt: "2026-08-30T10:00:00.000Z",
            finishedAt: "2026-08-30T10:00:01.000Z",
            durationMs: 1000,
            discovered: 1,
            stored: [{ sourceId: known, documentId: 1, versionId: 1, jobId: "j1", revised: false }],
            skipped: [],
            failed: [],
            scan: { roots: [], items: [], skipped: [], truncated: false },
            truncated: false,
        });

        const response = await POST(postRequest({ sourceIds: [known, gone] }));

        expect(response.status).toBe(202);
        expect(mockSync).toHaveBeenCalledWith(
            expect.objectContaining({ sourceIds: [known, gone] })
        );
        expect((await readBody(response)).data.missing).toEqual([gone]);
    });

    it("rejects a sourceId from a different scheme", async () => {
        const response = await POST(postRequest({ sourceIds: ["file:///etc/passwd"] }));

        expect(response.status).toBe(400);
        expect(mockSync).not.toHaveBeenCalled();
    });
});

describe("GET /api/connectors/agent-sessions", () => {
    it("previews the workspace-aware session list, scoped to the caller's company", async () => {
        mockPreview.mockResolvedValue({
            roots: [
                {
                    toolId: "claude-code",
                    dir: "/h/.claude/projects",
                    exists: true,
                    sessionCount: 1,
                },
            ],
            items: [
                {
                    sourceId: "agent-sessions://claude-code/aaaaaaaa-1111-4111-8111-111111111111",
                    tool: "claude-code",
                    title: "Deploy pipeline chat",
                    preview: "How do I deploy this?",
                    projectSlug: "-Users-me-app",
                    projectPath: "/Users/me/app",
                    gitBranch: "main",
                    bytes: 1200,
                    modifiedAt: "2026-08-01T00:00:00.000Z",
                    relativePath: "projects/-Users-me-app/aaaaaaaa.jsonl",
                    archived: false,
                    active: false,
                    imported: null,
                },
            ],
            skipped: [],
            truncated: false,
        });

        const response = await GET(getRequest());
        const payload = await readBody(response);

        expect(response.status).toBe(200);
        // The import-state lookup reads through the caller's document scope.
        expect(mockPreview).toHaveBeenCalledWith(7n, expect.any(Object), HIDES_BOARD);
        expect(payload.data.items).toEqual([
            expect.objectContaining({
                relativePath: "projects/-Users-me-app/aaaaaaaa.jsonl",
                projectSlug: "-Users-me-app",
                title: "Deploy pipeline chat",
                imported: null,
            }),
        ]);
        // The preview must not hand back the server's absolute file paths.
        expect(JSON.stringify(payload.data.items)).not.toContain("origin");
        expect(mockSync).not.toHaveBeenCalled();
    });

    it("rejects a traversal in the projects query parameter", async () => {
        const response = await GET(getRequest("?projects=../../etc"));

        expect(response.status).toBe(400);
        expect(mockPreview).not.toHaveBeenCalled();
    });

    it("requires the same authorization as a sync", async () => {
        signedInAs("member");

        expect((await GET(getRequest())).status).toBe(403);
        expect(mockPreview).not.toHaveBeenCalled();
    });
});
