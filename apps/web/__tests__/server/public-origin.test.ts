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
    it("uses BETTER_AUTH_URL, reduced to its origin", () => {
        setEnv("https://public.example.com", "https://app.example.com/api/auth/");
        expect(publicOrigin(proxied("/x"))).toBe("https://app.example.com");
    });

    it("never uses APP_PUBLIC_URL, the address other services fetch from", () => {
        // Unset, it means the in-cluster http://app:3000 — not for a browser.
        setEnv("http://app:3000", "https://app.example.com");
        expect(publicOrigin(proxied("/x"))).toBe("https://app.example.com");
        setEnv("https://public.example.com", undefined);
        expect(publicOrigin(new Request("http://localhost:3010/x"))).toBe("http://localhost:3010");
    });

    it("skips a blank or malformed value instead of throwing", () => {
        setEnv(undefined, "   ");
        expect(publicOrigin(new Request("http://localhost:3010/x"))).toBe("http://localhost:3010");
        setEnv(undefined, "localhost:3000");
        expect(publicOrigin(new Request("http://localhost:3010/x"))).toBe("http://localhost:3010");
        setEnv(undefined, "not a url");
        expect(publicOrigin(new Request("http://localhost:3010/x"))).toBe("http://localhost:3010");
    });

    it("uses the request only when nothing is configured (a dev server)", () => {
        setEnv(undefined, undefined);
        expect(publicOrigin(new Request("http://localhost:3010/x"))).toBe("http://localhost:3010");
    });

    it("warns once when production falls back to the request", () => {
        setEnv(undefined, "launchstack-internal.com");
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const env = process.env as Record<string, string | undefined>;
        const nodeEnv = env.NODE_ENV;
        env.NODE_ENV = "production";
        try {
            jest.isolateModules(() => {
                // A fresh module, so the warn-once flag starts unset.
                const fresh = jest.requireActual<{ publicOrigin: typeof publicOrigin }>(
                    "~/server/public-origin"
                );
                expect(fresh.publicOrigin(proxied("/x"))).toBe(PROXIED);
                expect(fresh.publicOrigin(proxied("/y"))).toBe(PROXIED);
            });
            expect(warn).toHaveBeenCalledTimes(1);
            expect(String(warn.mock.calls[0]?.[0])).toContain("BETTER_AUTH_URL");
        } finally {
            env.NODE_ENV = nodeEnv;
            warn.mockRestore();
        }
    });
});

describe("links built from the public origin", () => {
    beforeEach(() => setEnv("http://app:3000", "https://app.example.com"));

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
