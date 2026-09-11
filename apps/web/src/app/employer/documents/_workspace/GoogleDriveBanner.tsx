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
import dayjs from "dayjs";

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
                setNotice(body.message ?? "Could not open the document in Google Drive.");
            }
        } catch {
            tab?.close();
            setNotice("Could not reach the server.");
        } finally {
            setBusy(null);
            void refresh();
        }
    }, [documentId, refresh]);

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
                setNotice(
                    `Synced v${body.outcome?.versionNumber ?? ""} from Google Drive. Reopen the document to see it.`
                );
            } else if (kind === "noop") {
                setNotice("Already up to date.");
            } else if (kind) {
                setNotice(`Sync result: ${kind.replace(/_/g, " ")}.`);
            } else {
                setNotice(body.message ?? "Sync failed.");
            }
        } catch {
            setNotice("Could not reach the server.");
        } finally {
            setBusy(null);
            void refresh();
        }
    }, [documentId, refresh]);

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
                setUnlinkError(body.message ?? "Unlink failed — the link was kept.");
                return;
            }
            setConfirmUnlink(false);
            setNotice("Unlinked. The Drive copy was moved to the Drive trash.");
        } catch {
            setUnlinkError("Could not reach the server.");
        } finally {
            setBusy(null);
            void refresh();
        }
    }, [documentId, refresh]);

    if (!status?.linkable) return null;

    const link = status.link;

    if (!link) {
        return (
            <div style={rowStyle}>
                <span>
                    {status.connected
                        ? "Edit this document with real tools — it opens in Google Drive and syncs back here."
                        : "Connect a Google account to edit this document in Google Drive."}
                </span>
                <span style={{ flex: 1 }} />
                {status.connected ? (
                    <Button size="sm" onClick={openInDrive} disabled={busy !== null}>
                        {busy === "open" ? "Linking…" : "Open in Google Drive"}
                    </Button>
                ) : (
                    <Button size="sm" variant="outline" asChild>
                        <a href="/api/connectors/google/oauth/start">Connect Google Drive</a>
                    </Button>
                )}
                {notice && <span style={{ width: "100%", color: "var(--ink-2)" }}>{notice}</span>}
            </div>
        );
    }

    const synced = link.lastSyncedAt ? dayjs(link.lastSyncedAt).format("MMM D, HH:mm") : "never";

    return (
        <>
            <div style={rowStyle}>
                <span style={{ color: "var(--ink)" }}>
                    {link.status === "orphaned"
                        ? "The Google Drive copy was deleted or trashed."
                        : `Lives in Google Drive${link.linkedBy ? ` — linked by ${link.linkedBy}` : ""} · last synced ${synced}`}
                </span>
                <span style={{ flex: 1 }} />
                {link.status === "linked" && link.url && (
                    <Button size="sm" variant="outline" asChild>
                        <a href={link.url} target="_blank" rel="noreferrer">
                            Open
                        </a>
                    </Button>
                )}
                {link.status === "linked" && (
                    <Button size="sm" variant="outline" onClick={syncNow} disabled={busy !== null}>
                        {busy === "sync" ? "Syncing…" : "Sync now"}
                    </Button>
                )}
                {link.status === "orphaned" && (
                    <Button size="sm" onClick={openInDrive} disabled={busy !== null}>
                        {busy === "open" ? "Re-linking…" : "Re-link from current version"}
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
                    Unlink
                </Button>
                {link.fidelityWarning && (
                    <span style={{ width: "100%", color: "var(--warn, var(--ink-2))" }}>
                        This file was converted to a native Google Doc — formatting may drift on
                        sync.
                    </span>
                )}
                {link.lastError && (
                    <span style={{ width: "100%", color: "var(--danger)" }}>{link.lastError}</span>
                )}
                {notice && <span style={{ width: "100%" }}>{notice}</span>}
            </div>

            <ConfirmActionDialog
                open={confirmUnlink}
                title="Unlink from Google Drive"
                body="A final sync pulls any remaining Drive edits into version history, then the Drive copy is moved to the Drive trash and editing returns in-app."
                confirmLabel={busy === "unlink" ? "Unlinking…" : "Unlink"}
                busy={busy === "unlink"}
                error={unlinkError}
                danger
                onConfirm={() => void unlink()}
                onClose={() => setConfirmUnlink(false)}
            />
        </>
    );
}
