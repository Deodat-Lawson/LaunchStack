/**
 * The feedback routes: who gets in (401), the feature switch (403), the
 * multipart contract of POST /api/feedback (400s, images re-encoded, the
 * reporter's workspace soft-resolved), the per-user create budget (429), and
 * how each route turns the store's refusals into status codes. The store is
 * mocked here — its visibility rules run against Postgres in
 * __tests__/server/feedback/store.integration.test.ts.
 */

jest.mock("server-only", () => ({}), { virtual: true });

// `better-auth.session_token=<id>` is <id>'s session for the limiter;
// `mockSession` is what the routes' own session read sees.
let mockSession: { user: { id: string; email: string } } | null = null;
jest.mock("~/server/auth", () => ({
    getServerSession: () => Promise.resolve(mockSession),
    getSessionFromHeaders: (headers: Headers) => {
        const token = /better-auth\.session_token=([^;]+)/.exec(headers.get("cookie") ?? "")?.[1];
        return Promise.resolve(token ? { user: { id: token } } : null);
    },
}));

const mockRequireWorkspaceContext = jest.fn();
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspaceContext: () => mockRequireWorkspaceContext(),
}));

jest.mock("~/server/feedback/store", () => ({
    listFeedback: jest.fn(),
    getFeedbackReport: jest.fn(),
    createFeedbackReport: jest.fn(),
    updateFeedbackReport: jest.fn(),
    replyToFeedback: jest.fn(),
    setFeedbackVote: jest.fn(),
    readFeedbackAttachment: jest.fn(),
}));

jest.mock("~/server/feedback/webhook", () => ({ queueFeedbackWebhook: jest.fn() }));

import sharp from "sharp";

import { GET as ME } from "~/app/api/feedback/me/route";
import { GET as LIST, POST as CREATE } from "~/app/api/feedback/route";
import { GET as READ, PATCH } from "~/app/api/feedback/[id]/route";
import { POST as REPLY } from "~/app/api/feedback/[id]/replies/route";
import { DELETE as UNVOTE, PUT as VOTE } from "~/app/api/feedback/[id]/vote/route";
import { GET as ATTACHMENT } from "~/app/api/feedback/[id]/attachments/[attachmentId]/route";
import { copy } from "~/i18n/copy";
import { clearRateLimitStore } from "~/lib/rate-limiter";
import type { FeedbackDetail } from "~/lib/feedback/contract";
import * as store from "~/server/feedback/store";
import { queueFeedbackWebhook } from "~/server/feedback/webhook";
import { badRequest, forbidden, notFound } from "~/server/workspace/errors";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mocked = jest.mocked(store);
const ADMIN = "ops@example.com";

const env = { ...process.env };

function signIn(id: string, email: string) {
    mockSession = { user: { id, email } };
}

function req(path: string, init: RequestInit & { user?: string; locale?: string } = {}) {
    const { user, locale, headers, ...rest } = init;
    const cookie = [
        user ? `better-auth.session_token=${user}` : null,
        locale ? `ls-locale=${locale}` : null,
    ]
        .filter(Boolean)
        .join("; ");
    return new Request(`http://localhost${path}`, {
        ...rest,
        headers: { ...(cookie ? { cookie } : {}), ...(headers as Record<string, string>) },
    });
}

function json(path: string, method: string, body: unknown, user = "auth-ada") {
    return req(path, {
        method,
        user,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

function multipart(payload: unknown, files: Blob[] = [], user = "auth-ada", locale?: string) {
    const form = new FormData();
    if (payload !== undefined) {
        form.set("payload", typeof payload === "string" ? payload : JSON.stringify(payload));
    }
    for (const file of files) form.append("files", file, "shot.png");
    return req("/api/feedback", { method: "POST", user, locale, body: form });
}

async function pngBlob(width = 64, height = 48): Promise<Blob> {
    const bytes = await sharp({
        create: { width, height, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
        .png()
        .toBuffer();
    return new Blob([new Uint8Array(bytes)], { type: "image/png" });
}

const params = <T extends Record<string, string>>(value: T) => ({
    params: Promise.resolve(value),
});

const DETAIL = { id: 9, kind: "bug", title: "Upload fails" } as unknown as FeedbackDetail;

beforeEach(() => {
    clearRateLimitStore();
    jest.clearAllMocks();
    process.env = {
        ...env,
        FEEDBACK_ADMIN_EMAILS: ADMIN,
        BETTER_AUTH_URL: "https://app.example.com",
    };
    signIn("auth-ada", "ada@example.com");
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ authUserId: "auth-ada", companyId: 5n }),
    });
    mocked.createFeedbackReport.mockResolvedValue({
        id: 9,
        kind: "bug",
        title: "Upload fails",
        severity: "blocking",
    });
    mocked.getFeedbackReport.mockResolvedValue(DETAIL);
});

afterAll(() => {
    process.env = env;
});

describe("GET /api/feedback/me", () => {
    it("is 401 without a session", async () => {
        mockSession = null;
        const res = await ME(req("/api/feedback/me"));
        expect(res.status).toBe(401);
        await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    });

    it("says off while nobody triages", async () => {
        delete process.env.FEEDBACK_ADMIN_EMAILS;
        const res = await ME(req("/api/feedback/me", { user: "auth-ada" }));
        await expect(res.json()).resolves.toEqual({ enabled: false, triager: false });
    });

    it("names triagers by the session's email, case-insensitively", async () => {
        await expect((await ME(req("/api/feedback/me"))).json()).resolves.toEqual({
            enabled: true,
            triager: false,
        });
        signIn("auth-ops", "OPS@Example.com");
        await expect((await ME(req("/api/feedback/me"))).json()).resolves.toEqual({
            enabled: true,
            triager: true,
        });
    });
});

describe("POST /api/feedback", () => {
    const BUG = {
        kind: "bug",
        title: "  Upload fails  ",
        body: "It spins forever.",
        severity: "blocking",
        context: { path: "/employer/documents", appVersion: "client-claims-this" },
    };

    it("is 401 without a session", async () => {
        mockSession = null;
        expect((await CREATE(multipart(BUG))).status).toBe(401);
        expect(mocked.createFeedbackReport).not.toHaveBeenCalled();
    });

    it("is 403, with a sentence, while the feature is off", async () => {
        process.env.FEEDBACK_ADMIN_EMAILS = "";
        const res = await CREATE(multipart(BUG));
        expect(res.status).toBe(403);
        await expect(res.json()).resolves.toEqual({
            error: "Feedback is turned off on this instance: nobody has been named to read reports yet.",
        });
        expect(mocked.createFeedbackReport).not.toHaveBeenCalled();
    });

    it("answers in the reader's language", async () => {
        process.env.FEEDBACK_ADMIN_EMAILS = "";
        const res = await CREATE(multipart(BUG, [], "auth-ada", "zh-CN.1"));
        const body = (await res.json()) as { error: string };
        expect(body.error).toBe("此实例未开启反馈：还没有指定处理反馈的人员。");
    });

    it.each([
        [
            "a JSON body",
            () => json("/api/feedback", "POST", BUG),
            "Send the report as multipart form data.",
        ],
        [
            "no payload field",
            () => multipart(undefined, []),
            "The report is missing its payload field.",
        ],
        [
            "a payload that is not JSON",
            () => multipart("{nope", []),
            "The report's payload field is not valid JSON.",
        ],
    ])("is 400 for %s", async (_label, make, error) => {
        const res = await CREATE(make());
        expect(res.status).toBe(400);
        await expect(res.json()).resolves.toEqual({ error });
    });

    it("is 400 for a payload the contract refuses", async () => {
        const res = await CREATE(multipart({ ...BUG, title: "   " }));
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toMatch(/^Invalid request: /);
        expect(body.error).toContain("title");
    });

    it("is 400 for more than three images", async () => {
        const png = await pngBlob();
        const res = await CREATE(multipart(BUG, [png, png, png, png]));
        expect(res.status).toBe(400);
        await expect(res.json()).resolves.toEqual({ error: "Attach at most 3 images." });
    });

    it("is 400 for a file that is not an image", async () => {
        const text = new Blob(["hello"], { type: "text/plain" });
        const res = await CREATE(multipart(BUG, [text]));
        expect(res.status).toBe(400);
        await expect(res.json()).resolves.toEqual({
            error: "Attach PNG, JPEG, WebP or GIF images.",
        });

        const fake = new Blob(["not really a png"], { type: "image/png" });
        const again = await CREATE(multipart(BUG, [fake]));
        expect(again.status).toBe(400);
        await expect(again.json()).resolves.toEqual({
            error: "One of the images couldn't be read. Try a PNG or JPEG.",
        });
        expect(mocked.createFeedbackReport).not.toHaveBeenCalled();
    });

    it("is 400 for an image over 5 MB, before reading it", async () => {
        const big = new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: "image/png" });
        const res = await CREATE(multipart(BUG, [big]));
        expect(res.status).toBe(400);
        await expect(res.json()).resolves.toEqual({ error: "Each image must be 5 MB or smaller." });
    });

    it("is 413 for a body larger than three full-size images, before parsing it", async () => {
        const res = await CREATE(
            req("/api/feedback", {
                method: "POST",
                user: "auth-ada",
                headers: { "content-length": String(17 * 1024 * 1024) },
                body: "x",
            })
        );
        expect(res.status).toBe(413);
        await expect(res.json()).resolves.toEqual({
            error: "The report is too large to send: attach at most 3 images of up to 5 MB each.",
        });
    });

    it("parses the multipart report, re-encodes the images, and answers 201 with the report", async () => {
        const res = await CREATE(multipart(BUG, [await pngBlob(), await pngBlob(32, 32)]));

        expect(res.status).toBe(201);
        await expect(res.json()).resolves.toEqual({ report: DETAIL });

        const args = mocked.createFeedbackReport.mock.calls[0]![0];
        expect(args.reporter).toEqual({
            authUserId: "auth-ada",
            email: "ada@example.com",
            triager: false,
            companyId: 5n,
        });
        expect(args.input).toEqual({
            kind: "bug",
            title: "Upload fails",
            body: "It spins forever.",
            severity: "blocking",
            // Unknown keys never reach the store: the server stamps appVersion.
            context: { path: "/employer/documents" },
        });
        expect(args.images.map(image => [image.contentType, image.width, image.height])).toEqual([
            ["image/webp", 64, 48],
            ["image/webp", 32, 32],
        ]);
        expect(mocked.getFeedbackReport).toHaveBeenCalledWith(
            expect.objectContaining({ authUserId: "auth-ada" }),
            9
        );
        // The channel hears about it, linked on the public origin.
        expect(queueFeedbackWebhook).toHaveBeenCalledWith(
            { id: 9, kind: "bug", title: "Upload fails", severity: "blocking" },
            "https://app.example.com"
        );
    });

    it("files from the workspace picker, with no workspace", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: false,
            response: new Response(null, { status: 403 }),
        });
        const res = await CREATE(multipart({ kind: "idea", title: "Dark mode" }));
        expect(res.status).toBe(201);
        const args = mocked.createFeedbackReport.mock.calls[0]![0];
        expect(args.reporter.companyId).toBeNull();
        expect(args.input).toMatchObject({ kind: "idea", body: "", context: {} });
        expect(args.images).toEqual([]);
    });

    it("passes the store's refusals through", async () => {
        mocked.createFeedbackReport.mockRejectedValueOnce(
            forbidden(copy("errors.feedback.disabled"))
        );
        const res = await CREATE(multipart(BUG));
        expect(res.status).toBe(403);
        expect(queueFeedbackWebhook).not.toHaveBeenCalled();
    });

    it("allows each person ten reports per fifteen minutes, then 429", async () => {
        for (let i = 0; i < 10; i++) {
            expect((await CREATE(multipart(BUG))).status).toBe(201);
        }
        const refused = await CREATE(multipart(BUG));
        expect(refused.status).toBe(429);
        expect(refused.headers.get("Retry-After")).toMatch(/^\d+$/);
        await expect(refused.json()).resolves.toMatchObject({
            success: false,
            error: "Rate Limit Exceeded",
            retryAfter: expect.any(Number),
        });
        expect(mocked.createFeedbackReport).toHaveBeenCalledTimes(10);

        // Someone else's budget is their own.
        signIn("auth-bob", "bob@example.com");
        expect((await CREATE(multipart(BUG, [], "auth-bob"))).status).toBe(201);
    });
});

describe("GET /api/feedback", () => {
    it("is 401 without a session", async () => {
        mockSession = null;
        expect((await LIST(req("/api/feedback?scope=ideas"))).status).toBe(401);
    });

    it("is 400 without a valid scope", async () => {
        expect((await LIST(req("/api/feedback"))).status).toBe(400);
        expect((await LIST(req("/api/feedback?scope=everything"))).status).toBe(400);
        expect(mocked.listFeedback).not.toHaveBeenCalled();
    });

    it("hands the parsed query, with its defaults, to the store", async () => {
        mocked.listFeedback.mockResolvedValue([]);
        const res = await LIST(req("/api/feedback?scope=ideas&q=%20dark%20&status=planned&sort="));
        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({ items: [] });
        expect(mocked.listFeedback).toHaveBeenCalledWith(
            { authUserId: "auth-ada", email: "ada@example.com", triager: false },
            { scope: "ideas", q: "dark", status: "planned", sort: "recent", limit: 50 }
        );
    });

    it("is 403 for triage when the store says so", async () => {
        mocked.listFeedback.mockRejectedValue(forbidden(copy("errors.feedback.triagersOnly")));
        const res = await LIST(req("/api/feedback?scope=triage"));
        expect(res.status).toBe(403);
        await expect(res.json()).resolves.toEqual({
            error: "Only the people who triage feedback can do that.",
        });
    });
});

describe("GET /api/feedback/[id]", () => {
    it("is 400 for an id that is not one", async () => {
        const res = await READ(req("/api/feedback/abc"), params({ id: "abc" }));
        expect(res.status).toBe(400);
    });

    it("is 404 for a report the caller cannot see", async () => {
        mocked.getFeedbackReport.mockRejectedValue(notFound());
        const res = await READ(req("/api/feedback/3"), params({ id: "3" }));
        expect(res.status).toBe(404);
        await expect(res.json()).resolves.toEqual({ error: "Not found" });
    });

    it("returns the report", async () => {
        const res = await READ(req("/api/feedback/9"), params({ id: "9" }));
        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({ report: DETAIL });
    });

    it("never leaks a store failure", async () => {
        const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
        mocked.getFeedbackReport.mockRejectedValue(new Error("pg: relation missing"));
        const res = await READ(req("/api/feedback/9"), params({ id: "9" }));
        expect(res.status).toBe(500);
        await expect(res.json()).resolves.toEqual({ error: "Internal server error" });
        error.mockRestore();
    });
});

describe("PATCH /api/feedback/[id]", () => {
    it("is 403 for a non-triager, whatever the id", async () => {
        const res = await PATCH(
            json("/api/feedback/9", "PATCH", { status: "done" }),
            params({ id: "9" })
        );
        expect(res.status).toBe(403);
        expect(mocked.updateFeedbackReport).not.toHaveBeenCalled();
    });

    it("is 400 for a body that changes nothing", async () => {
        signIn("auth-ops", ADMIN);
        const res = await PATCH(json("/api/feedback/9", "PATCH", {}), params({ id: "9" }));
        expect(res.status).toBe(400);
    });

    it("lets a triager change status and severity", async () => {
        signIn("auth-ops", ADMIN);
        mocked.updateFeedbackReport.mockResolvedValue(DETAIL);
        const res = await PATCH(
            json("/api/feedback/9", "PATCH", { status: "in_progress", severity: null }),
            params({ id: "9" })
        );
        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({ report: DETAIL });
        expect(mocked.updateFeedbackReport).toHaveBeenCalledWith(
            { authUserId: "auth-ops", email: ADMIN, triager: true },
            9,
            { status: "in_progress", severity: null }
        );
    });

    it("is 400 for a severity on an idea", async () => {
        signIn("auth-ops", ADMIN);
        mocked.updateFeedbackReport.mockRejectedValue(
            badRequest(copy("errors.feedback.severityBugsOnly"))
        );
        const res = await PATCH(
            json("/api/feedback/9", "PATCH", { severity: "cosmetic" }),
            params({ id: "9" })
        );
        expect(res.status).toBe(400);
        await expect(res.json()).resolves.toEqual({ error: "Only bug reports have a severity." });
    });
});

describe("POST /api/feedback/[id]/replies", () => {
    it("is 400 for an empty reply", async () => {
        const res = await REPLY(
            json("/api/feedback/9/replies", "POST", { body: "   " }),
            params({ id: "9" })
        );
        expect(res.status).toBe(400);
        expect(mocked.replyToFeedback).not.toHaveBeenCalled();
    });

    it("answers 201 with the reply", async () => {
        const reply = {
            id: 1,
            body: "Still broken",
            fromTeam: false,
            mine: true,
            author: { name: "Ada" },
            createdAt: "2026-10-25T12:00:00.000Z",
        };
        mocked.replyToFeedback.mockResolvedValue(reply);
        const res = await REPLY(
            json("/api/feedback/9/replies", "POST", { body: " Still broken " }),
            params({ id: "9" })
        );
        expect(res.status).toBe(201);
        await expect(res.json()).resolves.toEqual({ reply });
        expect(mocked.replyToFeedback).toHaveBeenCalledWith(
            expect.objectContaining({ authUserId: "auth-ada" }),
            9,
            "Still broken"
        );
    });

    it("is 403 on someone else's idea", async () => {
        mocked.replyToFeedback.mockRejectedValue(forbidden(copy("errors.feedback.cannotReply")));
        const res = await REPLY(
            json("/api/feedback/9/replies", "POST", { body: "+1" }),
            params({ id: "9" })
        );
        expect(res.status).toBe(403);
    });
});

describe("PUT / DELETE /api/feedback/[id]/vote", () => {
    it("votes and withdraws", async () => {
        mocked.setFeedbackVote.mockResolvedValueOnce({ votes: 4, voted: true });
        const put = await VOTE(req("/api/feedback/9/vote", { method: "PUT" }), params({ id: "9" }));
        await expect(put.json()).resolves.toEqual({ votes: 4, voted: true });
        expect(mocked.setFeedbackVote).toHaveBeenLastCalledWith(
            expect.objectContaining({ authUserId: "auth-ada" }),
            9,
            true
        );

        mocked.setFeedbackVote.mockResolvedValueOnce({ votes: 3, voted: false });
        const del = await UNVOTE(
            req("/api/feedback/9/vote", { method: "DELETE" }),
            params({ id: "9" })
        );
        await expect(del.json()).resolves.toEqual({ votes: 3, voted: false });
        expect(mocked.setFeedbackVote).toHaveBeenLastCalledWith(expect.anything(), 9, false);
    });

    it("is 400 for a bug", async () => {
        mocked.setFeedbackVote.mockRejectedValue(
            badRequest(copy("errors.feedback.votesIdeasOnly"))
        );
        const res = await VOTE(req("/api/feedback/9/vote", { method: "PUT" }), params({ id: "9" }));
        expect(res.status).toBe(400);
        await expect(res.json()).resolves.toEqual({ error: "Only feature requests take votes." });
    });
});

describe("GET /api/feedback/[id]/attachments/[attachmentId]", () => {
    it("is 404 when the caller may not see it", async () => {
        mocked.readFeedbackAttachment.mockResolvedValue(null);
        const res = await ATTACHMENT(
            req("/api/feedback/9/attachments/2"),
            params({ id: "9", attachmentId: "2" })
        );
        expect(res.status).toBe(404);
        expect(
            (
                await ATTACHMENT(
                    req("/api/feedback/9/attachments/x"),
                    params({ id: "9", attachmentId: "x" })
                )
            ).status
        ).toBe(404);
    });

    it("serves the bytes, cached privately forever and never sniffed", async () => {
        mocked.readFeedbackAttachment.mockResolvedValue({
            contentType: "image/webp",
            data: Buffer.from("RIFFwebp"),
        });
        const res = await ATTACHMENT(
            req("/api/feedback/9/attachments/2"),
            params({ id: "9", attachmentId: "2" })
        );
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toBe("image/webp");
        expect(res.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
        expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
        expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("RIFFwebp");
        expect(mocked.readFeedbackAttachment).toHaveBeenCalledWith(
            expect.objectContaining({ authUserId: "auth-ada" }),
            9,
            2
        );
    });
});
