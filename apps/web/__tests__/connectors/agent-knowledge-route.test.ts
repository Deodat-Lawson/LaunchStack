/**
 * Route-level gates. The connector reads the server's filesystem, so "who may
 * call this, and with which directories" is the part that must not regress.
 */

const mockEnv = {
    server: {
        AGENT_KNOWLEDGE_CONNECTOR_ENABLED: undefined as string | undefined,
        AGENT_KNOWLEDGE_PROJECT_ROOTS: undefined as string | undefined,
    },
};
const mockUserRows: { rows: { id: bigint; role: string; companyId: bigint }[] } = { rows: [] };

// A getter, not `env: mockEnv` — jest hoists mock factories above the const,
// so the binding is only safe to read once a handler actually runs.
jest.mock("~/env", () => ({
    get env() {
        return mockEnv;
    },
}));
jest.mock("@clerk/nextjs/server", () => ({ auth: jest.fn() }));
jest.mock("~/server/db", () => ({
    db: {
        select: () => ({ from: () => ({ where: () => Promise.resolve(mockUserRows.rows) }) }),
    },
}));
jest.mock("~/lib/active-workspace", () => ({ resolveActiveCompanyForUser: jest.fn() }));
jest.mock("~/server/services/agent-knowledge-connector", () => ({
    previewAgentKnowledge: jest.fn(),
    runAgentKnowledgeSync: jest.fn(),
}));

import path from "node:path";

import { auth } from "@clerk/nextjs/server";

import { GET, POST } from "~/app/api/connectors/agent-knowledge/route";
import { resolveActiveCompanyForUser } from "~/lib/active-workspace";
import {
    previewAgentKnowledge,
    runAgentKnowledgeSync,
} from "~/server/services/agent-knowledge-connector";

const mockAuth = auth as unknown as jest.Mock;
const mockResolveCompany = resolveActiveCompanyForUser as jest.Mock;
const mockPreview = previewAgentKnowledge as jest.Mock;
const mockSync = runAgentKnowledgeSync as jest.Mock;

const ROOT = path.resolve("/srv/checkouts/app");

interface ApiBody {
    message?: string;
    data: {
        counts?: Record<string, number>;
        rejectedProjects?: string[];
        items?: { relativePath: string; kind: string }[];
    };
}

async function readBody(response: Response): Promise<ApiBody> {
    return (await response.json()) as ApiBody;
}

function postRequest(body?: unknown): Request {
    return new Request("http://test/api/connectors/agent-knowledge", {
        method: "POST",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}

function getRequest(query = ""): Request {
    return new Request(`http://test/api/connectors/agent-knowledge${query}`);
}

beforeEach(() => {
    jest.clearAllMocks();
    mockEnv.server.AGENT_KNOWLEDGE_CONNECTOR_ENABLED = "true";
    mockEnv.server.AGENT_KNOWLEDGE_PROJECT_ROOTS = ROOT;
    mockUserRows.rows = [{ id: 1n, role: "owner", companyId: 7n }];
    mockAuth.mockResolvedValue({ userId: "user_abc" });
    mockResolveCompany.mockResolvedValue(7n);
    mockPreview.mockResolvedValue({ roots: [], items: [], skipped: [], truncated: false });
    mockSync.mockResolvedValue({
        connectorId: "agent-knowledge",
        startedAt: "2026-08-09T10:00:00.000Z",
        finishedAt: "2026-08-09T10:00:01.000Z",
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

describe("POST /api/connectors/agent-knowledge", () => {
    it("rejects an unauthenticated call before touching the filesystem", async () => {
        mockAuth.mockResolvedValue({ userId: null });

        const response = await POST(postRequest({}));

        expect(response.status).toBe(401);
        expect(mockSync).not.toHaveBeenCalled();
    });

    it("rejects an employee — imported knowledge is workspace-wide", async () => {
        mockUserRows.rows = [{ id: 1n, role: "employee", companyId: 7n }];

        const response = await POST(postRequest({}));

        expect(response.status).toBe(403);
        expect(mockSync).not.toHaveBeenCalled();
    });

    it("stays off unless the deployment opts in", async () => {
        mockEnv.server.AGENT_KNOWLEDGE_CONNECTOR_ENABLED = undefined;

        const response = await POST(postRequest({}));

        expect(response.status).toBe(403);
        expect((await readBody(response)).message).toContain("AGENT_KNOWLEDGE_CONNECTOR_ENABLED");
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
            expect.objectContaining({
                companyId: 7n,
                userId: "user_abc",
                projects: [{ dir: ROOT }],
            })
        );
    });

    it("refuses project directories outside the configured roots", async () => {
        const response = await POST(postRequest({ projects: ["/etc"] }));

        expect(response.status).toBe(403);
        expect(mockSync).not.toHaveBeenCalled();
    });

    it("refuses a traversal dressed up as an allowed root", async () => {
        const response = await POST(postRequest({ projects: [`${ROOT}/../../etc`] }));

        expect(response.status).toBe(403);
        expect(mockSync).not.toHaveBeenCalled();
    });

    it("passes a subdirectory of an allowed root straight through", async () => {
        const nested = path.join(ROOT, "apps", "web");

        const response = await POST(postRequest({ projects: [nested] }));

        expect(response.status).toBe(202);
        expect(mockSync).toHaveBeenCalledWith(
            expect.objectContaining({ projects: [{ dir: nested }] })
        );
    });

    it("rejects a malformed option instead of silently dropping it", async () => {
        const response = await POST(postRequest({ tools: ["cursor"] }));

        expect(response.status).toBe(400);
        expect(mockSync).not.toHaveBeenCalled();
    });
});

describe("GET /api/connectors/agent-knowledge", () => {
    it("previews without reading file contents", async () => {
        mockPreview.mockResolvedValue({
            roots: [
                {
                    toolId: "claude-code",
                    scope: "global",
                    key: "global",
                    dir: "/h/.claude",
                    exists: true,
                    itemCount: 1,
                },
            ],
            items: [
                {
                    sourceId: "agent-knowledge://claude-code/global/CLAUDE.md",
                    title: "Claude Code (global) — CLAUDE.md",
                    kind: "instructions",
                    bytes: 12,
                    modifiedAt: "2026-08-01T00:00:00.000Z",
                    location: { origin: "/h/.claude/CLAUDE.md", relativePath: "CLAUDE.md" },
                    metadata: {},
                    connectorId: "agent-knowledge",
                    mimeType: "text/markdown",
                },
            ],
            skipped: [],
            truncated: false,
        });

        const response = await GET(getRequest());
        const payload = await readBody(response);

        expect(response.status).toBe(200);
        expect(payload.data.items).toEqual([
            expect.objectContaining({ relativePath: "CLAUDE.md", kind: "instructions" }),
        ]);
        // The preview must not hand back the file's text or its absolute path.
        expect(JSON.stringify(payload.data.items)).not.toContain("origin");
        expect(mockSync).not.toHaveBeenCalled();
    });

    it("reports rejected project directories rather than scanning them", async () => {
        const response = await GET(getRequest("?projects=/etc"));
        const payload = await readBody(response);

        expect(response.status).toBe(200);
        expect(payload.data.rejectedProjects).toEqual([path.resolve("/etc")]);
        expect(mockPreview).toHaveBeenCalledWith(expect.objectContaining({ projects: [] }));
    });

    it("requires the same authorization as a sync", async () => {
        mockUserRows.rows = [{ id: 1n, role: "employee", companyId: 7n }];

        expect((await GET(getRequest())).status).toBe(403);
        expect(mockPreview).not.toHaveBeenCalled();
    });
});
