"use client";

import { useTranslations } from "next-intl";
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
    type ReactNode,
} from "react";

import {
    AcceleratorsApiError,
    acceleratorsApi,
    type AcceleratorRunView,
    type AcceleratorsHome,
} from "../api";

interface AcceleratorsContextValue {
    home: AcceleratorsHome | null;
    loading: boolean;
    error: unknown;
    denied: boolean;
    refresh: () => Promise<void>;
    activeRun: AcceleratorRunView | null;
    runBusy: boolean;
    pollError: unknown;
    resumePolling: () => void;
    /** Starts scoring these Programs; the server skips current results unless `rescore`. */
    match: (programIds: string[], rescore: boolean) => Promise<void>;
}

const Context = createContext<AcceleratorsContextValue | null>(null);

export function runIsLive(run: AcceleratorRunView | null): boolean {
    return run?.status === "queued" || run?.status === "running";
}

export function AcceleratorsProvider({
    children,
    storageScope,
}: {
    children: ReactNode;
    storageScope?: string | null;
}) {
    const t = useTranslations("accelerators.errors");
    const [home, setHome] = useState<AcceleratorsHome | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<unknown>(null);
    const [denied, setDenied] = useState(false);
    const [activeRun, setActiveRun] = useState<AcceleratorRunView | null>(null);
    const [restoredRunId, setRestoredRunId] = useState<string | null>(null);
    const [pollError, setPollError] = useState<unknown>(null);
    const [pollNonce, setPollNonce] = useState(0);
    const [startingRun, setStartingRun] = useState(false);
    const startingRunRef = useRef(false);
    const runLiveRef = useRef(false);
    const requestSequence = useRef(0);
    const accessDenied = useRef(false);
    const storageKey = storageScope ? `accelerators.match.v1:${storageScope}` : null;

    const clearStoredRun = useCallback(() => {
        if (!storageKey) return;
        try {
            window.sessionStorage.removeItem(storageKey);
        } catch {
            return;
        }
    }, [storageKey]);

    const guardError = useCallback(
        (failure: unknown) => {
            if (failure instanceof AcceleratorsApiError && failure.status === 403) {
                accessDenied.current = true;
                requestSequence.current++;
                setHome(null);
                setDenied(true);
                setError(failure);
                setActiveRun(null);
                setRestoredRunId(null);
                runLiveRef.current = false;
                clearStoredRun();
            }
        },
        [clearStoredRun]
    );

    const refresh = useCallback(async () => {
        const sequence = ++requestSequence.current;
        try {
            const incoming = await acceleratorsApi.home();
            if (sequence !== requestSequence.current) return;
            accessDenied.current = false;
            setDenied(false);
            setError(null);
            setHome(incoming);
        } catch (failure) {
            if (sequence === requestSequence.current) {
                setError(failure);
                guardError(failure);
            }
            throw failure;
        } finally {
            if (sequence === requestSequence.current || accessDenied.current) setLoading(false);
        }
    }, [guardError]);

    useEffect(() => {
        void refresh().catch(() => undefined);
    }, [refresh]);

    // Recover matching progress after a reload, never start paid work on mount.
    useEffect(() => {
        if (!storageKey) return;
        try {
            const id = window.sessionStorage.getItem(storageKey);
            setRestoredRunId(id);
            if (id) runLiveRef.current = true;
        } catch {
            /* Storage is optional. */
        }
    }, [storageKey]);

    const runId = activeRun?.id ?? restoredRunId;
    const live = activeRun ? runIsLive(activeRun) : restoredRunId !== null;
    useEffect(() => {
        if (!runId || denied) return;
        let disposed = false;
        let timer: number;
        const poll = async () => {
            try {
                const { run } = await acceleratorsApi.run(runId);
                if (disposed || accessDenied.current) return;
                if (!runIsLive(run)) clearStoredRun();
                runLiveRef.current = runIsLive(run);
                setActiveRun(run);
                setRestoredRunId(null);
                setPollError(null);
                // The run-status poll is light; the home (every Program and fit) reloads
                // once, when the run settles.
                if (!runIsLive(run)) await refresh();
                if (disposed || accessDenied.current) return;
                if (runIsLive(run))
                    timer = window.setTimeout(() => {
                        void poll();
                    }, 1500);
            } catch (failure) {
                if (disposed) return;
                guardError(failure);
                if (failure instanceof AcceleratorsApiError && failure.status === 404) {
                    clearStoredRun();
                    setActiveRun(null);
                    setRestoredRunId(null);
                    runLiveRef.current = false;
                    setPollError(null);
                    setError(failure);
                } else {
                    setPollError(failure);
                }
            }
        };
        timer = window.setTimeout(() => {
            void poll();
        }, 800);
        return () => {
            disposed = true;
            window.clearTimeout(timer);
        };
    }, [runId, denied, pollNonce, refresh, guardError, clearStoredRun]);

    const match = useCallback(
        async (programIds: string[], rescore: boolean) => {
            if (startingRunRef.current || runLiveRef.current) throw new Error(t("runInProgress"));
            startingRunRef.current = true;
            setStartingRun(true);
            try {
                const { run } = await acceleratorsApi.match(programIds, rescore);
                if (accessDenied.current) return;
                runLiveRef.current = runIsLive(run);
                setActiveRun(run);
                setRestoredRunId(null);
                setPollError(null);
                if (storageKey && runIsLive(run)) {
                    try {
                        window.sessionStorage.setItem(storageKey, run.id);
                    } catch {
                        /* Storage is optional. */
                    }
                }
                if (!runIsLive(run)) {
                    clearStoredRun();
                    void refresh().catch(() => undefined);
                }
            } catch (failure) {
                guardError(failure);
                throw failure;
            } finally {
                startingRunRef.current = false;
                setStartingRun(false);
            }
        },
        [storageKey, clearStoredRun, refresh, guardError, t]
    );

    return (
        <Context.Provider
            value={{
                home,
                loading,
                error,
                denied,
                refresh,
                activeRun,
                pollError,
                runBusy: startingRun || live,
                resumePolling: () => setPollNonce(value => value + 1),
                match,
            }}
        >
            {children}
        </Context.Provider>
    );
}

export function useAccelerators(): AcceleratorsContextValue {
    const value = useContext(Context);
    if (!value) throw new Error("useAccelerators requires AcceleratorsProvider");
    return value;
}
