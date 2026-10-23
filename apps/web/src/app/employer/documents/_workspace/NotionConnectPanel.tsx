"use client";

/**
 * The Notion connect panel — replaces the generic connect card for `notion`
 * in AddSourceModal's Connect group.
 *
 * Connecting is one consent: Notion's own screen, with Notion's page picker,
 * decides what LaunchStack may read, and whatever was picked syncs into
 * Sources (read-only, every 15 minutes, first run straight after connect).
 * "Choose pages" runs the same consent again, which reopens the picker.
 *
 * States: loading → not-configured → not-connected → connected (one card per
 * connected Notion workspace: folder, last sync, Sync now, Choose pages,
 * Disconnect) → syncing (polls status; a sync that never starts says so, see
 * useConnectorSync) → revoked (reconnect). All data comes from
 * /api/connectors/notion/status.
 */

import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, FolderClosed, RefreshCw } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";

import { SyncStalledNotice } from "./SyncStalledNotice";
import type { AddSourceTab } from "./types";
import { syncStatusLabel, useConnectorSync } from "./useConnectorSync";

interface NotionConnection {
    readonly connectionId: string;
    readonly workspaceName: string | null;
    readonly status: string;
    readonly statusDetail: string | null;
    readonly connectedBy: string | null;
    readonly folderPath: string | null;
    readonly lastSyncAt: string | null;
    readonly lastSyncStatus: string | null;
    readonly lastSyncError: string | null;
    readonly lastSyncReport: Record<string, unknown> | null;
}

interface NotionStatus {
    readonly configured: boolean;
    readonly connections: readonly NotionConnection[];
}

type Loaded =
    | { readonly kind: "loading" }
    | { readonly kind: "forbidden" }
    | { readonly kind: "error" }
    | { readonly kind: "ready"; readonly status: NotionStatus };

export const NOTION_CONNECT_URL = "/api/connectors/notion/oauth/start";
const STATUS_URL = "/api/connectors/notion/status";

const PERKS = [
    "Pick pages and databases on Notion's own consent screen",
    "Synced pages become sources Ask can search and cite",
    "Re-syncs every 15 minutes, read-only — LaunchStack never edits your Notion",
];

function reportCount(report: Record<string, unknown> | null, key: string): number {
    const value = report?.[key];
    return typeof value === "number" ? value : 0;
}

/** "12 pages · 3 updated · 1 failed" from the last run's counts. */
export function syncSummary(report: Record<string, unknown> | null): string | null {
    if (!report) return null;
    const pages = reportCount(report, "discovered");
    const parts = [`${pages} page${pages === 1 ? "" : "s"}`];
    const stored = reportCount(report, "stored");
    if (stored > 0) parts.push(`${stored} updated`);
    const failed = reportCount(report, "failed");
    if (failed > 0) parts.push(`${failed} failed`);
    const tooLarge = reportCount(report, "tooLarge");
    if (tooLarge > 0) parts.push(`${tooLarge} too large`);
    if (report.truncated === true) parts.push("page limit reached");
    return parts.join(" · ");
}

function ConnectionCard({
    connection,
    refresh,
    onDisconnected,
}: {
    readonly connection: NotionConnection;
    readonly refresh: () => Promise<unknown>;
    readonly onDisconnected: () => void;
}) {
    const [busy, setBusy] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const { phase, requestSync } = useConnectorSync(
        connection,
        refresh,
        `/api/connectors/notion/sync?connectionId=${encodeURIComponent(connection.connectionId)}`
    );
    const name = connection.workspaceName ?? "Notion workspace";
    const revoked = connection.status !== "active";
    const summary = syncSummary(connection.lastSyncReport);

    const syncNow = async () => {
        setBusy(true);
        try {
            if (await requestSync()) toast.success("Sync requested");
            else toast.error("Could not start the sync");
        } finally {
            setBusy(false);
        }
    };

    const disconnect = async () => {
        setBusy(true);
        try {
            const res = await fetch(
                `/api/connectors/connections/${encodeURIComponent(connection.connectionId)}`,
                { method: "DELETE" }
            );
            if (res.ok) {
                toast.success(`${name} disconnected. Pages already synced were kept.`);
                onDisconnected();
            } else {
                toast.error(`Could not disconnect ${name}`);
            }
        } finally {
            setBusy(false);
            setConfirming(false);
        }
    };

    return (
        <li className="border-line bg-panel rounded-xl border p-3.5">
            <div className="flex items-start gap-2.5">
                <span className={revoked ? "text-danger mt-0.5" : "text-brand mt-0.5"}>
                    <Check className="size-3.5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="text-ink truncate text-[13.5px] font-semibold">{name}</div>
                    <div className="text-ink-3 text-[12px]">
                        {revoked
                            ? "Access was revoked — reconnect to keep syncing"
                            : [
                                  syncStatusLabel(phase, connection.lastSyncAt),
                                  connection.connectedBy
                                      ? `connected by ${connection.connectedBy}`
                                      : null,
                              ]
                                  .filter(Boolean)
                                  .join(" · ")}
                    </div>
                    {summary && !revoked && (
                        <div className="text-ink-2 mt-1 text-[12px]">{summary}</div>
                    )}
                    {connection.folderPath && (
                        <div className="text-ink-2 mt-1 flex items-center gap-1.5 text-[12px]">
                            <FolderClosed className="size-3.5 shrink-0" aria-hidden />
                            <span className="truncate">{connection.folderPath}</span>
                        </div>
                    )}
                    {connection.lastSyncStatus === "error" && connection.lastSyncError && (
                        <div className="text-danger mt-1 text-[12px]">
                            {connection.lastSyncError}
                        </div>
                    )}
                </div>
            </div>
            {phase === "stalled" && (
                <div className="mt-3">
                    <SyncStalledNotice />
                </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
                {revoked ? (
                    <Button asChild size="sm">
                        <a href={NOTION_CONNECT_URL}>Reconnect</a>
                    </Button>
                ) : (
                    <>
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={busy || phase === "running" || phase === "starting"}
                            onClick={() => void syncNow()}
                        >
                            <RefreshCw aria-hidden />
                            Sync now
                        </Button>
                        <Button asChild size="sm" variant="outline">
                            <a href={NOTION_CONNECT_URL}>Choose pages</a>
                        </Button>
                    </>
                )}
                {confirming ? (
                    <>
                        <Button
                            size="sm"
                            variant="destructive"
                            disabled={busy}
                            onClick={() => void disconnect()}
                        >
                            Disconnect {name}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                            Cancel
                        </Button>
                    </>
                ) : (
                    <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setConfirming(true)}
                    >
                        Disconnect
                    </Button>
                )}
            </div>
        </li>
    );
}

export function NotionConnectPanel({ tab }: { tab: AddSourceTab }) {
    const Icon = tab.Icon;
    const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });

    const refresh = useCallback(async () => {
        try {
            const res = await fetch(STATUS_URL);
            if (res.status === 403) {
                setLoaded({ kind: "forbidden" });
                return null;
            }
            if (!res.ok) {
                setLoaded({ kind: "error" });
                return null;
            }
            const payload = (await res.json()) as { data?: NotionStatus };
            if (!payload.data) {
                setLoaded({ kind: "error" });
                return null;
            }
            setLoaded({ kind: "ready", status: payload.data });
            return payload.data;
        } catch {
            setLoaded({ kind: "error" });
            return null;
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const status = loaded.kind === "ready" ? loaded.status : null;
    const connections = status?.connections ?? [];

    return (
        <div>
            <div className="bg-line-2 mb-4 flex items-center gap-3.5 rounded-xl px-4 py-4">
                <div className="border-line bg-panel text-ink flex size-11 items-center justify-center rounded-[10px] border">
                    <Icon size={22} />
                </div>
                <div className="flex-1">
                    <div className="text-ink text-[15px] font-semibold">Connect Notion</div>
                    <div className="text-ink-3 text-[13px]">One-click OAuth, revoke anytime.</div>
                </div>
            </div>

            {connections.length === 0 && (
                <ul className="mb-4 flex flex-col gap-2.5">
                    {PERKS.map(perk => (
                        <li key={perk} className="text-ink-2 flex items-center gap-2.5 text-[13px]">
                            <Check className="text-brand size-3.5 shrink-0" aria-hidden />
                            {perk}
                        </li>
                    ))}
                </ul>
            )}

            {loaded.kind === "loading" && (
                <div className="text-ink-3 flex items-center gap-2 text-[13px]">
                    <Spinner /> Checking Notion…
                </div>
            )}

            {loaded.kind === "forbidden" && (
                <p className="text-ink-2 text-[13px]">
                    Connecting Notion is for workspace admins. Ask one to connect it; the pages they
                    pick will show up in Sources.
                </p>
            )}

            {loaded.kind === "error" && (
                <p className="text-danger text-[13px]">
                    Could not load the Notion connection. Try again in a moment.
                </p>
            )}

            {status && !status.configured && (
                <p className="text-ink-2 text-[13px]">
                    Notion is not configured on this server. Whoever runs LaunchStack needs to add
                    NOTION_OAUTH_CLIENT_ID and NOTION_OAUTH_CLIENT_SECRET — the steps are in
                    .env.example.
                </p>
            )}

            {status && connections.length > 0 && (
                <ul className="mb-3.5 flex flex-col gap-2">
                    {connections.map(connection => (
                        <ConnectionCard
                            key={connection.connectionId}
                            connection={connection}
                            refresh={refresh}
                            onDisconnected={() => void refresh()}
                        />
                    ))}
                </ul>
            )}

            {status?.configured && (
                <Button
                    asChild
                    className="w-full"
                    variant={connections.length > 0 ? "outline" : "default"}
                >
                    <a href={NOTION_CONNECT_URL}>
                        <Icon size={16} />
                        {connections.length > 0
                            ? "Connect another Notion workspace"
                            : "Connect Notion"}
                    </a>
                </Button>
            )}
        </div>
    );
}
