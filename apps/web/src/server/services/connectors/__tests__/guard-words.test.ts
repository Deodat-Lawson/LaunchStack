/**
 * The connector guards' refusals: Chinese for a Chinese reader, the English
 * unchanged otherwise. The configuration hint lists the variables in either
 * language, joined the way that language joins them.
 */

jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspaceContext: jest.fn(),
    requireWorkspacePermission: jest.fn(),
}));

import { gmailNotConfiguredResponse } from "~/server/services/connectors/gmail/guard";
import { notConfiguredResponse } from "~/server/services/connectors/workspace-guard";

async function messageOf(response: Response): Promise<string> {
    return ((await response.json()) as { message: string }).message;
}

describe("connector configuration hints", () => {
    it("keep the English by default", async () => {
        await expect(messageOf(notConfiguredResponse("gmail"))).resolves.toBe(
            "The gmail connector is not configured. Set GMAIL_CONNECTOR_ENABLED=true plus GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET and EMBEDDING_SECRETS_KEY on the server."
        );
        await expect(messageOf(notConfiguredResponse("bluesky"))).resolves.toBe(
            "The bluesky connector is not configured. Set EMBEDDING_SECRETS_KEY on the server."
        );
    });

    it("list the variables in Chinese", async () => {
        await expect(messageOf(notConfiguredResponse("slack", "zh-CN"))).resolves.toBe(
            "slack 连接器尚未配置。请在服务器上设置 SLACK_CLIENT_ID、SLACK_CLIENT_SECRET、EMBEDDING_SECRETS_KEY。"
        );
        await expect(messageOf(gmailNotConfiguredResponse("zh-CN"))).resolves.toBe(
            "此服务器未启用 Gmail 连接器。请设置 GMAIL_CONNECTOR_ENABLED=true、GOOGLE_OAUTH_CLIENT_ID、GOOGLE_OAUTH_CLIENT_SECRET 和 EMBEDDING_SECRETS_KEY。"
        );
        expect(notConfiguredResponse("slack", "zh-CN").status).toBe(403);
    });
});
