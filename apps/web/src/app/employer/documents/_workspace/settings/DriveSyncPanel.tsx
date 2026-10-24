"use client";

/**
 * What syncs from Google Drive — Settings → Integrations, under Google
 * Drive. Drive is added from Add source (Files picks files, Folder picks a
 * folder; see useDriveSource), so this card only manages what was picked:
 * the account and the last run, the picked list with Stop syncing, Sync now,
 * and the folder-access notices. Connecting starts in Add source; a revoked
 * grant is reconnected here. Disconnecting is the workspace connection's
 * own action, in the Google Drive and Connections cards.
 *
 * States: loading → nothing to show (not configured, not allowed, or the
 * check failed: the cards around it say why) → not connected → revoked
 * (reconnect) → connected → syncing (polls status). A sync that was
 * requested but never starts says so (see useConnectorSync). With several
 * Drive accounts connected, this manages the primary (oldest) one.
 *
 * Whether a picked folder brings its contents depends on the grant
 * (`folderAccess`, see driveStatus.ts): with drive.readonly it imports whole.
 * Connecting asks only for drive.file, so where the operator has turned
 * folder import on, the card offers "Allow folder access" — a second consent
 * that adds drive.readonly, the restricted scope Google warns about until the
 * app is verified. Where the operator hasn't, only files picked one by one
 * come in — the card says so rather than letting a folder import nothing.
 */

import React, { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { FileText, Folder, FolderOpen, Info, TriangleAlert, X } from "lucide-react";

import { IconDrive } from "~/components/icons/brand";
import { Card } from "~/components/layout/page-shell";
import { Button } from "~/components/ui/button";

import {
    emptyFolderNames,
    folderAccessState,
    listNames,
    pickedItemDestination,
    reportCount,
    type DriveStatus,
} from "../driveStatus";
import { SyncStalledNotice } from "../SyncStalledNotice";
import { useConnectorSync, useSyncStatusLabel } from "../useConnectorSync";
import {
    DRIVE_API,
    DRIVE_CONNECT_URL,
    DRIVE_FOLDER_ACCESS_URL,
    fetchDriveStatus,
} from "../useDriveSource";

function Notice({
    tone,
    children,
}: {
    tone: "info" | "warn" | "danger";
    children: React.ReactNode;
}) {
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
                className={`mt-0.5 size-4 shrink-0 ${tone === "info" ? "text-ink-3" : tone === "warn" ? "text-warn" : "text-danger"}`}
            />
            <div className="min-w-0 flex-1">{children}</div>
        </div>
    );
}

/** A titled card; nothing at all where Drive isn't set up or isn't this person's to manage. */
export function DriveSyncPanel() {
    const t = useTranslations("sources.driveConnect");
    const tc = useTranslations("common");
    const syncStatusLabel = useSyncStatusLabel();
    const [status, setStatus] = useState<DriveStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);

    const refresh = useCallback(async () => {
        const next = await fetchDriveStatus().catch(() => null);
        // A failed poll keeps the last good status.
        if (next) setStatus(next);
        setLoading(false);
        return next;
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    // Polls while a sync is starting or running, so the counts land without
    // a manual refresh.
    const { phase, requestSync } = useConnectorSync(status, refresh, `${DRIVE_API}/sync`);

    const syncNow = useCallback(async () => {
        setBusy(true);
        try {
            if (await requestSync()) toast.success(t("syncRequested"));
            else toast.error(t("syncStartFailed"));
        } finally {
            setBusy(false);
        }
    }, [requestSync, t]);

    const removeItem = useCallback(
        async (fileId: string) => {
            await fetch(`${DRIVE_API}/items`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fileIds: [fileId] }),
            });
            void refresh();
        },
        [refresh]
    );

    const card = (body: React.ReactNode) => (
        <Card className="mt-3">
            <div className="text-ink mb-3 text-[13px] font-semibold">{t("cardTitle")}</div>
            {body}
        </Card>
    );

    if (loading) {
        return card(<div className="text-ink-3 text-[13px]">{t("checking")}</div>);
    }

    if (!status?.configured) return null;

    if (!status.connected) {
        return card(<div className="text-ink-3 text-[13px]">{t("notConnected")}</div>);
    }

    if (status.status !== "active") {
        // A reconnect keeps the folder access it had, or its folders come back empty.
        const href = status.folderAccess?.granted ? DRIVE_FOLDER_ACCESS_URL : DRIVE_CONNECT_URL;
        return card(
            <Notice tone="warn">
                <div className="text-ink font-semibold">{t("reconnectTitle")}</div>
                {t("reconnectBody")}
                <div className="mt-2">
                    <Button asChild size="sm">
                        <a href={href}>{t("reconnectTitle")}</a>
                    </Button>
                </div>
            </Notice>
        );
    }

    const picked = status.pickedItems ?? [];
    const syncing = phase === "running";
    const starting = phase === "starting";
    const report = status.lastSyncReport;
    const accessLost = reportCount(report, "accessLost");
    const access = folderAccessState(status);
    const empty = syncing ? [] : emptyFolderNames(status);

    return card(
        <>
            <div className="bg-panel-2 mb-3.5 flex flex-wrap items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-[13px]">
                <span className="text-brand flex">
                    <IconDrive size={16} />
                </span>
                <span className="text-ink min-w-0 truncate font-semibold">
                    {status.accountEmail ?? tc("status.connected")}
                </span>
                <span className="text-ink-3 ml-auto text-xs">
                    {syncStatusLabel(phase, status.lastSyncAt)}
                </span>
            </div>

            {phase === "stalled" ? <SyncStalledNotice /> : null}

            {access === "allow" ? (
                <Notice tone="info">
                    <div className="text-ink font-semibold">{t("allowTitle")}</div>
                    {t("allowBody")}
                    <div className="mt-2">
                        <Button asChild size="sm">
                            <a href={DRIVE_FOLDER_ACCESS_URL}>{t("allowButton")}</a>
                        </Button>
                    </div>
                </Notice>
            ) : access === "files-only" ? (
                <Notice tone="info">
                    {t.rich("filesOnly", { code: chunks => <code>{chunks}</code> })}
                </Notice>
            ) : null}

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

            {empty.length > 0 ? (
                <Notice tone="warn">
                    {access === "ready"
                        ? t("emptyReady", { names: listNames(t, empty), count: empty.length })
                        : t("emptyNoAccess", { names: listNames(t, empty) })}
                </Notice>
            ) : null}

            {accessLost > 0 ? (
                <Notice tone="warn">{t("accessLost", { count: accessLost })}</Notice>
            ) : null}

            <div className="text-ink-3 mb-2 text-xs font-semibold">
                {t("syncedFromDrive", { count: picked.length })}
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
                                key={item.fileId}
                                className="border-line flex items-center gap-2.5 rounded-lg border px-3 py-2 text-[13px]"
                            >
                                <ItemIcon className="text-ink-3 size-4 shrink-0" />
                                <span className="min-w-0 flex-1">
                                    <span className="text-ink block truncate">{item.name}</span>
                                    <span className="text-ink-3 block truncate text-[11.5px]">
                                        {pickedItemDestination(t, item, access)}
                                    </span>
                                </span>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-7"
                                    onClick={() => void removeItem(item.fileId)}
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

            <Button
                size="sm"
                variant="outline"
                disabled={busy || syncing || starting || picked.length === 0}
                onClick={() => void syncNow()}
            >
                {syncing ? t("syncing") : starting ? t("starting") : t("syncNow")}
            </Button>
        </>
    );
}
