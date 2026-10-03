"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";

import {
    formatToolHref,
    isToolPath,
    parseToolHref,
    toolTabHref,
    toolTargetFromHref,
    type ToolLocation,
} from "~/lib/tool-app/locations";

/**
 * Navigation inside a tool's tab.
 *
 * A tool with screens of its own (Growth, Proposals, Vantage) used to be a
 * route tree with its own layout, so opening it left the workspace. Now it
 * is a tab, and the tab keeps its own little history: a stack of app-relative
 * locations ("/prospects/companies?view=new") with a cursor, walked by the
 * frame's back and forward buttons. The page URL never changes, so the other
 * tabs, the chat and the split stay exactly as they were.
 *
 * Screens do not import `next/navigation` or `next/link`. They use the hooks
 * below, which answer in the same shapes (`useToolRouter().push`,
 * `useToolPathname()`, `useToolSearchParams()`), and `ToolLink`.
 */

/** What the workspace shell hands a tool's tab. Every field is optional so a harness can mount a tool bare. */
export interface ToolHost {
    /**
     * This tab is the focused one. Tabs are hidden, not unmounted, so a
     * screen listening on `window` must check this or its shortcuts fire
     * from whatever tab the person is actually typing in.
     */
    active?: boolean;
    /** Show this location — `?feature=growth&at=…`, a palette row, another tool. A new nonce is a new request. */
    request?: { at: string; nonce: number } | null;
    /**
     * Called once a request has been shown, so the shell can drop it. A tab
     * closed and opened again later then starts where the person left it,
     * not at a request from an hour ago.
     */
    consumeRequest?: (nonce: number) => void;
    /** Remember the last location per member and workspace; null until both are known. */
    storageScope?: string | null;
    /** Open another tool's tab at a location. */
    openTool?: (toolId: string, at: string) => void;
    /** Follow a site href that is not a tool's: a source, `?ask=`, Settings. */
    openHref?: (href: string) => void;
}

interface Entry extends ToolLocation {
    /** Unique per visit, so the frame can put the scroll back where it was. */
    key: number;
}

export interface ToolNavValue {
    toolId: string;
    /** App-relative path of the current screen, e.g. "/prospects/companies". */
    path: string;
    /** "" or "?…". */
    search: string;
    searchParams: URLSearchParams;
    /** Identifies this visit; changes on every navigation, including back. */
    entryKey: number;
    active: boolean;
    canBack: boolean;
    canForward: boolean;
    /**
     * Go to an app-relative href ("/write/12", "?view=new"), another tool's
     * old URL (opens that tool's tab), or any other site href (handed to the
     * workspace).
     */
    navigate: (to: string, options?: { replace?: boolean }) => void;
    back: () => void;
    forward: () => void;
    /** The real URL for `to`: what an `<a href>` shows, a new browser tab opens, and "Copy link" copies. */
    linkFor: (to: string) => string;
    /** Whether `to` stays inside this tool's tab. */
    isInternal: (to: string) => boolean;
    /** Do not remember this visit as the tab's last screen (a not-found page). */
    forgetCurrent: () => void;
}

const ToolNavContext = createContext<ToolNavValue | null>(null);

const STORAGE_PREFIX = "tool.location.v1:";
const MAX_ENTRIES = 50;

let nextEntryKey = 1;

function readSaved(scope: string | null | undefined, toolId: string): string | null {
    if (!scope || typeof window === "undefined") return null;
    try {
        return window.localStorage.getItem(`${STORAGE_PREFIX}${scope}:${toolId}`);
    } catch {
        return null;
    }
}

export function ToolNavProvider({
    toolId,
    roots,
    home = "/",
    host,
    children,
}: {
    toolId: string;
    /** First path segments that are this tool's screens: ["brand", "prospects"]. "/" is always included. */
    roots: readonly string[];
    /** Where "/" lands. Growth has no screen at "/", so it is "/brand". */
    home?: string;
    host?: ToolHost;
    children: ReactNode;
}) {
    const hostRef = useRef(host);
    hostRef.current = host;

    const resolve = useCallback(
        (href: string): ToolLocation => {
            const location = parseToolHref(href);
            return location.path === "/" && home !== "/"
                ? { ...parseToolHref(home), search: location.search }
                : location;
        },
        [home]
    );

    const [history, setHistory] = useState<{ entries: Entry[]; index: number }>(() => {
        const start = host?.request?.at ?? readSaved(host?.storageScope, toolId) ?? home;
        return { entries: [{ ...resolve(start), key: nextEntryKey++ }], index: 0 };
    });
    const current = history.entries[history.index]!;

    /** Set once the person (or a request) has moved; a late-arriving saved location must not undo that. */
    const moved = useRef(Boolean(host?.request));
    const handledNonce = useRef(host?.request?.nonce ?? null);

    const go = useCallback((location: ToolLocation, replace: boolean) => {
        moved.current = true;
        setHistory(prev => {
            const here = prev.entries[prev.index]!;
            if (here.path === location.path && here.search === location.search) return prev;
            const entry: Entry = { ...location, key: nextEntryKey++ };
            if (replace) {
                const entries = prev.entries.slice();
                entries[prev.index] = entry;
                return { entries, index: prev.index };
            }
            const entries = [...prev.entries.slice(0, prev.index + 1), entry].slice(-MAX_ENTRIES);
            return { entries, index: entries.length - 1 };
        });
    }, []);

    const isInternal = useCallback((to: string) => isToolPath(to, roots), [roots]);

    const navigate = useCallback(
        (to: string, options?: { replace?: boolean }) => {
            const replace = options?.replace ?? false;
            if (to.startsWith("?")) {
                go({ path: current.path, search: to === "?" ? "" : to }, replace);
                return;
            }
            if (isToolPath(to, roots)) {
                go(resolve(to), replace);
                return;
            }
            const target = toolTargetFromHref(to);
            if (target?.toolId === toolId) {
                go(resolve(target.at), replace);
                return;
            }
            if (target) {
                const open = hostRef.current?.openTool;
                if (open) open(target.toolId, target.at);
                else window.location.assign(toolTabHref(target.toolId, target.at));
                return;
            }
            const follow = hostRef.current?.openHref;
            if (follow) follow(to);
            else window.location.assign(to);
        },
        [current.path, go, resolve, roots, toolId]
    );

    const linkFor = useCallback(
        (to: string) => {
            if (to.startsWith("?")) return toolTabHref(toolId, `${current.path}${to}`);
            if (isToolPath(to, roots)) return toolTabHref(toolId, formatToolHref(resolve(to)));
            const target = toolTargetFromHref(to);
            return target ? toolTabHref(target.toolId, target.at) : to;
        },
        [current.path, resolve, roots, toolId]
    );

    const back = useCallback(() => {
        moved.current = true;
        setHistory(prev => (prev.index > 0 ? { ...prev, index: prev.index - 1 } : prev));
    }, []);
    const forward = useCallback(() => {
        moved.current = true;
        setHistory(prev =>
            prev.index < prev.entries.length - 1 ? { ...prev, index: prev.index + 1 } : prev
        );
    }, []);

    // A request from outside the tab: the palette, `?at=`, another tool. The
    // one the tab opened with was shown by the initial state; either way the
    // shell is told it can forget it.
    const request = host?.request;
    useEffect(() => {
        if (!request) return;
        if (request.nonce !== handledNonce.current) {
            handledNonce.current = request.nonce;
            go(resolve(request.at), false);
        }
        hostRef.current?.consumeRequest?.(request.nonce);
    }, [request, go, resolve]);

    // The saved location can only be read once the shell knows who and which
    // workspace this is. If that lands after mount and nobody has moved yet,
    // pick up where they left off.
    const scope = host?.storageScope ?? null;
    useEffect(() => {
        if (!scope || moved.current) return;
        const saved = readSaved(scope, toolId);
        if (saved) go(resolve(saved), true);
        moved.current = true;
    }, [scope, toolId, go, resolve]);

    // Visits that must not become the remembered screen. A screen that finds
    // nothing to show (a dead link) says so with `forgetCurrent`: usually from
    // its first render — children's effects run before this provider's, so the
    // write below skips it — and sometimes later, once its data has answered,
    // after the visit was already written. Then the screen remembered before
    // it is put back.
    const unremembered = useRef(new Set<number>());
    const currentKeyRef = useRef(current.key);
    currentKeyRef.current = current.key;
    const currentHrefRef = useRef(formatToolHref(current));
    currentHrefRef.current = formatToolHref(current);
    const written = useRef<{ key: number; previous: string | null } | null>(null);
    const storageKey = scope ? `${STORAGE_PREFIX}${scope}:${toolId}` : null;
    const storageKeyRef = useRef(storageKey);
    storageKeyRef.current = storageKey;
    const forgetCurrent = useCallback(() => {
        const key = currentKeyRef.current;
        unremembered.current.add(key);
        const last = written.current;
        if (!storageKeyRef.current) return;
        if (!last || last.key !== key) {
            // Nothing was written for this visit (the screen said so on its
            // first paint), but the tab was reopened on it: a remembered path
            // that matches no screen any more. Let it go.
            try {
                if (window.localStorage.getItem(storageKeyRef.current) === currentHrefRef.current) {
                    window.localStorage.removeItem(storageKeyRef.current);
                }
            } catch {
                // Storage blocked: nothing to forget.
            }
            return;
        }
        // Reopened on a remembered record that has since gone (deleted on
        // another device): what was remembered before is this same dead
        // path, so forget it outright and let the next visit start at home.
        const previous = last.previous === currentHrefRef.current ? null : last.previous;
        try {
            if (previous === null) window.localStorage.removeItem(storageKeyRef.current);
            else window.localStorage.setItem(storageKeyRef.current, previous);
        } catch {
            // Storage blocked: nothing was remembered to undo.
        }
        written.current = null;
    }, []);

    useEffect(() => {
        if (!storageKey || unremembered.current.has(current.key)) return;
        try {
            const previous = window.localStorage.getItem(storageKey);
            const next = formatToolHref(current);
            window.localStorage.setItem(storageKey, next);
            // What to put back if this visit turns out to be a dead end.
            written.current = {
                key: current.key,
                previous:
                    written.current?.key === current.key ? written.current.previous : previous,
            };
        } catch {
            // Storage full or blocked: the tab still works, it just will not remember.
        }
    }, [storageKey, current]);

    const searchParams = useMemo(() => new URLSearchParams(current.search), [current.search]);
    const active = host?.active ?? true;

    const value = useMemo<ToolNavValue>(
        () => ({
            toolId,
            path: current.path,
            search: current.search,
            searchParams,
            entryKey: current.key,
            active,
            canBack: history.index > 0,
            canForward: history.index < history.entries.length - 1,
            navigate,
            back,
            forward,
            linkFor,
            isInternal,
            forgetCurrent,
        }),
        [
            toolId,
            current,
            searchParams,
            active,
            history.index,
            history.entries.length,
            navigate,
            back,
            forward,
            linkFor,
            isInternal,
            forgetCurrent,
        ]
    );

    return <ToolNavContext.Provider value={value}>{children}</ToolNavContext.Provider>;
}

export function useToolNav(): ToolNavValue {
    const value = useContext(ToolNavContext);
    if (!value) {
        throw new Error(
            "useToolNav needs a ToolNavProvider: tool screens render inside their tool's tab (see components/tool-app/README.md)."
        );
    }
    return value;
}

/** `useToolNav` for components that can also render outside a tool. */
export function useOptionalToolNav(): ToolNavValue | null {
    return useContext(ToolNavContext);
}

/** The `next/navigation` router's shape, inside a tool's tab. */
export function useToolRouter(): {
    push: (href: string) => void;
    replace: (href: string) => void;
    back: () => void;
    forward: () => void;
} {
    const { navigate, back, forward } = useToolNav();
    return useMemo(
        () => ({
            push: (href: string) => navigate(href),
            replace: (href: string) => navigate(href, { replace: true }),
            back,
            forward,
        }),
        [navigate, back, forward]
    );
}

/** The current screen's app-relative path. */
export function useToolPathname(): string {
    return useToolNav().path;
}

/** The current screen's query. Read-only by convention, as Next's is. */
export function useToolSearchParams(): URLSearchParams {
    return useToolNav().searchParams;
}

/** True while this tool's tab is the focused one. Gate `window` key listeners on it. */
export function useToolActive(): boolean {
    return useOptionalToolNav()?.active ?? true;
}
