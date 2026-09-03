/**
 * The peek is the sessions browser's data source: bounded head/tail reads
 * that recover titles, first prompts and provenance without a full parse.
 * These tests pin the windowing behaviour — a title record at the end of a
 * file bigger than both windows must still be found, and a missing file must
 * degrade to nulls rather than throw.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
    PEEK_WINDOW_BYTES,
    peekSessionFile,
} from "@launchstack/pipelines/connectors/agent-sessions";

let root: string;

beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "agent-sessions-peek-"));
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

async function write(name: string, lines: readonly string[]): Promise<string> {
    const file = path.join(root, name);
    await writeFile(file, lines.join("\n") + "\n", "utf8");
    return file;
}

const claudeUser = (text: string): string =>
    JSON.stringify({
        type: "user",
        cwd: "/Users/me/app",
        gitBranch: "main",
        message: { role: "user", content: text },
    });

describe("peekSessionFile (claude-code)", () => {
    it("recovers title, first prompt, project path and branch", async () => {
        const file = await write("session.jsonl", [
            claudeUser("How do I deploy this?"),
            JSON.stringify({
                type: "assistant",
                message: { role: "assistant", content: [{ type: "text", text: "Like this." }] },
            }),
            JSON.stringify({ type: "custom-title", customTitle: "Deploy pipeline chat" }),
        ]);

        expect(await peekSessionFile(file, "claude-code")).toEqual({
            title: "Deploy pipeline chat",
            preview: "How do I deploy this?",
            projectPath: "/Users/me/app",
            gitBranch: "main",
        });
    });

    it("skips harness-injected user text when picking the preview", async () => {
        const file = await write("session.jsonl", [
            claudeUser("<command-name>/compact</command-name>"),
            claudeUser("Real question"),
        ]);

        const peek = await peekSessionFile(file, "claude-code");
        expect(peek.preview).toBe("Real question");
    });

    it("finds a tail title in a file larger than both windows", async () => {
        const filler = JSON.stringify({ type: "system", note: "x".repeat(1024) });
        const fillerCount = Math.ceil((PEEK_WINDOW_BYTES * 3) / filler.length);
        const file = await write("big.jsonl", [
            claudeUser("First prompt in the head window"),
            ...Array.from({ length: fillerCount }, () => filler),
            JSON.stringify({ type: "ai-title", aiTitle: "Title near the end" }),
        ]);

        const peek = await peekSessionFile(file, "claude-code");
        expect(peek.title).toBe("Title near the end");
        expect(peek.preview).toBe("First prompt in the head window");
    });

    it("returns nulls for an unreadable file", async () => {
        expect(await peekSessionFile(path.join(root, "absent.jsonl"), "claude-code")).toEqual({
            title: null,
            preview: null,
            projectPath: null,
            gitBranch: null,
        });
    });
});

describe("peekSessionFile (codex)", () => {
    it("recovers the project path and first user message", async () => {
        const file = await write("rollout.jsonl", [
            JSON.stringify({
                type: "session_meta",
                payload: { id: "abc", cwd: "/Users/me/app" },
            }),
            JSON.stringify({
                type: "event_msg",
                payload: { type: "user_message", message: "Fix the tests" },
            }),
        ]);

        expect(await peekSessionFile(file, "codex")).toEqual({
            title: null,
            preview: "Fix the tests",
            projectPath: "/Users/me/app",
            gitBranch: null,
        });
    });

    it("prefers the response stream's user message when both exist", async () => {
        const file = await write("rollout.jsonl", [
            JSON.stringify({
                type: "response_item",
                payload: {
                    type: "message",
                    role: "user",
                    content: [{ type: "input_text", text: "From the response stream" }],
                },
            }),
            JSON.stringify({
                type: "event_msg",
                payload: { type: "user_message", message: "From the event stream" },
            }),
        ]);

        const peek = await peekSessionFile(file, "codex");
        expect(peek.preview).toBe("From the response stream");
    });
});
