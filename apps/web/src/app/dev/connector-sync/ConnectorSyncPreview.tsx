"use client";

import { useEffect, useState } from "react";

import { Toaster } from "~/components/ui/sonner";

import { DriveConnectPanel } from "~/app/employer/documents/_workspace/DriveConnectPanel";
import { GmailConnectPanel } from "~/app/employer/documents/_workspace/GmailConnectPanel";
import { ADD_TABS, type AddSourceTab } from "~/app/employer/documents/_workspace/types";

/**
 * Local harness for the Drive and Gmail panels' sync states. Mounts the real
 * panels with their session-guarded routes stubbed.
 *
 * Press "Sync now". By default the stubbed runner picks the job up after two
 * polls, runs it for two more, then reports a finished sync. `?runner=down`
 * never picks it up, the production failure of 2026-10-17, so the panel
 * moves from "Starting sync…" to the stalled notice after 90 seconds.
 * `?reject=1` makes the sync route fail. Gated by the page.
 */

type Provider = "google-drive" | "gmail";

interface RunState {
    requestedPolls: number | null;
    lastSyncAt: string | null;
    lastSyncStatus: string | null;
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function tab(id: string): AddSourceTab {
    const found = ADD_TABS.flatMap(group => group.items).find(item => item.id === id);
    if (!found) throw new Error(`No add-source tab "${id}"`);
    return found;
}

/** Advances one provider's fake run by one status poll. */
function advance(run: RunState, runnerUp: boolean): void {
    if (run.requestedPolls === null || !runnerUp) return;
    run.requestedPolls += 1;
    if (run.requestedPolls === 2) run.lastSyncStatus = "running";
    if (run.requestedPolls === 4) {
        run.requestedPolls = null;
        run.lastSyncStatus = "ok";
        run.lastSyncAt = new Date().toISOString();
    }
}

function installFetchStub(flags: URLSearchParams): () => void {
    const original = window.fetch.bind(window);
    const runnerUp = flags.get("runner") !== "down";
    const reject = flags.get("reject") === "1";
    const runs: Record<Provider, RunState> = {
        "google-drive": { requestedPolls: null, lastSyncAt: null, lastSyncStatus: null },
        gmail: {
            requestedPolls: null,
            lastSyncAt: "2026-10-16T09:12:00.000Z",
            lastSyncStatus: "ok",
        },
    };
    const report = { stored: 3, unchanged: 12, failed: 0, discovered: 15 };

    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const method = (init?.method ?? "GET").toUpperCase();

        if (url === "/api/connectors/google-drive/sync" || url === "/api/connectors/gmail/sync") {
            if (reject) return jsonResponse({ success: false, message: "Sync failed" }, 500);
            const provider: Provider = url.includes("gmail") ? "gmail" : "google-drive";
            runs[provider].requestedPolls = 0;
            return jsonResponse({ success: true, data: { queued: true } }, 202);
        }

        if (url === "/api/connectors/google-drive/status") {
            const run = runs["google-drive"];
            advance(run, runnerUp);
            return jsonResponse({
                success: true,
                data: {
                    configured: true,
                    connected: true,
                    connectionId: "1",
                    status: "active",
                    accountEmail: "owner@launchstack.test",
                    pickedItems: [
                        {
                            fileId: "f1",
                            kind: "folder",
                            name: "Coding Circles",
                            mimeType: "application/vnd.google-apps.folder",
                        },
                    ],
                    lastSyncAt: run.lastSyncAt,
                    lastSyncStatus: run.lastSyncStatus,
                    lastSyncError: null,
                    lastSyncReport: run.lastSyncAt ? report : null,
                    picker: { apiKey: null, appId: null },
                },
            });
        }

        if (url === "/api/connectors/gmail" && method === "GET") {
            const run = runs.gmail;
            advance(run, runnerUp);
            return jsonResponse({
                success: true,
                data: {
                    configured: true,
                    connected: true,
                    canConnect: true,
                    connectionId: "2",
                    status: "active",
                    accountEmail: "owner@launchstack.test",
                    folder: "Gmail/owner@launchstack.test",
                    scope: [{ id: "s1", kind: "label", value: "INBOX", name: "Inbox" }],
                    lastSyncAt: run.lastSyncAt,
                    lastSyncStatus: run.lastSyncStatus,
                    lastSyncError: null,
                    lastSyncReport: report,
                },
            });
        }

        return original(input, init);
    }) as typeof window.fetch;

    return () => {
        window.fetch = original;
    };
}

export function ConnectorSyncPreview() {
    const [ready, setReady] = useState(false);

    useEffect(() => {
        const restore = installFetchStub(new URLSearchParams(window.location.search));
        setReady(true);
        return restore;
    }, []);

    if (!ready) return null;

    return (
        <main className="bg-surface text-ink min-h-screen p-6">
            <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-2">
                <section className="border-line bg-panel rounded-xl border p-5">
                    <h2 className="text-ink-3 mb-4 text-xs font-semibold">GOOGLE DRIVE</h2>
                    <DriveConnectPanel tab={tab("drive")} />
                </section>
                <section className="border-line bg-panel rounded-xl border p-5">
                    <h2 className="text-ink-3 mb-4 text-xs font-semibold">GMAIL</h2>
                    <GmailConnectPanel tab={tab("gmail")} />
                </section>
            </div>
            <Toaster />
        </main>
    );
}
