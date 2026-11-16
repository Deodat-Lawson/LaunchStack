import { spawnSync } from "node:child_process";
import path from "node:path";
import { authBaseURL } from "~/server/auth/base-url";

const primary = "https://vantage.example.com";
const local = "http://localhost:3199";
const loopback = "http://127.0.0.1:3199";

describe("explicit authentication origins", () => {
    it("preserves the single-origin configuration unless alternatives are set", () => {
        expect(authBaseURL({ BETTER_AUTH_URL: primary })).toBe(primary);
        expect(authBaseURL({})).toBeUndefined();
    });

    it("allows only the configured origins without adding wildcard hosts", () => {
        const environment = {
            BETTER_AUTH_URL: primary,
            BETTER_AUTH_ADDITIONAL_ORIGINS: `${local},${loopback},${local}`,
        };
        for (const origin of [primary, local, loopback])
            expect(authBaseURL(environment, new Request(origin))).toBe(origin);
        expect(authBaseURL(environment, new Headers({ host: new URL(primary).host }))).toBe(
            primary
        );
        expect(() =>
            authBaseURL(environment, new Request("https://unlisted.example.com"))
        ).toThrow();
        expect(() => authBaseURL(environment, new Headers())).toThrow();
        expect(
            authBaseURL(
                environment,
                new Request("http://0.0.0.0:3199", {
                    headers: { host: new URL(primary).host },
                })
            )
        ).toBe(primary);
        expect(() =>
            authBaseURL(
                environment,
                new Request("https://unlisted.example.com", {
                    headers: { "x-forwarded-host": new URL(primary).host },
                })
            )
        ).toThrow();
    });

    it.each([
        "https://*.example.com",
        "https://user:password@example.com",
        "https://example.com/path",
        "https://example.com?next=evil",
        "https://example.com#fragment",
        "http://remote.example.com",
        "http://localhost.attacker.example:3199",
        "not-a-url",
    ])("rejects an invalid alternative origin: %s", alternative => {
        expect(() =>
            authBaseURL({
                BETTER_AUTH_URL: primary,
                BETTER_AUTH_ADDITIONAL_ORIGINS: alternative,
            })
        ).toThrow("BETTER_AUTH_ADDITIONAL_ORIGINS");
    });

    it("requires an explicit primary origin for multi-origin operation", () => {
        expect(() => authBaseURL({ BETTER_AUTH_ADDITIONAL_ORIGINS: local })).toThrow(
            "BETTER_AUTH_URL"
        );
    });

    it("uses host-bound HTTP cookies locally and Secure cookies over HTTPS", () => {
        // Run the installed ESM adapter natively; its pnpm hash path is not transformed by Jest.
        const result = spawnSync(
            process.execPath,
            [
                path.join(__dirname, "fixtures/auth-origins.mjs"),
                JSON.stringify(
                    [primary, local, loopback].map(origin =>
                        authBaseURL(
                            {
                                BETTER_AUTH_URL: primary,
                                BETTER_AUTH_ADDITIONAL_ORIGINS: `${local},${loopback}`,
                            },
                            new Request(origin)
                        )
                    )
                ),
            ],
            {
                encoding: "utf8",
                timeout: 15_000,
                windowsHide: true,
            }
        );
        expect({
            status: result.status,
            stderr: result.stderr,
            error: result.error?.message,
        }).toEqual({
            status: 0,
            stderr: "",
            error: undefined,
        });
        expect(JSON.parse(result.stdout)).toEqual({
            origins: 3,
            sessions: 3,
            unknownOriginRejected: true,
        });
    });
});
