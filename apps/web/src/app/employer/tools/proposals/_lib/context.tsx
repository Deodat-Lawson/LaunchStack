"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { useResource } from "~/lib/tools/useResource";
import { proposalsApi, type CountsDto, type RunDto } from "../api";

export interface ProposalsContextValue {
    /** "/employer/tools/proposals" in the app, "/dev/proposals" in the harness. */
    basePath: string;
    href: (path?: string) => string;
    counts: CountsDto | null;
    reloadCounts: () => Promise<void>;
    /** The run being watched: polled while live, kept until the next one starts. */
    activeRun: RunDto | null;
    runSheetOpen: boolean;
    /** Watch a run the caller just started; opens the sheet. */
    trackRun: (run: RunDto, options?: { openSheet?: boolean }) => void;
    openRunSheet: (runId?: string) => void;
    closeRunSheet: () => void;
    /** Increments each time a watched run finishes; screens reload on it. */
    finishedTick: number;
}

const Ctx = createContext<ProposalsContextValue | null>(null);

export function runIsLive(run: RunDto | null): boolean {
    return run !== null && (run.status === "queued" || run.status === "running");
}

export function ProposalsProvider({
    basePath,
    children,
}: {
    basePath: string;
    children: React.ReactNode;
}) {
    const countsRes = useResource("proposals:counts", () => proposalsApi.counts());
    const [activeRunId, setActiveRunId] = useState<string | null>(null);
    const [runSheetOpen, setRunSheetOpen] = useState(false);
    const [finishedTick, setFinishedTick] = useState(0);
    const [seed, setSeed] = useState<RunDto | null>(null);

    const runRes = useResource(
        activeRunId ? `proposals:run:${activeRunId}` : null,
        () => proposalsApi.run(activeRunId!),
        { pollMs: activeRunId ? 1500 : null }
    );
    // The row the caller handed over answers until the first poll lands.
    const activeRun = runRes.data?.run ?? (seed?.id === activeRunId ? seed : null);
    const live = runIsLive(activeRun);

    // Discover a run already in progress on arrival (page refresh).
    useEffect(() => {
        let cancelled = false;
        void proposalsApi
            .runs()
            .then(({ runs }) => {
                if (cancelled) return;
                const inProgress = runs.find(r => r.status === "running" || r.status === "queued");
                if (inProgress) setActiveRunId(current => current ?? inProgress.id);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, []);

    // Stop polling and tell the screens once the watched run settles.
    const reloadCounts = countsRes.reload;
    const [settledId, setSettledId] = useState<string | null>(null);
    useEffect(() => {
        if (!activeRun || live || settledId === activeRun.id) return;
        setSettledId(activeRun.id);
        setFinishedTick(t => t + 1);
        void reloadCounts();
    }, [activeRun, live, settledId, reloadCounts]);

    const trackRun = useCallback((run: RunDto, options?: { openSheet?: boolean }) => {
        setSeed(run);
        setActiveRunId(run.id);
        if (options?.openSheet !== false) setRunSheetOpen(true);
    }, []);
    const openRunSheet = useCallback((runId?: string) => {
        if (runId) setActiveRunId(runId);
        setRunSheetOpen(true);
    }, []);
    const closeRunSheet = useCallback(() => setRunSheetOpen(false), []);

    const value = useMemo<ProposalsContextValue>(
        () => ({
            basePath,
            href: (path = "") => `${basePath}${path}`,
            counts: countsRes.data,
            reloadCounts,
            activeRun,
            runSheetOpen,
            trackRun,
            openRunSheet,
            closeRunSheet,
            finishedTick,
        }),
        [
            basePath,
            countsRes.data,
            reloadCounts,
            activeRun,
            runSheetOpen,
            trackRun,
            openRunSheet,
            closeRunSheet,
            finishedTick,
        ]
    );

    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProposals(): ProposalsContextValue {
    const value = useContext(Ctx);
    if (!value) throw new Error("useProposals must be used inside ProposalsProvider");
    return value;
}
