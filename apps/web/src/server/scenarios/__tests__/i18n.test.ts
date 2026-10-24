/**
 * What `/api/scenarios/*` says, in the reader's language: its refusals, the
 * labels the server composed for evidence, "Someone who has left" and the
 * run's own failure sentences are Chinese behind the `ls-locale` cookie and
 * exactly the old English without it. Codes stay codes; what people and the
 * model wrote stays as written.
 */
import type * as MockRequireWorkspaceContext from "../../../../__tests__/helpers/mock-require-workspace-context";

import { createWorld } from "@launchstack/simulation";
import type { ScenarioRunRecord } from "@launchstack/pipelines/scenarios";

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

jest.mock("@launchstack/pipelines/scenarios/db", () => {
    const fns = {
        getCompanyRun: jest.fn(),
        listVisibleRuns: jest.fn(),
        createScenarioRun: jest.fn(),
        updateRunMeta: jest.fn(),
        deleteRun: jest.fn(),
        requestCancel: jest.fn(),
        listInjections: jest.fn(async () => []),
        listInterviews: jest.fn(async () => []),
        addInjectionIfOpen: jest.fn(),
        addInterview: jest.fn(),
        linkPostTest: jest.fn(),
        listLinkedPostTests: jest.fn(),
        finish: jest.fn(),
    };
    return { ...fns, createScenarioStore: () => ({ finish: fns.finish }) };
});
jest.mock("~/server/scenarios/executor", () => ({
    dispatchRun: jest.fn(),
    resumeIfStalled: jest.fn(),
    readScenariosExecutor: jest.fn(() => "inline"),
}));
jest.mock("~/server/scenarios/evidence", () => ({
    visibleDocumentIds: jest.fn(async () => new Set<number>()),
    brandIdentity: jest.fn(),
}));
jest.mock("~/server/profile/store", () => ({
    workspaceLooks: jest.fn(async (_c: bigint, ids: Iterable<string>) => {
        const out = new Map();
        for (const id of ids) out.set(id, { displayName: "Ana", member: id !== "gone" });
        return out;
    }),
}));
jest.mock("~/lib/credits", () => ({ getBalance: jest.fn(), debitTokens: jest.fn() }));
jest.mock("~/server/deployment", () => ({ isMeteringEnforced: jest.fn(() => false) }));
jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("~/server/workspace-models/scope", () => ({
    withWorkspaceChatModels: jest.fn((_companyId: unknown, fn: () => unknown) => fn()),
}));

const mockDb = jest.requireMock<{ getCompanyRun: jest.Mock; listVisibleRuns: jest.Mock }>(
    "@launchstack/pipelines/scenarios/db"
);

import { GET as getRun } from "~/app/api/scenarios/[id]/route";
import { GET as listRoute, POST as createRoute } from "~/app/api/scenarios/route";
import { SCENARIO_LIMITS } from "~/lib/scenarios/types";
import { leftWorkspaceName, runErrorText, sourceLabel } from "~/server/scenarios/views";

const ZH = { cookie: "ls-locale=zh-CN.1" };

function run(overrides: Partial<ScenarioRunRecord> = {}): ScenarioRunRecord {
    return {
        id: 3,
        companyId: 5n,
        createdByUserId: "creator",
        kind: "scenario",
        title: "Price rise",
        subject: "We raise prices.",
        status: "failed",
        step: 3,
        agentCount: 2,
        roundCount: 4,
        seed: 1,
        sources: {
            documentIds: [],
            searchFiles: false,
            prospects: true,
            brandComments: true,
            companyProfile: true,
            notes: "news",
        },
        evidence: [
            {
                id: "E1",
                kind: "document",
                label: "Board memo.pdf, page 3",
                text: "Plan.",
                ref: { type: "document", id: "7" },
                href: null,
                documentIds: [],
            },
            {
                id: "E2",
                kind: "notes",
                label: "Pasted material, part 2",
                text: "News.",
                ref: { type: "notes", id: "2" },
                href: null,
                documentIds: [],
            },
            {
                id: "E3",
                kind: "prospect",
                label: "Prospect: Acme Corp",
                text: "Acme.",
                ref: { type: "prospect", id: "p1" },
                href: null,
                documentIds: [],
            },
            {
                id: "E4",
                kind: "brand_comment",
                label: "Comment on your linkedin post",
                text: "Nice.",
                ref: { type: "brand_comment", id: "c1" },
                href: null,
                documentIds: [],
            },
        ],
        brief: null,
        world: createWorld({
            subject: "Price rise",
            brief: "Background.",
            personas: [],
            accounts: [],
            seedPosts: [],
        }),
        report: null,
        reception: null,
        estimate: { calls: 10, inputTokens: 100, outputTokens: 10, credits: 110 },
        usage: { calls: 4, inputTokens: 40, outputTokens: 4, credits: 44 },
        draft: null,
        draftHash: null,
        error: "Only 2 people could be built from the sources",
        sharedAt: new Date("2026-10-18T00:00:00Z"),
        cancelRequestedAt: null,
        leaseUntil: null,
        createdAt: new Date("2026-10-17T00:00:00Z"),
        startedAt: null,
        finishedAt: null,
        eventsClosedAt: null,
        ...overrides,
    };
}

function signIn(authUserId = "creator") {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ authUserId, role: "member", companyId: 5n }),
    });
}

const get = (id: string, headers: Record<string, string> = {}) =>
    getRun(new Request(`http://x/api/scenarios/${id}`, { headers }) as never, {
        params: Promise.resolve({ id }),
    });

beforeEach(() => {
    jest.clearAllMocks();
    signIn();
});

describe("refusals", () => {
    it("say a malformed id and a private run alike in Chinese, keeping the code", async () => {
        const malformed = await get("abc", ZH);
        expect(malformed.status).toBe(404);
        expect(await malformed.json()).toEqual({ error: "找不到这个情景" });

        mockDb.getCompanyRun.mockResolvedValue(run({ sharedAt: null }));
        signIn("someone");
        const hidden = await get("3", ZH);
        expect(hidden.status).toBe(404);
        expect(await hidden.json()).toEqual({ error: "找不到这个情景", code: "not_found" });

        const english = await get("3");
        expect(await english.json()).toEqual({ error: "Scenario not found", code: "not_found" });
    });

    it("say a form's problem in Chinese", async () => {
        const res = await createRoute(
            new Request("http://x/api/scenarios", {
                method: "POST",
                body: JSON.stringify({ subject: "x".repeat(SCENARIO_LIMITS.subjectMax + 1) }),
                headers: ZH,
            }) as never
        );
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({
            error: `情况描述请控制在 ${SCENARIO_LIMITS.subjectMax} 个字符以内。`,
            code: "invalid",
        });
    });
});

describe("a run's details", () => {
    it("label the evidence and the failure in Chinese, keeping names and titles", async () => {
        mockDb.getCompanyRun.mockResolvedValue(run({ createdByUserId: "gone" }));
        signIn("reader");
        const res = await get("3", ZH);
        const { run: detail } = (await res.json()) as {
            run: { sources: { label: string }[]; error: string; createdByName: string };
        };
        expect(detail.sources.map(s => s.label)).toEqual([
            "Board memo.pdf，第 3 页",
            "粘贴的材料（第 2 部分）",
            "潜在客户：Acme Corp",
            "你在 linkedin 上的帖子下的评论",
        ]);
        expect(detail.error).toBe("根据这些来源只能构建 2 个人物");
        expect(detail.createdByName).toBe("已离开的成员");
    });

    it("are the stored English without the cookie", async () => {
        mockDb.getCompanyRun.mockResolvedValue(run({ createdByUserId: "gone" }));
        signIn("reader");
        const res = await get("3");
        const { run: detail } = (await res.json()) as {
            run: { sources: { label: string }[]; error: string; createdByName: string };
        };
        expect(detail.sources.map(s => s.label)).toEqual([
            "Board memo.pdf, page 3",
            "Pasted material, part 2",
            "Prospect: Acme Corp",
            "Comment on your linkedin post",
        ]);
        expect(detail.error).toBe("Only 2 people could be built from the sources");
        expect(detail.createdByName).toBe("Someone who has left");
    });

    it("name a creator who left in the list too", async () => {
        mockDb.listVisibleRuns.mockResolvedValue([
            { ...run({ createdByUserId: "gone" }), headline: null },
        ]);
        const res = await listRoute(new Request("http://x/api/scenarios", { headers: ZH }));
        const { runs } = (await res.json()) as { runs: { createdByName: string }[] };
        expect(runs[0]!.createdByName).toBe("已离开的成员");
    });
});

describe("the words themselves", () => {
    it("leave a document title, a provider's error and English alone", () => {
        expect(sourceLabel("document", "Board memo.pdf", "zh-CN")).toBe("Board memo.pdf");
        expect(sourceLabel("search", "A file", "zh-CN")).toBe("一个文件");
        expect(sourceLabel("notes", "Pasted material", "en")).toBe("Pasted material");
        expect(runErrorText("429 Too Many Requests", "zh-CN")).toBe("429 Too Many Requests");
        expect(runErrorText("The workspace ran out of credits during this run.", "zh-CN")).toBe(
            "这次运行期间，工作区的额度用完了。"
        );
        expect(leftWorkspaceName()).toBe("Someone who has left");
    });
});
