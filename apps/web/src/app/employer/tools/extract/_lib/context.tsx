"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { useToolActive } from "~/components/tool-app/nav";
import type { ExtractionTableSummary } from "~/lib/extraction/types";
import { useResource, type Resource } from "~/lib/tools/useResource";

import { extractApi } from "../api";
import { isLive } from "./cells";

interface ExtractContextValue {
    list: Resource<{ tables: ExtractionTableSummary[] }>;
    /** The newest of my tables still being read, for the bar's status. */
    liveTable: ExtractionTableSummary | null;
    /** Poll the list for a while: a table was just started from this tab. */
    expectLive: () => void;
}

const Ctx = createContext<ExtractContextValue | null>(null);

/**
 * The table list, loaded once for the tab: the list screen shows it and the
 * bar shows the table in progress from it, on every screen. Polled while
 * any table is queued or running and the tab is the one in front — a hidden
 * tab stays mounted, and has no reason to keep asking.
 */
export function ExtractProvider({ children }: { children: React.ReactNode }) {
    const active = useToolActive();
    const [expecting, setExpecting] = useState(false);
    const [anyLive, setAnyLive] = useState(false);
    const list = useResource("extract:list", () => extractApi.list(), {
        pollMs: active && (anyLive || expecting) ? 3000 : null,
    });
    const tables = list.data?.tables;
    const live = (tables ?? []).some(t => isLive(t.status));
    if (live !== anyLive) setAnyLive(live);
    if (expecting && live) setExpecting(false);

    // Back in front with something that was running: catch up at once.
    const reload = list.reload;
    useEffect(() => {
        if (active && anyLive) void reload();
        // Only the tab coming back matters here, not each change of `anyLive`.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, reload]);

    const value = useMemo<ExtractContextValue>(
        () => ({
            list,
            liveTable: (tables ?? []).find(t => t.mine && isLive(t.status)) ?? null,
            expectLive: () => {
                setExpecting(true);
                void list.reload();
            },
        }),
        [list, tables]
    );
    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useExtract(): ExtractContextValue {
    const value = useContext(Ctx);
    if (!value) throw new Error("useExtract needs an ExtractProvider (ExtractTool mounts one).");
    return value;
}
