import type { ContextMenuEvent } from "./types";

/**
 * Where menu events go when nobody passes the provider a sink of their own.
 *
 * Two destinations, both cheap: a ring buffer on `window` so a developer can
 * read the last few hundred opens and picks from the console, and Vercel Web
 * Analytics when its script is on the page (cloud deployments only — see
 * `CloudAnalytics`). Self-hosted instances therefore record nothing beyond
 * the buffer, which never leaves the tab.
 *
 * The questions this answers: which target kinds are right-clicked at all,
 * which opens end in a pick versus a dismiss, and which action ids earn
 * their place — the prune loop from the design.
 */

const BUFFER_LIMIT = 300;

type RecordedEvent = ContextMenuEvent & { at: number };

declare global {
    interface Window {
        /** The last few hundred context-menu events, newest last. */
        __launchstackContextMenu?: RecordedEvent[];
        /** Vercel Web Analytics' queue, present only when its script loaded. */
        va?: (...args: unknown[]) => void;
    }
}

export function trackContextMenuEvent(event: ContextMenuEvent): void {
    if (typeof window === "undefined") return;
    const buffer = (window.__launchstackContextMenu ??= []);
    buffer.push({ ...event, at: Date.now() });
    if (buffer.length > BUFFER_LIMIT) buffer.splice(0, buffer.length - BUFFER_LIMIT);

    if (typeof window.va === "function") {
        const props: Record<string, string | number> = {
            type: event.type,
            via: event.via,
            kind: event.kind,
        };
        if (event.type === "open") props.items = event.itemCount;
        if (event.type === "pick") props.item = event.itemId;
        window.va("event", { name: "context_menu", data: props });
    }
}

/** The recorded events, for tests and the console. */
export function recordedContextMenuEvents(): readonly RecordedEvent[] {
    if (typeof window === "undefined") return [];
    return window.__launchstackContextMenu ?? [];
}
