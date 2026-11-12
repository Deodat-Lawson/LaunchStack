"use client";

import { useEffect, useState } from "react";

import { Toaster } from "~/components/ui/sonner";

import { Microsoft365SourcePanel } from "~/app/employer/documents/_workspace/Microsoft365Source";
import { Microsoft365Section } from "~/app/employer/documents/_workspace/settings/Microsoft365Section";

/**
 * Local harness for the OneDrive and SharePoint panels. Mounts the real Add
 * source panel and the real Settings section with their session-guarded
 * routes stubbed, so every state can be looked at without a Microsoft
 * account, a database or a job runner. Development only (the page is gated).
 *
 * `?state=` picks what the status route answers:
 *   ready (default) · connect · reconnect · not-configured · forbidden · error
 * `?runner=down` never picks a requested sync up, so Settings moves from
 * "Starting…" to the stalled notice after 90 seconds. `?reject=1` makes
 * adding fail with the server's "can't open that link" sentence.
 *
 * Browse walks a small made-up OneDrive and one SharePoint site. For the
 * real round trip (consent, token, Graph), use the Microsoft stand-in:
 * MICROSOFT_STAND_IN_URL=<origin>/dev/stand-ins/microsoft.
 */

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

function item(driveId: string, itemId: string, kind: "file" | "folder", name: string) {
    return {
        driveId,
        itemId,
        kind,
        name,
        mimeType: null,
        size: 2048,
        modifiedAt: "2026-11-03T14:20:00.000Z",
        webUrl: null,
        supported: !name.endsWith(".mov"),
    };
}

const FOLDERS: Record<string, ReturnType<typeof item>[]> = {
    "b!me:root": [
        item("b!me", "clients", "folder", "Client files"),
        item("b!me", "templates", "folder", "Templates"),
        item("b!me", "deck", "file", "Board deck Q4.pptx"),
        item("b!me", "walkthrough", "file", "Office walkthrough.mov"),
    ],
    "b!me:clients": [
        item("b!me", "northgate", "folder", "Northgate Bakery Group"),
        item("b!me", "pbc", "file", "PBC list.xlsx"),
    ],
    "b!me:northgate": [
        item("b!me", "letter", "file", "Engagement letter FY2026.docx"),
        item("b!me", "memo", "file", "Audit planning memo.docx"),
    ],
    "b!me:templates": [],
    "b!lib:root": [
        item("b!lib", "policies", "folder", "Policies"),
        item("b!lib", "handbook", "file", "Staff handbook.pdf"),
    ],
    "b!lib:policies": [item("b!lib", "travel", "file", "Travel policy.docx")],
};

const PICKED = [
    {
        sourceId: "b!me:northgate",
        driveId: "b!me",
        itemId: "northgate",
        kind: "folder",
        name: "Northgate Bakery Group",
        mimeType: null,
        folderPath: "Clients/Northgate Bakery Group",
        folderHidden: false,
    },
    {
        sourceId: "b!lib:handbook",
        driveId: "b!lib",
        itemId: "handbook",
        kind: "file",
        name: "Staff handbook.pdf",
        mimeType: "application/pdf",
        folderPath: "Firm knowledge",
        folderHidden: false,
    },
];

/** Advances the fake run by one status poll. */
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
    const API = "/api/connectors/microsoft-files";
    const state = flags.get("state") ?? "ready";
    const runnerUp = flags.get("runner") !== "down";
    const reject = flags.get("reject") === "1";
    const run: RunState = {
        requestedPolls: null,
        lastSyncAt: "2026-11-11T09:12:00.000Z",
        lastSyncStatus: "ok",
    };
    let picked = [...PICKED];
    let connected = state === "ready" || state === "reconnect";

    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const raw =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const url = new URL(raw, window.location.origin);
        const path = url.pathname;
        const method = (init?.method ?? "GET").toUpperCase();

        if (path === `${API}/status`) {
            if (state === "forbidden") return jsonResponse({ success: false }, 403);
            if (state === "error") return jsonResponse({ success: false }, 500);
            if (state === "not-configured") {
                return jsonResponse({
                    success: true,
                    data: { configured: false, connected: false },
                });
            }
            if (!connected) {
                return jsonResponse({
                    success: true,
                    data: { configured: true, connected: false },
                });
            }
            advance(run, runnerUp);
            return jsonResponse({
                success: true,
                data: {
                    configured: true,
                    connected: true,
                    connectionId: "1",
                    status: state === "reconnect" ? "revoked" : "active",
                    accountEmail: "morgan.ellis@harlowreed.example",
                    pickedItems: picked,
                    lastSyncAt: run.lastSyncAt,
                    lastSyncStatus: run.lastSyncStatus,
                    lastSyncError: null,
                    lastSyncReport: {
                        stored: 2,
                        unchanged: 9,
                        failed: 0,
                        discovered: 11,
                        accessLost: 0,
                        emptyFolders: [],
                        truncated: false,
                    },
                    deletedHere: {
                        items: [
                            {
                                sourceId: "b!me:old-memo",
                                title: "Old planning memo.docx",
                                deletedAt: "2026-11-09T16:00:00.000Z",
                            },
                        ],
                        others: 1,
                    },
                },
            });
        }

        if (path === `${API}/browse`) {
            const sites = url.searchParams.get("sites");
            if (sites !== null) {
                const all = [
                    { siteId: "site-clients", name: "Clients", webUrl: null },
                    { siteId: "site-knowledge", name: "Firm knowledge", webUrl: null },
                ];
                const q = sites.trim().toLowerCase();
                return jsonResponse({
                    success: true,
                    data: { sites: all.filter(site => !q || site.name.toLowerCase().includes(q)) },
                });
            }
            if (url.searchParams.get("siteId")) {
                return jsonResponse({
                    success: true,
                    data: { drives: [{ driveId: "b!lib", name: "Documents" }] },
                });
            }
            const driveId = url.searchParams.get("driveId") ?? "b!me";
            const itemId = url.searchParams.get("itemId") ?? "root";
            return jsonResponse({
                success: true,
                data: {
                    drive: null,
                    folder: { driveId, itemId },
                    items: FOLDERS[`${driveId}:${itemId}`] ?? [],
                    truncated: false,
                },
            });
        }

        if (path === `${API}/items` && method === "POST") {
            if (reject) {
                return jsonResponse(
                    {
                        success: false,
                        message:
                            "morgan.ellis@harlowreed.example can't open that link. Ask its owner to share it with morgan.ellis@harlowreed.example, then paste it again.",
                    },
                    404
                );
            }
            const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
                items?: { driveId: string; itemId: string }[];
            };
            const all = Object.values(FOLDERS).flat();
            const added = body.items
                ? body.items.flatMap(ref =>
                      all.filter(row => row.driveId === ref.driveId && row.itemId === ref.itemId)
                  )
                : [{ kind: "file" as const, name: "Shared workbook.xlsx" }];
            return jsonResponse({ success: true, data: { count: added.length, added } });
        }

        if (path === `${API}/items` && method === "DELETE") {
            const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
                items?: { driveId: string; itemId: string }[];
            };
            const gone = new Set((body.items ?? []).map(ref => `${ref.driveId}:${ref.itemId}`));
            picked = picked.filter(row => !gone.has(row.sourceId));
            return jsonResponse({ success: true, data: { removed: gone.size } });
        }

        if (path === `${API}/sync`) {
            run.requestedPolls = 0;
            return jsonResponse({ success: true, data: { queued: true } }, 202);
        }

        if (path === `${API}/deleted`) {
            return jsonResponse({ success: true, data: { restored: 1 } });
        }

        if (path === "/api/connectors/connections/1" && method === "DELETE") {
            connected = false;
            return jsonResponse({ success: true, data: { deleted: true, providerRevoked: false } });
        }

        return original(input, init);
    }) as typeof window.fetch;

    return () => {
        window.fetch = original;
    };
}

export function Microsoft365Preview() {
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
                    <Microsoft365SourcePanel destination="Clients" onAdded={() => undefined} />
                </section>
                <section>
                    <Microsoft365Section />
                </section>
            </div>
            <Toaster />
        </main>
    );
}
