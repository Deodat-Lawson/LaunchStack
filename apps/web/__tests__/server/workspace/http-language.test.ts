/**
 * The shared response helpers answer in the reader's language when handed
 * the request, and keep their English for everyone else.
 */

import { z } from "zod";

import { copy } from "~/i18n/copy";
import { V } from "~/i18n/validation";
import { handleApiError } from "~/lib/api-utils";
import { validateRequestBody } from "~/lib/validation";
import { handleRouteError } from "~/server/api/responses";
import { handleRouteError as handleDistributionError } from "~/server/distribution/http";
import { notFound } from "~/server/workspace/errors";
import { invalidIdResponse, parseJsonBody, workspaceErrorResponse } from "~/server/workspace/http";

const english = (body?: string) => new Request("http://x/api", { method: "POST", body });
const chinese = (body?: string) =>
    new Request("http://x/api", {
        method: "POST",
        body,
        headers: { cookie: "ls-locale=zh-CN.1" },
    });

async function errorOf(response: Response): Promise<unknown> {
    return ((await response.json()) as { error?: unknown; message?: unknown }).error;
}

describe("workspace errors", () => {
    const error = notFound(copy("errors.api.documentNotFound"));

    it("keep the English as the message and word the copy per reader", async () => {
        expect(error.message).toBe("Document not found");
        expect(await errorOf(workspaceErrorResponse(error, "test"))).toBe("Document not found");
        expect(await errorOf(workspaceErrorResponse(error, "test", chinese()))).toBe(
            "未找到该文档"
        );
    });

    it("pass a plain string through as it was", async () => {
        const plain = notFound("Folder not found");
        expect(await errorOf(workspaceErrorResponse(plain, "test", chinese()))).toBe(
            "Folder not found"
        );
    });

    it("word the generic 500 and the bad id", async () => {
        jest.spyOn(console, "error").mockImplementation(() => undefined);
        expect(await errorOf(workspaceErrorResponse(new Error("boom"), "test", chinese()))).toBe(
            "服务器内部错误"
        );
        expect(await errorOf(invalidIdResponse())).toBe("Invalid id");
        expect(await errorOf(invalidIdResponse(chinese()))).toBe("ID 无效");
    });
});

describe("validated bodies", () => {
    const schema = z.object({ name: z.string().min(1, V.nameRequired) });

    it("say what is wrong in English, unchanged", async () => {
        const parsed = await parseJsonBody(english(JSON.stringify({ name: "" })), schema);
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
            expect(await errorOf(parsed.response)).toBe("Invalid request: name: Name is required");
        }
        const validated = await validateRequestBody(english("{"), schema);
        if (!validated.success) {
            expect(await validated.response.json()).toMatchObject({
                error: "Validation Error",
                message: "Invalid JSON format",
            });
        }
    });

    it("say it in Chinese for a Chinese reader", async () => {
        const parsed = await parseJsonBody(chinese(JSON.stringify({ name: "" })), schema);
        if (!parsed.success) {
            expect(await errorOf(parsed.response)).toBe("请求无效：name: 请输入名称");
        }
        const validated = await validateRequestBody(chinese(JSON.stringify({})), schema);
        expect(validated.success).toBe(false);
        if (!validated.success) {
            expect(await validated.response.json()).toMatchObject({
                error: "校验错误",
                message: "请求数据无效：name: 必填",
            });
        }
    });
});

describe("thrown errors", () => {
    beforeEach(() => jest.spyOn(console, "error").mockImplementation(() => undefined));

    it("become responses in the reader's language", async () => {
        const conflict = Object.assign(new Error("Forbidden"), {
            code: "won",
            status: 409,
            copy: copy("errors.api.forbidden"),
        });
        expect(await errorOf(handleDistributionError("test", conflict))).toBe("Forbidden");
        expect(await errorOf(handleDistributionError("test", conflict, chinese()))).toBe(
            "没有权限"
        );
        const failed = (await handleRouteError("test", new Error("boom"), chinese()).json()) as {
            message: string;
        };
        expect(failed.message).toBe("请求失败");
        const unexpected = (await handleApiError(new Error("boom"), chinese()).json()) as {
            message: string;
        };
        expect(unexpected.message).toBe("发生了意外错误，请重试。");
    });
});
