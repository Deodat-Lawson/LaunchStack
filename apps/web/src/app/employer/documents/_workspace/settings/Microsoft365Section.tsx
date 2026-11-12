"use client";

/**
 * Microsoft 365 in Settings › Integrations: the workspace's OneDrive and
 * SharePoint connection and what syncs from it. Files are added from Add
 * source (its OneDrive and SharePoint tab); this section manages what was
 * picked: the account, the last run, the picked list with Stop syncing,
 * files deleted here with Sync again, Sync now, Reconnect and Disconnect.
 *
 * States: loading → not this person's to manage (403) → not configured (the
 * variables the server needs) → not connected → revoked (reconnect) →
 * connected → syncing (polls status). A sync that was requested but never
 * starts says so (see useConnectorSync).
 *
 * Disconnect deletes the connection row and, with it, the stored refresh
 * token and the picked list. Microsoft offers an app no call that withdraws
 * a delegated permission, so nothing is revoked on Microsoft's side, and the
 * confirm dialog and the toast both say so.
 */

import React, { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { FileText, Folder, FolderOpen, Info, TriangleAlert, X } from "lucide-react";

import { IconMicrosoft } from "~/components/icons/brand";
import { Card, Section } from "~/components/layout/page-shell";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";

import { DeletedHereList } from "../DeletedHereList";
import {
    emptyFolderNames,
    listNames,
    pickedItemDestination,
    reportCount,
    type Microsoft365Loaded,
    type Microsoft365PickedItem,
    type Microsoft365Status,
} from "../microsoft365Status";
import { SyncStalledNotice } from "../SyncStalledNotice";
import { useConnectorSync, useSyncStatusLabel } from "../useConnectorSync";
import {
    MICROSOFT_365_API,
    MICROSOFT_365_CONNECT_URL,
    loadMicrosoft365Status,
} from "../useMicrosoft365Source";
import { Code, StatusNote, StatusRow } from "./ui";

/** `<code>` inside a message, drawn as the settings `Code` token. */
const code = (chunks: ReactNode) => <Code>{chunks}</Code>;

function Notice({ tone, children }: { tone: "info" | "warn" | "danger"; children: ReactNode }) {
    const Icon = tone === "info" ? Info : TriangleAlert;
    const tones = {
        info: "border-line bg-panel-2 text-ink-2",
        warn: "border-warn bg-warn-soft text-ink",
        danger: "border-danger bg-danger-soft text-ink",
    } as const;
    return (
        <div
            className={`mb-3 flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-[12.5px] leading-relaxed ${tones[tone]}`}
        >
            <Icon
                className={`mt-0.5 size-4 shrink-0 ${tone === "info" ? "text-ink-3" : tone === "warn" ? "text-warn-ink" : "text-danger"}`}
                aria-hidden
            />
            <div className="min-w-0 flex-1">{children}</div>
        </div>
    );
}

/** What syncs: the picked list, the last run, files deleted here, Sync now. */
function SyncCard({
    status,
    refresh,
}: {
    status: Microsoft365Status;
    refresh: () => Promise<unknown>;
}) {
    const t = useTranslations("sources.microsoft365Sync");
    const tc = useTranslations("common");
    const syncStatusLabel = useSyncStatusLabel();
    const [busy, setBusy] = useState(false);
    // Polls while a sync is starting or running, so the counts land without
    // a manual refresh.
    const { phase, requestSync } = useConnectorSync(status, refresh, `${MICROSOFT_365_API}/sync`);

    const syncNow = async () => {
        setBusy(true);
        try {
            if (await requestSync()) toast.success(t("syncRequested"));
            else toast.error(t("syncStartFailed"));
        } finally {
            setBusy(false);
        }
    };

    const removeItem = async (item: Microsoft365PickedItem) => {
        const res = await fetch(`${MICROSOFT_365_API}/items`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: [{ driveId: item.driveId, itemId: item.itemId }] }),
        }).catch(() => null);
        if (!res?.ok) toast.error(t("stopFailed"));
        void refresh();
    };

    const picked = status.pickedItems ?? [];
    const syncing = phase === "running";
    const starting = phase === "starting";
    const report = status.lastSyncReport;
    const accessLost = reportCount(report, "accessLost");
    const empty = syncing ? [] : emptyFolderNames(status);

    return (
        <Card className="mt-3">
            <div className="text-ink mb-3 text-[13px] font-semibold">{t("cardTitle")}</div>
            <div className="bg-panel-2 mb-3.5 flex flex-wrap items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-[13px]">
                <span className="text-brand flex">
                    <IconMicrosoft size={16} />
                </span>
                <span className="text-ink min-w-0 truncate font-semibold">
                    {status.accountEmail ?? tc("status.connected")}
                </span>
                <span className="text-ink-3 ml-auto text-xs">
                    {syncStatusLabel(phase, status.lastSyncAt)}
                </span>
            </div>

            {phase === "stalled" ? <SyncStalledNotice /> : null}

            {status.lastSyncStatus === "error" && status.lastSyncError ? (
                <Notice tone="danger">
                    {t("lastSyncFailed", { error: status.lastSyncError })}
                </Notice>
            ) : null}

            {report && !syncing ? (
                <div className="text-ink-3 mb-3 text-[12.5px]">
                    {t("lastRun", {
                        stored: reportCount(report, "stored"),
                        unchanged: reportCount(report, "unchanged"),
                        failed: reportCount(report, "failed"),
                    })}
                </div>
            ) : null}

            {report?.truncated === true && !syncing ? (
                <Notice tone="warn">{t("truncated")}</Notice>
            ) : null}

            {empty.length > 0 ? (
                <Notice tone="warn">
                    {t("empty", { names: listNames(t, empty), count: empty.length })}
                </Notice>
            ) : null}

            {accessLost > 0 ? (
                <Notice tone="warn">{t("accessLost", { count: accessLost })}</Notice>
            ) : null}

            <div className="text-ink-3 mb-2 text-xs font-semibold">
                {t("syncedTitle", { count: picked.length })}
            </div>
            <ul className="mb-4 flex max-h-64 flex-col gap-1.5 overflow-y-auto">
                {picked.length === 0 ? (
                    <li className="text-ink-3 text-[13px]">{t("nothingYet")}</li>
                ) : (
                    picked.map(item => {
                        const ItemIcon =
                            item.kind === "folder"
                                ? item.folderPath
                                    ? FolderOpen
                                    : Folder
                                : FileText;
                        return (
                            <li
                                key={item.sourceId}
                                className="border-line flex items-center gap-2.5 rounded-lg border px-3 py-2 text-[13px]"
                            >
                                <ItemIcon className="text-ink-3 size-4 shrink-0" aria-hidden />
                                <span className="min-w-0 flex-1">
                                    <span className="text-ink block truncate">{item.name}</span>
                                    <span className="text-ink-3 block truncate text-[11.5px]">
                                        {pickedItemDestination(t, item)}
                                    </span>
                                </span>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-7"
                                    onClick={() => void removeItem(item)}
                                    title={t("stopSyncingTitle")}
                                    aria-label={t("stopSyncingAria", { name: item.name })}
                                >
                                    <X className="size-3.5" />
                                </Button>
                            </li>
                        );
                    })
                )}
            </ul>

            <DeletedHereList
                provider="microsoft-365"
                connectionId={status.connectionId}
                deleted={status.deletedHere}
                disabled={syncing || starting}
                onRestored={async () => {
                    await requestSync();
                    await refresh();
                }}
            />

            <Button
                size="sm"
                variant="outline"
                disabled={busy || syncing || starting || picked.length === 0}
                onClick={() => void syncNow()}
            >
                {syncing ? t("syncing") : starting ? t("starting") : t("syncNow")}
            </Button>
        </Card>
    );
}

export function Microsoft365Section({ onChanged }: { onChanged?: () => void }) {
    const t = useTranslations("settings.integrations");
    const ts = useTranslations("sources.microsoft365Sync");
    const tm = useTranslations("sources.microsoft365Source");
    const tc = useTranslations("common");
    const [loaded, setLoaded] = useState<Microsoft365Loaded>({ kind: "loading" });
    const [busy, setBusy] = useState(false);
    const [confirming, setConfirming] = useState(false);

    const refresh = useCallback(async () => {
        const next = await loadMicrosoft365Status();
        // A failed poll keeps the last good status.
        setLoaded(prev => (next.kind === "error" && prev.kind === "ok" ? prev : next));
        return next;
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const status = loaded.kind === "ok" ? loaded.status : null;

    const disconnect = async () => {
        if (!status?.connectionId) return;
        setBusy(true);
        try {
            const res = await fetch(
                `/api/connectors/connections/${encodeURIComponent(status.connectionId)}`,
                { method: "DELETE" }
            ).catch(() => null);
            if (res?.ok) toast.success(t("microsoft365.disconnected"));
            else toast.error(t("microsoft365.disconnectFailed"));
        } finally {
            setBusy(false);
            await refresh();
            onChanged?.();
        }
    };

    const active = status?.connected === true && status.status === "active";
    const revoked = status?.connected === true && status.status !== "active";
    const email = status?.accountEmail ?? t("microsoft365.unknown");

    return (
        <Section title="Microsoft 365" description={t("microsoft365.description")}>
            <Card>
                {loaded.kind === "loading" ? (
                    <StatusNote tone="muted" style={{ marginBottom: 0 }}>
                        {t("checking")}
                    </StatusNote>
                ) : loaded.kind === "forbidden" ? (
                    <StatusNote tone="muted" style={{ marginBottom: 0 }}>
                        {t("microsoft365.adminOnly")}
                    </StatusNote>
                ) : !status ? (
                    <StatusNote tone="danger" style={{ marginBottom: 0 }}>
                        {tm("loadError")}
                    </StatusNote>
                ) : !status.configured ? (
                    <StatusRow
                        label={t("microsoft365.setupLabel")}
                        ok={false}
                        detail={t.rich("microsoft365.setup", { code })}
                    />
                ) : (
                    <>
                        <StatusRow
                            label={t("microsoft365.account")}
                            ok={active}
                            detail={
                                active
                                    ? t.rich("microsoft365.connectedAs", { email, code })
                                    : revoked
                                      ? t.rich("microsoft365.revokedAs", { email, code })
                                      : t("microsoft365.notConnected")
                            }
                        />
                        <div className="flex gap-2 pt-2.5">
                            <Button size="sm" variant={active ? "outline" : "default"} asChild>
                                <a href={MICROSOFT_365_CONNECT_URL}>
                                    {status.connected
                                        ? t("microsoft365.reconnect")
                                        : t("microsoft365.connect")}
                                </a>
                            </Button>
                            {status.connected ? (
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setConfirming(true)}
                                    disabled={busy}
                                >
                                    {busy ? t("disconnecting") : tc("actions.disconnect")}
                                </Button>
                            ) : null}
                        </div>
                    </>
                )}
            </Card>

            {status?.configured && !status.connected ? (
                <Card className="mt-3">
                    <div className="text-ink mb-3 text-[13px] font-semibold">{ts("cardTitle")}</div>
                    <div className="text-ink-3 text-[13px]">{ts("notConnected")}</div>
                </Card>
            ) : null}

            {status && revoked ? (
                <Card className="mt-3">
                    <div className="text-ink mb-3 text-[13px] font-semibold">{ts("cardTitle")}</div>
                    <Notice tone="warn">
                        <div className="text-ink font-semibold">{ts("reconnectTitle")}</div>
                        {ts("reconnectBody")}
                        <div className="mt-2">
                            <Button asChild size="sm">
                                <a href={MICROSOFT_365_CONNECT_URL}>{ts("reconnectTitle")}</a>
                            </Button>
                        </div>
                    </Notice>
                </Card>
            ) : null}

            {status && active ? <SyncCard status={status} refresh={refresh} /> : null}

            <ConfirmDialog
                open={confirming}
                onOpenChange={setConfirming}
                title={t("microsoft365.confirmTitle")}
                description={t("microsoft365.confirmBody")}
                confirmLabel={tc("actions.disconnect")}
                onConfirm={() => void disconnect()}
            />
        </Section>
    );
}
