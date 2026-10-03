"use client";

import { createContext, useContext, useMemo, useState } from "react";

import type { ScenarioSummary } from "~/lib/scenarios/types";
import { useResource, type Resource } from "~/lib/tools/useResource";

import { scenariosApi } from "../api";
import { isLive } from "~/lib/scenarios/words";

interface ScenariosContextValue {
    list: Resource<{ runs: ScenarioSummary[] }>;
    /** The newest of my runs still going, for the bar's status. */
    liveRun: ScenarioSummary | null;
    /** Poll the list for a while: a run was just started from this tab. */
    expectLive: () => void;
}

const Ctx = createContext<ScenariosContextValue | null>(null);

/**
 * The run list, loaded once for the tab: the list screen shows it and the
 * bar shows the run in progress from it, on every screen. Polled while any
 * run is queued or running, so both stay live without a second request.
 */
export function ScenariosProvider({ children }: { children: React.ReactNode }) {
    const [expecting, setExpecting] = useState(false);
    const [anyLive, setAnyLive] = useState(false);
    const list = useResource("scenarios:list", () => scenariosApi.list(), {
        pollMs: anyLive || expecting ? 3000 : null,
    });
    const runs = list.data?.runs;
    const live = (runs ?? []).some(r => isLive(r.status));
    if (live !== anyLive) setAnyLive(live);
    if (expecting && live) setExpecting(false);

    const value = useMemo<ScenariosContextValue>(
        () => ({
            list,
            liveRun: (runs ?? []).find(r => r.createdByMe && isLive(r.status)) ?? null,
            expectLive: () => {
                setExpecting(true);
                void list.reload();
            },
        }),
        [list, runs]
    );
    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useScenarios(): ScenariosContextValue {
    const value = useContext(Ctx);
    if (!value)
        throw new Error("useScenarios needs a ScenariosProvider (ScenariosTool mounts one).");
    return value;
}
