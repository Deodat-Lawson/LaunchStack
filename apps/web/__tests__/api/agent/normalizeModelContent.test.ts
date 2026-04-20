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
    expect(result).toContain("\"bar\":1");
  });

  it("returns empty string for nullish values", () => {
    expect(normalizeModelContent(null)).toBe("");
    expect(normalizeModelContent(undefined)).toBe("");
  });

  it("stringifies objects", () => {
    const result = normalizeModelContent({ baz: "qux" });
    expect(result).toContain("\"baz\":\"qux\"");
  });

  it("converts bracket notation to dollar signs for inline equations", () => {
    const input = "The formula [ E = mc^2 ] is famous.";
    const result = normalizeModelContent(input);
    expect(result).toBe("The formula $E = mc^2$ is famous.");
  });

  it("handles multiple bracket equations in one string", () => {
    const input = "First [ a^2 ] and second [ b^2 ] equations.";
    const result = normalizeModelContent(input);
    expect(result).toBe("First $a^2$ and second $b^2$ equations.");
  });

  it("preserves regular square brackets that are not equations", () => {
    const input = "Array access like arr[0] should not change.";
    const result = normalizeModelContent(input);
    expect(result).toBe("Array access like arr[0] should not change.");
  });

  it("converts parentheses notation to dollar signs for inline equations", () => {
    const input = "The variable (x) and the series (\\sum_{n=0}^{\\infty} x^n) converge.";
    const result = normalizeModelContent(input);
    expect(result).toBe("The variable $x$ and the series $\\sum_{n=0}^{\\infty} x^n$ converge.");
  });

  it("converts parentheses with subscripts and superscripts", () => {
    const input = "Example with (C_n = 1), (a = 0) and domain ((-1,1)).";
    const result = normalizeModelContent(input);
    expect(result).toBe("Example with $C_n = 1$, $a = 0$ and domain $(-1,1)$.");
  });

  it("preserves regular parentheses in text", () => {
    const input = "This is a function call like func(x, y) and should not change.";
    const result = normalizeModelContent(input);
    expect(result).toBe("This is a function call like func(x, y) and should not change.");
  });

  it("handles mixed bracket and parentheses notation", () => {
    const input = "The series [ \\sum x^n ] equals (\\frac{1}{1-x}) for (x) in ((-1,1)).";
    const result = normalizeModelContent(input);
    expect(result).toBe("The series $\\sum x^n$ equals $\\frac{1}{1-x}$ for $x$ in $(-1,1)$.");
  });
});

