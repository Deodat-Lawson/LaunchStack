/**
 * Resolving an agent for a chat turn: unknown and retired handles are 404s,
 * mode mismatches are 400s, and the agent's policy shapes the turn.
 */

import type { PersonaRecord } from "~/server/collab/personas";

const roster: Record<string, PersonaRecord> = {};

jest.mock("~/server/collab/personas", () => ({
    getPersonaByKey: (_companyId: bigint, key: string) => Promise.resolve(roster[key] ?? null),
    personaToDefinition: (persona: PersonaRecord) => ({
        key: persona.id,
        displayName: persona.displayName,
        role: persona.role,
        description: persona.description,
        systemPrompt: persona.systemPrompt,
        mode: persona.mode,
        tools: persona.tools,
        style: persona.style,
        route: persona.route ?? null,
        temperature: persona.temperature ?? null,
        maxTurnChars: persona.maxTurnChars ?? null,
        accent: persona.accent ?? null,
        autonomy: persona.autonomy,
        nodeId: persona.nodeId ?? null,
    }),
}));

import {
    ChatAgentError,
    agentSystemPromptBlock,
    resolveChatAgent,
} from "~/server/collab/chat-agent";

function persona(overrides: Partial<PersonaRecord>): PersonaRecord {
    return {
        dbId: "p_1",
        id: "finance",
        displayName: "Dana",
        role: "Finance partner",
        systemPrompt: "Guard the margin.",
        archived: false,
        autonomy: null,
        description: "Guards margin",
        mode: "all",
        tools: null,
        style: null,
        builtin: true,
        ...overrides,
    };
}

beforeEach(() => {
    for (const key of Object.keys(roster)) delete roster[key];
});

const request = { webSearch: true, thinking: true, hasAttachments: true };

describe("resolveChatAgent", () => {
    it("returns null without a handle", async () => {
        expect(await resolveChatAgent(7n, null, request)).toBeNull();
    });

    it("404s an unknown or retired handle", async () => {
        await expect(resolveChatAgent(7n, "ghost", request)).rejects.toMatchObject({ status: 404 });
        roster.finance = persona({ archived: true });
        await expect(resolveChatAgent(7n, "finance", request)).rejects.toBeInstanceOf(
            ChatAgentError
        );
    });

    it("refuses a subagent as the chat's voice but not when mentioned", async () => {
        roster.critic = persona({ id: "critic", mode: "subagent" });
        await expect(resolveChatAgent(7n, "critic", request)).rejects.toMatchObject({
            status: 400,
        });
        const summoned = await resolveChatAgent(7n, "critic", { ...request, mentioned: true });
        expect(summoned?.persona.id).toBe("critic");
    });

    it("refuses a primary-only agent when mentioned", async () => {
        roster.chair = persona({ id: "chair", mode: "primary" });
        await expect(
            resolveChatAgent(7n, "chair", { ...request, mentioned: true })
        ).rejects.toMatchObject({
            status: 400,
        });
    });

    it("applies the tool policy, route and style to the turn", async () => {
        roster.finance = persona({
            tools: { web: false, attachments: false },
            route: "reasoning",
            style: "organized",
            temperature: 0.2,
        });
        const resolved = await resolveChatAgent(7n, "finance", request);
        expect(resolved?.turn).toMatchObject({
            webSearch: false,
            thinking: true,
            attachmentsDropped: true,
            route: "reasoning",
            style: "organized",
            temperature: 0.2,
        });
        expect(resolved?.turn.notes).toHaveLength(2);
    });

    it("writes the agent's block with the role and a length cap", () => {
        const block = agentSystemPromptBlock(persona({ maxTurnChars: 500 }));
        expect(block).toContain("You are Dana, the workspace's Finance partner");
        expect(block).toContain("Guard the margin.");
        expect(block).toContain("under 500 characters");
    });
});
