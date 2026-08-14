/**
 * Sync orchestration against an in-memory sink: change detection, error
 * containment and concurrency. No database, no blob storage — the point of the
 * `KnowledgeSink` seam is that this layer is testable without either.
 */

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { syncAgentKnowledge } from "@launchstack/features/connectors/agent-knowledge";
import type {
    DiscoveredKnowledgeItem,
    KnowledgeItem,
    KnowledgeSink,
    StoredKnowledgeItem,
} from "@launchstack/features/connectors";

let root: string;
let home: string;

async function write(file: string, contents: string): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, "utf8");
}

function claudeFile(name: string): string {
    return path.join(home, ".claude", name);
}

interface RecordingSink extends KnowledgeSink {
    readonly stored: KnowledgeItem[];
    readonly hashes: Map<string, string>;
    concurrentPeak: number;
}

function createRecordingSink(
    overrides: { failOn?: (item: KnowledgeItem) => string | null; delayMs?: number } = {}
): RecordingSink {
    const stored: KnowledgeItem[] = [];
    const hashes = new Map<string, string>();
    let inFlight = 0;
    let documentId = 0;

    const sink: RecordingSink = {
        stored,
        hashes,
        concurrentPeak: 0,
        async lastSyncedHash(item: DiscoveredKnowledgeItem): Promise<string | null> {
            return hashes.get(item.sourceId) ?? null;
        },
        async store(item: KnowledgeItem): Promise<StoredKnowledgeItem> {
            inFlight += 1;
            sink.concurrentPeak = Math.max(sink.concurrentPeak, inFlight);
            try {
                if (overrides.delayMs) {
                    await new Promise(resolve => setTimeout(resolve, overrides.delayMs));
                }
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
            } finally {
                inFlight -= 1;
            }
        },
    };

    return sink;
}

beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "agent-knowledge-sync-"));
    home = path.join(root, "home");
    await mkdir(home, { recursive: true });
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe("syncAgentKnowledge", () => {
    it("uploads everything it finds on a first run", async () => {
        await write(claudeFile("CLAUDE.md"), "# Rules");
        await write(claudeFile("agents/reviewer.md"), "You review.");

        const sink = createRecordingSink();
        const report = await syncAgentKnowledge({
            homeDir: home,
            tools: ["claude-code"],
            sink,
        });

        expect(report.discovered).toBe(2);
        expect(report.stored).toHaveLength(2);
        expect(report.failed).toHaveLength(0);
        expect(report.stored.every(entry => !entry.revised)).toBe(true);
        expect(sink.stored.map(item => item.content)).toEqual(
            expect.arrayContaining(["# Rules", "You review."])
        );
    });

    it("skips files whose content has not changed since the last sync", async () => {
        await write(claudeFile("CLAUDE.md"), "# Rules");
        const sink = createRecordingSink();

        await syncAgentKnowledge({ homeDir: home, tools: ["claude-code"], sink });
        const second = await syncAgentKnowledge({ homeDir: home, tools: ["claude-code"], sink });

        expect(second.stored).toHaveLength(0);
        expect(second.skipped).toEqual([
            expect.objectContaining({
                sourceId: "agent-knowledge://claude-code/global/CLAUDE.md",
                reason: "unchanged",
            }),
        ]);
        expect(sink.stored).toHaveLength(1);
    });

    it("re-uploads a file once its content changes, marked as a revision", async () => {
        await write(claudeFile("CLAUDE.md"), "# Rules");
        const sink = createRecordingSink();

        await syncAgentKnowledge({ homeDir: home, tools: ["claude-code"], sink });
        await write(claudeFile("CLAUDE.md"), "# Rules, revised");
        const second = await syncAgentKnowledge({ homeDir: home, tools: ["claude-code"], sink });

        expect(second.stored).toEqual([expect.objectContaining({ revised: true })]);
        expect(sink.stored.at(-1)?.content).toBe("# Rules, revised");
    });

    it("re-uploads unchanged content when forced", async () => {
        await write(claudeFile("CLAUDE.md"), "# Rules");
        const sink = createRecordingSink();

        await syncAgentKnowledge({ homeDir: home, tools: ["claude-code"], sink });
        const forced = await syncAgentKnowledge({
            homeDir: home,
            tools: ["claude-code"],
            sink,
            force: true,
        });

        expect(forced.stored).toHaveLength(1);
        expect(forced.skipped.filter(entry => entry.reason === "unchanged")).toHaveLength(0);
    });

    it("keeps going when one file fails and reports it", async () => {
        await write(claudeFile("CLAUDE.md"), "# Rules");
        await write(claudeFile("agents/broken.md"), "boom");
        await write(claudeFile("agents/fine.md"), "ok");

        const sink = createRecordingSink({
            failOn: item => (item.sourceId.endsWith("broken.md") ? "storage exploded" : null),
        });

        const report = await syncAgentKnowledge({ homeDir: home, tools: ["claude-code"], sink });

        expect(report.stored).toHaveLength(2);
        expect(report.failed).toEqual([
            {
                sourceId: "agent-knowledge://claude-code/global/agents/broken.md",
                error: "storage exploded",
            },
        ]);
    });

    it("carries discovery skips through to the report", async () => {
        await write(claudeFile("CLAUDE.md"), "# Rules");
        await write(claudeFile("memory/auth.json"), "{}");
        await write(claudeFile("agents/empty.md"), "");

        const sink = createRecordingSink();
        const report = await syncAgentKnowledge({ homeDir: home, tools: ["claude-code"], sink });

        expect(report.stored).toHaveLength(1);
        expect(report.skipped.map(entry => entry.reason)).toEqual(
            expect.arrayContaining(["empty", "excluded"])
        );
    });

    it("honours the concurrency ceiling", async () => {
        for (const name of ["a", "b", "c", "d", "e", "f"]) {
            await write(claudeFile(`agents/${name}.md`), name);
        }

        const sink = createRecordingSink({ delayMs: 5 });
        await syncAgentKnowledge({
            homeDir: home,
            tools: ["claude-code"],
            sink,
            concurrency: 2,
        });

        expect(sink.stored).toHaveLength(6);
        expect(sink.concurrentPeak).toBeLessThanOrEqual(2);
    });

    it("works against a sink with no change detection at all", async () => {
        await write(claudeFile("CLAUDE.md"), "# Rules");
        const calls: string[] = [];
        const sink: KnowledgeSink = {
            async store(item) {
                calls.push(item.sourceId);
                return {
                    sourceId: item.sourceId,
                    documentId: 1,
                    versionId: 1,
                    jobId: null,
                    revised: false,
                };
            },
        };

        await syncAgentKnowledge({ homeDir: home, tools: ["claude-code"], sink });
        await syncAgentKnowledge({ homeDir: home, tools: ["claude-code"], sink });

        expect(calls).toHaveLength(2);
    });

    it("times the run from a caller-supplied clock", async () => {
        await write(claudeFile("CLAUDE.md"), "# Rules");
        const times = [new Date("2026-08-09T10:00:00Z"), new Date("2026-08-09T10:00:03Z")];

        const report = await syncAgentKnowledge({
            homeDir: home,
            tools: ["claude-code"],
            sink: createRecordingSink(),
            now: () => times.shift() ?? new Date("2026-08-09T10:00:03Z"),
        });

        expect(report.startedAt).toBe("2026-08-09T10:00:00.000Z");
        expect(report.durationMs).toBe(3000);
        expect(report.connectorId).toBe("agent-knowledge");
    });
});
