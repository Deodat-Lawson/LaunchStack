"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { prospectsApi, type NextRunMode, type RunDto, type SegmentSummary } from "../api";
import { useResource } from "~/lib/tools/useResource";

export type ProspectsPanel = "runs" | "segment";

export interface ProspectsContextValue {
    /** "/employer/tools/growth/prospects" in the app, "/dev/growth/prospects" in the harness. */
    basePath: string;
    href: (path?: string) => string;
    segments: SegmentSummary[];
    segmentsLoading: boolean;
    segmentId: string | null;
    segment: SegmentSummary | null;
    setSegmentId: (id: string) => void;
    reloadSegments: () => Promise<void>;
    /** The run currently in progress for this segment, if any. */
    activeRun: RunDto | null;
    /** What "Find companies" will do next in this environment. */
    nextMode: NextRunMode | null;
    /** Bumps when a run finishes, so lists that show its results can reload. */
    runsVersion: number;
    panel: ProspectsPanel | null;
    openPanel: (panel: ProspectsPanel) => void;
    closePanel: () => void;
    startRun: (options?: { sample?: boolean }) => Promise<void>;
    stopRun: () => Promise<void>;
    /** Remembered per browser: run with sample data instead of live providers. */
    samplePreferred: boolean;
    setSamplePreferred: (value: boolean) => void;
}

const Ctx = createContext<ProspectsContextValue | null>(null);

const SEGMENT_KEY = "prospects:segment";
const SAMPLE_KEY = "prospects:sample";
/** How often a live run is re-read. The worker writes counters, so a few seconds is plenty. */
const RUN_POLL_MS = 3000;

function readSamplePreference(): boolean {
    try {
        return localStorage.getItem(SAMPLE_KEY) === "1";
    } catch {
        return false;
    }
}

export function isRunLive(run: RunDto | null): boolean {
    return run !== null && (run.status === "running" || run.status === "queued");
}

export function ProspectsProvider({
    basePath,
    children,
}: {
    basePath: string;
    children: React.ReactNode;
}) {
    const segmentsRes = useResource("segments", () => prospectsApi.segments());
    const segments = useMemo(() => segmentsRes.data?.segments ?? [], [segmentsRes.data]);

    const [segmentId, setSegmentIdState] = useState<string | null>(null);
    useEffect(() => {
        if (segments.length === 0) return;
        let remembered: string | null = null;
        try {
            remembered = localStorage.getItem(SEGMENT_KEY);
        } catch {
            remembered = null;
        }
        setSegmentIdState(current => {
            if (current && segments.some(s => s.id === current)) return current;
            if (remembered && segments.some(s => s.id === remembered)) return remembered;
            return segments[0]!.id;
        });
    }, [segments]);

    const setSegmentId = useCallback((id: string) => {
        setSegmentIdState(id);
        try {
            localStorage.setItem(SEGMENT_KEY, id);
        } catch {
            /* fine */
        }
    }, []);

    const segment = segments.find(s => s.id === segmentId) ?? null;

    // The run in flight, re-read on a slow poll while it is live. The panel
    // and the header pill read the same object.
    const [activeRunId, setActiveRunId] = useState<string | null>(null);
    const [nextMode, setNextMode] = useState<NextRunMode | null>(null);
    const runRes = useResource(
        activeRunId ? `run:${activeRunId}` : null,
        () => prospectsApi.run(activeRunId!),
        { pollMs: activeRunId ? RUN_POLL_MS : null }
    );
    const activeRun = runRes.data?.run ?? null;

    // Discover a run already in progress when the segment loads (page refresh).
    useEffect(() => {
        if (!segmentId) return;
        let cancelled = false;
        void prospectsApi
            .runs(segmentId)
            .then(({ active, nextMode: mode }) => {
                if (cancelled) return;
                if (mode) setNextMode(mode);
                setActiveRunId(active ? active.id : null);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [segmentId]);

    const finished = activeRun !== null && !isRunLive(activeRun);
    const [runsVersion, setRunsVersion] = useState(0);
    const reloadSegments = segmentsRes.reload;
    useEffect(() => {
        if (!finished) return;
        setRunsVersion(v => v + 1);
        void reloadSegments();
    }, [finished, reloadSegments]);

    const [samplePreferred, setSamplePreferredState] = useState(false);
    useEffect(() => setSamplePreferredState(readSamplePreference()), []);
    const setSamplePreferred = useCallback((value: boolean) => {
        setSamplePreferredState(value);
        try {
            localStorage.setItem(SAMPLE_KEY, value ? "1" : "0");
        } catch {
            /* fine */
        }
    }, []);

    const [panel, setPanel] = useState<ProspectsPanel | null>(null);
    const openPanel = useCallback((next: ProspectsPanel) => setPanel(next), []);
    const closePanel = useCallback(() => setPanel(null), []);

    const startRun = useCallback(
        async (options?: { sample?: boolean }) => {
            if (!segmentId) return;
            const sample = options?.sample ?? samplePreferred;
            const { run } = await prospectsApi.startRun(segmentId, sample ? { sample: true } : {});
            setActiveRunId(run.id);
            if (!isRunLive(run)) setRunsVersion(v => v + 1);
            setPanel("runs");
        },
        [segmentId, samplePreferred]
    );

    const stopRun = useCallback(async () => {
        if (!activeRunId) return;
        await prospectsApi.stopRun(activeRunId);
        await runRes.reload();
    }, [activeRunId, runRes]);

    const value = useMemo<ProspectsContextValue>(
        () => ({
            basePath,
            href: (path = "") => `${basePath}${path}`,
            segments,
            segmentsLoading: segmentsRes.loading,
            segmentId,
            segment,
            setSegmentId,
            reloadSegments,
            activeRun,
            nextMode,
            runsVersion,
            panel,
            openPanel,
            closePanel,
            startRun,
            stopRun,
            samplePreferred,
            setSamplePreferred,
        }),
        [
            basePath,
            segments,
            segmentsRes.loading,
            segmentId,
            segment,
            setSegmentId,
            reloadSegments,
            activeRun,
            nextMode,
            runsVersion,
            panel,
            openPanel,
            closePanel,
            startRun,
            stopRun,
            samplePreferred,
            setSamplePreferred,
        ]
    );

    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProspects(): ProspectsContextValue {
    const value = useContext(Ctx);
    if (!value) throw new Error("useProspects must be used inside ProspectsProvider");
    return value;
}
