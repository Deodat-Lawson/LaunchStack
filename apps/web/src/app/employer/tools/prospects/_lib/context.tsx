"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { prospectsApi, type RunDto, type SegmentSummary } from "../api";
import { useResource } from "./useResource";

export interface ProspectsContextValue {
    /** "/employer/tools/prospects" in the app, "/dev/prospects" in the harness. */
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
    runSheetOpen: boolean;
    openRunSheet: (runId?: string) => void;
    closeRunSheet: () => void;
    startRun: (options?: { sample?: boolean }) => Promise<void>;
    noteRunFinished: () => void;
    /** Remembered per browser: run with sample data instead of live providers. */
    samplePreferred: boolean;
    setSamplePreferred: (value: boolean) => void;
}

const Ctx = createContext<ProspectsContextValue | null>(null);

const SEGMENT_KEY = "prospects:segment";
const SAMPLE_KEY = "prospects:sample";

function readSamplePreference(): boolean {
    try {
        return localStorage.getItem(SAMPLE_KEY) === "1";
    } catch {
        return false;
    }
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

    // Active run: polled while running so the rail indicator and any open
    // sheet stay live. The sheet reads the same object.
    const [activeRunId, setActiveRunId] = useState<string | null>(null);
    const [runSheetOpen, setRunSheetOpen] = useState(false);
    const runRes = useResource(
        activeRunId ? `run:${activeRunId}` : null,
        () => prospectsApi.run(activeRunId!),
        { pollMs: activeRunId ? 1000 : null }
    );
    const activeRun = runRes.data?.run ?? null;

    // Discover a run already in progress when the segment loads (page refresh).
    useEffect(() => {
        if (!segmentId) return;
        let cancelled = false;
        void prospectsApi
            .runs(segmentId)
            .then(({ runs }) => {
                if (cancelled) return;
                const live = runs.find(r => r.status === "running" || r.status === "queued");
                if (live) setActiveRunId(live.id);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [segmentId]);

    const finished =
        activeRun !== null &&
        (activeRun.status === "completed" ||
            activeRun.status === "failed" ||
            activeRun.status === "stopped");
    const reloadSegments = segmentsRes.reload;
    useEffect(() => {
        if (finished) void reloadSegments();
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

    const startRun = useCallback(
        async (options?: { sample?: boolean }) => {
            if (!segmentId) return;
            const sample = options?.sample ?? samplePreferred;
            const { run } = await prospectsApi.startRun(segmentId, sample ? { sample: true } : {});
            setActiveRunId(run.id);
            setRunSheetOpen(true);
        },
        [segmentId, samplePreferred]
    );

    const openRunSheet = useCallback((runId?: string) => {
        if (runId) setActiveRunId(runId);
        setRunSheetOpen(true);
    }, []);
    const closeRunSheet = useCallback(() => setRunSheetOpen(false), []);
    const noteRunFinished = useCallback(() => {
        setActiveRunId(null);
        setRunSheetOpen(false);
    }, []);

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
            activeRun: finished ? activeRun : activeRun,
            runSheetOpen,
            openRunSheet,
            closeRunSheet,
            startRun,
            noteRunFinished,
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
            finished,
            runSheetOpen,
            openRunSheet,
            closeRunSheet,
            startRun,
            noteRunFinished,
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
