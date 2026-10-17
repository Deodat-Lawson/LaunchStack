import { normalizeModelContent } from "~/app/api/agents/documentQ&A/services/normalizeModelContent";

describe("normalizeModelContent", () => {
    it("returns strings unchanged", () => {
        expect(normalizeModelContent("hello")).toBe("hello");
    });

    it("joins arrays of strings", () => {
        expect(normalizeModelContent(["foo", "bar"])).toBe("foobar");
    });

    it("handles arrays with mixed entries", () => {
        const result = normalizeModelContent(["foo", { bar: 1 }]);
        expect(result).toContain("foo");
        expect(result).toContain('"bar":1');
    });

    it("returns empty string for nullish values", () => {
        expect(normalizeModelContent(null)).toBe("");
        expect(normalizeModelContent(undefined)).toBe("");
    });

    it("stringifies objects", () => {
        const result = normalizeModelContent({ baz: "qux" });
        expect(result).toContain('"baz":"qux"');
    });

    // The full math contract is pinned in packages/llm/src/normalize-content.test.ts.
    it("converts LaTeX delimiters to dollar signs", () => {
        const input = "The series \\[ \\sum x^n \\] equals \\( \\frac{1}{1-x} \\).";
        const result = normalizeModelContent(input);
        expect(result).toBe("The series $$ \\sum x^n $$ equals $\\frac{1}{1-x}$.");
    });

    it("converts bare brackets and parentheses only when they hold LaTeX math", () => {
        const input = "The series [ \\sum x^n ] equals (\\frac{1}{1-x}) for (x) in ((-1,1)).";
        const result = normalizeModelContent(input);
        expect(result).toBe("The series $\\sum x^n$ equals $\\frac{1}{1-x}$ for (x) in ((-1,1)).");
    });

    it("preserves regular brackets and parentheses in text", () => {
        const input = "Use arr[0], [ E = mc^2 ], (DATABASE_URL), (a = b) and options (a) and (b).";
        const result = normalizeModelContent(input);
        expect(result).toBe(input);
    });

    it("preserves code", () => {
        const input = "Match `/\\(\\d+\\)/`:\n\n```js\nconst re = /\\(\\d+\\)/;\n```";
        const result = normalizeModelContent(input);
        expect(result).toBe(input);
    });
});
