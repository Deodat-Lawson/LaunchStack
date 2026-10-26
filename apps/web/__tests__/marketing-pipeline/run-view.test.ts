import type { MarketingRunRecord } from "@launchstack/pipelines/marketing/runs";

import { failureMessage } from "~/server/marketing/executor";
import { toRunView } from "~/server/marketing/run-view";

jest.mock("~/server/workspace-models/scope", () => ({
    withWorkspaceChatModels: (_companyId: unknown, _feature: unknown, fn: () => unknown) => fn(),
}));

function failed(errorMessage: string | null): MarketingRunRecord {
    return {
        id: "run-1",
        status: "failed",
        input: { platform: "linkedin", prompt: "Launch" },
        createdAt: new Date("2026-10-26T00:00:00Z"),
        events: [],
        checkpoints: {},
        attempts: 3,
        result: null,
        errorMessage,
    } as unknown as MarketingRunRecord;
}

describe("a failed run's words", () => {
    it("are stored in English, with the usual misconfiguration hint", () => {
        expect(failureMessage(new Error("No chat model route"))).toBe(
            "Failed to run marketing pipeline Ensure CHAT_BASE_URL (and CHAT_API_KEY if required) are set and the chat model configuration file is valid."
        );
        expect(failureMessage(new Error("boom"))).toBe("Failed to run marketing pipeline");
    });

    it("read back in the reader's language", () => {
        const stored = failureMessage(new Error("missing company"));
        expect(toRunView(failed(stored)).error).toBe(stored);
        expect(toRunView(failed(stored), 0, "zh-CN").error).toBe(
            "营销流程运行失败。请确认你的用户拥有有效的公司档案。"
        );
        expect(toRunView(failed(null), 0, "zh-CN").error).toBe("营销流程运行失败");
    });

    it("pass through words the executor did not write", () => {
        expect(toRunView(failed("Something else"), 0, "zh-CN").error).toBe("Something else");
    });
});
