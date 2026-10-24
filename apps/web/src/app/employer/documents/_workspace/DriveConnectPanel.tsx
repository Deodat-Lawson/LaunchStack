"use client";

/**
 * The real Google Drive connect panel — replaces the generic connect card for
 * `drive` in AddSourceModal's Connect group.
 *
 * States: loading → not-configured → not-connected → connected (picked list,
 * pick more, paste a folder link, sync now, disconnect) → syncing (polls
 * status) → revoked (reconnect). A sync that was requested but never starts
 * says so (see useConnectorSync). All data comes from
 * /api/connectors/google-drive/status; the Picker's public config rides on
 * the status payload, so no client env inlining. With several Drive accounts
 * connected, this panel manages the primary (oldest) connection; the rest
 * are listed under Settings → Integrations.
 *
 * Whether a picked folder brings its contents depends on the grant
 * (`folderAccess`, see driveStatus.ts): with drive.readonly it imports whole.
 * Connecting asks only for drive.file, so where the operator has turned
 * folder import on, the panel offers "Allow folder access" — a second consent
 * that adds drive.readonly, the restricted scope Google warns about until the
 * app is verified. Where the operator hasn't, only files picked one by one
 * come in — the panel says so rather than letting a folder import nothing.
 */

import React, { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { FileText, Folder, FolderOpen, Info, Link2, TriangleAlert, X } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { driveIdFromLink } from "~/lib/integrations/google-drive-link";

import {
    emptyFolderNames,
    folderAccessState,
    listNames,
    pickedItemDestination,
    reportCount,
    type DriveStatus,
    type FolderAccessState,
} from "./driveStatus";
import { SyncStalledNotice } from "./SyncStalledNotice";
import type { AddSourceTab } from "./types";
import { useConnectorSync, useSyncStatusLabel } from "./useConnectorSync";
import { useGooglePicker, type PickedDoc } from "./useGooglePicker";

const BASE = "/api/connectors/google-drive";
const CONNECT_URL = "/api/connectors/google/oauth/start";
const FOLDER_ACCESS_URL = `${CONNECT_URL}?access=folders`;

async function fetchStatus(): Promise<DriveStatus | null> {
    const res = await fetch(`${BASE}/status`);
    if (!res.ok) return null;
    const payload = (await res.json()) as { data?: DriveStatus };
    return payload.data ?? null;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
    try {
        const body = (await res.json()) as { message?: string };
        return body.message ?? fallback;
    } catch {
        return fallback;
    }
}

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
                className={`mt-0.5 size-4 shrink-0 ${tone === "info" ? "text-ink-3" : tone === "warn" ? "text-warn-ink" : "text-danger"}`}
            />
            <div className="min-w-0 flex-1">{children}</div>
        </div>
    );
}

export function DriveConnectPanel({
    tab,
    onFolderAccess,
}: {
    tab: AddSourceTab;
    /**
     * Whether a picked folder can import right now (null until known, or
     * while not connected): the modal's destination bar only promises a
     * folder of its own when it can.
     */
    onFolderAccess?: (state: FolderAccessState | null) => void;
}) {
    const t = useTranslations("sources.driveConnect");
    const tc = useTranslations("common");
    const syncStatusLabel = useSyncStatusLabel();
    const Icon = tab.Icon;
    const [status, setStatus] = useState<DriveStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
    const [link, setLink] = useState("");
    const [linkError, setLinkError] = useState<string | null>(null);
    const [addingLink, setAddingLink] = useState(false);
    const { openPicker, opening } = useGooglePicker();

    const refresh = useCallback(async () => {
        const next = await fetchStatus().catch(() => null);
        if (next) setStatus(next);
        // A failed check is not "not configured": keep the last good status
        // and say the check failed.
        setLoadFailed(next === null);
        setLoading(false);
        return next;
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const liveAccess =
        status?.configured && status.connected && status.status === "active"
            ? folderAccessState(status)
            : null;
    useEffect(() => {
        onFolderAccess?.(liveAccess);
    }, [liveAccess, onFolderAccess]);

    // Polls while a sync is starting or running, so the counts land without
    // a manual refresh.
    const { phase, requestSync } = useConnectorSync(status, refresh, `${BASE}/sync`);

    /** After something was added: request the sync; the hook follows it. */
    const syncAfterAdd = useCallback(async () => {
        if (!(await requestSync())) toast.error(t("syncFailedAfterAdd"));
        void refresh();
    }, [refresh, requestSync, t]);

    const handlePicked = useCallback(
        async (docs: readonly PickedDoc[]) => {
            const res = await fetch(`${BASE}/items`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ items: docs }),
            });
            if (res.ok) {
                toast.success(
                    docs.length === 1
                        ? t("pickedOne", { name: docs[0]!.name })
                        : t("pickedMany", { count: docs.length })
                );
                await syncAfterAdd();
            } else {
                toast.error(await errorMessage(res, t("saveSelectionFailed")));
                void refresh();
            }
        },
        [refresh, syncAfterAdd, t]
    );

    const addLink = useCallback(async () => {
        const value = link.trim();
        if (!driveIdFromLink(value)) {
            setLinkError(t("notDriveLink"));
            return;
        }
        setAddingLink(true);
        setLinkError(null);
        try {
            const res = await fetch(`${BASE}/items`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ link: value }),
            });
            if (!res.ok) {
                setLinkError(await errorMessage(res, t("addLinkFailed")));
                return;
            }
            const payload = (await res.json()) as { message?: string };
            toast.success(
                payload.message
                    ? t("linkAddedWithMessage", { message: payload.message })
                    : t("linkAdded")
            );
            setLink("");
            await syncAfterAdd();
        } finally {
            setAddingLink(false);
        }
    }, [link, syncAfterAdd, t]);

    const choose = useCallback(async () => {
        if (!status?.picker.apiKey || !status.picker.appId) {
            toast.error(t("pickerNotConfigured"));
            return;
        }
        setBusy(true);
        try {
            const res = await fetch(`${BASE}/picker-token`);
            if (!res.ok) {
                toast.error(t("noDriveAccess"));
                return;
            }
            const payload = (await res.json()) as { data?: { accessToken?: string } };
            const accessToken = payload.data?.accessToken;
            if (!accessToken) {
                toast.error(t("noDriveAccess"));
                return;
            }
            await openPicker({
                scriptUrl: status.picker.scriptUrl,
                apiKey: status.picker.apiKey,
                appId: status.picker.appId,
                accessToken,
                onPicked: docs => void handlePicked(docs),
            });
        } catch {
            toast.error(t("pickerFailed"));
        } finally {
            setBusy(false);
        }
    }, [status, openPicker, handlePicked, t]);

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
            await fetch(`${BASE}/items`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fileIds: [fileId] }),
            });
            void refresh();
        },
        [refresh]
    );

    const disconnect = useCallback(async () => {
        if (!status?.connectionId) return;
        setBusy(true);
        try {
            const res = await fetch(`/api/connectors/connections/${status.connectionId}`, {
                method: "DELETE",
            });
            if (res.ok) toast.success(t("disconnected"));
            else toast.error(t("disconnectFailed"));
            setConfirmingDisconnect(false);
            void refresh();
        } finally {
            setBusy(false);
        }
    }, [refresh, status?.connectionId, t]);

    if (loading) {
        return <div className="text-ink-3 p-6 text-[13px]">{t("checking")}</div>;
    }

    if (!status && loadFailed) {
        return (
            <Notice tone="danger">
                {t("checkFailed")}
                <div className="mt-2">
                    <Button size="sm" variant="outline" onClick={() => void refresh()}>
                        {tc("actions.tryAgain")}
                    </Button>
                </div>
            </Notice>
        );
    }

    if (!status?.configured) {
        return (
            <div className="bg-panel-2 text-ink-2 rounded-xl px-4 py-4 text-[13px] leading-relaxed">
                <div className="text-ink mb-1.5 font-semibold">{t("notConfiguredTitle")}</div>
                {t.rich("notConfiguredBody", { code: chunks => <code>{chunks}</code> })}
            </div>
        );
    }

    if (!status.connected || status.status !== "active") {
        const reconnect = status.connected && status.status !== "active";
        const folderImport = status.folderAccess?.enabled ?? false;
        // A reconnect keeps the folder access it had, or its folders come back empty.
        const connectUrl =
            reconnect && status.folderAccess?.granted ? FOLDER_ACCESS_URL : CONNECT_URL;
        return (
            <div>
                <div className="bg-panel-2 mb-4 flex items-center gap-3.5 rounded-xl px-4 py-4">
                    <div className="bg-panel border-line text-brand flex size-11 shrink-0 items-center justify-center rounded-lg border">
                        <Icon size={22} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="text-ink text-[15px] font-semibold">
                            {reconnect ? t("reconnectTitle") : t("connectTitle")}
                        </div>
                        <div className="text-ink-3 text-[13px]">
                            {reconnect
                                ? t("reconnectBody")
                                : folderImport
                                  ? t("connectBodyFolders")
                                  : t("connectBody")}
                        </div>
                    </div>
                </div>
                <Button asChild className="w-full" size="lg">
                    <a href={connectUrl}>{reconnect ? t("reconnectTitle") : t("connectTitle")}</a>
                </Button>
            </div>
        );
    }

    const picked = status.pickedItems ?? [];
    const syncing = phase === "running";
    const starting = phase === "starting";
    const report = status.lastSyncReport;
    const accessLost = reportCount(report, "accessLost");
    const access = folderAccessState(status);
    const empty = syncing ? [] : emptyFolderNames(status);

    return (
        <div>
            <div className="bg-panel-2 mb-3.5 flex flex-wrap items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-[13px]">
                <span className="text-brand flex">
                    <Icon size={16} />
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
                            <a href={FOLDER_ACCESS_URL}>{t("allowButton")}</a>
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

            {access === "ready" ? (
                <form
                    className="mb-4"
                    onSubmit={event => {
                        event.preventDefault();
                        void addLink();
                    }}
                >
                    <label
                        htmlFor="drive-folder-link"
                        className="text-ink-3 mb-1.5 block text-xs font-semibold"
                    >
                        {t("pasteLinkLabel")}
                    </label>
                    <div className="flex gap-2 max-sm:flex-col">
                        <div className="relative min-w-0 flex-1">
                            <Link2 className="text-ink-3 pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
                            <Input
                                id="drive-folder-link"
                                value={link}
                                onChange={event => {
                                    setLink(event.target.value);
                                    setLinkError(null);
                                }}
                                placeholder="https://drive.google.com/drive/folders/…"
                                aria-invalid={linkError ? true : undefined}
                                aria-describedby={linkError ? "drive-folder-link-error" : undefined}
                                className="pl-8"
                                autoComplete="off"
                                spellCheck={false}
                            />
                        </div>
                        <Button
                            type="submit"
                            variant="outline"
                            disabled={addingLink || !link.trim()}
                        >
                            {addingLink ? t("adding") : t("addFolder")}
                        </Button>
                    </div>
                    {linkError ? (
                        <p id="drive-folder-link-error" className="text-danger mt-1.5 text-xs">
                            {linkError}
                        </p>
                    ) : (
                        <p className="text-ink-3 mt-1.5 text-xs">
                            {status.accountEmail
                                ? t("linkHintAccount", { account: status.accountEmail })
                                : t("linkHintThis")}
                        </p>
                    )}
                </form>
            ) : null}

            <div className="text-ink-3 mb-2 text-xs font-semibold">
                {t("syncedFromDrive", { count: picked.length })}
            </div>
            <ul className="mb-4 flex max-h-48 flex-col gap-1.5 overflow-y-auto">
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

            <div className="flex flex-wrap items-center gap-2">
                <Button disabled={busy || opening} onClick={() => void choose()}>
                    {opening ? t("openingPicker") : t("chooseInDrive")}
                </Button>
                <Button
                    variant="outline"
                    disabled={busy || syncing || starting || picked.length === 0}
                    onClick={() => void syncNow()}
                >
                    {syncing ? t("syncing") : starting ? t("starting") : t("syncNow")}
                </Button>
                {confirmingDisconnect ? (
                    <span className="flex flex-wrap items-center gap-2">
                        <span className="text-ink-2 text-[12.5px]">{t("disconnectConfirm")}</span>
                        <Button
                            variant="destructive"
                            disabled={busy}
                            onClick={() => void disconnect()}
                        >
                            {tc("actions.disconnect")}
                        </Button>
                        <Button variant="outline" onClick={() => setConfirmingDisconnect(false)}>
                            {tc("actions.cancel")}
                        </Button>
                    </span>
                ) : (
                    <Button
                        variant="ghost"
                        className="ml-auto"
                        onClick={() => setConfirmingDisconnect(true)}
                    >
                        {tc("actions.disconnect")}
                    </Button>
                )}
            </div>
        </div>
    );
}
