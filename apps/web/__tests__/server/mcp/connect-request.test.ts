/**
 * The consent screen promises only what the connection will really be able
 * to do: the server never offers a tool the person's role cannot use.
 */
import { describeScopes } from "~/server/mcp/connect-request";

jest.mock("~/server/db", () => ({ db: {} }));

const ALL = [
    "openid",
    "profile",
    "email",
    "offline_access",
    "launchstack:read",
    "launchstack:write",
];

describe("describeScopes", () => {
    it("lists reading and saving for someone who may do both", () => {
        const lines = describeScopes(ALL, "Acme", { canRead: true, canSave: true });
        expect(lines).toEqual([
            "Search and read the files you can open in Acme",
            "Save conversations to Acme, visible only to you, with a follow-up note LaunchStack writes",
            "See your name and email address",
            "Stay connected until you disconnect it in Settings",
        ]);
    });

    it("does not promise saving to someone whose role cannot upload", () => {
        const lines = describeScopes(ALL, "Acme", { canRead: true, canSave: false });
        expect(lines.some(line => line.startsWith("Save conversations"))).toBe(false);
        expect(lines[0]).toBe("Search and read the files you can open in Acme");
    });
});
