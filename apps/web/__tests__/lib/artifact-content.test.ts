import {
    artifactFileExtension,
    artifactSearchText,
    deriveArtifactTitle,
    detectArtifactType,
    isClaudeHostedUrl,
} from "~/lib/artifact-content";

describe("detectArtifactType", () => {
    it("classifies full HTML documents by prefix", () => {
        expect(detectArtifactType("<!DOCTYPE html><html><body>hi</body></html>")).toBe("html");
        expect(detectArtifactType("  <html lang='en'><head></head></html>")).toBe("html");
    });

    it("classifies fragments with structural tags as html", () => {
        expect(detectArtifactType('<div class="app"><script>alert(1)</script></div>')).toBe("html");
    });

    it("classifies svg, including with an xml prolog", () => {
        expect(detectArtifactType('<svg viewBox="0 0 10 10"></svg>')).toBe("svg");
        expect(detectArtifactType('<?xml version="1.0"?>\n<svg xmlns="…"></svg>')).toBe("svg");
    });

    it("classifies mermaid sources, including with an init directive", () => {
        expect(detectArtifactType("flowchart TD\n  A --> B")).toBe("mermaid");
        expect(detectArtifactType("sequenceDiagram\n  A->>B: hi")).toBe("mermaid");
        expect(detectArtifactType("%%{init: {'theme':'dark'}}%%\ngraph LR\nA-->B")).toBe("mermaid");
    });

    it("classifies React components", () => {
        expect(
            detectArtifactType('import React from "react";\nexport default function App() {}')
        ).toBe("react");
        expect(
            detectArtifactType('export default function App() {\n  return <Card title="x" />;\n}')
        ).toBe("react");
    });

    it("classifies plain code without markup", () => {
        expect(detectArtifactType("def main():\n    print('hi')")).toBe("code");
        expect(detectArtifactType("const x = 1;\nconsole.log(x);")).toBe("code");
    });

    it("falls back to markdown for prose", () => {
        expect(detectArtifactType("# Design review\n\nSome *notes* here.")).toBe("markdown");
        expect(detectArtifactType("Just a paragraph of text.")).toBe("markdown");
    });
});

describe("deriveArtifactTitle", () => {
    it("uses <title> for html", () => {
        expect(
            deriveArtifactTitle(
                "<html><head><title> Churn  Dashboard </title></head></html>",
                "html"
            )
        ).toBe("Churn Dashboard");
    });

    it("falls back to <h1> for html without a title", () => {
        expect(deriveArtifactTitle("<div><h1>Quarterly <em>Plan</em></h1></div>", "html")).toBe(
            "Quarterly Plan"
        );
    });

    it("uses the first heading for markdown", () => {
        expect(deriveArtifactTitle("intro\n\n## Roadmap\n\nbody", "markdown")).toBe("Roadmap");
    });

    it("returns null when nothing usable exists", () => {
        expect(deriveArtifactTitle("plain text", "markdown")).toBeNull();
        expect(deriveArtifactTitle("<div>x</div>", "html")).toBeNull();
    });
});

describe("isClaudeHostedUrl", () => {
    it("matches claude.ai and subdomains", () => {
        expect(isClaudeHostedUrl("https://claude.ai/public/artifacts/abc")).toBe(true);
        expect(isClaudeHostedUrl("https://www.claude.ai/code/artifact/abc")).toBe(true);
        expect(isClaudeHostedUrl("https://claude.site/artifacts/abc")).toBe(true);
    });

    it("rejects other hosts, including look-alikes", () => {
        expect(isClaudeHostedUrl("https://example.com/page")).toBe(false);
        expect(isClaudeHostedUrl("https://notclaude.ai/artifacts")).toBe(false);
        expect(isClaudeHostedUrl("https://claude.ai.evil.com/x")).toBe(false);
        expect(isClaudeHostedUrl("not a url")).toBe(false);
    });
});

describe("artifactSearchText", () => {
    it("strips scripts, styles, and tags", () => {
        const text = artifactSearchText(
            "<html><style>.a{color:red}</style><script>var x=1;</script><body><h1>Hello</h1> <p>world</p></body></html>"
        );
        expect(text).toBe("Hello world");
    });
});

describe("artifactFileExtension", () => {
    it("maps each type to a sensible extension", () => {
        expect(artifactFileExtension("html")).toBe("html");
        expect(artifactFileExtension("svg")).toBe("svg");
        expect(artifactFileExtension("markdown")).toBe("md");
        expect(artifactFileExtension("mermaid")).toBe("mmd");
        expect(artifactFileExtension("react")).toBe("tsx");
        expect(artifactFileExtension("code")).toBe("txt");
    });
});
