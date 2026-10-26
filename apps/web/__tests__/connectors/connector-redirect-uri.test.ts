/**
 * A connector's redirect URI is a browser-facing address: it is built on the
 * public origin (BETTER_AUTH_URL), never on APP_PUBLIC_URL, which is only
 * where this app's other services fetch from and may be internal.
 */
// Inline: the modules below read env while they load.
jest.mock("~/env", () => ({
    env: {
        server: {
            APP_PUBLIC_URL: "http://app:3000",
            SLACK_CLIENT_ID: "slack-id",
            SLACK_CLIENT_SECRET: "slack-secret",
            NOTION_OAUTH_CLIENT_ID: "notion-id",
            NOTION_OAUTH_CLIENT_SECRET: "notion-secret",
            EMBEDDING_SECRETS_KEY: "test-key",
        },
        client: {},
    },
}));
jest.mock("~/server/db", () => ({ db: {} }));

import { listBrandNetworks } from "~/server/brand/accounts";
import {
    getConnectorConfig,
    getConnectorProvidersStatus,
} from "~/server/services/connectors/config";

const saved = process.env.BETTER_AUTH_URL;

afterEach(() => {
    if (saved === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = saved;
});

describe("connector redirect URIs", () => {
    it("are built on the public origin the route passes", () => {
        expect(getConnectorConfig("slack", "https://app.example.com")?.redirectUri).toBe(
            "https://app.example.com/api/connectors/slack/oauth/callback"
        );
    });

    it("fall back to BETTER_AUTH_URL without a request, never APP_PUBLIC_URL", () => {
        process.env.BETTER_AUTH_URL = "https://app.example.com";
        expect(getConnectorConfig("slack")?.redirectUri).toBe(
            "https://app.example.com/api/connectors/slack/oauth/callback"
        );
        delete process.env.BETTER_AUTH_URL;
        // A worker refresh sends no redirect URI, so none is better than an internal one.
        expect(getConnectorConfig("slack")?.redirectUri).toBe("");
    });

    it("give Notion its own callback on the public origin", () => {
        expect(getConnectorConfig("notion", "https://app.example.com")?.redirectUri).toBe(
            "https://app.example.com/api/connectors/notion/oauth/callback"
        );
        // The pair plus the secret-box key is all Notion needs to be offered.
        expect(getConnectorProvidersStatus().notion.configured).toBe(true);
    });

    // LinkedIn is unconfigured here, so its setup steps are shown.
    it("tell the operator to register the LinkedIn callback on the public origin", () => {
        process.env.BETTER_AUTH_URL = "https://app.example.com/";
        const linkedin = listBrandNetworks().find(n => n.platform === "linkedin");
        expect(linkedin?.setup.join("\n")).toContain(
            "https://app.example.com/api/connectors/linkedin/oauth/callback"
        );
        expect(linkedin?.setup.join("\n")).not.toContain("app:3000");
    });
});
