import type { WorkspaceContextResult } from "~/lib/require-workspace-context";

const mockRequireWorkspaceContext = jest.fn<Promise<WorkspaceContextResult>, []>();
const mockInngestSend = jest.fn();
const mockDbSelect = jest.fn();

jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspaceContext: () => mockRequireWorkspaceContext(),
}));

jest.mock("~/server/db/index", () => ({
    db: {
        select: (...args: unknown[]) => mockDbSelect(...args) as unknown,
    },
}));

jest.mock("~/server/inngest/client", () => ({
    inngest: {
        send: (...args: unknown[]) => mockInngestSend(...args) as unknown,
    },
}));

jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_req: Request, _preset: unknown, handler: () => Promise<Response>) => handler(),
}));

jest.mock("~/server/metrics/registry", () => ({
    predictiveAnalysisAiCalls: { observe: jest.fn() },
    predictiveAnalysisCacheHits: { inc: jest.fn() },
    predictiveAnalysisDuration: { startTimer: () => jest.fn() },
    predictiveAnalysisRequests: { inc: jest.fn() },
}));

jest.mock("~/lib/integrations/slack", () => ({
    notifyOnCriticalFindings: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("~/app/api/agents/predictive-document-analysis/agent", () => ({
    analyzeDocumentChunks: jest.fn(),
}));

import { POST as postSync } from "~/app/api/agents/predictive-document-analysis/route";
import { POST as postStream } from "~/app/api/agents/predictive-document-analysis/stream/route";

const VERIFIED_CTX: WorkspaceContextResult = {
    success: true,
    data: {
        authUserId: "clerk_abc",
        userPk: BigInt(7),
        companyId: BigInt(5),
        role: "employer",
        status: "verified",
    },
};

function chainResolved(rows: unknown[]) {
    const limit = jest.fn().mockResolvedValue(rows);
    const orderBy = jest.fn().mockReturnValue({ limit });
    const where = jest.fn().mockReturnValue({ orderBy, limit });
    const leftJoin = jest.fn().mockReturnValue({ where });
    const from = jest.fn().mockReturnValue({ where, leftJoin });
    return { from, where, orderBy, limit, leftJoin };
}

function requestBody(documentId = 42) {
    return new Request("http://localhost/api/agents/predictive-document-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            documentId,
            analysisType: "general",
            includeRelatedDocs: false,
            forceRefresh: true,
        }),
    });
}

describe("predictive-document-analysis ownership", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockRequireWorkspaceContext.mockResolvedValue(VERIFIED_CTX);
    });

    it("POST sync returns 404 when document is not in the active company", async () => {
        mockDbSelect.mockReturnValue(chainResolved([]));

        const response = await postSync(requestBody());
        expect(response.status).toBe(404);
        const body = (await response.json()) as { message?: string };
        expect(body.message).toBe("Document not found.");
        expect(mockInngestSend).not.toHaveBeenCalled();
    });

    it("POST stream returns 404 when document is not in the active company (before cache)", async () => {
        mockDbSelect.mockReturnValue(chainResolved([]));

        const response = await postStream(requestBody());
        expect(response.status).toBe(404);
        const body = (await response.json()) as { message?: string };
        expect(body.message).toBe("Document not found.");
        expect(mockInngestSend).not.toHaveBeenCalled();
    });
});
