import { existsSync } from "node:fs";
import { join } from "node:path";

import { isAgentKey, isAgentToolId } from "~/lib/agents/definition";
import { STARTER_AGENTS, STARTER_AGENT_KEYS } from "~/lib/agents/starter-agents";

describe("starter agents", () => {
    it("ships ten, with unique mention-safe handles", () => {
        expect(STARTER_AGENTS).toHaveLength(10);
        expect(new Set(STARTER_AGENT_KEYS).size).toBe(10);
        for (const key of STARTER_AGENT_KEYS) expect(isAgentKey(key)).toBe(true);
    });

    it("keeps the four original handles so stored transcripts still resolve", () => {
        for (const key of ["facilitator", "analyst", "engineer", "counsel"]) {
            expect(STARTER_AGENT_KEYS).toContain(key);
        }
    });

    it("gives every agent a description, a role and instructions", () => {
        for (const agent of STARTER_AGENTS) {
            expect(agent.description.length).toBeGreaterThan(20);
            expect(agent.role.length).toBeGreaterThan(2);
            expect(agent.systemPrompt.length).toBeGreaterThan(80);
            expect(agent.accent).toMatch(/^oklch\(/);
        }
    });

    it("takes every prompt from a named, licensed prompt file, verbatim", () => {
        for (const agent of STARTER_AGENTS) {
            expect(agent.source.name.length).toBeGreaterThan(3);
            expect(agent.source.file.length).toBeGreaterThan(3);
            expect(agent.source.url).toMatch(/^https:\/\//);
            expect(agent.source.license.length).toBeGreaterThan(2);
            // The stored prompt is the source text, not a paraphrase: the
            // source's own opening line must appear in it unchanged.
            expect(agent.systemPrompt).toContain(agent.source.fingerprint);
        }
    });

    it("names only registry tools, and ships a picture that exists", () => {
        for (const agent of STARTER_AGENTS) {
            for (const id of agent.tools ?? []) expect(isAgentToolId(id)).toBe(true);
            expect(agent.avatarUrl).toBe(`/agents/${agent.key}.jpg`);
            expect(existsSync(join(process.cwd(), "public", agent.avatarUrl!))).toBe(true);
        }
        expect(existsSync(join(process.cwd(), "public", "agents", "CREDITS.md"))).toBe(true);
    });
});
