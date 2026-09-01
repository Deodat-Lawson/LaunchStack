/**
 * Round-trip pin between the connector's renderer and the client-side parser:
 * whatever renderSessionMarkdown writes, parseSessionTranscript must read
 * back. If the grammar in render.ts moves, this is the test that says so.
 */

import {
    renderSessionMarkdown,
    type NormalizedSession,
} from "@launchstack/pipelines/connectors/agent-sessions";

import {
    buildContinuationContext,
    isAgentSessionDocument,
    parseSessionTranscript,
} from "~/lib/session-transcript";

const SESSION: NormalizedSession = {
    tool: "claude-code",
    sessionId: "aaaaaaaa-1111-4111-8111-111111111111",
    title: "Deploy pipeline chat",
    projectPath: "/Users/me/app",
    gitBranch: "main",
    startedAt: "2026-08-27T02:20:45.256Z",
    endedAt: "2026-08-27T03:11:02.000Z",
    segments: [
        { kind: "user", text: "How should I deploy this app?", at: "2026-08-27T02:20:45.256Z" },
        { kind: "assistant", text: "Three options stand out." },
        { kind: "tool-call", name: "Bash", summary: "az vm list --output table" },
        { kind: "tool-result", text: "Name  Location\nvm-1  eastus" },
        { kind: "assistant", text: "The single-VM route is the cheapest.\n\nHere is why." },
        { kind: "user", text: "Go with that.", at: "2026-08-27T03:10:00.000Z" },
    ],
    dropped: { thinking: 4, sidechain: 2, metadata: 10, unknown: 0, malformed: 0 },
};

describe("parseSessionTranscript", () => {
    it("round-trips the renderer's output", () => {
        const markdown = renderSessionMarkdown(SESSION, { title: "Deploy pipeline chat" });
        const parsed = parseSessionTranscript(markdown);

        expect(parsed.title).toBe("Deploy pipeline chat");
        expect(parsed.provenance.join(" ")).toContain("Imported Claude Code session");
        expect(parsed.provenance.join(" ")).toContain("thinking block");

        expect(parsed.segments).toEqual([
            {
                kind: "user",
                text: "How should I deploy this app?",
                at: "2026-08-27 02:20",
            },
            { kind: "assistant", text: "Three options stand out." },
            { kind: "tool-call", name: "Bash", summary: "az vm list --output table" },
            { kind: "tool-result", text: "Name  Location\nvm-1  eastus" },
            {
                kind: "assistant",
                text: "The single-VM route is the cheapest.\n\nHere is why.",
            },
            { kind: "user", text: "Go with that.", at: "2026-08-27 03:10" },
        ]);
    });

    it("keeps unrecognized structure inside the surrounding text", () => {
        const markdown = [
            "# Odd session",
            "",
            "## User — 2026-08-27 02:20",
            "",
            "A quote follows:",
            "> not a tool call, just a quote",
            "",
            "### a heading inside the user's own markdown",
            "",
        ].join("\n");

        const parsed = parseSessionTranscript(markdown);
        expect(parsed.segments).toEqual([
            {
                kind: "user",
                text: "A quote follows:\n> not a tool call, just a quote\n\n### a heading inside the user's own markdown",
                at: "2026-08-27 02:20",
            },
        ]);
    });

    it("survives an unterminated tool-result fence", () => {
        const markdown = ["# T", "", "## Assistant", "", "````", "half a result"].join("\n");
        const parsed = parseSessionTranscript(markdown);
        expect(parsed.segments).toEqual([{ kind: "tool-result", text: "half a result" }]);
    });
});

describe("isAgentSessionDocument", () => {
    it("keys off the sink's connector marker", () => {
        expect(isAgentSessionDocument({ ocrMetadata: { connector: "agent-sessions" } })).toBe(true);
        expect(isAgentSessionDocument({ ocrMetadata: { connector: "agent-knowledge" } })).toBe(
            false
        );
        expect(isAgentSessionDocument({ ocrMetadata: null })).toBe(false);
        expect(isAgentSessionDocument(null)).toBe(false);
    });
});

describe("buildContinuationContext", () => {
    it("keeps the newest turns and folds tool traffic to one line", () => {
        const markdown = renderSessionMarkdown(SESSION, { title: "Deploy pipeline chat" });
        const context = buildContinuationContext(parseSessionTranscript(markdown));

        expect(context).toContain('Continuing the imported session "Deploy pipeline chat"');
        expect(context).toContain("User: Go with that.");
        expect(context).toContain("[ran Bash: az vm list --output table]");
        expect(context).not.toContain("vm-1  eastus"); // tool results stay in the document
    });

    it("stays inside the character budget, dropping oldest turns first", () => {
        const long: NormalizedSession = {
            ...SESSION,
            segments: Array.from({ length: 100 }, (_, i) => ({
                kind: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
                text: `turn ${i} ${"x".repeat(200)}`,
                at: undefined,
            })),
        };
        const markdown = renderSessionMarkdown(long, { title: "Long" });
        const context = buildContinuationContext(parseSessionTranscript(markdown), {
            maxChars: 2000,
        });

        expect(context.length).toBeLessThan(2400);
        expect(context).toContain("turn 99");
        expect(context).not.toContain("turn 1 ");
    });
});
