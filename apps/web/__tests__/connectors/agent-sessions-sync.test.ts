/**
 * Sync orchestration against an in-memory sink: parse-and-render on the way
 * through, change detection on the rendered transcript, and error containment.
 */

import { mkdir, mkdtemp, rm, utimes, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { syncAgentSessions } from "@launchstack/pipelines/connectors/agent-sessions";
import type {
    DiscoveredKnowledgeItem,
    KnowledgeItem,
    KnowledgeSink,
    StoredKnowledgeItem,
} from "@launchstack/pipelines/connectors";

let root: string;
let home: string;

const CLAUDE_UUID = "aaaaaaaa-1111-4111-8111-111111111111";
const CODEX_UUID = "bbbbbbbb-2222-4222-8222-222222222222";

async function age(file: string, ageMinutes = 60): Promise<void> {
    const when = new Date(Date.now() - ageMinutes * 60 * 1000);
    await utimes(file, when, when);
}

async function write(file: string, contents: string): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, "utf8");
    await age(file);
}

function claudeLines(...extra: string[]): string {
    return [
        JSON.stringify({
            type: "user",
            sessionId: CLAUDE_UUID,
            cwd: "/Users/me/app",
            gitBranch: "main",
            timestamp: "2026-08-27T02:20:45.256Z",
            message: { role: "user", content: "How should I deploy this?" },
        }),
        JSON.stringify({
            type: "assistant",
            sessionId: CLAUDE_UUID,
            message: { content: [{ type: "text", text: "Use Azure." }] },
        }),
        ...extra,
    ].join("\n");
}

function codexLines(): string {
    return [
        JSON.stringify({
            timestamp: "2026-07-12T03:27:49.931Z",
            type: "session_meta",
            payload: { id: CODEX_UUID, cwd: "/Users/me/app" },
        }),
        JSON.stringify({
            type: "event_msg",
            payload: { type: "user_message", message: "Research SaaS trends" },
        }),
        JSON.stringify({
            type: "event_msg",
            payload: { type: "agent_message", message: "Here is the report." },
        }),
    ].join("\n");
}

function claudeFile(): string {
    return path.join(home, ".claude", "projects", "-Users-me-app", `${CLAUDE_UUID}.jsonl`);
}

function codexFile(): string {
    return path.join(
        home,
        ".codex",
        "sessions",
        "2026/07/11",
        `rollout-2026-07-11T23-27-49-${CODEX_UUID}.jsonl`
    );
}

interface RecordingSink extends KnowledgeSink {
    readonly stored: KnowledgeItem[];
    readonly hashes: Map<string, string>;
}

function createRecordingSink(
    overrides: { failOn?: (item: KnowledgeItem) => string | null } = {}
): RecordingSink {
    const stored: KnowledgeItem[] = [];
    const hashes = new Map<string, string>();
    let documentId = 0;

    return {
        stored,
        hashes,
        async lastSyncedHash(item: DiscoveredKnowledgeItem): Promise<string | null> {
            return hashes.get(item.sourceId) ?? null;
        },
        async store(item: KnowledgeItem): Promise<StoredKnowledgeItem> {
            const failure = overrides.failOn?.(item);
            if (failure) throw new Error(failure);

            const revised = hashes.has(item.sourceId);
            hashes.set(item.sourceId, item.contentHash);
            stored.push(item);
            documentId += 1;
            return {
                sourceId: item.sourceId,
                documentId,
                versionId: documentId,
                jobId: `job-${documentId}`,
                revised,
            };
        },
    };
}

beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "agent-sessions-sync-"));
    home = path.join(root, "home");
    await mkdir(home, { recursive: true });
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe("syncAgentSessions", () => {
    it("imports both dialects as rendered Markdown, titled from what the tools recorded", async () => {
        await write(claudeFile(), claudeLines());
        await write(codexFile(), codexLines());
        await write(
            path.join(home, ".codex", "session_index.jsonl"),
            JSON.stringify({ id: CODEX_UUID, thread_name: "SaaS trend research" })
        );

        const sink = createRecordingSink();
        const report = await syncAgentSessions({ homeDir: home, sink });

        expect(report.discovered).toBe(2);
        expect(report.failed).toHaveLength(0);
        expect(report.stored).toHaveLength(2);

        const codexItem = sink.stored.find(item => item.metadata.tool === "codex");
        expect(codexItem?.title).toBe("SaaS trend research");
        expect(codexItem?.content).toContain("Research SaaS trends");

        const claudeItem = sink.stored.find(item => item.metadata.tool === "claude-code");
        expect(claudeItem?.title).toBe("How should I deploy this?");
        expect(claudeItem?.content).toContain("## Assistant");
        expect(claudeItem?.mimeType).toBe("text/markdown");
    });

    it("skips a session whose rendered transcript has not changed", async () => {
        await write(claudeFile(), claudeLines());
        const sink = createRecordingSink();

        await syncAgentSessions({ homeDir: home, sink });
        const second = await syncAgentSessions({ homeDir: home, sink });

        expect(second.stored).toHaveLength(0);
        expect(second.skipped).toEqual([
            expect.objectContaining({
                sourceId: `agent-sessions://claude-code/${CLAUDE_UUID}`,
                reason: "unchanged",
            }),
        ]);
    });

    it("re-imports a session that grew, marked as a revision", async () => {
        await write(claudeFile(), claudeLines());
        const sink = createRecordingSink();
        await syncAgentSessions({ homeDir: home, sink });

        await appendFile(
            claudeFile(),
            "\n" +
                JSON.stringify({
                    type: "assistant",
                    sessionId: CLAUDE_UUID,
                    message: { content: [{ type: "text", text: "Actually, use a container." }] },
                })
        );
        await age(claudeFile());
        const second = await syncAgentSessions({ homeDir: home, sink });

        expect(second.stored).toEqual([expect.objectContaining({ revised: true })]);
        expect(sink.stored.at(-1)?.content).toContain("Actually, use a container.");
    });

    it("re-uploads unchanged sessions when forced", async () => {
        await write(claudeFile(), claudeLines());
        const sink = createRecordingSink();

        await syncAgentSessions({ homeDir: home, sink });
        const forced = await syncAgentSessions({ homeDir: home, sink, force: true });

        expect(forced.stored).toHaveLength(1);
    });

    it("reports a session with no conversational content as empty instead of storing it", async () => {
        await write(claudeFile(), JSON.stringify({ type: "queue-operation" }));

        const sink = createRecordingSink();
        const report = await syncAgentSessions({ homeDir: home, sink });

        expect(report.stored).toHaveLength(0);
        expect(report.skipped).toEqual([expect.objectContaining({ reason: "empty" })]);
    });

    it("keeps going when one session fails to store and reports it", async () => {
        await write(claudeFile(), claudeLines());
        await write(codexFile(), codexLines());

        const sink = createRecordingSink({
            failOn: item => (item.metadata.tool === "codex" ? "storage exploded" : null),
        });
        const report = await syncAgentSessions({ homeDir: home, sink });

        expect(report.stored).toHaveLength(1);
        expect(report.failed).toEqual([
            { sourceId: `agent-sessions://codex/${CODEX_UUID}`, error: "storage exploded" },
        ]);
    });
});
