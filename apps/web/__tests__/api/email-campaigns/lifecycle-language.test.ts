import { CampaignLifecycleError } from "@launchstack/pipelines/email/types";

import { handleRouteError } from "~/app/api/email-campaigns/_lib/context";

const chinese = new Request("http://x/api", { headers: { cookie: "ls-locale=zh-CN.1" } });

async function messageOf(response: Response): Promise<unknown> {
    return ((await response.json()) as { message?: unknown }).message;
}

describe("campaign lifecycle refusals", () => {
    const refusal = new CampaignLifecycleError(
        "This campaign is draft; approve the current template version before sending.",
        "not_approved"
    );

    it("keep the package's English for English readers", async () => {
        const response = handleRouteError("test", refusal, new Request("http://x/api"));
        expect(response.status).toBe(409);
        expect(await messageOf(response)).toBe(refusal.message);
    });

    it("read in Chinese for a Chinese reader, values kept", async () => {
        const response = handleRouteError("test", refusal, chinese);
        expect(await response.json()).toMatchObject({
            code: "not_approved",
            message: "此营销活动的状态为 draft，请先批准当前模板版本再发送。",
        });
        const missing = new CampaignLifecycleError(
            "Campaign 42 not found",
            "campaign_not_found",
            404
        );
        expect(await messageOf(handleRouteError("test", missing, chinese))).toBe(
            "未找到营销活动 42"
        );
    });
});
