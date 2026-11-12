"use client";

/**
 * OneDrive and SharePoint as somewhere to add from: Add source's tab browses
 * the connected account's files (or takes a pasted link), and what is picked
 * lands in the folder the destination bar shows, then stays in sync.
 * Connecting happens there too, the first time. What keeps syncing (the
 * list, Sync now, Disconnect) is managed in Settings › Integrations.
 *
 * The connection is the workspace's, so only people who manage connections
 * can add from it; for anyone else the status route answers 403 and the
 * panel says who to ask.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import {
    microsoft365SourceState,
    type Microsoft365Loaded,
    type Microsoft365Status,
} from "./microsoft365Status";
import { SYNC_POLL_MS } from "./useConnectorSync";

export const MICROSOFT_365_API = "/api/connectors/microsoft-files";
export const MICROSOFT_365_CONNECT_URL = "/api/connectors/microsoft/oauth/start";

/** The most items one Add may carry (the items route's own limit). */
export const MICROSOFT_365_MAX_PICKS = 50;

export async function loadMicrosoft365Status(): Promise<Microsoft365Loaded> {
    try {
        const res = await fetch(`${MICROSOFT_365_API}/status`);
        if (res.status === 403) return { kind: "forbidden" };
        if (!res.ok) return { kind: "error" };
        const payload = (await res.json()) as { data?: Microsoft365Status };
        return payload.data ? { kind: "ok", status: payload.data } : { kind: "error" };
    } catch {
        return { kind: "error" };
    }
}

/** The status, or null when it can't be read (not allowed, or the check failed). */
export async function fetchMicrosoft365Status(): Promise<Microsoft365Status | null> {
    const loaded = await loadMicrosoft365Status();
    return loaded.kind === "ok" ? loaded.status : null;
}

/** The server's sentence for a refusal, or `fallback`. */
export async function microsoft365ErrorMessage(res: Response, fallback: string): Promise<string> {
    try {
        const body = (await res.json()) as { message?: string; error?: string };
        return body.message ?? body.error ?? fallback;
    } catch {
        return fallback;
    }
}

/** One thing picked in the browser. */
export interface Microsoft365Pick {
    readonly driveId: string;
    readonly itemId: string;
    readonly kind: "file" | "folder";
    readonly name: string;
}

type AddBody =
    | { readonly items: readonly { driveId: string; itemId: string }[] }
    | { readonly link: string };

/** What the items route says it added. */
export interface Microsoft365Added {
    readonly kind: string;
    readonly name: string;
}

export type Microsoft365AddResult =
    | { readonly ok: true; readonly added: readonly Microsoft365Added[] }
    | { readonly ok: false; readonly message: string };

/** How long to keep watching for a requested sync to land. */
export const SYNC_FOLLOW_MS = 2 * 60_000;

/**
 * Picked files arrive with the sync, seconds after Add source has closed. So
 * watch the status until a run newer than `baseline` has finished, then
 * `onSynced` (the workspace reads its list again). Gives up after
 * SYNC_FOLLOW_MS: a runner that is down shows the picks whenever it catches up.
 */
export function followMicrosoft365Sync(baseline: string | null, onSynced: () => void): void {
    const started = Date.now();
    const tick = async () => {
        const next = await fetchMicrosoft365Status();
        const landed =
            next !== null &&
            next.lastSyncStatus !== "running" &&
            (next.lastSyncAt ?? null) !== baseline;
        if (landed) onSynced();
        else if (Date.now() - started < SYNC_FOLLOW_MS) setTimeout(() => void tick(), SYNC_POLL_MS);
    };
    setTimeout(() => void tick(), SYNC_POLL_MS);
}

/** `onSynced`: what to do once the picks are in; the workspace refreshes its list. */
export function useMicrosoft365Source({ onSynced }: { onSynced?: () => void } = {}) {
    const t = useTranslations("sources.microsoft365Source");
    const [loaded, setLoaded] = useState<Microsoft365Loaded>({ kind: "loading" });
    const [adding, setAdding] = useState(false);

    const mounted = useRef(true);
    const refresh = useCallback(async () => {
        const next = await loadMicrosoft365Status();
        if (mounted.current) setLoaded(next);
    }, []);

    useEffect(() => {
        mounted.current = true;
        void refresh();
        return () => {
            mounted.current = false;
        };
    }, [refresh]);

    const lastSyncAt = loaded.kind === "ok" ? (loaded.status.lastSyncAt ?? null) : null;

    /**
     * Saves what was picked into `destination` and starts the sync. A sync
     * that won't start still leaves the pick saved: the periodic sync brings
     * it in.
     */
    const add = useCallback(
        async (body: AddBody, destination: string): Promise<Microsoft365AddResult> => {
            setAdding(true);
            try {
                const res = await fetch(`${MICROSOFT_365_API}/items`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ...body, destination }),
                });
                if (!res.ok) {
                    // A dead grant turns the panel into Reconnect.
                    void refresh();
                    return {
                        ok: false,
                        message: await microsoft365ErrorMessage(res, t("addFailed")),
                    };
                }
                const payload = (await res.json().catch(() => null)) as {
                    data?: { added?: Microsoft365Added[] };
                } | null;
                const sync = await fetch(`${MICROSOFT_365_API}/sync`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({}),
                }).catch(() => null);
                if (!sync?.ok) toast.warning(t("syncLater"));
                else if (onSynced) followMicrosoft365Sync(lastSyncAt, onSynced);
                return { ok: true, added: payload?.data?.added ?? [] };
            } catch {
                return { ok: false, message: t("addFailed") };
            } finally {
                if (mounted.current) setAdding(false);
            }
        },
        [lastSyncAt, onSynced, refresh, t]
    );

    const addItems = useCallback(
        (picks: readonly Microsoft365Pick[], destination: string) =>
            add(
                { items: picks.map(pick => ({ driveId: pick.driveId, itemId: pick.itemId })) },
                destination
            ),
        [add]
    );

    const addLink = useCallback(
        (link: string, destination: string) => add({ link }, destination),
        [add]
    );

    return {
        state: microsoft365SourceState(loaded),
        busy: adding,
        refresh,
        addItems,
        addLink,
    };
}
