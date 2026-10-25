/**
 * The weekly-review routes answer in the reader's language: their own
 * "Unauthorized" / "Invalid request", and the review pipeline's
 * status-carrying errors, are Chinese behind the `ls-locale` cookie and the
 * old English without it. `code` values stay as they are.
 */
jest.mock("~/server/auth", () => ({ getServerSession: jest.fn() }));

import { getServerSession } from "~/server/auth";
import { createFounderWeeklyReviewGetHandler } from "~/app/api/founder-weekly-reviews/[runId]/get-handler";
import { createFounderWeeklyReviewRetryPostHandler } from "~/app/api/founder-weekly-reviews/[runId]/retry/retry-handler";
import {
    FounderWeeklyReviewInvalidTransitionError,
    FounderWeeklyReviewNotFoundError,
} from "@launchstack/pipelines/founder-weekly-review";

const mockAuth = getServerSession as unknown as jest.Mock;
const actor = { externalUserId: "u", internalUserId: 1n, companyId: 1n, role: "owner" };
const ZH = { cookie: "ls-locale=zh-CN.1" };
const params = { params: Promise.resolve({ runId: "fwr_1" }) };

function getHandler(error: Error) {
    return createFounderWeeklyReviewGetHandler({
        actorResolver: { resolve: jest.fn(async () => actor) },
        getRun: jest.fn(async () => {
            throw error;
        }),
    });
}

describe("weekly-review route errors", () => {
    beforeEach(() => mockAuth.mockResolvedValue({ user: { id: "u" } }));

    it("say the pipeline's not-found in Chinese with its code, English unchanged", async () => {
        const GET = getHandler(new FounderWeeklyReviewNotFoundError("fwr_1"));
        const zh = await GET(new Request("http://x", { headers: ZH }), params);
        expect(zh.status).toBe(404);
        expect(await zh.json()).toEqual({
            success: false,
            message: "找不到创始人每周回顾运行“fwr_1”。",
            code: "not_found",
        });
        const en = await GET(new Request("http://x"), params);
        expect(await en.json()).toEqual({
            success: false,
            message: 'Founder weekly review run "fwr_1" was not found.',
            code: "not_found",
        });
    });

    it("say an impossible transition in Chinese without the English verb", async () => {
        const GET = getHandler(new FounderWeeklyReviewInvalidTransitionError("queued", "retry"));
        const zh = await GET(new Request("http://x", { headers: ZH }), params);
        expect(zh.status).toBe(409);
        expect(await zh.json()).toMatchObject({
            message: "创始人每周回顾运行处于“queued”状态，无法重试。",
            code: "invalid_transition",
        });
    });

    it("say the generic 500 in Chinese", async () => {
        const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
        const GET = getHandler(new Error("db exploded"));
        const zh = await GET(new Request("http://x", { headers: ZH }), params);
        expect(zh.status).toBe(500);
        expect(((await zh.json()) as { message: string }).message).not.toMatch(/[A-Za-z]{4}/);
        log.mockRestore();
    });

    it("say their own refusals in Chinese", async () => {
        mockAuth.mockResolvedValue(null);
        const POST = createFounderWeeklyReviewRetryPostHandler({
            actorResolver: { resolve: jest.fn() },
            retryRunWithDispatch: jest.fn(),
            sendDispatchRequested: jest.fn(),
            incrementRetry: jest.fn(),
        });
        const unauthorized = await POST(
            new Request("http://x", { method: "POST", body: "{}", headers: ZH }),
            params
        );
        expect(unauthorized.status).toBe(401);
        expect(await unauthorized.json()).toEqual({
            success: false,
            message: "未登录或登录已失效",
        });

        mockAuth.mockResolvedValue({ user: { id: "u" } });
        const invalid = await POST(
            new Request("http://x", { method: "POST", body: "{}", headers: ZH }),
            params
        );
        expect(invalid.status).toBe(400);
        expect(await invalid.json()).toEqual({ success: false, message: "请求无效" });

        const english = await POST(new Request("http://x", { method: "POST", body: "{}" }), params);
        expect(await english.json()).toEqual({ success: false, message: "Invalid request" });
    });
});
