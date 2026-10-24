"use client";

/**
 * The Drive-link state line (Drive-Linked Files, Leg 2).
 *
 * Renders nothing until it has something true to say. For a linkable but
 * unlinked document it offers the link action; for a linked one it always
 * states *when* the document last synced — the design's defense against
 * anyone acting on a stale copy — plus Sync now and Unlink.
 */

import React, { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { Button } from "~/components/ui/button";
import { ConfirmActionDialog } from "./ConfirmActionDialog";

interface DriveLinkStatus {
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

export function GoogleDriveBanner({ documentId }: { documentId: number }) {
    const t = useTranslations("sources.googleDriveBanner");
    const tc = useTranslations("common");
    const format = useFormatter();
    const [status, setStatus] = useState<DriveLinkStatus | null>(null);
    const [busy, setBusy] = useState<null | "open" | "sync" | "unlink">(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [confirmUnlink, setConfirmUnlink] = useState(false);
    const [unlinkError, setUnlinkError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
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
        setNotice(null);
        void refresh();
    }, [refresh]);

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
    }, [documentId, refresh, t]);

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
                {notice && <span style={{ width: "100%", color: "var(--ink-2)" }}>{notice}</span>}
            </div>
        );
    }

    const synced = link.lastSyncedAt
        ? format.dateTime(new Date(link.lastSyncedAt), {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              hourCycle: "h23",
          })
        : t("never");

    return (
        <>
            <div style={rowStyle}>
                <span style={{ color: "var(--ink)" }}>
                    {link.status === "orphaned"
                        ? t("orphaned")
                        : link.linkedBy
                          ? t("livesInLinkedBy", { name: link.linkedBy, synced })
                          : t("livesIn", { synced })}
                </span>
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
