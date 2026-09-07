/**
 * Dialect parsers and renderer. These are pinned against the on-disk formats
 * observed in real `~/.claude` and `~/.codex` folders — when a CLI update
 * moves the format, the intended failure mode is a broken fixture here plus a
 * rising `unknown` count in production reports, never a corrupt import.
 */

import {
    parseClaudeSession,
    parseCodexSession,
    renderSessionMarkdown,
    sessionDisplayTitle,
    TOOL_RESULT_MAX_CHARS,
} from "@launchstack/pipelines/connectors/agent-sessions";

function jsonl(...records: unknown[]): string {
    return records
        .map(record => (typeof record === "string" ? record : JSON.stringify(record)))
        .join("\n");
}

const CLAUDE_COMMON = {
    sessionId: "s1",
    cwd: "/Users/me/app",
    gitBranch: "main",
};

describe("parseClaudeSession", () => {
    it("keeps prose, summarizes tools, and drops thinking and sidechains", () => {
        const longOutput = "x".repeat(TOOL_RESULT_MAX_CHARS + 500);
        const session = parseClaudeSession(
            jsonl(
                { type: "queue-operation", operation: "enqueue" },
                {
                    type: "user",
                    ...CLAUDE_COMMON,
                    timestamp: "2026-08-27T02:20:45.256Z",
                    message: { role: "user", content: "How should I deploy this?" },
                },
                {
                    type: "assistant",
                    ...CLAUDE_COMMON,
                    timestamp: "2026-08-27T02:21:00.000Z",
                    message: {
                        content: [
                            { type: "thinking", thinking: "SECRET-THOUGHT" },
                            { type: "text", text: "Use Azure." },
                            { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
                        ],
                    },
                },
                {
                    type: "user",
                    ...CLAUDE_COMMON,
                    timestamp: "2026-08-27T02:21:05.000Z",
                    message: {
                        role: "user",
                        content: [
                            { type: "tool_result", content: [{ type: "text", text: longOutput }] },
                        ],
                    },
                },
                {
                    type: "assistant",
                    ...CLAUDE_COMMON,
                    isSidechain: true,
                    message: { content: [{ type: "text", text: "subagent chatter" }] },
                },
                { type: "ai-title", aiTitle: "AI title" },
                { type: "custom-title", customTitle: "Deploy plan" },
                { type: "definitely-new-record-type", payload: {} },
                '{"torn line'
            )
        );

        expect(session.sessionId).toBe("s1");
        expect(session.projectPath).toBe("/Users/me/app");
        expect(session.gitBranch).toBe("main");
        expect(session.title).toBe("Deploy plan");
        expect(session.startedAt).toBe("2026-08-27T02:20:45.256Z");
        expect(session.endedAt).toBe("2026-08-27T02:21:05.000Z");

        expect(session.segments.map(segment => segment.kind)).toEqual([
            "user",
            "assistant",
            "tool-call",
            "tool-result",
        ]);
        const toolResult = session.segments[3];
        expect(toolResult?.kind === "tool-result" && toolResult.text).toContain("[+500 chars]");

        expect(session.dropped).toEqual(
            expect.objectContaining({ thinking: 1, sidechain: 1, unknown: 1, malformed: 1 })
        );
        expect(session.dropped.metadata).toBeGreaterThanOrEqual(1);
    });

    it("treats slash-command echoes in the user channel as bookkeeping", () => {
        const session = parseClaudeSession(
            jsonl({
                type: "user",
                ...CLAUDE_COMMON,
                message: { role: "user", content: "<command-name>/compact</command-name>" },
            })
        );

        expect(session.segments).toHaveLength(0);
        expect(session.dropped.metadata).toBe(1);
    });

    it("prefers the AI title when no custom title exists", () => {
        const session = parseClaudeSession(jsonl({ type: "ai-title", aiTitle: "AI title" }));
        expect(session.title).toBe("AI title");
    });
});

describe("parseCodexSession", () => {
    it("prefers the response stream and decodes JSON-encoded tool output", () => {
        const session = parseCodexSession(
            jsonl(
                {
                    timestamp: "2026-07-12T03:27:49.931Z",
                    type: "session_meta",
                    payload: { id: "c0ffee00-1111-4222-8333-444444444444", cwd: "/Users/me/app" },
                },
                {
                    timestamp: "2026-07-12T03:27:50.000Z",
                    type: "response_item",
                    payload: {
                        type: "message",
                        role: "developer",
                        content: [{ type: "input_text", text: "<permissions instructions>" }],
                    },
                },
                {
                    timestamp: "2026-07-12T03:27:51.000Z",
                    type: "event_msg",
                    payload: { type: "user_message", message: "duplicate from the event stream" },
                },
                {
                    timestamp: "2026-07-12T03:27:51.100Z",
                    type: "response_item",
                    payload: {
                        type: "message",
                        role: "user",
                        content: [{ type: "input_text", text: "Research SaaS trends" }],
                    },
                },
                {
                    timestamp: "2026-07-12T03:27:52.000Z",
                    type: "response_item",
                    payload: { type: "reasoning", encrypted_content: "gAAAA…" },
                },
                {
                    timestamp: "2026-07-12T03:27:53.000Z",
                    type: "response_item",
                    payload: { type: "custom_tool_call", name: "exec", input: "ls -la" },
                },
                {
                    timestamp: "2026-07-12T03:27:54.000Z",
                    type: "response_item",
                    payload: {
                        type: "custom_tool_call_output",
                        output: '[{"type": "input_text", "text": "Script completed"}]',
                    },
                },
                {
                    timestamp: "2026-07-12T03:27:55.000Z",
                    type: "response_item",
                    payload: {
                        type: "message",
                        role: "assistant",
                        content: [{ type: "output_text", text: "Here is the trend report." }],
                    },
                },
                {
                    timestamp: "2026-07-12T03:27:55.500Z",
                    type: "event_msg",
                    payload: { type: "agent_message", message: "duplicate agent event" },
                },
                {
                    timestamp: "2026-07-12T03:27:56.000Z",
                    type: "event_msg",
                    payload: { type: "token_count" },
                }
            )
        );

        expect(session.sessionId).toBe("c0ffee00-1111-4222-8333-444444444444");
        expect(session.projectPath).toBe("/Users/me/app");
        expect(session.segments).toEqual([
            expect.objectContaining({ kind: "user", text: "Research SaaS trends" }),
            expect.objectContaining({ kind: "tool-call", name: "exec", summary: "ls -la" }),
            expect.objectContaining({ kind: "tool-result", text: "Script completed" }),
            expect.objectContaining({ kind: "assistant", text: "Here is the trend report." }),
        ]);
        expect(session.dropped.thinking).toBe(1);
        // developer prompt + both duplicate events + token_count
        expect(session.dropped.metadata).toBeGreaterThanOrEqual(4);
    });

    it("falls back to the event stream when the response stream has no messages", () => {
        const session = parseCodexSession(
            jsonl(
                { type: "session_meta", payload: { id: "c0ffee00-1111-4222-8333-444444444444" } },
                { type: "event_msg", payload: { type: "user_message", message: "hello" } },
                { type: "event_msg", payload: { type: "agent_message", message: "hi there" } }
            )
        );

        expect(session.segments).toEqual([
            expect.objectContaining({ kind: "user", text: "hello" }),
            expect.objectContaining({ kind: "assistant", text: "hi there" }),
        ]);
    });
});

describe("renderSessionMarkdown", () => {
    it("renders headings, provenance and drop counts — and no thinking text", () => {
        const session = parseClaudeSession(
            jsonl(
                {
                    type: "user",
                    ...CLAUDE_COMMON,
                    timestamp: "2026-08-27T02:20:45.256Z",
                    message: { role: "user", content: "How should I deploy this?" },
                },
                {
                    type: "assistant",
                    ...CLAUDE_COMMON,
                    message: {
                        content: [
                            { type: "thinking", thinking: "SECRET-THOUGHT" },
                            { type: "text", text: "Use Azure." },
                            { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
                        ],
                    },
                },
                { type: "custom-title", customTitle: "Deploy plan" }
            )
        );

        const markdown = renderSessionMarkdown(session, { title: "Deploy plan" });

        expect(markdown).toContain("# Deploy plan");
        expect(markdown).toContain("> Imported Claude Code session `s1`.");
        expect(markdown).toContain("project `/Users/me/app` · branch `main`");
        expect(markdown).toContain("## User — 2026-08-27 02:20");
        expect(markdown).toContain("## Assistant");
        expect(markdown).toContain("> → **Bash** — `ls -la`");
        expect(markdown).toContain("Not imported: 1 thinking block");
        expect(markdown).not.toContain("SECRET-THOUGHT");
    });

    it("falls back to the first user line, then to the session id, for a title", () => {
        const withUser = parseClaudeSession(
            jsonl({
                type: "user",
                ...CLAUDE_COMMON,
                message: { role: "user", content: "Fix the flaky login test\nplease" },
            })
        );
        expect(sessionDisplayTitle(withUser, "abcd1234-0000-4000-8000-000000000000")).toBe(
            "Fix the flaky login test"
        );

        const empty = parseClaudeSession("");
        expect(sessionDisplayTitle(empty, "abcd1234-0000-4000-8000-000000000000")).toBe(
            "Claude Code session abcd1234"
        );
    });
});
