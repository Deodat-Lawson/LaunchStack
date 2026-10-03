/**
 * The conversation viewer's helpers recognise a saved assistant conversation
 * — display type, label, format — while imported agent sessions keep
 * behaving exactly as before.
 */

import { renderSessionMarkdown } from "@launchstack/pipelines/connectors/agent-sessions";

import { getDocumentDisplayType } from "~/app/employer/documents/types/document";
import {
    ASSISTANT_LABELS,
    assistantConversationMeta,
    isAgentSessionDocument,
    isAssistantConversationDocument,
    isConversationDocument,
    parseSessionTranscript,
} from "~/lib/session-transcript";

const SAVED = {
    ocrMetadata: {
        connector: "assistant-conversations",
        assistant: "gemini",
        clientName: "Gemini CLI",
        model: "gemini-3-pro",
        savedAt: "2026-10-16T14:03:00.000Z",
        messageCount: 4,
    },
};
const SESSION = { ocrMetadata: { connector: "agent-sessions", tool: "codex" } };

describe("recognising conversation documents", () => {
    it("tells the two connectors apart and treats both as conversations", () => {
        expect(isAssistantConversationDocument(SAVED)).toBe(true);
        expect(isAgentSessionDocument(SAVED)).toBe(false);
        expect(isConversationDocument(SAVED)).toBe(true);

        expect(isAgentSessionDocument(SESSION)).toBe(true);
        expect(isAssistantConversationDocument(SESSION)).toBe(false);
        expect(isConversationDocument(SESSION)).toBe(true);

        expect(isConversationDocument({ ocrMetadata: { connector: "gmail" } })).toBe(false);
        expect(isConversationDocument({ ocrMetadata: null })).toBe(false);
        expect(isConversationDocument(null)).toBe(false);
    });

    it("renders both as the conversation display type", () => {
        const base = { url: "/api/files/1", title: "Chat.md", mimeType: "text/markdown" };
        expect(getDocumentDisplayType({ ...base, ...SAVED })).toBe("conversation");
        expect(getDocumentDisplayType({ ...base, ...SESSION })).toBe("conversation");
        expect(getDocumentDisplayType(base)).toBe("markdown");
    });
});

describe("assistantConversationMeta", () => {
    it("labels each family Claude / ChatGPT / Gemini / Assistant", () => {
        expect(assistantConversationMeta(SAVED)).toEqual({
            assistant: "gemini",
            label: "Gemini",
            clientName: "Gemini CLI",
            model: "gemini-3-pro",
            savedAt: "2026-10-16T14:03:00.000Z",
            messageCount: 4,
        });
        const label = (assistant: unknown) =>
            assistantConversationMeta({ ocrMetadata: { ...SAVED.ocrMetadata, assistant } }).label;
        expect(label("claude")).toBe("Claude");
        expect(label("chatgpt")).toBe("ChatGPT");
        expect(label("other")).toBe("Assistant");
        expect(label("something-new")).toBe("Assistant");
        expect(label(undefined)).toBe("Assistant");
        expect(Object.values(ASSISTANT_LABELS)).toEqual([
            "Claude",
            "ChatGPT",
            "Gemini",
            "Assistant",
        ]);
    });
});

describe("agent sessions keep their grammar", () => {
    const session = {
        tool: "claude-code" as const,
        sessionId: "s-1",
        title: "Deploy",
        projectPath: null,
        gitBranch: null,
        startedAt: null,
        endedAt: null,
        segments: [
            { kind: "user" as const, text: "Run it\n\\## User — literal", at: undefined },
            { kind: "assistant" as const, text: "Running." },
            { kind: "tool-call" as const, name: "Bash", summary: "make deploy" },
            { kind: "tool-result" as const, text: "ok" },
        ],
        dropped: { thinking: 0, sidechain: 0, metadata: 0, unknown: 0, malformed: 0 },
    };

    it("parses as an agent session, with tool traffic and no unescaping", () => {
        const markdown = renderSessionMarkdown(session, { title: "Deploy" });
        const auto = parseSessionTranscript(markdown);
        const explicit = parseSessionTranscript(markdown, { format: "agent-session" });

        expect(auto).toEqual(explicit);
        expect(auto.format).toBe("agent-session");
        expect(auto.segments).toEqual([
            { kind: "user", text: "Run it\n\\## User — literal", at: null },
            { kind: "assistant", text: "Running." },
            { kind: "tool-call", name: "Bash", summary: "make deploy" },
            { kind: "tool-result", text: "ok" },
        ]);
        // No `at` key is added to an agent session's assistant turns.
        expect(Object.keys(auto.segments[1]!)).toEqual(["kind", "text"]);
    });

    it("does not read tool calls or result fences inside a saved conversation", () => {
        const markdown = [
            "# Saved",
            "",
            "> Saved from Claude · 2026-10-16 14:03 UTC · 1 message",
            "",
            "## Assistant — 2026-10-16 14:00",
            "",
            "> → **Bash** — `ls`",
            "````",
            "not a result",
            "````",
        ].join("\n");
        const parsed = parseSessionTranscript(markdown);
        expect(parsed.format).toBe("assistant-conversation");
        expect(parsed.segments).toEqual([
            {
                kind: "assistant",
                text: "> → **Bash** — `ls`\n````\nnot a result\n````",
                at: "2026-10-16 14:00",
            },
        ]);
    });
});
