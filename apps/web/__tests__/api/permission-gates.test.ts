/**
 * Every mutating route in the document / folder / settings / connector /
 * analytics / campaign families refuses a membership that lacks the one
 * permission the route names — before it touches the database.
 *
 * One table, one context per role, one assertion: 403. The positive paths
 * live with each route's own tests; this file exists so that a route which
 * quietly drops its gate fails here.
 */

import type * as MockRequireWorkspaceContext from "../helpers/mock-require-workspace-context";
import type * as Zod from "zod";

import type { Permission } from "~/lib/authz/permissions";
import type { WorkspaceContextResult } from "~/lib/require-workspace-context";

import { makeWorkspaceContext } from "../helpers/workspace-context";

// ---------------------------------------------------------------------------
// Module stubs. Everything below the gate is a stand-in — the routes must
// return before any of it is reached.
// ---------------------------------------------------------------------------

const mockRequireWorkspaceContext = jest.fn<Promise<WorkspaceContextResult>, []>();

jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

const mockEnv = {
    server: {
        AGENT_KNOWLEDGE_CONNECTOR_ENABLED: "true",
        AGENT_KNOWLEDGE_PROJECT_ROOTS: undefined as string | undefined,
        AGENT_SESSIONS_CONNECTOR_ENABLED: "true",
        GOOGLE_DOCS_EDITING_ENABLED: "true",
        GOOGLE_OAUTH_CLIENT_ID: "cid",
        GOOGLE_OAUTH_CLIENT_SECRET: "sec",
        GOOGLE_OAUTH_REDIRECT_URL: undefined as string | undefined,
        GOOGLE_DOCS_SETTLE_MINUTES: "10",
        APP_PUBLIC_URL: "https://app.test",
        DOCUMENT_CONVERTER_URL: undefined as string | undefined,
        GITHUB_TOKEN: undefined as string | undefined,
        FILE_ACCESS_TOKEN_SECRET: "secret",
    },
    client: {},
};
jest.mock("~/env", () => ({
    get env() {
        return mockEnv;
    },
}));

/**
 * A chainable, awaitable Drizzle stand-in. Every builder method returns the
 * same proxy; awaiting it resolves to the current rows. Only the campaign
 * routes and the dashboard reach the database before their gate (a user-row
 * read and a last-active stamp), and one row satisfies both.
 *
 * Function declarations only: the mock factories are hoisted above every
 * `const` in this file, so the state lives in a lazily created global.
 */
function mockDbRows(): unknown[] {
    const holder = globalThis as { __permissionGateRows?: unknown[] };
    holder.__permissionGateRows ??= [{ email: "ada@example.com", name: "Ada", id: 1 }];
    return holder.__permissionGateRows;
}
function mockChain(): Record<string, unknown> {
    const proxy: Record<string, unknown> = new Proxy(
        {},
        {
            get(_target, prop) {
                if (prop === "then") {
                    return (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
                        Promise.resolve(mockDbRows()).then(resolve, reject);
                }
                return () => proxy;
            },
        }
    );
    return proxy;
}
function mockDbClient() {
    const db = {
        select: () => mockChain(),
        insert: () => mockChain(),
        update: () => mockChain(),
        delete: () => mockChain(),
        transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    };
    return db;
}
jest.mock("~/server/db", () => ({ db: mockDbClient() }));
jest.mock("~/server/db/index", () => ({ db: mockDbClient() }));

jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_request: Request, _config: unknown, handler: () => Promise<Response>) =>
        handler(),
}));
jest.mock("~/lib/rate-limiter", () => ({
    RateLimitPresets: { permissive: {}, standard: {}, strict: {} },
}));
jest.mock("~/server/engine", () => ({ getEngine: jest.fn() }));
jest.mock("~/server/inngest/client", () => ({ inngest: { send: jest.fn() } }));
jest.mock("~/lib/authz/audit", () => ({ recordAuditEvent: jest.fn() }));
jest.mock("~/lib/storage", () => ({
    uploadFile: jest.fn(),
    fetchFile: jest.fn(),
    deleteFileByUrl: jest.fn(),
    isS3Storage: () => false,
    isLocalStorage: () => false,
    resolveStorageBackend: () => "database",
}));
jest.mock("~/server/storage/vercel-blob", () => ({
    isPrivateBlobUrl: () => false,
    putFile: jest.fn(),
}));
jest.mock("@launchstack/llm/embeddings", () => ({
    getCompanyCredentialsPlaintext: jest.fn(),
    upsertCompanyCredentials: jest.fn(),
    beginReindex: jest.fn(),
    getCompanyReindexState: jest.fn(),
    resolveIngestIndexKey: jest.fn(),
}));
jest.mock("~/lib/ai/validate-credentials", () => ({ validateEmbeddingCredentials: jest.fn() }));
jest.mock("~/lib/llm", () => ({ generateStructured: jest.fn() }));
jest.mock("@launchstack/pipelines/repo-explainer", () => ({
    parseGitHubUrl: jest.fn(),
    getRepoContext: jest.fn(),
    explainRepoWithLlm: jest.fn(),
    extractMermaidCode: jest.fn(),
    extractSummary: jest.fn(),
}));
jest.mock("@launchstack/pipelines/email", () => ({
    approveEmailCampaign: jest.fn(),
    dispatchEmailCampaign: jest.fn(),
    resolveAutomationPolicy: jest.fn(),
    runAutomatedEmailCampaign: jest.fn(),
    RecipientSchema: jest.requireActual<typeof Zod>("zod").z.object({
        email: jest.requireActual<typeof Zod>("zod").z.string(),
    }),
}));
jest.mock("@launchstack/conversion/ocr/trigger", () => ({ parseProvider: jest.fn() }));
jest.mock("@launchstack/conversion/ocr/config", () => ({ getOcrConfig: jest.fn() }));
jest.mock("~/server/services/document-creation", () => ({
    createDocumentLifecycle: jest.fn(),
    createDocumentVersionLifecycle: jest.fn(),
    findDocumentByCreationKey: jest.fn(),
}));
jest.mock("~/server/services/internal-file-ref", () => ({
    authorizeInternalFileRef: jest.fn(),
    UploadAuthorizationError: class extends Error {},
}));
jest.mock("~/server/services/document-upload", () => ({
    processDocumentUpload: jest.fn(),
    processVideoUrlUpload: jest.fn(),
}));
jest.mock("~/server/services/document-delete", () => ({ deleteDocumentCore: jest.fn() }));
jest.mock("~/server/services/folder-access", () => ({
    FOLDER_EDIT_DENIED: "denied",
    canEditFolder: jest.fn().mockResolvedValue(true),
}));
jest.mock("~/server/services/upload-batches", () => ({
    findBatchOwnedByUser: jest.fn(),
    refreshBatchAggregates: jest.fn(),
    serializeBatch: jest.fn(),
    updateBatchStatus: jest.fn(),
}));
jest.mock("~/server/services/connectors/connection-store", () => ({
    getCompanyAccessToken: jest.fn(),
}));
jest.mock("~/server/services/google-drive/links", () => ({
    DriveLinkError: class extends Error {},
    getActiveDriveLink: jest.fn(),
    getDriveLinkForDocument: jest.fn(),
    linkDocumentToDrive: jest.fn(),
    isDriveLinkableDocument: jest.fn(),
}));
jest.mock("~/server/services/google-drive/connections", () => ({
    GoogleNotConnectedError: class extends Error {},
    disconnectGoogleConnections: jest.fn(),
    getActiveGoogleConnection: jest.fn(),
    upsertGoogleConnection: jest.fn(),
}));
jest.mock("~/server/services/agent-knowledge-connector", () => ({
    previewAgentKnowledge: jest.fn(),
    runAgentKnowledgeSync: jest.fn(),
}));
jest.mock("~/server/services/agent-sessions-connector", () => ({
    previewAgentSessionsDetailed: jest.fn(),
    runAgentSessionsSync: jest.fn(),
}));
// ESM-only; the commit route never reaches it before its gate.
jest.mock("p-limit", () => () => (fn: () => unknown) => fn());

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

import { POST as addCategory } from "~/app/api/Categories/AddCategories/route";
import { DELETE as deleteCategory } from "~/app/api/Categories/DeleteCategories/route";
import { PATCH as renameCategory } from "~/app/api/Categories/[id]/route";
import { POST as updateUploadPreference } from "~/app/api/updateUploadPreference/route";
import { POST as updateCompany } from "~/app/api/updateCompany/route";
import { POST as companyOnboarding } from "~/app/api/company/onboarding/route";
import { PATCH as patchMetadata } from "~/app/api/company/metadata/route";
import { POST as extractMetadata } from "~/app/api/company/metadata/extract/route";
import { POST as repoExplainer } from "~/app/api/repo-explainer/route";
import { GET as uploadBootstrap } from "~/app/api/employer/upload/bootstrap/route";
import { DELETE as deleteDocument } from "~/app/api/deleteDocument/route";
import { DELETE as batchDelete } from "~/app/api/documents/batchDelete/route";
import { DELETE as deleteVersion } from "~/app/api/documents/[id]/versions/[versionId]/route";
import { PATCH as patchDocument } from "~/app/api/documents/[id]/route";
import { POST as revertVersion } from "~/app/api/documents/[id]/versions/[versionId]/revert/route";
import { POST as createVersion } from "~/app/api/documents/[id]/versions/route";
import { POST as uploadDocument } from "~/app/api/uploadDocument/route";
import { POST as uploadWebsite } from "~/app/api/upload/website/route";
import { POST as uploadVideoUrl } from "~/app/api/upload/video-url/route";
import { POST as uploadGithubRepo } from "~/app/api/upload/github-repo/route";
import { POST as commitBatch } from "~/app/api/upload/batches/[batchId]/commit/route";
import { DELETE as disconnectGoogle } from "~/app/api/connectors/google/route";
import { GET as startGoogleOAuth } from "~/app/api/connectors/google/oauth/start/route";
import { GET as googleOAuthCallback } from "~/app/api/connectors/google/oauth/callback/route";
import { POST as openInDrive } from "~/app/api/documents/[id]/google-docs/open/route";
import {
    GET as previewAgentKnowledge,
    POST as syncAgentKnowledge,
} from "~/app/api/connectors/agent-knowledge/route";
import {
    GET as previewAgentSessions,
    POST as syncAgentSessions,
} from "~/app/api/connectors/agent-sessions/route";
import { GET as analysisDashboard } from "~/app/api/company/analysis-dashboard/route";
import { GET as documentStats } from "~/app/api/company/documents/[documentId]/stats/route";
import { POST as approveCampaign } from "~/app/api/email-campaigns/[campaignId]/approve/route";
import { POST as sendCampaign } from "~/app/api/email-campaigns/[campaignId]/send/route";
import { POST as runCampaign } from "~/app/api/email-campaign-runs/route";

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

function json(path: string, method: string, body: unknown): Request {
    return new Request(`http://localhost${path}`, {
        method,
        headers: { "Content-Type": "application/json", "Idempotency-Key": "k-1" },
        body: JSON.stringify(body),
    });
}

const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });

interface Gate {
    readonly route: string;
    readonly permission: Permission;
    /** The built-in role that lacks the permission. */
    readonly deniedRole: "member" | "viewer";
    readonly call: () => Promise<Response>;
}

const GATES: readonly Gate[] = [
    // folders.manage
    {
        route: "POST /api/Categories/AddCategories",
        permission: "folders.manage",
        deniedRole: "member",
        call: () =>
            addCategory(json("/api/Categories/AddCategories", "POST", { CategoryName: "X" })),
    },
    {
        route: "DELETE /api/Categories/DeleteCategories",
        permission: "folders.manage",
        deniedRole: "member",
        call: () => deleteCategory(json("/api/Categories/DeleteCategories", "DELETE", { id: 1 })),
    },
    {
        route: "PATCH /api/Categories/[id]",
        permission: "folders.manage",
        deniedRole: "member",
        call: () =>
            renameCategory(json("/api/Categories/1", "PATCH", { name: "Y" }), params({ id: "1" })),
    },
    // settings.manage
    {
        route: "POST /api/updateUploadPreference",
        permission: "settings.manage",
        deniedRole: "member",
        call: () =>
            updateUploadPreference(
                json("/api/updateUploadPreference", "POST", { useUploadThing: true })
            ),
    },
    {
        route: "POST /api/updateCompany",
        permission: "settings.manage",
        deniedRole: "member",
        call: () => updateCompany(json("/api/updateCompany", "POST", { name: "Acme" })),
    },
    {
        route: "POST /api/company/onboarding",
        permission: "settings.manage",
        deniedRole: "member",
        call: () => companyOnboarding(json("/api/company/onboarding", "POST", { industry: "x" })),
    },
    {
        route: "PATCH /api/company/metadata",
        permission: "settings.manage",
        deniedRole: "member",
        call: () =>
            patchMetadata(
                json("/api/company/metadata", "PATCH", { path: "company.name", value: "A" })
            ),
    },
    {
        route: "POST /api/company/metadata/extract",
        permission: "settings.manage",
        deniedRole: "member",
        call: () => extractMetadata(json("/api/company/metadata/extract", "POST", {})),
    },
    {
        route: "POST /api/repo-explainer",
        permission: "settings.manage",
        deniedRole: "member",
        call: () => repoExplainer(json("/api/repo-explainer", "POST", { url: "owner/repo" })),
    },
    {
        route: "GET /api/employer/upload/bootstrap",
        permission: "settings.manage",
        deniedRole: "member",
        call: () => uploadBootstrap(),
    },
    // documents.delete
    {
        route: "DELETE /api/deleteDocument",
        permission: "documents.delete",
        deniedRole: "member",
        call: () => deleteDocument(json("/api/deleteDocument", "DELETE", { docId: "1" })),
    },
    {
        route: "DELETE /api/documents/batchDelete",
        permission: "documents.delete",
        deniedRole: "member",
        call: () => batchDelete(json("/api/documents/batchDelete", "DELETE", { docIds: [1] })),
    },
    {
        route: "DELETE /api/documents/[id]/versions/[versionId]",
        permission: "documents.delete",
        deniedRole: "member",
        call: () =>
            deleteVersion(
                json("/api/documents/1/versions/2", "DELETE", {}),
                params({ id: "1", versionId: "2" })
            ),
    },
    // documents.edit
    {
        route: "PATCH /api/documents/[id]",
        permission: "documents.edit",
        deniedRole: "viewer",
        call: () =>
            patchDocument(json("/api/documents/1", "PATCH", { title: "T" }), params({ id: "1" })),
    },
    {
        route: "POST /api/documents/[id]/versions/[versionId]/revert",
        permission: "documents.edit",
        deniedRole: "viewer",
        call: () =>
            revertVersion(
                json("/api/documents/1/versions/2/revert", "POST", {}),
                params({ id: "1", versionId: "2" })
            ),
    },
    // documents.upload
    {
        route: "POST /api/documents/[id]/versions",
        permission: "documents.upload",
        deniedRole: "viewer",
        call: () =>
            createVersion(json("/api/documents/1/versions", "POST", {}), params({ id: "1" })),
    },
    {
        route: "POST /api/uploadDocument",
        permission: "documents.upload",
        deniedRole: "viewer",
        call: () =>
            uploadDocument(
                json("/api/uploadDocument", "POST", { documentUrl: "u", documentName: "n" })
            ),
    },
    {
        route: "POST /api/upload/website",
        permission: "documents.upload",
        deniedRole: "viewer",
        call: () =>
            uploadWebsite(json("/api/upload/website", "POST", { url: "https://example.com" })),
    },
    {
        route: "POST /api/upload/video-url",
        permission: "documents.upload",
        deniedRole: "viewer",
        call: () =>
            uploadVideoUrl(
                json("/api/upload/video-url", "POST", {
                    videoUrl: "https://youtu.be/x",
                    category: "c",
                })
            ),
    },
    {
        route: "POST /api/upload/github-repo",
        permission: "documents.upload",
        deniedRole: "viewer",
        call: () =>
            uploadGithubRepo(
                json("/api/upload/github-repo", "POST", { repoUrl: "https://github.com/a/b" })
            ),
    },
    {
        route: "POST /api/upload/batches/[batchId]/commit",
        permission: "documents.upload",
        deniedRole: "viewer",
        call: () =>
            commitBatch(
                json("/api/upload/batches/b1/commit", "POST", {}),
                params({ batchId: "b1" })
            ),
    },
    // connectors.manage
    {
        route: "DELETE /api/connectors/google",
        permission: "connectors.manage",
        deniedRole: "member",
        call: () => disconnectGoogle(),
    },
    {
        route: "GET /api/connectors/google/oauth/start",
        permission: "connectors.manage",
        deniedRole: "member",
        call: () =>
            startGoogleOAuth(new Request("http://localhost/api/connectors/google/oauth/start")),
    },
    {
        route: "POST /api/documents/[id]/google-docs/open",
        permission: "connectors.manage",
        deniedRole: "member",
        call: () =>
            openInDrive(json("/api/documents/1/google-docs/open", "POST", {}), params({ id: "1" })),
    },
    {
        route: "GET /api/connectors/agent-knowledge",
        permission: "connectors.manage",
        deniedRole: "member",
        call: () =>
            previewAgentKnowledge(new Request("http://localhost/api/connectors/agent-knowledge")),
    },
    {
        route: "POST /api/connectors/agent-knowledge",
        permission: "connectors.manage",
        deniedRole: "member",
        call: () => syncAgentKnowledge(json("/api/connectors/agent-knowledge", "POST", {})),
    },
    {
        route: "GET /api/connectors/agent-sessions",
        permission: "connectors.manage",
        deniedRole: "member",
        call: () =>
            previewAgentSessions(new Request("http://localhost/api/connectors/agent-sessions")),
    },
    {
        route: "POST /api/connectors/agent-sessions",
        permission: "connectors.manage",
        deniedRole: "member",
        call: () => syncAgentSessions(json("/api/connectors/agent-sessions", "POST", {})),
    },
    // analytics.view
    {
        route: "GET /api/company/analysis-dashboard",
        permission: "analytics.view",
        deniedRole: "member",
        call: () => analysisDashboard(),
    },
    {
        route: "GET /api/company/documents/[documentId]/stats",
        permission: "analytics.view",
        deniedRole: "member",
        call: () =>
            documentStats(
                new Request("http://localhost/api/company/documents/1/stats") as never,
                params({ documentId: "1" })
            ),
    },
    // campaigns.send
    {
        route: "POST /api/email-campaigns/[campaignId]/approve",
        permission: "campaigns.send",
        deniedRole: "member",
        call: () =>
            approveCampaign(
                json("/api/email-campaigns/1/approve", "POST", { templateVersionId: 1 }),
                params({ campaignId: "1" })
            ),
    },
    {
        route: "POST /api/email-campaigns/[campaignId]/send (mode: send)",
        permission: "campaigns.send",
        deniedRole: "member",
        call: () =>
            sendCampaign(
                json("/api/email-campaigns/1/send", "POST", { mode: "send" }),
                params({ campaignId: "1" })
            ),
    },
    {
        route: "POST /api/email-campaign-runs",
        permission: "campaigns.send",
        deniedRole: "member",
        call: () =>
            runCampaign(
                json("/api/email-campaign-runs", "POST", {
                    name: "n",
                    recipients: [{ email: "a@b.c" }],
                })
            ),
    },
];

function signInAs(role: string) {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ role, authUserId: "user-1", companyId: BigInt(5) }),
    });
}

describe("permission gates", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // The table is only a proof if the denied role really lacks the permission
    // and the next role up really holds it.
    it.each(GATES)("$route names a permission $deniedRole lacks and admin holds", gate => {
        const denied = makeWorkspaceContext({ role: gate.deniedRole });
        const admin = makeWorkspaceContext({ role: "admin" });
        expect(denied.can(gate.permission)).toBe(false);
        expect(admin.can(gate.permission)).toBe(true);
    });

    it.each(GATES)("$route returns 403 to a $deniedRole", async gate => {
        signInAs(gate.deniedRole);

        const response = await gate.call();

        expect(response.status).toBe(403);
        const body = (await response.json().catch(() => ({}))) as { permission?: string };
        if (body.permission !== undefined) {
            expect(body.permission).toBe(gate.permission);
        }
    });

    it("GET /api/connectors/google/oauth/callback sends a member back with an error flag", async () => {
        signInAs("member");

        const response = await googleOAuthCallback(
            new Request("http://localhost/api/connectors/google/oauth/callback?code=c&state=s")
        );

        expect(response.status).toBe(307);
        expect(response.headers.get("location")).toContain("result=error");
    });

    it("lets an admin through the same gate (the harness is not refusing everyone)", async () => {
        signInAs("admin");
        const rows = mockDbRows();
        const before = rows.splice(0, rows.length, { id: 5, useUploadThing: true });

        const response = await updateUploadPreference(
            json("/api/updateUploadPreference", "POST", { useUploadThing: true })
        );

        expect(response.status).toBe(200);
        rows.splice(0, rows.length, ...before);
    });
});
