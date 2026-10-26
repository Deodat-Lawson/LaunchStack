/**
 * What `/api/vantage/*` says, in the reader's language: a form's field
 * message, the pipeline's VantageError, a route's own refusal and the CSV
 * importer's problems are Chinese behind the `ls-locale` cookie and exactly
 * the old English without it. Codes stay codes.
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

const mockRecordDecision = jest.fn();
const mockParseMetricCsv = jest.fn();

jest.mock("@launchstack/pipelines/vantage", () => ({
    VantageError: class VantageError extends Error {
        readonly status: number;
        readonly code: string;
        constructor(message: string, status: number, code: string) {
            super(message);
            this.status = status;
            this.code = code;
        }
    },
    VANTAGE_EVIDENCE_KINDS: ["note", "interview", "link", "task", "claim", "document"],
    VANTAGE_VISIBILITIES: ["private", "shared"],
    VANTAGE_COMMITMENT_STATUSES: ["open", "done", "missed", "dropped"],
    isIsoDate: (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value),
    recordDecision: (...args: unknown[]) => mockRecordDecision(...args),
    undoDecision: jest.fn(),
    parseMetricCsv: (...args: unknown[]) => mockParseMetricCsv(...args),
    ensureMetricDefinitions: jest.fn(async () => []),
    createMetricDefinition: jest.fn(),
    createObservations: jest.fn(async () => 0),
    slugKey: (s: string) => s.toLowerCase(),
}));

jest.mock("~/server/vantage/service", () => ({ loadTriage: jest.fn() }));

import { NextRequest } from "next/server";

import { VantageError } from "@launchstack/pipelines/vantage";

import { POST as decide } from "~/app/api/vantage/topics/[id]/decide/route";
import { POST as importCsv } from "~/app/api/vantage/metrics/import/route";
import { GET as triage } from "~/app/api/vantage/triage/route";

const ZH = { cookie: "ls-locale=zh-CN.1" };

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
    return new NextRequest(`http://localhost${url}`, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json", ...headers },
    });
}

const params = { params: Promise.resolve({ id: "t1" }) };

function signInAs(role: string) {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ role, authUserId: "user-1", companyId: BigInt(42) }),
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    signInAs("member");
});

describe("a form's field message", () => {
    it("is the schema's own sentence in Chinese, with the field name as it is", async () => {
        const response = await decide(
            post("/api/vantage/topics/t1/decide", { decision: "", commitment: null }, ZH),
            params
        );
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "decision: 请写下决定" });
    });

    it("is unchanged in English", async () => {
        const response = await decide(
            post("/api/vantage/topics/t1/decide", { decision: "", commitment: null }),
            params
        );
        expect(await response.json()).toEqual({ error: "decision: write the decision" });
    });

    it("rewords zod's own default when the schema gave none", async () => {
        const response = await decide(
            post("/api/vantage/topics/t1/decide", { decision: "Ship it", commitment: 5 }, ZH),
            params
        );
        const body = (await response.json()) as { error: string };
        expect(body.error.startsWith("commitment: ")).toBe(true);
        expect(body.error).not.toMatch(/Expected|received/);
    });
});

describe("a VantageError", () => {
    it("says the pipeline's sentence in Chinese and keeps its code", async () => {
        mockRecordDecision.mockRejectedValue(
            new VantageError("That topic is not here.", 404, "not_found")
        );
        const response = await decide(
            post("/api/vantage/topics/t1/decide", { decision: "Ship it", commitment: null }, ZH),
            params
        );
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: "找不到这个议题。", code: "not_found" });
    });

    it("fills a template's value in", async () => {
        mockRecordDecision.mockRejectedValue(
            new VantageError('A metric with the key "mrr" already exists.', 409, "conflict")
        );
        const response = await decide(
            post("/api/vantage/topics/t1/decide", { decision: "Ship it", commitment: null }, ZH),
            params
        );
        expect(await response.json()).toEqual({
            error: "键为“mrr”的指标已存在。",
            code: "conflict",
        });
    });

    it("leaves a sentence the catalogue does not know as it came", async () => {
        mockRecordDecision.mockRejectedValue(new VantageError("Something new.", 409, "conflict"));
        const response = await decide(
            post("/api/vantage/topics/t1/decide", { decision: "Ship it", commitment: null }, ZH),
            params
        );
        expect(await response.json()).toEqual({ error: "Something new.", code: "conflict" });
    });
});

describe("a route's own refusal", () => {
    it("is Chinese behind the cookie and English without it", async () => {
        const zh = await triage(
            new NextRequest("http://localhost/api/vantage/triage", { headers: ZH })
        );
        expect(zh.status).toBe(403);
        expect(await zh.json()).toEqual({
            error: "只有工作区管理员可以查看各团队的求助情况。",
            permission: "settings.manage",
        });
        const en = await triage(new NextRequest("http://localhost/api/vantage/triage"));
        expect(await en.json()).toEqual({
            error: "Only a workspace admin can see program triage.",
            permission: "settings.manage",
        });
    });
});

describe("the CSV importer's problems", () => {
    const problems = [
        { line: 1, message: "Missing metric." },
        { line: 3, message: '"abc" is not a number.' },
        { line: 4, message: 'Period must be YYYY-MM-DD (got "May" to "?").' },
        { line: 5, message: "Some parser sentence nobody wrote down." },
    ];

    it("come back in Chinese with their line numbers", async () => {
        mockParseMetricCsv.mockReturnValue({ rows: [], problems });
        const response = await importCsv(post("/api/vantage/metrics/import", { csv: "x" }, ZH));
        expect(await response.json()).toEqual({
            imported: 0,
            createdMetrics: [],
            problems: [
                { line: 1, message: "缺少指标。" },
                { line: 3, message: "“abc”不是数字。" },
                { line: 4, message: "周期必须是 YYYY-MM-DD 格式（收到的是“May”到“?”）。" },
                { line: 5, message: "Some parser sentence nobody wrote down." },
            ],
        });
    });

    it("are unchanged in English", async () => {
        mockParseMetricCsv.mockReturnValue({ rows: [], problems });
        const response = await importCsv(post("/api/vantage/metrics/import", { csv: "x" }));
        expect(await response.json()).toEqual({ imported: 0, problems, createdMetrics: [] });
    });
});
