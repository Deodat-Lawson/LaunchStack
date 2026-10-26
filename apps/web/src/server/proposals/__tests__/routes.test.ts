/**
 * What `/api/proposals/*` answers with, in the reader's language: a route's
 * own refusal, a ProposalsError from the service and the 402 for a run the
 * workspace cannot pay for are Chinese behind the `ls-locale` cookie and the
 * old English without it. `code` values stay as they are.
 */
import type * as MockRequireWorkspaceContext from "../../../../__tests__/helpers/mock-require-workspace-context";

import type { WorkspaceContextResult } from "~/lib/require-workspace-context";

import { makeWorkspaceContext } from "../../../../__tests__/helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn<Promise<WorkspaceContextResult>, []>();
jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../../../__tests__/helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_request: Request, _config: unknown, handler: () => Promise<Response>) =>
        handler(),
}));

const mockGetApplication = jest.fn();
const mockListSections = jest.fn();
jest.mock("@launchstack/pipelines/proposals/db", () => ({
    getApplication: (...args: unknown[]) => mockGetApplication(...args),
    listSections: (...args: unknown[]) => mockListSections(...args),
}));

const mockHasTokens = jest.fn();
jest.mock("~/lib/credits", () => ({
    hasTokens: (...args: unknown[]) => mockHasTokens(...args),
    debitTokens: jest.fn(),
}));
jest.mock("~/server/deployment", () => ({ isMeteringEnforced: () => true }));
jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("~/lib/storage", () => ({ uploadFile: jest.fn() }));
jest.mock("~/server/services/document-upload", () => ({ processDocumentUpload: jest.fn() }));
jest.mock("~/server/inngest/client", () => ({ inngest: { send: jest.fn() } }));

import { NextRequest } from "next/server";

import { GET as getApplicationRoute } from "~/app/api/proposals/applications/[id]/route";
import { POST as reviewRoute } from "~/app/api/proposals/applications/[id]/review/route";
import { POST as createRoute } from "~/app/api/proposals/applications/route";

const ZH = { cookie: "ls-locale=zh-CN.1" };
const params = { params: Promise.resolve({ id: "a1" }) };

beforeEach(() => {
    jest.clearAllMocks();
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ role: "member", authUserId: "u1", companyId: BigInt(9) }),
    });
});

describe("a route's own refusal", () => {
    it("is Chinese behind the cookie and English without it", async () => {
        const zh = await createRoute(
            new NextRequest("http://x/api/proposals/applications", {
                method: "POST",
                body: JSON.stringify({}),
                headers: ZH,
            })
        );
        expect(zh.status).toBe(400);
        expect(await zh.json()).toEqual({ error: "请为申请填写标题，或粘贴资助方的征集要求" });

        const en = await createRoute(
            new NextRequest("http://x/api/proposals/applications", {
                method: "POST",
                body: JSON.stringify({}),
            })
        );
        expect(await en.json()).toEqual({
            error: "Give the application a title, or paste the funder's request",
        });
    });
});

describe("a ProposalsError", () => {
    it("says the service's sentence in the reader's language", async () => {
        mockGetApplication.mockResolvedValue(null);
        const zh = await getApplicationRoute(
            new NextRequest("http://x/api/proposals/applications/a1", { headers: ZH }),
            params
        );
        expect(zh.status).toBe(404);
        expect(await zh.json()).toEqual({ error: "找不到这个申请" });

        const en = await getApplicationRoute(
            new NextRequest("http://x/api/proposals/applications/a1"),
            params
        );
        expect(await en.json()).toEqual({ error: "Application not found" });
    });
});

describe("a run the workspace cannot pay for", () => {
    it("is a 402 with its code, worded for the reader", async () => {
        mockGetApplication.mockResolvedValue({ id: "a1" });
        mockHasTokens.mockResolvedValue(false);
        const zh = await reviewRoute(
            new NextRequest("http://x/api/proposals/applications/a1/review", {
                method: "POST",
                headers: ZH,
            }),
            params
        );
        expect(zh.status).toBe(402);
        expect(await zh.json()).toEqual({
            error: "额度不足，无法开始这次运行",
            code: "insufficient_credits",
        });

        const en = await reviewRoute(
            new NextRequest("http://x/api/proposals/applications/a1/review", { method: "POST" }),
            params
        );
        expect(await en.json()).toEqual({
            error: "Not enough credits to start this run",
            code: "insufficient_credits",
        });
    });
});
