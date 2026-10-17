/**
 * Links and redirects that leave the server point at the deployment's public
 * origin. Behind the proxy the standalone server hands route handlers its bind
 * address (`https://0.0.0.0:3000`), which is how join links came out unusable.
 */
jest.mock("~/server/db", () => ({ db: {} }));

import { GET as providerOAuthCallback } from "~/app/api/connectors/[provider]/oauth/callback/route";
import { unsubscribeBaseUrl } from "~/app/api/email-campaigns/_lib/context";
import { publicOrigin } from "~/server/public-origin";

/** What a route handler sees behind Caddy: the bind address, whatever the Host says. */
const PROXIED = "https://0.0.0.0:3000";

function proxied(path: string): Request {
    return new Request(`${PROXIED}${path}`, { headers: { host: "app.example.com" } });
}

const saved = { app: process.env.APP_PUBLIC_URL, auth: process.env.BETTER_AUTH_URL };

function setEnv(app: string | undefined, auth: string | undefined) {
    if (app === undefined) delete process.env.APP_PUBLIC_URL;
    else process.env.APP_PUBLIC_URL = app;
    if (auth === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = auth;
}

afterEach(() => setEnv(saved.app, saved.auth));

describe("publicOrigin", () => {
    it("uses APP_PUBLIC_URL, reduced to its origin", () => {
        setEnv("https://app.example.com/some/path/", "https://auth.example.com");
        expect(publicOrigin(proxied("/x"))).toBe("https://app.example.com");
    });

    it("falls back to BETTER_AUTH_URL", () => {
        setEnv(undefined, "https://auth.example.com/api/auth");
        expect(publicOrigin(proxied("/x"))).toBe("https://auth.example.com");
    });

    it("skips a blank or malformed value instead of throwing", () => {
        setEnv("   ", "localhost:3000");
        expect(publicOrigin(new Request("http://localhost:3010/x"))).toBe("http://localhost:3010");
        setEnv("not a url", "https://auth.example.com");
        expect(publicOrigin(proxied("/x"))).toBe("https://auth.example.com");
    });

    it("uses the request only when nothing is configured (a dev server)", () => {
        setEnv(undefined, undefined);
        expect(publicOrigin(new Request("http://localhost:3010/x"))).toBe("http://localhost:3010");
    });
});

describe("links built from the public origin", () => {
    beforeEach(() => setEnv("https://app.example.com", undefined));

    it("sends the OAuth return leg to the public origin", async () => {
        const response = await providerOAuthCallback(
            proxied("/api/connectors/slack/oauth/callback?error=access_denied"),
            { params: Promise.resolve({ provider: "slack" }) }
        );

        expect(response.status).toBe(307);
        const location = new URL(response.headers.get("location") ?? "");
        expect(location.origin).toBe("https://app.example.com");
        expect(location.pathname).toBe("/employer/documents");
    });

    it("builds unsubscribe links on the public origin", () => {
        expect(unsubscribeBaseUrl(proxied("/api/email-campaigns/1/send"))).toBe(
            "https://app.example.com/api/email-pipeline/unsubscribe"
        );
    });
});
