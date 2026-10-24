import { z } from "zod";

import { copy } from "~/i18n/copy";
import { requestTranslator } from "~/i18n/server";
import { englishCopy, translatorFor, wordCopy, wordEnglish } from "~/i18n/translate";
import { V, v } from "~/i18n/validation";
import { zodErrorText, zodIssueText } from "~/i18n/zod";

const chinese = new Request("http://x/api", { headers: { cookie: "ls-locale=zh-CN.1" } });

describe("server translators", () => {
    it("word a route's sentence in the request's language", () => {
        expect(requestTranslator(new Request("http://x/api"), "errors.api")("notFound")).toBe(
            "Not found"
        );
        expect(requestTranslator(chinese, "errors.api")("notFound")).toBe("未找到");
        expect(translatorFor("zh-CN", "errors.api")("invalidRequestDetail", { detail: "x" })).toBe(
            "请求无效：x"
        );
    });

    it("word a Copy in either language", () => {
        const notFound = copy("errors.api.documentNotFound");
        expect(englishCopy(notFound)).toBe("Document not found");
        expect(wordCopy(notFound, "zh-CN")).toBe("未找到该文档");
    });

    it("find a catalogue sentence again by its English, values and all", () => {
        expect(wordEnglish(V.nameEmpty, "errors.validation", "zh-CN")).toBe("姓名不能为空。");
        expect(wordEnglish(v("keepItUnder", { max: 80 }), "errors.validation", "zh-CN")).toBe(
            "请控制在 80 个字符以内。"
        );
        expect(
            wordEnglish(
                'The model serving the "vision" route does not support: vision. Assign a capable model to that route in the chat model configuration.',
                "errors.chatModels",
                "zh-CN"
            )
        ).toBe(
            "为“vision”路由提供服务的模型不支持：vision。请在对话模型配置中为该路由指定一个支持这些能力的模型。"
        );
        expect(
            wordEnglish("Something the catalogue never said", "errors.validation", "zh-CN")
        ).toBe("Something the catalogue never said");
        expect(wordEnglish(V.nameEmpty, "errors.validation", "en")).toBe(V.nameEmpty);
    });
});

describe("zod issues", () => {
    const schema = z.object({
        name: z.string().min(1, V.nameRequired),
        email: z.string().email(),
        count: z.number(),
    });

    it("keep the English for English readers", () => {
        const error = schema.safeParse({ name: "", email: "no", count: "1" }).error!;
        expect(zodErrorText(error, "en", ", ")).toBe(
            "name: Name is required, email: Invalid email, count: Expected number, received string"
        );
    });

    it("word a schema's own sentence and zod's defaults in Chinese", () => {
        const error = schema.safeParse({ name: "", email: "no" }).error!;
        expect(error.errors.map(issue => zodIssueText(issue, "zh-CN"))).toEqual([
            "请输入名称",
            "邮箱地址无效",
            "必填",
        ]);
        expect(zodErrorText(error, "zh-CN", ", ")).toBe(
            "name: 请输入名称；email: 邮箱地址无效；count: 必填"
        );
    });
});
