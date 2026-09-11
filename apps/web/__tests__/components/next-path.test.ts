import { safeNextPath, withNext } from "~/components/auth/next-path";

describe("safeNextPath", () => {
    it("keeps a same-origin path", () => {
        expect(safeNextPath("/invite/abc")).toBe("/invite/abc");
        expect(safeNextPath("/employer/documents?feature=knowledge")).toBe(
            "/employer/documents?feature=knowledge"
        );
    });

    it("falls back for anything that could leave the origin", () => {
        expect(safeNextPath("https://evil.example/")).toBe("/");
        expect(safeNextPath("//evil.example")).toBe("/");
        expect(safeNextPath("/\\evil.example")).toBe("/");
        expect(safeNextPath("javascript:alert(1)")).toBe("/");
        expect(safeNextPath("/ok\r\nLocation: x")).toBe("/");
    });

    it("falls back for empty or missing values, honouring the caller's fallback", () => {
        expect(safeNextPath(null)).toBe("/");
        expect(safeNextPath(undefined, "")).toBe("");
        expect(safeNextPath("   ", "/workspaces")).toBe("/workspaces");
    });
});

describe("withNext", () => {
    it("appends an encoded next parameter", () => {
        expect(withNext("/signin", "/invite/a b")).toBe("/signin?next=%2Finvite%2Fa%20b");
        expect(withNext("/signup?from=x", "/invite/t")).toBe("/signup?from=x&next=%2Finvite%2Ft");
    });

    it("leaves the path alone when next is unusable", () => {
        expect(withNext("/signin", null)).toBe("/signin");
        expect(withNext("/signin", "https://evil.example")).toBe("/signin");
    });
});
