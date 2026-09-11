import { describe, expect, it } from "vitest";

import type { RepoExplanationJobResult } from "@launchstack/pipelines/repo-workspace/schema";

import {
    makeExplanationCreationKey,
    makeExplanationFilename,
    renderExplanationMarkdown,
    stripMermaidFence,
} from "./publish";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const SKILL_HASH = "d4c3b2a1f0e9d8c7b6a5948382716059d4c3b2a1f0e9d8c7b6a5948382716059";

function makeResult(overrides: Partial<RepoExplanationJobResult> = {}): RepoExplanationJobResult {
    return {
        summary:
            "## Overview\n\nThe service syncs a mirror, derives a context bundle, " +
            "and asks the model for a diagram of the requested type.",
        mermaidCode:
            "flowchart TD\n    sync[Sync] --> derive[Derive]\n    derive --> explain[Explain]",
        filesRead: ["src/index.ts", "src/server/sync.ts"],
        path: "loop",
        turns: 7,
        provenance: {
            sha: SHA,
            skillVersion: "repo-explainer-skills/v1",
            skillHash: SKILL_HASH,
            promptVersion: "repo-explainer-prompts/v2",
        },
        ...overrides,
    };
}

describe("makeExplanationCreationKey", () => {
    it("uses the exact repo-explainer:owner/repo@sha:type format", () => {
        expect(makeExplanationCreationKey("acme", "widgets", SHA, "sequence")).toBe(
            `repo-explainer:acme/widgets@${SHA}:sequence`
        );
    });

    it("converges: same inputs produce the same key, any change a different one", () => {
        const key = makeExplanationCreationKey("acme", "widgets", SHA, "er");
        expect(makeExplanationCreationKey("acme", "widgets", SHA, "er")).toBe(key);
        expect(makeExplanationCreationKey("acme", "widgets", SHA, "class")).not.toBe(key);
        expect(makeExplanationCreationKey("acme", "gadgets", SHA, "er")).not.toBe(key);
    });
});

describe("makeExplanationFilename", () => {
    it("joins owner and repo, the 12-char sha prefix, and the .md suffix", () => {
        expect(makeExplanationFilename("acme", "widgets", SHA)).toBe(
            `acme-widgets-${SHA.slice(0, 12)}.md`
        );
    });

    it("sanitizes exotic characters down to [a-zA-Z0-9-_]", () => {
        const filename = makeExplanationFilename("Weird Org!", "my.repo/v2 (beta)", SHA);
        expect(filename).toBe(`Weird-Org--my-repo-v2--beta--${SHA.slice(0, 12)}.md`);
        expect(filename).toMatch(/^[a-zA-Z0-9-_]+\.md$/);
    });

    it("clamps the owner-repo base to 80 characters", () => {
        const filename = makeExplanationFilename("o".repeat(60), "r".repeat(60), SHA);
        const base = filename.slice(0, filename.length - "-000000000000.md".length);
        expect(base).toHaveLength(80);
        expect(filename.endsWith(`-${SHA.slice(0, 12)}.md`)).toBe(true);
    });
});

describe("stripMermaidFence", () => {
    const inner = "flowchart TD\n    a[Ingress] --> b[Worker]\n    b --> c[(Store)]";

    it("leaves bare diagram code unchanged", () => {
        expect(stripMermaidFence(inner)).toBe(inner);
    });

    it("strips a ```mermaid fence", () => {
        expect(stripMermaidFence("```mermaid\n" + inner + "\n```")).toBe(inner);
    });

    it("strips an anonymous ``` fence", () => {
        expect(stripMermaidFence("```\n" + inner + "\n```")).toBe(inner);
    });

    it("tolerates surrounding whitespace and trailing spaces after the fence", () => {
        expect(stripMermaidFence("\n\n```mermaid  \n" + inner + "\n```\n\n")).toBe(inner);
    });

    it("preserves the inner content byte for byte", () => {
        const tricky = 'sequenceDiagram\n    A->>B: note over "quotes"\n    B-->>A: done';
        expect(stripMermaidFence("```mermaid\n" + tricky + "\n```")).toBe(tricky);
    });
});

describe("renderExplanationMarkdown", () => {
    const generatedAt = new Date("2026-08-31T12:34:56.000Z");

    const render = (overrides: Partial<RepoExplanationJobResult> = {}): string =>
        renderExplanationMarkdown({
            owner: "acme",
            repo: "widgets",
            diagramType: "architecture",
            result: makeResult(overrides),
            generatedAt,
        });

    it("titles the document with owner/repo and the diagram type", () => {
        expect(render()).toContain("# acme/widgets — architecture explanation");
    });

    it("includes the summary", () => {
        expect(render()).toContain("The service syncs a mirror");
    });

    it("emits exactly one mermaid fence for bare diagram code", () => {
        const markdown = render();
        expect(markdown.match(/```mermaid/g)).toHaveLength(1);
        expect(markdown.match(/```/g)).toHaveLength(2);
        expect(markdown).toContain("sync[Sync] --> derive[Derive]");
    });

    it("never double-fences an already-fenced mermaidCode", () => {
        const markdown = render({
            mermaidCode: "```mermaid\nflowchart TD\n    a --> b\n```",
        });
        expect(markdown.match(/```mermaid/g)).toHaveLength(1);
        expect(markdown.match(/```/g)).toHaveLength(2);
        expect(markdown).toContain("```mermaid\nflowchart TD\n    a --> b\n```");
    });

    it("lists consulted files as backticked bullets", () => {
        const markdown = render();
        expect(markdown).toContain("## Files consulted");
        expect(markdown).toContain("- `src/index.ts`");
        expect(markdown).toContain("- `src/server/sync.ts`");
    });

    it("falls back to the precomputed-context note when no files were read", () => {
        const markdown = render({ filesRead: [] });
        expect(markdown).toContain("_(derived from precomputed context only)_");
        expect(markdown).not.toContain("- `");
    });

    it("renders the provenance footer as blockquote lines", () => {
        const markdown = render();
        expect(markdown).toContain("> Repository: acme/widgets");
        expect(markdown).toContain(`> Commit: ${SHA}`);
        expect(markdown).toContain("> Diagram type: architecture");
        expect(markdown).toContain("> Generated: 2026-08-31T12:34:56.000Z");
        expect(markdown).toContain(
            `> Skill: repo-explainer-skills/v1 (${SKILL_HASH.slice(0, 12)})`
        );
        expect(markdown).toContain("> Prompt: repo-explainer-prompts/v2");
    });

    it("includes the Model line only when a modelId is present", () => {
        expect(render()).not.toContain("> Model:");
        const withModel = render({
            provenance: {
                sha: SHA,
                skillVersion: "repo-explainer-skills/v1",
                skillHash: SKILL_HASH,
                promptVersion: "repo-explainer-prompts/v2",
                modelId: "claude-fable-5",
            },
        });
        expect(withModel).toContain("> Model: claude-fable-5");
    });
});
