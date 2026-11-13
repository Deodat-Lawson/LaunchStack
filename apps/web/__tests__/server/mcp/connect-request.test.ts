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
    it("lists reading, saving and adding documents for someone who may do all three", () => {
        const lines = describeScopes(ALL, "Acme", { canRead: true, canSave: true });
        expect(lines).toEqual([
            "Search and read the files you can open in Acme",
            "Save conversations to Acme, visible only to you, with a follow-up note LaunchStack writes",
            "Add documents and files you give it to a folder you can edit in Acme, after asking you which one; anyone who can open that folder can see them",
            "See your name and email address",
            "Stay connected until you disconnect it in Settings",
        ]);
    });

    it("promises neither saving nor adding to someone whose role cannot upload", () => {
        const lines = describeScopes(ALL, "Acme", { canRead: true, canSave: false });
        expect(lines.some(line => line.startsWith("Save conversations"))).toBe(false);
        expect(lines.some(line => line.startsWith("Add documents"))).toBe(false);
        expect(lines[0]).toBe("Search and read the files you can open in Acme");
    });

    it("promises nothing writable without the write scope", () => {
        const lines = describeScopes(
            ALL.filter(s => s !== "launchstack:write"),
            "Acme",
            { canRead: true, canSave: true }
        );
        expect(lines.some(line => line.startsWith("Save conversations"))).toBe(false);
        expect(lines.some(line => line.startsWith("Add documents"))).toBe(false);
    });
});
