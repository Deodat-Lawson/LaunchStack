/**
 * The agent vocabulary: mentions, tool policy, and how a turn resolves
 * against an agent. Pure functions, so the composer's preview and the
 * route's enforcement can only agree.
 */

import {
    coerceAgentDefinition,
    deniedTools,
    mentionQueryAt,
    mentionedAgentKeys,
    resolveChatTurn,
    toAgentKey,
    usableAsPrimary,
    usableAsSubagent,
} from "~/lib/agents/definition";

describe("mentions", () => {
    const roster = ["analyst", "finance", "critic"];

    it("finds known handles in order, once each", () => {
        expect(
            mentionedAgentKeys("@finance what does @analyst say? @finance again", roster)
        ).toEqual(["finance", "analyst"]);
    });

    it("ignores unknown handles and emails", () => {
        expect(mentionedAgentKeys("mail dana@finance.com about @nobody", roster)).toEqual([]);
    });

    it("is case-insensitive on the handle", () => {
        expect(mentionedAgentKeys("Ask @Analyst", roster)).toEqual(["analyst"]);
    });

    it("reads the handle being typed at the caret", () => {
        expect(mentionQueryAt("ask @ana", 8)).toEqual({ query: "ana", start: 4 });
        expect(mentionQueryAt("ask @", 5)).toEqual({ query: "", start: 4 });
    });

    it("does not treat an email or a finished mention as a query", () => {
        expect(mentionQueryAt("dana@fin", 8)).toBeNull();
        expect(mentionQueryAt("@analyst please", 15)).toBeNull();
    });
});

describe("tool policy", () => {
    it("records only denials", () => {
        expect(deniedTools({ web: false, reasoning: true })).toEqual(["web"]);
        expect(deniedTools(null)).toEqual([]);
    });

    it("switches off what the agent denies and says so", () => {
        const turn = resolveChatTurn(
            {
                tools: { web: false, attachments: false },
                route: "reasoning",
                style: "detailed",
                temperature: 0.2,
            },
            { webSearch: true, thinking: true, hasAttachments: true }
        );
        expect(turn.webSearch).toBe(false);
        expect(turn.thinking).toBe(true);
        expect(turn.attachmentsDropped).toBe(true);
        expect(turn.route).toBe("reasoning");
        expect(turn.style).toBe("detailed");
        expect(turn.notes).toHaveLength(2);
    });

    it("leaves the person's toggles alone without an agent", () => {
        const turn = resolveChatTurn(null, {
            webSearch: true,
            thinking: false,
            hasAttachments: false,
        });
        expect(turn).toMatchObject({ webSearch: true, thinking: false, notes: [] });
    });
});

describe("modes", () => {
    it("keeps subagents out of the picker and primaries out of mentions", () => {
        expect(usableAsPrimary({ mode: "subagent" })).toBe(false);
        expect(usableAsPrimary({ mode: "all" })).toBe(true);
        expect(usableAsSubagent({ mode: "primary" })).toBe(false);
        expect(usableAsSubagent({ mode: "all" })).toBe(true);
    });
});

describe("coercion", () => {
    it("normalises a loosely typed record", () => {
        const agent = coerceAgentDefinition({
            key: "Finance Partner!",
            displayName: " Dana ",
            role: "Finance",
            mode: "nonsense",
            style: "detailed",
            route: "default",
            temperature: 7,
            tools: { web: false, bogus: false },
        });
        expect(agent.key).toBe("finance-partner");
        expect(agent.displayName).toBe("Dana");
        expect(agent.mode).toBe("all");
        expect(agent.route).toBeNull();
        expect(agent.temperature).toBe(2);
        expect(agent.tools).toEqual({ web: false });
    });

    it("makes handles mention-safe", () => {
        expect(toAgentKey("Devil's Advocate")).toBe("devil-s-advocate");
    });
});
