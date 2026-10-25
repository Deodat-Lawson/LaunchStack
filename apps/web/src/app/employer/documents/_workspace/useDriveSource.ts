"use client";

/**
 * Google Drive as somewhere to add from, not a connector of its own: Add
 * source's Files tab picks Drive files and its Folder tab picks Drive folders,
 * and what is picked lands in the folder the destination bar shows — then
 * stays in sync with Drive. Connecting happens there too, the first time.
 * What keeps syncing (the list, Sync now, Disconnect) is managed in
 * Settings → Integrations (DriveSyncPanel).
 *
 * Only people who manage the workspace's connections can pick: the Picker
 * browses the connected account's Drive with its grant. For anyone else the
 * status route answers 403 and the Drive button stays out of the way.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { folderAccessState, type DriveStatus, type FolderAccessState } from "./driveStatus";
import { SYNC_POLL_MS } from "./useConnectorSync";
import { useGooglePicker, type DrivePickTarget, type PickedDoc } from "./useGooglePicker";

export const DRIVE_API = "/api/connectors/google-drive";
export const DRIVE_CONNECT_URL = "/api/connectors/google/oauth/start";
export const DRIVE_FOLDER_ACCESS_URL = `${DRIVE_CONNECT_URL}?access=folders`;

/** The Drive status, or null when it can't be read (not allowed, or the check failed). */
export async function fetchDriveStatus(): Promise<DriveStatus | null> {
    const res = await fetch(`${DRIVE_API}/status`);
    if (!res.ok) return null;
    const payload = (await res.json()) as { data?: DriveStatus };
    return payload.data ?? null;
}

/** The server's sentence for a refusal, or `fallback`. */
export async function driveErrorMessage(res: Response, fallback: string): Promise<string> {
    try {
        const body = (await res.json()) as { message?: string; error?: string };
        return body.message ?? body.error ?? fallback;
    } catch {
        return fallback;
    }
}

/**
 * What the Drive button can offer right now.
 * - `hidden`: not configured, not this person's to use, or the check failed.
 * - `connect` / `reconnect`: send them through Google's consent first.
 * - `ready`: the Picker opens; `access` says whether a folder imports whole.
 */
export type DriveSourceState =
    | { readonly kind: "loading" }
    | { readonly kind: "hidden" }
    | { readonly kind: "connect"; readonly folderImport: boolean }
    | { readonly kind: "reconnect"; readonly href: string }
    | { readonly kind: "ready"; readonly access: FolderAccessState };

export function driveSourceState(status: DriveStatus | null, loading: boolean): DriveSourceState {
    if (loading) return { kind: "loading" };
    if (!status?.configured) return { kind: "hidden" };
    if (!status.connected) {
        return { kind: "connect", folderImport: status.folderAccess?.enabled ?? false };
    }
    if (status.status !== "active") {
        // A reconnect keeps the folder access it had, or its folders come back empty.
        return {
            kind: "reconnect",
            href: status.folderAccess?.granted ? DRIVE_FOLDER_ACCESS_URL : DRIVE_CONNECT_URL,
        };
    }
    return { kind: "ready", access: folderAccessState(status) };
}

type AddBody = { readonly items: readonly PickedDoc[] } | { readonly link: string };

/** How long to keep watching for a requested sync to land. */
export const SYNC_FOLLOW_MS = 2 * 60_000;

/**
 * Picked files arrive with the sync, seconds after Add source has closed —
 * unlike an upload, whose document exists by then. So watch the status until
 * a run newer than `baseline` has finished, then `onSynced` (the workspace
 * reads its list again). Gives up after SYNC_FOLLOW_MS: a runner that is down
 * shows the picks whenever it catches up, on the next refresh.
 */
export function followDriveSync(baseline: string | null, onSynced: () => void): void {
    const started = Date.now();
    const tick = async () => {
        const next = await fetchDriveStatus().catch(() => null);
        const landed =
            next !== null &&
            next.lastSyncStatus !== "running" &&
            (next.lastSyncAt ?? null) !== baseline;
        if (landed) onSynced();
        else if (Date.now() - started < SYNC_FOLLOW_MS) setTimeout(() => void tick(), SYNC_POLL_MS);
    };
    setTimeout(() => void tick(), SYNC_POLL_MS);
}

/** `onSynced`: what to do once the picks are in — the workspace refreshes its list. */
export function useDriveSource({ onSynced }: { onSynced?: () => void } = {}) {
    const t = useTranslations("sources.driveSource");
    const [status, setStatus] = useState<DriveStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [adding, setAdding] = useState(false);
    const { openPicker, opening } = useGooglePicker();

    const mounted = useRef(true);
    const refresh = useCallback(async () => {
        const next = await fetchDriveStatus().catch(() => null);
        if (!mounted.current) return;
        setStatus(next);
        setLoading(false);
    }, []);

    useEffect(() => {
        mounted.current = true;
        void refresh();
        return () => {
            mounted.current = false;
        };
    }, [refresh]);

    /**
     * Saves what was picked into `destination` and starts the sync. Resolves
     * to null once saved, or the reason it wasn't. A sync that won't start
     * still leaves the pick saved: the periodic sync brings it in.
     */
    const add = useCallback(
        async (body: AddBody, destination: string): Promise<string | null> => {
            setAdding(true);
            try {
                const res = await fetch(`${DRIVE_API}/items`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ...body, destination }),
                });
                if (!res.ok) return await driveErrorMessage(res, t("addFailed"));
                const sync = await fetch(`${DRIVE_API}/sync`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({}),
                }).catch(() => null);
                if (!sync?.ok) toast.warning(t("syncLater"));
                else if (onSynced) followDriveSync(status?.lastSyncAt ?? null, onSynced);
                return null;
            } finally {
                setAdding(false);
            }
        },
        [status?.lastSyncAt, onSynced, t]
    );

    /**
     * Opens the Picker for `target` and adds what comes back to
     * `destination`; `onAdded` runs once it is saved.
     */
    const pick = useCallback(
        async (
            target: DrivePickTarget,
            destination: string,
            onAdded: (docs: readonly PickedDoc[]) => void
        ) => {
            if (!status?.picker.apiKey || !status.picker.appId) {
                toast.error(t("pickerNotConfigured"));
                return;
            }
            try {
                const res = await fetch(`${DRIVE_API}/picker-token`);
                const payload = res.ok
                    ? ((await res.json()) as { data?: { accessToken?: string } })
                    : null;
                const accessToken = payload?.data?.accessToken;
                if (!accessToken) {
                    // Most likely the grant was revoked: the button turns into Reconnect.
                    toast.error(t("noDriveAccess"));
                    void refresh();
                    return;
                }
                await openPicker({
                    scriptUrl: status.picker.scriptUrl,
                    apiKey: status.picker.apiKey,
                    appId: status.picker.appId,
                    accessToken,
                    target,
                    onPicked: docs => {
                        void add({ items: docs }, destination).then(error => {
                            if (error) toast.error(error);
                            else onAdded(docs);
                        });
                    },
                });
            } catch {
                toast.error(t("pickerFailed"));
            }
        },
        [status, openPicker, add, refresh, t]
    );

    /** A pasted Drive folder link, into `destination`. Null once saved, or why not. */
    const addLink = useCallback(
        (link: string, destination: string) => add({ link }, destination),
        [add]
    );

    return {
        state: driveSourceState(status, loading),
        accountEmail: status?.accountEmail ?? null,
        busy: opening || adding,
        pick,
        addLink,
    };
}
