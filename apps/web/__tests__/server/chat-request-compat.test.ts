import { validateDeprecatedChatSelection } from "~/server/chat-request-compat";

const MODEL_OVERRIDE = {
    ok: false,
    status: 400,
    message:
        "Per-request model overrides are disabled; the model serving each route is operator-configured",
};

describe("deprecated chat request selectors", () => {
    it("accepts an omitted selector", () => {
        expect(validateDeprecatedChatSelection({})).toEqual({ ok: true });
    });

    it("rejects a provider selector outright — providers no longer exist", () => {
        expect(validateDeprecatedChatSelection({ provider: "openrouter" })).toEqual({
            ok: false,
            status: 400,
            message:
                "Per-request provider selection is no longer supported; the deployment serves one chat endpoint configured by the operator",
        });
    });

    it("rejects a model override rather than silently ignoring it", () => {
        expect(validateDeprecatedChatSelection({ model: "request/override" })).toEqual(
            MODEL_OVERRIDE
        );
    });

    it("refuses the serving model's own id the same way, so a guess cannot be confirmed", () => {
        expect(validateDeprecatedChatSelection({ model: "vendor/operator-model" })).toEqual(
            MODEL_OVERRIDE
        );
    });

    it("reports the provider problem first when both selectors are present", () => {
        const result = validateDeprecatedChatSelection({
            provider: "openai",
            model: "vendor/operator-model",
        });
        expect(result).toMatchObject({ ok: false, status: 400 });
        expect((result as { message: string }).message).toMatch(/provider selection/);
    });

    it("words the refusal for a Chinese reader and keeps the English otherwise", () => {
        expect(validateDeprecatedChatSelection({ model: "x" }, "en")).toEqual(MODEL_OVERRIDE);
        expect(validateDeprecatedChatSelection({ model: "x" }, "zh-CN")).toEqual({
            ok: false,
            status: 400,
            message: "已禁用按请求覆盖模型；每条路由使用的模型由运维人员配置",
        });
    });
});
