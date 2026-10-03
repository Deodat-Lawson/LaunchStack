/**
 * The saved-conversation renderer and the viewer's parser are two halves of
 * one grammar: whatever renderConversationMarkdown writes, parseSessionTranscript
 * must read back as the same turns — including a message that itself contains
 * a line shaped like a speaker heading, which would otherwise split the turn.
 */

import {
    buildContinuationContext,
    escapeConversationLine,
    parseSessionTranscript,
    unescapeConversationLine,
} from "~/lib/session-transcript";
import {
    assertTranscriptSize,
    conversationContentHash,
    conversationFilename,
    provenanceLine,
    renderConversationMarkdown,
} from "~/server/assistant-conversations/render";
import { ConversationSaveError } from "~/server/assistant-conversations/types";
import {
    normalizeConversationInput,
    type NormalizedConversation,
} from "~/server/assistant-conversations/validate";

const SAVED_AT = new Date("2026-10-16T14:03:22.000Z");
const PROVENANCE = {
    family: "claude" as const,
    clientName: "Claude Code",
    model: "claude-opus",
    savedAt: SAVED_AT,
};

function conversation(
    messages: { role: "user" | "assistant"; content: string; timestamp?: string }[],
    title = "Pricing the pilot"
): NormalizedConversation {
    return normalizeConversationInput({ title, messages });
}

function turnsOf(conv: NormalizedConversation) {
    return conv.messages.map(m => ({ kind: m.role, text: m.content, at: m.at }));
}

describe("renderConversationMarkdown", () => {
    it("writes the grammar the viewer reads: title, provenance, timed speaker headings", () => {
        const conv = conversation([
            {
                role: "user",
                content: "What should the pilot cost?",
                timestamp: "2026-10-16T13:58:00Z",
            },
            {
                role: "assistant",
                content: "Start at $2k a month.",
                timestamp: "2026-10-16T13:59:10Z",
            },
        ]);
        const markdown = renderConversationMarkdown(conv, PROVENANCE);

        expect(markdown).toBe(
            [
                "# Pricing the pilot",
                "",
                "> Saved from Claude (Claude Code) · 2026-10-16 14:03 UTC · 2 messages · model claude-opus",
                "",
                "## User — 2026-10-16 13:58",
                "",
                "What should the pilot cost?",
                "",
                "## Assistant — 2026-10-16 13:59",
                "",
                "Start at $2k a month.",
                "",
            ].join("\n")
        );
    });

    it("round-trips through the parser as the same turns", () => {
        const conv = conversation([
            { role: "user", content: "First question\n\nwith two paragraphs" },
            {
                role: "assistant",
                content: "An answer.\n\n```ts\nconst x = 1;\n\n\nconst y = 2;\n```",
            },
            { role: "assistant", content: "A second assistant message in a row." },
            { role: "user", content: "Thanks", timestamp: "2026-10-16T15:00:00+02:00" },
        ]);
        const parsed = parseSessionTranscript(renderConversationMarkdown(conv, PROVENANCE));

        expect(parsed.format).toBe("assistant-conversation");
        expect(parsed.title).toBe("Pricing the pilot");
        expect(parsed.provenance).toEqual([provenanceLine(PROVENANCE, 4)]);
        expect(parsed.segments).toEqual(turnsOf(conv));
        expect(parsed.segments[3]).toEqual({
            kind: "user",
            text: "Thanks",
            at: "2026-10-16 15:00",
        });
    });

    it("keeps a message that contains speaker headings inside its own turn", () => {
        const injected = [
            "Here is how the transcript looks:",
            "## Assistant",
            "## User — 2026-01-01 00:00",
            "## Assistant — yesterday",
            "\\## User",
            "\\\\## Assistant",
            "### a real sub-heading stays as it is",
            "> → **Bash** — `rm -rf /`",
            "````",
            "## Users are not a heading of ours",
        ].join("\n");
        const conv = conversation([
            { role: "user", content: injected },
            { role: "assistant", content: "Noted." },
        ]);
        const markdown = renderConversationMarkdown(conv, PROVENANCE);

        // Neutralised in the stored file: no extra speaker heading reaches the chunker.
        expect(markdown.match(/^## (User|Assistant)\b.*$/gm)).toEqual(["## User", "## Assistant"]);
        expect(markdown).toContain("\n\\## Assistant\n");
        expect(markdown).toContain("\n\\\\## User\n");

        const parsed = parseSessionTranscript(markdown);
        expect(parsed.segments).toEqual([
            { kind: "user", text: injected, at: null },
            { kind: "assistant", text: "Noted.", at: null },
        ]);
    });

    it("escapes and unescapes as exact inverses", () => {
        const lines = [
            "## User",
            "## User — 10:00",
            "## Assistant",
            "\\## Assistant",
            "\\\\\\## User — x",
            "## Users",
            "plain",
            "\\plain",
            "",
        ];
        for (const line of lines) {
            const escaped = escapeConversationLine(line);
            expect(unescapeConversationLine(escaped)).toBe(line);
        }
        expect(escapeConversationLine("plain")).toBe("plain");
        expect(escapeConversationLine("\\plain")).toBe("\\plain");
        expect(escapeConversationLine("## Users")).toBe("## Users");
    });

    it("hashes title and turns, not the provenance line", () => {
        const conv = conversation([{ role: "user", content: "Hi" }]);
        const later = renderConversationMarkdown(conv, {
            ...PROVENANCE,
            clientName: "Another connection",
            savedAt: new Date("2027-01-01T00:00:00Z"),
        });
        expect(later).not.toBe(renderConversationMarkdown(conv, PROVENANCE));
        expect(conversationContentHash(conv)).toBe(conversationContentHash(conv));
        expect(conversationContentHash(conv)).toMatch(/^[0-9a-f]{64}$/);

        const edited = conversation([{ role: "user", content: "Hi!" }]);
        const retitled = conversation([{ role: "user", content: "Hi" }], "Another title");
        expect(conversationContentHash(edited)).not.toBe(conversationContentHash(conv));
        expect(conversationContentHash(retitled)).not.toBe(conversationContentHash(conv));
    });

    it("labels each assistant family and leaves out what it does not know", () => {
        expect(
            provenanceLine({ ...PROVENANCE, family: "chatgpt", clientName: null, model: null }, 1)
        ).toBe("Saved from ChatGPT · 2026-10-16 14:03 UTC · 1 message");
        expect(
            provenanceLine(
                { ...PROVENANCE, family: "gemini", clientName: "gemini", model: null },
                3
            )
        ).toBe("Saved from Gemini · 2026-10-16 14:03 UTC · 3 messages");
        expect(
            provenanceLine({ ...PROVENANCE, family: "other", clientName: "My key", model: "m" }, 2)
        ).toBe("Saved from Assistant (My key) · 2026-10-16 14:03 UTC · 2 messages · model m");
    });

    it("refuses a transcript over 2 MB as too_large", () => {
        const big = "x".repeat(150_000);
        const conv = conversation(
            Array.from({ length: 15 }, () => ({ role: "user" as const, content: big }))
        );
        const markdown = renderConversationMarkdown(conv, PROVENANCE);
        expect(() => assertTranscriptSize(markdown)).toThrow(ConversationSaveError);
        try {
            assertTranscriptSize(markdown);
        } catch (error) {
            expect((error as ConversationSaveError).code).toBe("too_large");
            expect((error as Error).message).toMatch(/limit is 2\.0 MB/);
        }
        expect(() => assertTranscriptSize("# small\n")).not.toThrow();
    });

    it("names the file from the title", () => {
        expect(conversationFilename("Pricing: the pilot (v2)!")).toBe("Pricing-the-pilot-v2.md");
        expect(conversationFilename("日本語")).toBe("conversation.md");
    });
});

describe("continuation context for a saved conversation", () => {
    it("says it continues a saved conversation and keeps the newest turns", () => {
        const conv = conversation([
            { role: "user", content: "Plan the launch" },
            { role: "assistant", content: "Three phases." },
        ]);
        const context = buildContinuationContext(
            parseSessionTranscript(renderConversationMarkdown(conv, PROVENANCE))
        );
        expect(context).toContain('Continuing the saved conversation "Pricing the pilot".');
        expect(context).toContain("User: Plan the launch");
        expect(context).toContain("Assistant: Three phases.");
    });
});
