/**
 * Discovery is the connector's security boundary: it decides which files on
 * the host's disk are eligible to leave it. These tests build a real directory
 * tree — no fs mocks — so an allowlist change that quietly widens what is
 * readable fails here.
 */

import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
    collectAgentKnowledge,
    scanAgentKnowledge,
} from "@launchstack/features/connectors/agent-knowledge";

const NUL = String.fromCharCode(0);

let root: string;
let home: string;
let project: string;

async function write(file: string, contents: string): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, "utf8");
}

beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "agent-knowledge-"));
    home = path.join(root, "home");
    project = path.join(root, "workspace", "acme");
    await mkdir(home, { recursive: true });
    await mkdir(project, { recursive: true });
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

function sourceIds(items: readonly { sourceId: string }[]): string[] {
    return items.map(item => item.sourceId).sort();
}

describe("scanAgentKnowledge — what it picks up", () => {
    it("finds Claude Code global knowledge across every allowlisted location", async () => {
        await write(path.join(home, ".claude", "CLAUDE.md"), "# Global instructions");
        await write(path.join(home, ".claude", "MEMORY.md"), "- [A memory](a.md)");
        await write(path.join(home, ".claude", "agents", "reviewer.md"), "You review code.");
        await write(path.join(home, ".claude", "commands", "ship.md"), "Ship it.");
        await write(path.join(home, ".claude", "skills", "dataviz", "SKILL.md"), "Charts.");
        await write(path.join(home, ".claude", "memory", "user-prefers-pnpm.md"), "pnpm.");
        await write(path.join(home, ".claude", "output-styles", "terse.md"), "Be terse.");

        const scan = await scanAgentKnowledge({ homeDir: home, tools: ["claude-code"] });

        expect(sourceIds(scan.items)).toEqual([
            "agent-knowledge://claude-code/global/CLAUDE.md",
            "agent-knowledge://claude-code/global/MEMORY.md",
            "agent-knowledge://claude-code/global/agents/reviewer.md",
            "agent-knowledge://claude-code/global/commands/ship.md",
            "agent-knowledge://claude-code/global/memory/user-prefers-pnpm.md",
            "agent-knowledge://claude-code/global/output-styles/terse.md",
            "agent-knowledge://claude-code/global/skills/dataviz/SKILL.md",
        ]);

        const skill = scan.items.find(item => item.sourceId.endsWith("dataviz/SKILL.md"));
        expect(skill?.kind).toBe("skill");
        expect(skill?.mimeType).toBe("text/markdown");
    });

    it("finds Codex global knowledge", async () => {
        await write(path.join(home, ".codex", "AGENTS.md"), "# Codex instructions");
        await write(path.join(home, ".codex", "prompts", "refactor.md"), "Refactor.");
        await write(path.join(home, ".codex", "memories", "stack.md"), "Postgres.");

        const scan = await scanAgentKnowledge({ homeDir: home, tools: ["codex"] });

        expect(sourceIds(scan.items)).toEqual([
            "agent-knowledge://codex/global/AGENTS.md",
            "agent-knowledge://codex/global/memories/stack.md",
            "agent-knowledge://codex/global/prompts/refactor.md",
        ]);
        expect(scan.items.find(item => item.sourceId.endsWith("prompts/refactor.md"))?.kind).toBe(
            "prompt"
        );
    });

    it("scans project scope with a stable, machine-independent key", async () => {
        await write(path.join(project, "CLAUDE.md"), "# Project rules");
        await write(path.join(project, "AGENTS.md"), "# Codex project rules");
        await write(path.join(project, ".claude", "agents", "tester.md"), "You test.");

        const scan = await scanAgentKnowledge({
            homeDir: home,
            projects: [{ dir: project }],
            scopes: ["project"],
        });

        expect(sourceIds(scan.items)).toEqual([
            "agent-knowledge://claude-code/acme/.claude/agents/tester.md",
            "agent-knowledge://claude-code/acme/CLAUDE.md",
            "agent-knowledge://codex/acme/AGENTS.md",
        ]);
        // No absolute path leaks into the identity the host keys documents on.
        for (const item of scan.items) {
            expect(item.sourceId).not.toContain(root);
        }
    });

    it("keeps two checkouts that share a basename apart when given explicit keys", async () => {
        const other = path.join(root, "elsewhere", "acme");
        await write(path.join(project, "CLAUDE.md"), "one");
        await write(path.join(other, "CLAUDE.md"), "two");

        const scan = await scanAgentKnowledge({
            homeDir: home,
            tools: ["claude-code"],
            scopes: ["project"],
            projects: [
                { dir: project, key: "acme-main" },
                { dir: other, key: "acme-fork" },
            ],
        });

        expect(sourceIds(scan.items)).toEqual([
            "agent-knowledge://claude-code/acme-fork/CLAUDE.md",
            "agent-knowledge://claude-code/acme-main/CLAUDE.md",
        ]);
    });

    it("reports roots that do not exist rather than failing", async () => {
        const scan = await scanAgentKnowledge({ homeDir: home, tools: ["claude-code"] });

        expect(scan.items).toHaveLength(0);
        expect(scan.roots).toEqual([
            expect.objectContaining({ scope: "global", exists: false, itemCount: 0 }),
        ]);
    });
});

describe("scanAgentKnowledge — what it refuses to read", () => {
    it("never returns credential files that sit inside allowlisted roots", async () => {
        await write(path.join(home, ".claude", "CLAUDE.md"), "# Instructions");
        await write(path.join(home, ".claude", "memory", ".credentials.json"), "{}");
        await write(path.join(home, ".claude", "memory", "api-token.md"), "sk-live-123");
        await write(path.join(home, ".claude", "memory", "my-secret-notes.md"), "hunter2");
        await write(path.join(home, ".claude", "memory", "cert.pem"), "-----BEGIN");

        const scan = await scanAgentKnowledge({ homeDir: home, tools: ["claude-code"] });

        expect(sourceIds(scan.items)).toEqual(["agent-knowledge://claude-code/global/CLAUDE.md"]);
        const excluded = scan.skipped.filter(entry => entry.reason === "excluded");
        expect(excluded.map(entry => entry.sourceId)).toEqual(
            expect.arrayContaining([
                "agent-knowledge://claude-code/global/memory/api-token.md",
                "agent-knowledge://claude-code/global/memory/my-secret-notes.md",
            ])
        );
    });

    it("leaves config files alone unless includeConfig is set", async () => {
        await write(path.join(home, ".claude", "settings.json"), '{"model":"opus"}');
        await write(path.join(home, ".codex", "config.toml"), 'model = "gpt"');

        const withoutConfig = await scanAgentKnowledge({ homeDir: home });
        expect(withoutConfig.items).toHaveLength(0);

        const withConfig = await scanAgentKnowledge({ homeDir: home, includeConfig: true });
        expect(sourceIds(withConfig.items)).toEqual([
            "agent-knowledge://claude-code/global/settings.json",
            "agent-knowledge://codex/global/config.toml",
        ]);
    });

    it("never descends into session transcripts, caches or project state", async () => {
        await write(path.join(home, ".claude", "memory", "keep.md"), "keep");
        await write(path.join(home, ".claude", "memory", "cache", "blob.md"), "cached");
        await write(path.join(home, ".claude", "memory", "sessions", "s1.md"), "transcript");
        await write(path.join(home, ".claude", "projects", "p", "notes.md"), "state");
        await write(path.join(home, ".claude", "memory", "history.jsonl"), "{}");

        const scan = await scanAgentKnowledge({ homeDir: home, tools: ["claude-code"] });

        expect(sourceIds(scan.items)).toEqual([
            "agent-knowledge://claude-code/global/memory/keep.md",
        ]);
    });

    it("reads per-project memory without touching the transcripts beside it", async () => {
        const slug = path.join(home, ".claude", "projects", "-Users-dev-acme");
        await write(path.join(slug, "memory", "MEMORY.md"), "- [Deploys](deploys.md)");
        await write(path.join(slug, "memory", "deploys.md"), "Deploys run on Fridays.");
        // Everything else in that directory is machine state.
        await write(path.join(slug, "session-1.jsonl"), '{"type":"user"}');
        await write(path.join(slug, "notes.md"), "not a memory");
        await write(path.join(slug, "subagent", "transcript.md"), "not a memory");

        const scan = await scanAgentKnowledge({ homeDir: home, tools: ["claude-code"] });

        expect(sourceIds(scan.items)).toEqual([
            "agent-knowledge://claude-code/global/projects/-Users-dev-acme/memory/MEMORY.md",
            "agent-knowledge://claude-code/global/projects/-Users-dev-acme/memory/deploys.md",
        ]);
        expect(scan.items.every(item => item.kind === "memory")).toBe(true);
    });

    it("does not follow symlinks out of the root", async () => {
        const outside = path.join(root, "outside");
        await write(path.join(outside, "private.md"), "not yours");
        await mkdir(path.join(home, ".claude", "agents"), { recursive: true });
        await symlink(
            path.join(outside, "private.md"),
            path.join(home, ".claude", "agents", "link.md")
        );
        await symlink(outside, path.join(home, ".claude", "agents", "escape"));

        const scan = await scanAgentKnowledge({ homeDir: home, tools: ["claude-code"] });

        expect(scan.items).toHaveLength(0);
        expect(scan.skipped.map(entry => entry.detail)).toEqual(
            expect.arrayContaining(["symlink"])
        );
    });

    it("skips oversized and empty files with a reason", async () => {
        await write(path.join(home, ".claude", "agents", "huge.md"), "x".repeat(4096));
        await write(path.join(home, ".claude", "agents", "blank.md"), "");
        await write(path.join(home, ".claude", "agents", "ok.md"), "fine");

        const scan = await scanAgentKnowledge({
            homeDir: home,
            tools: ["claude-code"],
            maxFileBytes: 1024,
        });

        expect(sourceIds(scan.items)).toEqual([
            "agent-knowledge://claude-code/global/agents/ok.md",
        ]);
        expect(scan.skipped).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    sourceId: "agent-knowledge://claude-code/global/agents/huge.md",
                    reason: "too-large",
                }),
                expect.objectContaining({
                    sourceId: "agent-knowledge://claude-code/global/agents/blank.md",
                    reason: "empty",
                }),
            ])
        );
    });

    it("marks the scan truncated instead of silently dropping the tail", async () => {
        for (const name of ["a", "b", "c", "d"]) {
            await write(path.join(home, ".claude", "agents", `${name}.md`), name);
        }

        const scan = await scanAgentKnowledge({
            homeDir: home,
            tools: ["claude-code"],
            maxItems: 2,
        });

        expect(scan.items).toHaveLength(2);
        expect(scan.truncated).toBe(true);
        expect(scan.skipped.filter(entry => entry.reason === "limit-reached")).toHaveLength(2);
    });

    it("ignores files whose extension is not text-like", async () => {
        await write(path.join(home, ".claude", "skills", "viz", "SKILL.md"), "skill");
        await write(path.join(home, ".claude", "skills", "viz", "chart.png"), "binary-ish");
        await write(path.join(home, ".claude", "skills", "viz", "run.py"), "print(1)");

        const scan = await scanAgentKnowledge({ homeDir: home, tools: ["claude-code"] });

        expect(sourceIds(scan.items)).toEqual([
            "agent-knowledge://claude-code/global/skills/viz/SKILL.md",
        ]);
    });
});

describe("collectAgentKnowledge", () => {
    it("reads contents, normalizes line endings and hashes the result", async () => {
        await write(path.join(home, ".claude", "CLAUDE.md"), "# Rules\r\n\r\nBe careful.\r\n");

        const scan = await scanAgentKnowledge({ homeDir: home, tools: ["claude-code"] });
        const collected = await collectAgentKnowledge(scan.items);

        expect(collected.items).toHaveLength(1);
        expect(collected.items[0]?.content).toBe("# Rules\n\nBe careful.");
        expect(collected.items[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("gives identical content the same hash across scopes", async () => {
        await write(path.join(home, ".claude", "CLAUDE.md"), "same text");
        await write(path.join(project, "CLAUDE.md"), "same text");

        const scan = await scanAgentKnowledge({
            homeDir: home,
            tools: ["claude-code"],
            projects: [{ dir: project }],
        });
        const collected = await collectAgentKnowledge(scan.items);

        expect(collected.items).toHaveLength(2);
        expect(collected.items[0]?.contentHash).toBe(collected.items[1]?.contentHash);
        expect(collected.items[0]?.sourceId).not.toBe(collected.items[1]?.sourceId);
    });

    it("refuses a binary file that happens to end in .md", async () => {
        await write(path.join(home, ".claude", "agents", "binary.md"), `head${NUL}tail`);

        const scan = await scanAgentKnowledge({ homeDir: home, tools: ["claude-code"] });
        const collected = await collectAgentKnowledge(scan.items);

        expect(collected.items).toHaveLength(0);
        expect(collected.skipped).toEqual([
            expect.objectContaining({ reason: "excluded", detail: "binary content" }),
        ]);
    });

    it("turns an unreadable file into a skip, not a thrown scan", async () => {
        await write(path.join(home, ".claude", "CLAUDE.md"), "gone soon");
        const scan = await scanAgentKnowledge({ homeDir: home, tools: ["claude-code"] });
        await rm(path.join(home, ".claude", "CLAUDE.md"));

        const collected = await collectAgentKnowledge(scan.items);

        expect(collected.items).toHaveLength(0);
        expect(collected.skipped).toEqual([expect.objectContaining({ reason: "unreadable" })]);
    });
});
