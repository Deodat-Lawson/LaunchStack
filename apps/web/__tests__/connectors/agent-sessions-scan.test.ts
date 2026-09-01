/**
 * Discovery against a synthetic home directory: which files are session
 * transcripts, in what order they surface, and what gets skipped with which
 * reason. Discovery is stat-only, so nothing here asserts on content.
 */

import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { scanAgentSessions } from "@launchstack/pipelines/connectors/agent-sessions";

let root: string;
let home: string;

const UUID_A = "aaaaaaaa-1111-4111-8111-111111111111";
const UUID_B = "bbbbbbbb-2222-4222-8222-222222222222";
const UUID_C = "cccccccc-3333-4333-8333-333333333333";

/** Write a file and age its mtime so the quiescence window does not trip. */
async function writeAged(file: string, contents: string, ageMinutes = 60): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, "utf8");
    const when = new Date(Date.now() - ageMinutes * 60 * 1000);
    await utimes(file, when, when);
}

function claudeSession(slug: string, uuid: string): string {
    return path.join(home, ".claude", "projects", slug, `${uuid}.jsonl`);
}

function codexSession(day: string, uuid: string, archived = false): string {
    return path.join(
        home,
        ".codex",
        archived ? "archived_sessions" : "sessions",
        day,
        `rollout-2026-07-11T23-27-49-${uuid}.jsonl`
    );
}

beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "agent-sessions-scan-"));
    home = path.join(root, "home");
    await mkdir(home, { recursive: true });
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe("scanAgentSessions", () => {
    it("finds sessions for both tools, newest first, with uuid-based source ids", async () => {
        await writeAged(claudeSession("-Users-me-app", UUID_A), "{}", 180);
        await writeAged(codexSession("2026/07/11", UUID_B), "{}", 60);
        await writeAged(codexSession("2026/06/01", UUID_C, true), "{}", 240);

        const scan = await scanAgentSessions({ homeDir: home });

        expect(scan.items.map(item => item.sourceId)).toEqual([
            `agent-sessions://codex/${UUID_B}`,
            `agent-sessions://claude-code/${UUID_A}`,
            `agent-sessions://codex/${UUID_C}`,
        ]);
        expect(scan.items[2]?.metadata.archived).toBe(true);
        expect(scan.truncated).toBe(false);
    });

    it("ignores files that are not session transcripts", async () => {
        await writeAged(claudeSession("-Users-me-app", UUID_A), "{}");
        await writeAged(path.join(home, ".claude", "projects", "-Users-me-app", "notes.md"), "hi");
        await writeAged(path.join(home, ".codex", "sessions", "index.db"), "binary");

        const scan = await scanAgentSessions({ homeDir: home });

        expect(scan.items).toHaveLength(1);
        expect(scan.skipped).toHaveLength(0);
    });

    it("narrows to the requested Claude project slugs", async () => {
        await writeAged(claudeSession("-Users-me-app", UUID_A), "{}");
        await writeAged(claudeSession("-Users-me-other", UUID_B), "{}");

        const scan = await scanAgentSessions({ homeDir: home, projects: ["-Users-me-app"] });

        expect(scan.items.map(item => item.metadata.projectSlug)).toEqual(["-Users-me-app"]);
    });

    it("skips a file modified inside the quiescence window as still active", async () => {
        const file = claudeSession("-Users-me-app", UUID_A);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, "{}", "utf8"); // fresh mtime

        const scan = await scanAgentSessions({ homeDir: home });

        expect(scan.items).toHaveLength(0);
        expect(scan.skipped).toEqual([
            expect.objectContaining({
                sourceId: `agent-sessions://claude-code/${UUID_A}`,
                reason: "active",
            }),
        ]);
    });

    it("skips empty and oversized files with a reason", async () => {
        await writeAged(claudeSession("-Users-me-app", UUID_A), "");
        await writeAged(claudeSession("-Users-me-app", UUID_B), "x".repeat(64));

        const scan = await scanAgentSessions({ homeDir: home, maxFileBytes: 32 });

        expect(scan.items).toHaveLength(0);
        expect(scan.skipped.map(entry => entry.reason).sort()).toEqual(["empty", "too-large"]);
    });

    it("caps the batch newest-first and reports the cutoff", async () => {
        await writeAged(claudeSession("-Users-me-app", UUID_A), "{}", 60);
        await writeAged(claudeSession("-Users-me-app", UUID_B), "{}", 120);
        await writeAged(claudeSession("-Users-me-app", UUID_C), "{}", 180);

        const scan = await scanAgentSessions({ homeDir: home, maxSessions: 2 });

        expect(scan.items.map(item => item.sourceId)).toEqual([
            `agent-sessions://claude-code/${UUID_A}`,
            `agent-sessions://claude-code/${UUID_B}`,
        ]);
        expect(scan.truncated).toBe(true);
        expect(scan.skipped).toEqual([expect.objectContaining({ reason: "limit-reached" })]);
    });

    it("narrows to selected sourceIds and lets selection take a recently active session", async () => {
        await writeAged(claudeSession("-Users-me-app", UUID_A), "{}", 60);
        const active = claudeSession("-Users-me-app", UUID_B);
        await mkdir(path.dirname(active), { recursive: true });
        await writeFile(active, "{}", "utf8"); // fresh mtime — inside the quiescence window

        const scan = await scanAgentSessions({
            homeDir: home,
            sourceIds: [`agent-sessions://claude-code/${UUID_B}`],
        });

        expect(scan.items.map(item => item.sourceId)).toEqual([
            `agent-sessions://claude-code/${UUID_B}`,
        ]);
        expect(scan.skipped).toHaveLength(0);
    });

    it("selection still refuses an oversized file", async () => {
        await writeAged(claudeSession("-Users-me-app", UUID_A), "x".repeat(64));

        const scan = await scanAgentSessions({
            homeDir: home,
            maxFileBytes: 32,
            sourceIds: [`agent-sessions://claude-code/${UUID_A}`],
        });

        expect(scan.items).toHaveLength(0);
        expect(scan.skipped).toEqual([expect.objectContaining({ reason: "too-large" })]);
    });

    it("reports roots that do not exist without failing", async () => {
        const scan = await scanAgentSessions({ homeDir: home });

        expect(scan.items).toHaveLength(0);
        expect(scan.roots).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ toolId: "claude-code", exists: false }),
                expect.objectContaining({ toolId: "codex", exists: false }),
            ])
        );
    });
});
