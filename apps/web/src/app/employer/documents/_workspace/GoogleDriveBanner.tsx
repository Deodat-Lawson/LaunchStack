"use client";

/**
 * The Drive-link state line (Drive-Linked Files, Leg 2).
 *
 * Renders nothing until it has something true to say. For a linkable but
 * unlinked document it offers the link action; for a linked one it always
 * states *when* the document last synced — the design's defense against
 * anyone acting on a stale copy — plus Sync now and Unlink.
 *
 * A reader can hide it, once for every document. The viewer reads the
 * status for the line and for the header's Drive button, which brings the
 * line back — and carries the last-synced time in its tooltip meanwhile.
 */

import React, { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import dayjs from "dayjs";
import { X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { GoogleDriveLogo } from "~/components/icons/brand";
import { Button } from "~/components/ui/button";
import { ConfirmActionDialog } from "./ConfirmActionDialog";

export interface DriveLinkStatus {
    connected: boolean;
    linkable: boolean;
    link: {
        status: "linked" | "orphaned";
        url: string | null;
        linkedBy: string | null;
        lastSyncedAt: string | null;
        fidelityWarning: boolean;
        lastError: string | null;
    } | null;
}

interface PullOutcomeShape {
    kind: string;
    versionNumber?: number;
}

const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    padding: "8px 14px",
    margin: "12px 16px 0",
    borderRadius: 10,
    border: "1px solid var(--line)",
    background: "var(--panel)",
    fontSize: 12.5,
    color: "var(--ink-2)",
    flexShrink: 0,
};

/** Remembers a reader's choice to hide the line. Per browser, like the viewer's rail. */
const DRIVE_BAR_HIDDEN_KEY = "documentViewer.driveBarHidden.v1";

/**
 * Whether the reader hid the line: one choice for every document. A store
 * rather than each viewer's state, so hiding it in one tab hides it in the
 * tabs open beside it — and in other windows, through the storage event.
 * Held in memory once read, so blocked storage still hides it for the visit.
 */
let driveBarHidden: boolean | null = null;
const driveBarListeners = new Set<() => void>();

function readDriveBarHidden(): boolean {
    if (driveBarHidden === null) {
        try {
            driveBarHidden = localStorage.getItem(DRIVE_BAR_HIDDEN_KEY) === "1";
        } catch {
            // Private mode / blocked storage — fall back to shown.
            driveBarHidden = false;
        }
    }
    return driveBarHidden;
}

function subscribeDriveBarHidden(listener: () => void): () => void {
    driveBarListeners.add(listener);
    const onStorage = (event: StorageEvent) => {
        if (event.key !== DRIVE_BAR_HIDDEN_KEY) return;
        driveBarHidden = event.newValue === "1";
        listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
        driveBarListeners.delete(listener);
        window.removeEventListener("storage", onStorage);
    };
}

export function setDriveBarHidden(hidden: boolean): void {
    driveBarHidden = hidden;
    try {
        localStorage.setItem(DRIVE_BAR_HIDDEN_KEY, hidden ? "1" : "0");
    } catch {
        // Quota / private mode — the choice just is not remembered.
    }
    driveBarListeners.forEach(listener => listener());
}

export function useDriveBarHidden(): boolean {
    return useSyncExternalStore(subscribeDriveBarHidden, readDriveBarHidden, () => false);
}

/**
 * A document's Drive-link status; null while unread, or for no document. A
 * new document starts from null rather than showing the last one's line.
 */
export function useDriveLinkStatus(documentId: number | null) {
    const [status, setStatus] = useState<DriveLinkStatus | null>(null);

    const refresh = useCallback(async () => {
        if (documentId === null) {
            setStatus(null);
            return;
        }
        try {
            const res = await fetch(`/api/documents/${documentId}/google-docs/status`);
            if (!res.ok) {
                setStatus(null);
                return;
            }
            setStatus((await res.json()) as DriveLinkStatus);
        } catch {
            setStatus(null);
        }
    }, [documentId]);

    useEffect(() => {
        setStatus(null);
        void refresh();
    }, [refresh]);

    return { status, refresh };
}

type BannerTranslator = ReturnType<typeof useTranslations<"sources.googleDriveBanner">>;
type Formatter = ReturnType<typeof useFormatter>;

/**
 * Where a linked document lives and how fresh this copy is — the line's
 * words. In English without a translator; `useDriveLinkSummary` words it in
 * the reader's language.
 */
export function driveLinkSummary(
    link: NonNullable<DriveLinkStatus["link"]>,
    t?: BannerTranslator,
    format?: Formatter
): string {
    if (!t || !format) {
        if (link.status === "orphaned") return "The Google Drive copy was deleted or trashed.";
        const synced = link.lastSyncedAt
            ? dayjs(link.lastSyncedAt).format("MMM D, HH:mm")
            : "never";
        return `Lives in Google Drive${link.linkedBy ? ` — linked by ${link.linkedBy}` : ""} · last synced ${synced}`;
    }
    if (link.status === "orphaned") return t("orphaned");
    const synced = link.lastSyncedAt
        ? format.dateTime(new Date(link.lastSyncedAt), {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              hourCycle: "h23",
          })
        : t("never");
    return link.linkedBy
        ? t("livesInLinkedBy", { name: link.linkedBy, synced })
        : t("livesIn", { synced });
}

/** `driveLinkSummary` in the reader's language. */
export function useDriveLinkSummary(): (link: NonNullable<DriveLinkStatus["link"]>) => string {
    const t = useTranslations("sources.googleDriveBanner");
    const format = useFormatter();
    return useCallback(link => driveLinkSummary(link, t, format), [t, format]);
}

export function GoogleDriveBanner({
    documentId,
    status,
    refresh,
    onSynced,
    onHide,
}: {
    documentId: number;
    status: DriveLinkStatus | null;
    refresh: () => Promise<void>;
    /** A pull brought a new version — the viewer shows it. */
    onSynced?: () => void;
    onHide: () => void;
}) {
    const t = useTranslations("sources.googleDriveBanner");
    const tc = useTranslations("common");
    const summary = useDriveLinkSummary();
    const [busy, setBusy] = useState<null | "open" | "sync" | "unlink">(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [confirmUnlink, setConfirmUnlink] = useState(false);
    const [unlinkError, setUnlinkError] = useState<string | null>(null);

    useEffect(() => {
        setNotice(null);
    }, [documentId]);

    const openInDrive = useCallback(async () => {
        // Open the tab synchronously so popup blockers allow it, then point it.
        const tab = window.open("", "_blank");
        setBusy("open");
        setNotice(null);
        try {
            const res = await fetch(`/api/documents/${documentId}/google-docs/open`, {
                method: "POST",
            });
            const body = (await res.json()) as { url?: string; message?: string };
            if (res.ok && body.url) {
                if (tab) tab.location.href = body.url;
            } else {
                tab?.close();
                setNotice(body.message ?? t("openFailed"));
            }
        } catch {
            tab?.close();
            setNotice(t("unreachable"));
        } finally {
            setBusy(null);
            void refresh();
        }
    }, [documentId, refresh, t]);

    const syncNow = useCallback(async () => {
        setBusy("sync");
        setNotice(null);
        try {
            const res = await fetch(`/api/documents/${documentId}/google-docs/sync`, {
                method: "POST",
            });
            const body = (await res.json()) as { outcome?: PullOutcomeShape; message?: string };
            const kind = body.outcome?.kind;
            if (kind === "synced") {
                setNotice(t("synced", { version: String(body.outcome?.versionNumber ?? "") }));
                onSynced?.();
            } else if (kind === "noop") {
                setNotice(t("upToDate"));
            } else if (kind) {
                setNotice(t("syncResult", { kind: kind.replace(/_/g, " ") }));
            } else {
                setNotice(body.message ?? t("syncFailed"));
            }
        } catch {
            setNotice(t("unreachable"));
        } finally {
            setBusy(null);
            void refresh();
        }
    }, [documentId, onSynced, refresh, t]);

    const unlink = useCallback(async () => {
        setBusy("unlink");
        setUnlinkError(null);
        try {
            const res = await fetch(`/api/documents/${documentId}/google-docs/unlink`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            });
            const body = (await res.json()) as { success?: boolean; message?: string };
            if (!res.ok || !body.success) {
                setUnlinkError(body.message ?? t("unlinkFailed"));
                return;
            }
            setConfirmUnlink(false);
            setNotice(t("unlinked"));
        } catch {
            setUnlinkError(t("unreachable"));
        } finally {
            setBusy(null);
            void refresh();
        }
    }, [documentId, refresh, t]);

    if (!status?.linkable) return null;

    const link = status.link;

    if (!link) {
        return (
            <div style={rowStyle}>
                <GoogleDriveLogo className="shrink-0" />
                <span>{status.connected ? t("editPrompt") : t("connectPrompt")}</span>
                <span style={{ flex: 1 }} />
                {status.connected ? (
                    <Button size="sm" onClick={openInDrive} disabled={busy !== null}>
                        {busy === "open" ? t("linking") : t("openInDrive")}
                    </Button>
                ) : (
                    <Button size="sm" variant="outline" asChild>
                        <a href="/api/connectors/google/oauth/start">{t("connectDrive")}</a>
                    </Button>
                )}
                <Button
                    size="icon"
                    variant="ghost"
                    onClick={onHide}
                    aria-label={t("hide")}
                    title={t("hideHint")}
                    data-testid="drive-bar-hide"
                    className="text-ink-3 size-7"
                >
                    <X className="size-3.5" />
                </Button>
                {notice && <span style={{ width: "100%", color: "var(--ink-2)" }}>{notice}</span>}
            </div>
        );
    }

    return (
        <>
            <div style={rowStyle}>
                <GoogleDriveLogo className="shrink-0" />
                <span style={{ color: "var(--ink)" }}>{summary(link)}</span>
                <span style={{ flex: 1 }} />
                {link.status === "linked" && link.url && (
                    <Button size="sm" variant="outline" asChild>
                        <a href={link.url} target="_blank" rel="noreferrer">
                            {tc("actions.open")}
                        </a>
                    </Button>
                )}
                {link.status === "linked" && (
                    <Button size="sm" variant="outline" onClick={syncNow} disabled={busy !== null}>
                        {busy === "sync" ? t("syncing") : t("syncNow")}
                    </Button>
                )}
                {link.status === "orphaned" && (
                    <Button size="sm" onClick={openInDrive} disabled={busy !== null}>
                        {busy === "open" ? t("relinking") : t("relink")}
                    </Button>
                )}
                <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                        setUnlinkError(null);
                        setConfirmUnlink(true);
                    }}
                    disabled={busy !== null}
                >
                    {t("unlink")}
                </Button>
                <Button
                    size="icon"
                    variant="ghost"
                    onClick={onHide}
                    aria-label={t("hide")}
                    title={t("hideHint")}
                    data-testid="drive-bar-hide"
                    className="text-ink-3 size-7"
                >
                    <X className="size-3.5" />
                </Button>
                {link.fidelityWarning && (
                    <span style={{ width: "100%", color: "var(--warn, var(--ink-2))" }}>
                        {t("fidelity")}
                    </span>
                )}
                {link.lastError && (
                    <span style={{ width: "100%", color: "var(--danger)" }}>{link.lastError}</span>
                )}
                {notice && <span style={{ width: "100%" }}>{notice}</span>}
            </div>

            <ConfirmActionDialog
                open={confirmUnlink}
                title={t("confirmTitle")}
                body={t("confirmBody")}
                confirmLabel={busy === "unlink" ? t("unlinking") : t("unlink")}
                busy={busy === "unlink"}
                error={unlinkError}
                danger
                onConfirm={() => void unlink()}
                onClose={() => setConfirmUnlink(false)}
            />
        </>
    );
}
