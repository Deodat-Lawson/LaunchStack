/**
 * Brand's own sentences in the reader's language: stored and computed
 * reasons a channel or sign-in stopped working, a network's setup steps, and
 * the sentences the marketing pipeline's BrandPostError carries.
 */
jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("~/env", () => ({ env: { server: { EMBEDDING_SECRETS_KEY: undefined } } }));
jest.mock("@launchstack/tools/social-publish", () => ({
    describePublishConfig: () => ({
        x: { configured: false, identity: null },
        reddit: { configured: false, identity: null },
        linkedin: { configured: false, identity: null },
        bluesky: { configured: false, identity: null },
    }),
}));
jest.mock("~/server/services/connectors/config", () => ({
    connectorCallbackPath: () => "/api/connectors/linkedin/callback",
    isConnectorConfigured: () => false,
    linkedInRequestedScopes: () => [],
}));
jest.mock("~/server/public-origin", () => ({ configuredPublicOrigin: () => "https://app.test" }));

import { wordCopy } from "~/i18n/translate";
import { listBrandNetworks } from "~/server/brand/accounts";
import { connectionProblem } from "~/server/brand/channels";
import { brandReason } from "~/server/brand/words";

describe("brandReason", () => {
    it("words fixed and templated sentences, and leaves a network's own text", () => {
        expect(
            brandReason(
                "LinkedIn no longer accepts this sign-in. Reconnect it under Accounts.",
                "zh-CN"
            )
        ).toBe("LinkedIn 不再接受此登录。请在“账号”中重新连接。");
        expect(
            brandReason(
                "The account that connected this no longer manages it on the network.",
                "zh-CN"
            )
        ).toBe("连接此渠道的账号已不再在该平台上管理它。");
        expect(brandReason("1,412 characters is over X's limit of 280.", "zh-CN")).toBe(
            "1,412 个字符超出了 X 的 280 字符上限。"
        );
        expect(brandReason("The reply did not go through: HTTP 503", "zh-CN")).toBe(
            "回复未能发送：HTTP 503"
        );
        expect(brandReason("Upstream said no", "zh-CN")).toBe("Upstream said no");
        expect(brandReason("Pick a time that is still ahead.", "en")).toBe(
            "Pick a time that is still ahead."
        );
    });

    it("words a sign-in that expired, as connectionProblem writes it", () => {
        const problem = connectionProblem(
            {
                provider: "linkedin",
                status: "active",
                lastRefreshError: null,
                accessTokenExpiresAt: new Date("2026-09-01T00:00:00Z"),
                refreshTokenCiphertext: null,
            },
            new Date("2026-10-01T00:00:00Z")
        )!;
        expect(brandReason(problem, "zh-CN")).toBe(
            "LinkedIn 登录已于 2026-09-01 过期。请重新连接以继续发帖。"
        );
    });
});

describe("network setup copies", () => {
    it("say the English steps exactly, and read as Chinese", () => {
        const networks = listBrandNetworks();
        for (const network of networks) {
            expect(network.setupCopy?.map(c => wordCopy(c, "en"))).toEqual(network.setup);
            expect(wordCopy(network.noteCopy!, "en")).toBe(network.note);
        }
        const linkedin = networks.find(n => n.platform === "linkedin")!;
        expect(wordCopy(linkedin.setupCopy![2]!, "zh-CN")).toBe(
            "在应用的 Auth 标签页中添加重定向 URL https://app.test/api/connectors/linkedin/callback"
        );
        const bluesky = networks.find(n => n.platform === "bluesky")!;
        expect(wordCopy(bluesky.noteCopy!, "zh-CN")).toBe(
            "免费，无需审核。每个工作区使用自己的应用专用密码登录。"
        );
    });
});
