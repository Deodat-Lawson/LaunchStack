"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { EditorStore } from "../model/store";
import type { Point } from "../model/types";

/**
 * Presence: who else has this document open, where their cursor is, and
 * whether the server has moved ahead of us.
 *
 * Polled rather than socketed. The workspace has no document-sync plane, and a
 * 4-second heartbeat is entirely adequate for the thing this actually buys:
 * seeing that a colleague is in the file *before* you both save, instead of
 * discovering it from a 409.
 *
 * The cursor is read from a ref updated on pointer move rather than from React
 * state, so moving the mouse never re-renders the editor.
 */

const HEARTBEAT_MS = 4000;

export interface PresencePeer {
    userId: string;
    displayName: string | null;
    pageId: string | null;
    cursor: { x: number; y: number } | null;
    selection: string[];
    revisionSeen: number;
    lastSeenAt: string;
}

export interface PresenceState {
    peers: PresencePeer[];
    /** The server's revision is ahead of what this client has loaded. */
    staleBy: number;
}

export interface PresenceApi extends PresenceState {
    /** Feed the pointer position, in world coordinates. */
    reportCursor: (point: Point | null) => void;
    /** Adopt a revision after a save so staleness clears. */
    acknowledge: (revision: number) => void;
}

export function usePresence(
    store: EditorStore,
    mindmapId: number,
    displayName: string,
    currentRevision: () => number
): PresenceApi {
    const [state, setState] = useState<PresenceState>({ peers: [], staleBy: 0 });
    const cursor = useRef<Point | null>(null);
    const acknowledged = useRef(0);

    const reportCursor = useCallback((point: Point | null) => {
        cursor.current = point;
    }, []);

    const acknowledge = useCallback((revision: number) => {
        acknowledged.current = revision;
        setState(prev => (prev.staleBy === 0 ? prev : { ...prev, staleBy: 0 }));
    }, []);

    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const beat = async () => {
            const editor = store.getState();
            try {
                const res = await fetch(`/api/mindmaps/${mindmapId}/presence`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        displayName,
                        pageId: editor.doc.activePageId,
                        cursor: cursor.current,
                        selection: editor.selection
                            .filter(s => s.kind === "node")
                            .map(s => s.id)
                            .slice(0, 50),
                        revisionSeen: currentRevision(),
                    }),
                });
                if (!res.ok || cancelled) return;
                const body = (await res.json()) as { peers: PresencePeer[]; revision: number };
                if (cancelled) return;

                const mine = Math.max(currentRevision(), acknowledged.current);
                setState({ peers: body.peers, staleBy: Math.max(body.revision - mine, 0) });
            } catch {
                // Offline or a transient failure: presence is advisory, so the
                // next beat simply tries again. Never surface this.
            } finally {
                if (!cancelled) timer = setTimeout(() => void beat(), HEARTBEAT_MS);
            }
        };

        void beat();

        const leave = () => {
            // `keepalive` lets the request outlive the page; a plain fetch is
            // cancelled during teardown and the avatar would linger for the TTL.
            void fetch(`/api/mindmaps/${mindmapId}/presence`, {
                method: "DELETE",
                keepalive: true,
            }).catch(() => undefined);
        };
        window.addEventListener("pagehide", leave);

        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
            window.removeEventListener("pagehide", leave);
            leave();
        };
    }, [currentRevision, displayName, mindmapId, store]);

    return { ...state, reportCursor, acknowledge };
}

/**
 * Stable colour per collaborator, derived from the user id so the same person
 * is the same colour for everyone looking at the document.
 */
export const PEER_COLORS: readonly string[] = [
    "oklch(0.60 0.20 285)",
    "oklch(0.62 0.16 200)",
    "oklch(0.60 0.16 150)",
    "oklch(0.66 0.16 60)",
    "oklch(0.60 0.20 25)",
    "oklch(0.60 0.20 330)",
];

export function peerColor(userId: string): string {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
    return PEER_COLORS[hash % PEER_COLORS.length]!;
}

export function peerInitials(peer: PresencePeer): string {
    const name = peer.displayName?.trim();
    if (!name) return "?";
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}
