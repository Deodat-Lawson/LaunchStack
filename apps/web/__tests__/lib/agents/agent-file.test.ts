/**
 * The definition file round-trips: what is written can be read back to the
 * same agent, and a file written for another harness reads too.
 */

import { AgentFileError, parseAgentFile, serializeAgentFile } from "~/lib/agents/agent-file";
import type { AgentDefinition } from "~/lib/agents/definition";
import { STARTER_AGENTS, starterDefinition } from "~/lib/agents/starter-agents";

const DANA: AgentDefinition = {
    key: "finance",
    displayName: "Dana",
    role: "Finance partner",
    description: "Guards margin: asks what it costs.",
    systemPrompt: "You guard the margin.\n\nAsk what it costs.",
    mode: "all",
    tools: ["retrieval", "reasoning", "attachments"],
    style: "organized",
    route: "reasoning",
    temperature: 0.2,
    maxTurnChars: 1200,
    accent: "oklch(0.6 0.15 30)",
    avatarUrl: "/agents/finance.jpg",
    autonomy: "propose",
    nodeId: null,
};

describe("agent file", () => {
    it("round-trips a definition", () => {
        const text = serializeAgentFile(DANA);
        expect(text.startsWith("---\nname: finance\n")).toBe(true);
        const { definition, unknownKeys } = parseAgentFile(text);
        expect(definition).toEqual(DANA);
        expect(unknownKeys).toEqual([]);
    });

    it("writes tools as a list and the picture as `avatar`", () => {
        const text = serializeAgentFile(DANA);
        expect(text).toContain("tools:\n  - retrieval\n  - reasoning\n  - attachments\n");
        expect(text).toContain("avatar: /agents/finance.jpg");
        // An unrestricted agent writes no tools key at all.
        expect(serializeAgentFile({ ...DANA, tools: null })).not.toContain("tools:");
    });

    it("round-trips every starter agent", () => {
        for (const starter of STARTER_AGENTS) {
            const definition = starterDefinition(starter);
            expect(parseAgentFile(serializeAgentFile(definition)).definition).toEqual(definition);
        }
    });

    it("reads Claude Code's inline tool list", () => {
        const file = "---\nname: reviewer\ntools: retrieval, reasoning\n---\nReview.";
        expect(parseAgentFile(file).definition.tools).toEqual(["retrieval", "reasoning"]);
    });

    it("reads an OpenCode-style file with a model and nested tools", () => {
        const file = [
            "---",
            "description: Reviews code for security issues",
            "mode: subagent",
            "model: reasoning",
            "temperature: 0.1",
            "tools:",
            "  web: false",
            "  attachments: false",
            "name: security-reviewer",
            "unknown_thing: 42",
            "---",
            "",
            "You are a security reviewer. Find the vulnerability.",
        ].join("\n");
        const { definition, unknownKeys } = parseAgentFile(file);
        expect(definition.key).toBe("security-reviewer");
        expect(definition.mode).toBe("subagent");
        expect(definition.route).toBe("reasoning");
        expect(definition.tools).toEqual(["retrieval", "reasoning"]);
        expect(definition.displayName).toBe("security-reviewer");
        expect(definition.role).toBe("security-reviewer");
        expect(definition.systemPrompt).toBe(
            "You are a security reviewer. Find the vulnerability."
        );
        expect(unknownKeys).toEqual(["unknown_thing"]);
    });

    it("quotes values YAML would misread", () => {
        const text = serializeAgentFile({
            ...DANA,
            description: "Asks: what does it cost? #1 question",
        });
        expect(text).toContain('description: "Asks: what does it cost? #1 question"');
        expect(parseAgentFile(text).definition.description).toBe(
            "Asks: what does it cost? #1 question"
        );
    });

    it("refuses a file without front matter or without a body", () => {
        expect(() => parseAgentFile("just some text")).toThrow(AgentFileError);
        expect(() => parseAgentFile("---\nname: x\n---\n")).toThrow(/system prompt/);
        expect(() => parseAgentFile("---\nrole: x\n---\nbody")).toThrow(/name/);
    });

    it("tolerates CRLF and a BOM", () => {
        const text = "﻿---\r\nname: crlf\r\nrole: Tester\r\n---\r\nBody line.\r\n";
        expect(parseAgentFile(text).definition).toMatchObject({
            key: "crlf",
            systemPrompt: "Body line.",
        });
    });
});
