/**
 * When the MCP server (and with it the OAuth provider) is on. A base URL
 * assistants cannot sign in against switches it off instead of breaking
 * better-auth's startup, which would take every sign-in down with it.
 */
import { mcpAvailability } from "~/server/mcp/config";

const saved = { ...process.env };

afterEach(() => {
    process.env = { ...saved };
});

function withEnv(env: Record<string, string | undefined>) {
    for (const [key, value] of Object.entries(env)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    return mcpAvailability();
}

describe("mcpAvailability", () => {
    it("is on for an HTTPS origin, with the resource at /api/mcp", () => {
        expect(
            withEnv({ BETTER_AUTH_URL: "https://launchstack.example/", MCP_SERVER_ENABLED: undefined })
        ).toEqual({
            enabled: true,
            origin: "https://launchstack.example",
            resource: "https://launchstack.example/api/mcp",
        });
    });

    it("is on for plain HTTP on a loopback host", () => {
        expect(withEnv({ BETTER_AUTH_URL: "http://localhost:3000" })).toMatchObject({
            enabled: true,
            resource: "http://localhost:3000/api/mcp",
        });
        expect(withEnv({ BETTER_AUTH_URL: "http://127.0.0.1:3000" })).toMatchObject({
            enabled: true,
        });
    });

    it("is off for plain HTTP on a LAN address", () => {
        jest.spyOn(console, "warn").mockImplementation(() => undefined);
        expect(withEnv({ BETTER_AUTH_URL: "http://192.168.1.20:3000" })).toEqual({
            enabled: false,
            reason: "insecure-base-url",
        });
    });

    it("is off when the operator says so, or there is no base URL", () => {
        expect(
            withEnv({ BETTER_AUTH_URL: "https://launchstack.example", MCP_SERVER_ENABLED: "false" })
        ).toEqual({ enabled: false, reason: "disabled" });
        expect(withEnv({ BETTER_AUTH_URL: undefined, MCP_SERVER_ENABLED: undefined })).toEqual({
            enabled: false,
            reason: "no-base-url",
        });
    });
});
