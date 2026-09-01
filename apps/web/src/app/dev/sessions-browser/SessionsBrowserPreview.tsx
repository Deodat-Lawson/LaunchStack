"use client";

/**
 * Dev-only harness: the real SessionsBrowser with `window.fetch` stubbed for
 * the connector routes, so the list, filters, statuses and import flow render
 * without auth, a database, or the connector flag.
 */

import { useEffect, useState } from "react";

import { SessionsBrowser } from "~/app/employer/agent-sessions/_sessions/ui/SessionsBrowser";
import type { AgentSessionItem } from "~/app/employer/agent-sessions/_sessions/lib/api";

const now = Date.now();
const iso = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();

const ITEMS: AgentSessionItem[] = [
    {
        sourceId: "agent-sessions://claude-code/aaaaaaaa-1111-4111-8111-111111111111",
        tool: "claude-code",
        title: "Deploy pipeline chat",
        preview: "How should I deploy my app publicly using Azure?",
        projectSlug: "-Users-me-LaunchStack",
        projectPath: "/Users/me/LaunchStack",
        gitBranch: "main",
        bytes: 1_204_000,
        modifiedAt: iso(90),
        relativePath: "projects/-Users-me-LaunchStack/aaaaaaaa.jsonl",
        archived: false,
        active: false,
        imported: { documentId: 42, syncedAt: iso(60), stale: false },
    },
    {
        sourceId: "agent-sessions://claude-code/bbbbbbbb-2222-4222-8222-222222222222",
        tool: "claude-code",
        title: "Fix the flaky auth test",
        preview: "The signin e2e test fails every third run — find out why",
        projectSlug: "-Users-me-LaunchStack",
        projectPath: "/Users/me/LaunchStack",
        gitBranch: "fix/auth-flake",
        bytes: 480_000,
        modifiedAt: iso(30),
        relativePath: "projects/-Users-me-LaunchStack/bbbbbbbb.jsonl",
        archived: false,
        active: false,
        imported: { documentId: 43, syncedAt: iso(2000), stale: true },
    },
    {
        sourceId: "agent-sessions://codex/cccccccc-3333-4333-8333-333333333333",
        tool: "codex",
        title: "YC acceptance and interview rates",
        preview: "What are the current YC acceptance rates?",
        projectSlug: null,
        projectPath: "/Users/me/Break",
        gitBranch: null,
        bytes: 88_000,
        modifiedAt: iso(3),
        relativePath: "sessions/2026/08/30/rollout-cccccccc.jsonl",
        archived: false,
        active: true,
        imported: null,
    },
    {
        sourceId: "agent-sessions://codex/dddddddd-4444-4444-8444-444444444444",
        tool: "codex",
        title: "Download homework files",
        preview: "Download all the homework files from the portal",
        projectSlug: null,
        projectPath: "/Users/me/AI-coworker",
        gitBranch: null,
        bytes: 42_000,
        modifiedAt: iso(60 * 24 * 40),
        relativePath: "archived_sessions/2026/06/13/rollout-dddddddd.jsonl",
        archived: true,
        active: false,
        imported: null,
    },
];

const PREVIEW_RESPONSE = {
    success: true,
    data: {
        enabled: true,
        roots: [
            {
                toolId: "claude-code",
                dir: "/Users/me/.claude/projects",
                exists: true,
                sessionCount: 721,
            },
            { toolId: "codex", dir: "/Users/me/.codex/sessions", exists: true, sessionCount: 115 },
            {
                toolId: "codex",
                dir: "/Users/me/.codex/archived_sessions",
                exists: true,
                sessionCount: 12,
            },
        ],
        truncated: false,
        items: ITEMS,
        skipped: [],
    },
};

export function SessionsBrowserPreview() {
    const [ready, setReady] = useState(false);

    useEffect(() => {
        const original = window.fetch.bind(window);
        window.fetch = async (input, init) => {
            const url =
                typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            if (url.includes("/api/connectors/agent-sessions")) {
                if (init?.method === "POST") {
                    const body = JSON.parse(String(init.body ?? "{}")) as { sourceIds?: string[] };
                    const ids =
                        body.sourceIds ?? ITEMS.filter(i => !i.imported).map(i => i.sourceId);
                    await new Promise(r => setTimeout(r, 600));
                    return new Response(
                        JSON.stringify({
                            success: true,
                            data: {
                                counts: {
                                    discovered: ids.length,
                                    stored: ids.length,
                                    created: ids.length,
                                    revised: 0,
                                    skipped: 0,
                                    failed: 0,
                                },
                                stored: ids.map((sourceId, i) => ({
                                    sourceId,
                                    documentId: 100 + i,
                                    versionId: 100 + i,
                                    revised: false,
                                })),
                                skipped: [],
                                failed: [],
                                missing: [],
                            },
                        }),
                        { status: 202, headers: { "Content-Type": "application/json" } }
                    );
                }
                return new Response(JSON.stringify(PREVIEW_RESPONSE), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                });
            }
            return original(input, init);
        };
        setReady(true);
        return () => {
            window.fetch = original;
        };
    }, []);

    if (!ready) return null;
    return (
        <div className="bg-surface h-dvh">
            <SessionsBrowser />
        </div>
    );
}
