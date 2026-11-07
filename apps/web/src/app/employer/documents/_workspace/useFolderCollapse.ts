"use client";

import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";

/**
 * Which Sources folders are collapsed, remembered on this device per member
 * and workspace (the same scope as the pane layout). Folders are open unless
 * stored here, so only collapsed paths are written — a new folder starts open.
 *
 * `scope` is null until member and workspace are known; nothing is read or
 * written before then, so one workspace's folders never land under another's.
 */
const STORAGE_PREFIX = "workspace.railFolders.v1:";

type Collapsed = Record<string, boolean>;

function read(scope: string): Collapsed {
    try {
        const raw = localStorage.getItem(STORAGE_PREFIX + scope);
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return {};
        const out: Collapsed = {};
        for (const path of parsed) if (typeof path === "string") out[path] = true;
        return out;
    } catch {
        // Unreadable storage or a corrupt entry: every folder starts open.
        return {};
    }
}

export function useFolderCollapse(scope: string | null | undefined) {
    const [collapsed, setCollapsedState] = useState<Collapsed>({});
    /** The scope whose saved state has been read — and may now be written. */
    const loaded = useRef<string | null>(null);

    useEffect(() => {
        if (!scope || loaded.current === scope) return;
        loaded.current = scope;
        setCollapsedState(read(scope));
    }, [scope]);

    const setCollapsed = useCallback(
        (update: SetStateAction<Collapsed>) => {
            setCollapsedState(prev => {
                const next = typeof update === "function" ? update(prev) : update;
                if (scope && loaded.current === scope) {
                    try {
                        const paths = Object.keys(next).filter(p => next[p]);
                        if (paths.length) {
                            localStorage.setItem(STORAGE_PREFIX + scope, JSON.stringify(paths));
                        } else {
                            localStorage.removeItem(STORAGE_PREFIX + scope);
                        }
                    } catch {
                        // Quota / private mode — the state just won't be remembered.
                    }
                }
                return next;
            });
        },
        [scope]
    );

    return [collapsed, setCollapsed] as const;
}
