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
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, FolderClosed, RefreshCw } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";

import { SyncStalledNotice } from "./SyncStalledNotice";
import type { AddSourceTab } from "./types";
import { useConnectorSync, useSyncStatusLabel } from "./useConnectorSync";

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

/** What connecting gives, as keys in `sources.notionConnect.perks`. */
const PERKS = ["pick", "sources", "resync"] as const;

/** `useTranslations("sources.notionConnect")`. */
export type NotionTranslator = ReturnType<typeof useTranslations<"sources.notionConnect">>;

function reportCount(report: Record<string, unknown> | null, key: string): number {
    const value = report?.[key];
    return typeof value === "number" ? value : 0;
}

/** "12 pages · 3 updated · 1 failed" from the last run's counts. */
export function syncSummary(
    t: NotionTranslator,
    report: Record<string, unknown> | null
): string | null {
    if (!report) return null;
    const parts = [t("summary.pages", { count: reportCount(report, "discovered") })];
    const stored = reportCount(report, "stored");
    if (stored > 0) parts.push(t("summary.updated", { count: stored }));
    const failed = reportCount(report, "failed");
    if (failed > 0) parts.push(t("summary.failed", { count: failed }));
    const tooLarge = reportCount(report, "tooLarge");
    if (tooLarge > 0) parts.push(t("summary.tooLarge", { count: tooLarge }));
    if (report.truncated === true) parts.push(t("summary.pageLimit"));
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
    const t = useTranslations("sources.notionConnect");
    const tc = useTranslations("common");
    const syncStatusLabel = useSyncStatusLabel();
    const [busy, setBusy] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const { phase, requestSync } = useConnectorSync(
        connection,
        refresh,
        `/api/connectors/notion/sync?connectionId=${encodeURIComponent(connection.connectionId)}`
    );
    const name = connection.workspaceName ?? t("workspaceFallback");
    const revoked = connection.status !== "active";
    const summary = syncSummary(t, connection.lastSyncReport);

    const syncNow = async () => {
        setBusy(true);
        try {
            if (await requestSync()) toast.success(t("syncRequested"));
            else toast.error(t("syncStartFailed"));
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
                toast.success(t("disconnected", { name }));
                onDisconnected();
            } else {
                toast.error(t("disconnectFailed", { name }));
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
                            ? t("revoked")
                            : [
                                  syncStatusLabel(phase, connection.lastSyncAt),
                                  connection.connectedBy
                                      ? t("connectedBy", { name: connection.connectedBy })
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
                        <a href={NOTION_CONNECT_URL}>{t("reconnect")}</a>
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
                            {t("syncNow")}
                        </Button>
                        <Button asChild size="sm" variant="outline">
                            <a href={NOTION_CONNECT_URL}>{t("choosePages")}</a>
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
                            {t("disconnectName", { name })}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                            {tc("actions.cancel")}
                        </Button>
                    </>
                ) : (
                    <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setConfirming(true)}
                    >
                        {tc("actions.disconnect")}
                    </Button>
                )}
            </div>
        </li>
    );
}

export function NotionConnectPanel({ tab }: { tab: AddSourceTab }) {
    const t = useTranslations("sources.notionConnect");
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
                    <div className="text-ink text-[15px] font-semibold">{t("connectTitle")}</div>
                    <div className="text-ink-3 text-[13px]">{t("oneClick")}</div>
                </div>
            </div>

            {connections.length === 0 && (
                <ul className="mb-4 flex flex-col gap-2.5">
                    {PERKS.map(perk => (
                        <li key={perk} className="text-ink-2 flex items-center gap-2.5 text-[13px]">
                            <Check className="text-brand size-3.5 shrink-0" aria-hidden />
                            {t(`perks.${perk}`)}
                        </li>
                    ))}
                </ul>
            )}

            {loaded.kind === "loading" && (
                <div className="text-ink-3 flex items-center gap-2 text-[13px]">
                    <Spinner /> {t("checking")}
                </div>
            )}

            {loaded.kind === "forbidden" && (
                <p className="text-ink-2 text-[13px]">{t("forbidden")}</p>
            )}

            {loaded.kind === "error" && <p className="text-danger text-[13px]">{t("loadError")}</p>}

            {status && !status.configured && (
                <p className="text-ink-2 text-[13px]">{t("notConfigured")}</p>
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
                        {connections.length > 0 ? t("connectAnother") : t("connectTitle")}
                    </a>
                </Button>
            )}
        </div>
    );
}
