/**
 * End-to-end tests for the gated explanation run: a real tmp-dir checkout, a
 * real derived bundle, real tools and gate — only the model is scripted.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AgentModelPort, AgentModelResponse } from "@launchstack/llm";
import { SUBMIT_TOOL_NAME } from "@launchstack/llm";

import { deriveContextBundle } from "@launchstack/pipelines/repo-workspace";
import { createDirectoryView } from "@launchstack/pipelines/repo-workspace";
import type { ContextBundle, WorkspaceView } from "@launchstack/pipelines/repo-workspace";
import { EXPLAINER_PROMPT_VERSION, runRepoExplanation } from "./explain";
import { EXPLAINER_SKILL_VERSION } from "./skills";

const SHA = "f".repeat(40);

function validSummary(paths: string[]): string {
    return [
        "## Overview",
        "This repository is a small TypeScript service used as a test fixture. " +
            "It wires an entry point to a helper module and exists to exercise " +
            "the explanation pipeline end to end.",
        "",
        "## Key components",
        ...paths.map(p => `- \`${p}\` carries the load here.`),
    ].join("\n");
}

const VALID_MERMAID = [
    "flowchart TD",
    '  A["Entry"] -->|"calls"| B["Helper"]',
    '  B -->|"reads"| C["Config"]',
    '  C --> D["Store"]',
    '  D --> E["Output"]',
    '  A --> F["Logger"]',
].join("\n");

function submit(summary: string, mermaidCode: string): AgentModelResponse {
    return {
        text: "",
        toolCalls: [{ id: "s", name: SUBMIT_TOOL_NAME, arguments: { summary, mermaidCode } }],
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        modelId: "scripted-model",
    };
}

/** Queue-scripted port shared across the main run and any repair run. */
function scriptedPort(responses: AgentModelResponse[]): {
    port: AgentModelPort;
    inputs: Array<{ system: string; user: string; toolNames: string[] }>;
} {
    const queue = [...responses];
    const inputs: Array<{ system: string; user: string; toolNames: string[] }> = [];
    return {
        inputs,
        port: {
            respond(input) {
                const firstUser = input.transcript.find(item => item.role === "user");
                inputs.push({
                    system: input.system,
                    user: firstUser && "text" in firstUser ? firstUser.text : "",
                    toolNames: input.tools.map(tool => tool.name),
                });
                const next = queue.shift();
                if (!next) throw new Error("scripted port exhausted");
                return Promise.resolve(next);
            },
        },
    };
}

describe("runRepoExplanation", () => {
    let root: string;
    let view: WorkspaceView;
    let bundle: ContextBundle;

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-explain-"));
        await fs.mkdir(path.join(root, "src"), { recursive: true });
        await fs.writeFile(
            path.join(root, "README.md"),
            "# Fixture service\n\nA tiny service fixture for pipeline tests.\n"
        );
        await fs.writeFile(
            path.join(root, "src", "index.ts"),
            'import { helper } from "./util";\n\nexport function main(): void {\n    helper();\n}\n'
        );
        await fs.writeFile(
            path.join(root, "src", "util.ts"),
            "export function helper(): void {\n    // does the work\n}\n"
        );
        view = createDirectoryView(root, SHA);
        bundle = await deriveContextBundle(view);
    });

    afterEach(async () => {
        await fs.rm(root, { recursive: true, force: true });
    });

    it("takes the fast path when the packed repo fits, and passes the gate", async () => {
        const { port, inputs } = scriptedPort([
            submit(validSummary(["src/index.ts"]), VALID_MERMAID),
        ]);
        const result = await runRepoExplanation({
            view,
            bundle,
            port,
            repoName: "octo/demo",
            diagramType: "architecture",
        });

        expect(result.path).toBe("fast");
        expect(result.gate.ok).toBe(true);
        expect(result.repaired).toBe(false);
        expect(result.turns).toBe(1);
        expect(result.filesRead).toContain("src/index.ts");
        expect(result.modelId).toBe("scripted-model");
        expect(result.skillVersion).toBe(EXPLAINER_SKILL_VERSION);
        expect(result.skillHash).toMatch(/^[0-9a-f]{64}$/);
        expect(result.promptVersion).toBe(EXPLAINER_PROMPT_VERSION);
        expect(result.usage.totalTokens).toBe(150);

        // Fast path: no exploration tools bound, digest inlined in the task.
        expect(inputs[0]!.toolNames).toEqual([SUBMIT_TOOL_NAME]);
        expect(inputs[0]!.user).toContain("===== src/index.ts");
    });

    it("runs the exploration loop when the digest exceeds the fast-path budget", async () => {
        const { port, inputs } = scriptedPort([
            {
                text: "let me read the entry point",
                toolCalls: [
                    { id: "r1", name: "read_files", arguments: { paths: ["src/index.ts"] } },
                ],
                usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 },
            },
            submit(validSummary(["src/index.ts", "README.md"]), VALID_MERMAID),
        ]);

        const result = await runRepoExplanation({
            view,
            bundle,
            port,
            repoName: "octo/demo",
            diagramType: "architecture",
            limits: { fastPathMaxChars: 10 },
        });

        expect(result.path).toBe("loop");
        expect(result.gate.ok).toBe(true);
        expect(result.turns).toBe(2);
        // README is read-by-context (memory file); index.ts was read by tool.
        expect(result.filesRead).toEqual(expect.arrayContaining(["README.md", "src/index.ts"]));
        expect(result.usage.totalTokens).toBe(210);

        // Loop mode binds the four tools + submit, and warm-starts the system
        // prompt with the bundle.
        expect(inputs[0]!.toolNames).toEqual([
            "repo_map",
            "repo_tree",
            "search_code",
            "read_files",
            SUBMIT_TOOL_NAME,
        ]);
        expect(inputs[0]!.system).toContain("Ranked repo map");
        expect(inputs[0]!.system).toContain("Fixture service");
    });

    it("repairs once on a gate failure and reports the repair", async () => {
        // First submit references a file that was never read → grounding error.
        const { port, inputs } = scriptedPort([
            submit(validSummary(["src/never-read.ts"]), VALID_MERMAID),
            submit(validSummary(["src/index.ts"]), VALID_MERMAID),
        ]);
        const result = await runRepoExplanation({
            view,
            bundle,
            port,
            repoName: "octo/demo",
            diagramType: "architecture",
        });

        expect(result.repaired).toBe(true);
        expect(result.gate.ok).toBe(true);
        expect(result.turns).toBe(2);
        // The repair prompt carries the structured gate errors and the
        // allowed read-set.
        expect(inputs[1]!.user).toContain("ungrounded_path_reference");
        expect(inputs[1]!.user).toContain("src/index.ts");
    });

    it("returns a failing gate (without throwing) when the repair also fails", async () => {
        const { port } = scriptedPort([
            submit("too short", "not mermaid at all"),
            submit("still too short", "still not mermaid"),
        ]);
        const result = await runRepoExplanation({
            view,
            bundle,
            port,
            repoName: "octo/demo",
            diagramType: "architecture",
        });
        expect(result.repaired).toBe(true);
        expect(result.gate.ok).toBe(false);
        expect(result.gate.errors.length).toBeGreaterThan(0);
    });

    it("rejects a wrong-kind diagram through the gate", async () => {
        const sequence = [
            "sequenceDiagram",
            "  participant A",
            "  participant B",
            "  A->>B: hi",
        ].join("\n");
        const { port } = scriptedPort([
            submit(validSummary(["src/index.ts"]), sequence),
            submit(validSummary(["src/index.ts"]), sequence),
        ]);
        const result = await runRepoExplanation({
            view,
            bundle,
            port,
            repoName: "octo/demo",
            diagramType: "architecture",
        });
        expect(result.gate.ok).toBe(false);
        expect(result.gate.errors.some(e => e.code === "mermaid_type_mismatch")).toBe(true);
    });

    it("threads user instructions into the task prompt", async () => {
        const { port, inputs } = scriptedPort([
            submit(validSummary(["src/index.ts"]), VALID_MERMAID),
        ]);
        await runRepoExplanation({
            view,
            bundle,
            port,
            repoName: "octo/demo",
            diagramType: "architecture",
            instructions: "Focus on the auth flow",
        });
        expect(inputs[0]!.user).toContain("Focus on the auth flow");
    });
});
