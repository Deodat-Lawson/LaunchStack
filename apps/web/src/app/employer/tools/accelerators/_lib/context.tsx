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
    type AcceleratorApplication,
    type AcceleratorRunView,
    type AcceleratorSection,
    type HomeResponse,
} from "../api";

export interface AnswerBuffer {
    value: string;
    baseline: string;
    baseRevision: number;
}

interface AcceleratorsContextValue {
    home: HomeResponse | null;
    loading: boolean;
    error: unknown;
    denied: boolean;
    refresh: () => Promise<void>;
    activeRun: AcceleratorRunView | null;
    runBusy: boolean;
    pollError: unknown;
    resumePolling: () => void;
    match: () => Promise<void>;
    start: (programId: string, cycleId: string) => Promise<AcceleratorApplication>;
    loadApplication: (id: string) => Promise<AcceleratorApplication>;
    buffers: Record<string, AnswerBuffer>;
    changeAnswer: (section: AcceleratorSection, value: string) => void;
    resolveConflict: (section: AcceleratorSection, keepLocal: boolean) => void;
    saveAnswer: (applicationId: string, sectionId: string, buffer: AnswerBuffer) => Promise<void>;
    draftAnswer: (
        applicationId: string,
        sectionId: string,
        expectedRevision: number
    ) => Promise<void>;
}

const Context = createContext<AcceleratorsContextValue | null>(null);

export function runIsLive(run: AcceleratorRunView | null): boolean {
    return run?.status === "queued" || run?.status === "running";
}

function savedBuffer(section: AcceleratorSection): AnswerBuffer {
    return {
        value: section.draft ?? "",
        baseline: section.draft ?? "",
        baseRevision: section.revision,
    };
}

function newerApplication(
    current: AcceleratorApplication | undefined,
    incoming: AcceleratorApplication
): AcceleratorApplication {
    if (!current) return incoming;
    return {
        ...incoming,
        sections: incoming.sections.map(section => {
            const previous = current.sections.find(item => item.id === section.id);
            return previous && previous.revision > section.revision ? previous : section;
        }),
    };
}

/** Saved snapshots and unsaved buffers are separate: a poll must never replace typing. */
export function AcceleratorsProvider({
    children,
    storageScope,
}: {
    children: ReactNode;
    storageScope?: string | null;
}) {
    const t = useTranslations("accelerators.errors");
    const [home, setHome] = useState<HomeResponse | null>(null);
    const homeRef = useRef<HomeResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<unknown>(null);
    const [denied, setDenied] = useState(false);
    const [buffers, setBuffers] = useState<Record<string, AnswerBuffer>>({});
    const [activeRun, setActiveRun] = useState<AcceleratorRunView | null>(null);
    const [restoredRunId, setRestoredRunId] = useState<string | null>(null);
    const [pollError, setPollError] = useState<unknown>(null);
    const [pollNonce, setPollNonce] = useState(0);
    const [startingRun, setStartingRun] = useState(false);
    const startingRunRef = useRef(false);
    const runLiveRef = useRef(false);
    const requestSequence = useRef(0);
    const accessDenied = useRef(false);
    const storageKey = storageScope ? `accelerators.run.v1:${storageScope}` : null;

    const guardError = useCallback((failure: unknown) => {
        if (failure instanceof AcceleratorsApiError && failure.status === 403) {
            accessDenied.current = true;
            requestSequence.current++;
            homeRef.current = null;
            setHome(null);
            setDenied(true);
            setError(failure);
            setActiveRun(null);
            runLiveRef.current = false;
        }
    }, []);

    const syncBuffers = useCallback((applications: AcceleratorApplication[]) => {
        setBuffers(previous => {
            const next = { ...previous };
            for (const application of applications) {
                for (const section of application.sections) {
                    const local = previous[section.id];
                    if (
                        !local ||
                        (local.value === local.baseline && section.revision >= local.baseRevision)
                    ) {
                        next[section.id] = savedBuffer(section);
                    }
                }
            }
            return next;
        });
    }, []);

    const acceptHome = useCallback(
        (incoming: HomeResponse) => {
            const previous = homeRef.current;
            const next = {
                ...incoming,
                applications: [
                    ...incoming.applications.map(application =>
                        newerApplication(
                            previous?.applications.find(item => item.id === application.id),
                            application
                        )
                    ),
                    ...(previous?.applications.filter(
                        application =>
                            !incoming.applications.some(item => item.id === application.id)
                    ) ?? []),
                ],
            };
            homeRef.current = next;
            setHome(next);
            syncBuffers(next.applications);
        },
        [syncBuffers]
    );

    const acceptApplication = useCallback(
        (incoming: AcceleratorApplication) => {
            if (accessDenied.current) return;
            const current = homeRef.current;
            if (!current) return;
            const application = newerApplication(
                current.applications.find(item => item.id === incoming.id),
                incoming
            );
            const found = current.applications.some(item => item.id === application.id);
            const next = {
                ...current,
                applications: found
                    ? current.applications.map(item =>
                          item.id === application.id ? application : item
                      )
                    : [...current.applications, application],
            };
            homeRef.current = next;
            setHome(next);
            syncBuffers([application]);
        },
        [syncBuffers]
    );

    const refresh = useCallback(async () => {
        const sequence = ++requestSequence.current;
        try {
            const incoming = await acceleratorsApi.home();
            if (sequence !== requestSequence.current) return;
            accessDenied.current = false;
            setDenied(false);
            setError(null);
            acceptHome(incoming);
        } catch (failure) {
            if (sequence === requestSequence.current) {
                setError(failure);
                guardError(failure);
            }
            throw failure;
        } finally {
            if (sequence === requestSequence.current || accessDenied.current) setLoading(false);
        }
    }, [acceptHome, guardError]);

    useEffect(() => {
        void refresh().catch(() => undefined);
    }, [refresh]);

    // Recover an existing paid run after a reload, never start one on mount.
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
        if (!runId || !live || denied) return;
        let disposed = false;
        let timer: number;
        const poll = async () => {
            try {
                const { run } = await acceleratorsApi.run(runId);
                if (disposed || accessDenied.current) return;
                if (!runIsLive(run) && storageKey) {
                    try {
                        window.sessionStorage.removeItem(storageKey);
                    } catch {
                        /* Storage is optional. */
                    }
                }
                runLiveRef.current = runIsLive(run);
                setActiveRun(run);
                setPollError(null);
                await refresh();
                if (disposed || accessDenied.current) return;
                if (runIsLive(run))
                    timer = window.setTimeout(() => {
                        void poll();
                    }, 1500);
            } catch (failure) {
                if (disposed) return;
                guardError(failure);
                setPollError(failure);
            }
        };
        timer = window.setTimeout(() => {
            void poll();
        }, 800);
        return () => {
            disposed = true;
            window.clearTimeout(timer);
        };
    }, [runId, live, denied, pollNonce, refresh, guardError, storageKey]);

    const trackRun = useCallback(
        (run: AcceleratorRunView) => {
            if (accessDenied.current) return;
            runLiveRef.current = runIsLive(run);
            setActiveRun(run);
            setPollError(null);
            if (storageKey && runIsLive(run)) {
                try {
                    window.sessionStorage.setItem(storageKey, run.id);
                } catch {
                    /* Storage is optional. */
                }
            }
            if (!runIsLive(run)) void refresh().catch(() => undefined);
        },
        [storageKey, refresh]
    );

    const launchRun = useCallback(
        async (create: () => Promise<{ run: AcceleratorRunView }>) => {
            if (startingRunRef.current || runLiveRef.current) throw new Error(t("runInProgress"));
            startingRunRef.current = true;
            setStartingRun(true);
            try {
                trackRun((await create()).run);
            } catch (failure) {
                guardError(failure);
                throw failure;
            } finally {
                startingRunRef.current = false;
                setStartingRun(false);
            }
        },
        [trackRun, guardError, t]
    );

    const match = useCallback(() => launchRun(acceleratorsApi.match), [launchRun]);

    const start = useCallback(
        async (programId: string, cycleId: string) => {
            try {
                const { application } = await acceleratorsApi.start(programId, cycleId);
                acceptApplication(application);
                return application;
            } catch (failure) {
                guardError(failure);
                throw failure;
            }
        },
        [acceptApplication, guardError]
    );

    const loadApplication = useCallback(
        async (id: string) => {
            try {
                const { application } = await acceleratorsApi.application(id);
                acceptApplication(application);
                return application;
            } catch (failure) {
                guardError(failure);
                throw failure;
            }
        },
        [acceptApplication, guardError]
    );

    const changeAnswer = useCallback((section: AcceleratorSection, value: string) => {
        setBuffers(previous => ({
            ...previous,
            [section.id]: { ...(previous[section.id] ?? savedBuffer(section)), value },
        }));
    }, []);

    const resolveConflict = useCallback((section: AcceleratorSection, keepLocal: boolean) => {
        setBuffers(previous => ({
            ...previous,
            [section.id]: {
                ...savedBuffer(section),
                value: keepLocal
                    ? (previous[section.id]?.value ?? section.draft ?? "")
                    : (section.draft ?? ""),
            },
        }));
    }, []);

    const saveAnswer = useCallback(
        async (applicationId: string, sectionId: string, buffer: AnswerBuffer) => {
            try {
                const { section } = await acceleratorsApi.save(applicationId, sectionId, {
                    expectedRevision: buffer.baseRevision,
                    draft: buffer.value === "" ? null : buffer.value,
                });
                if (accessDenied.current) return;
                // Acknowledging our own save advances the base, but preserves text typed in flight.
                setBuffers(previous => {
                    const local = previous[sectionId];
                    if (!local || local.baseRevision !== buffer.baseRevision) return previous;
                    return {
                        ...previous,
                        [sectionId]: {
                            ...local,
                            baseline: section.draft ?? "",
                            baseRevision: section.revision,
                        },
                    };
                });
                const application = homeRef.current?.applications.find(
                    item => item.id === applicationId
                );
                if (application)
                    acceptApplication({
                        ...application,
                        sections: application.sections.map(item =>
                            item.id === sectionId ? section : item
                        ),
                    });
            } catch (failure) {
                guardError(failure);
                if (failure instanceof AcceleratorsApiError && failure.status === 409) {
                    await loadApplication(applicationId).catch(() => undefined);
                }
                throw failure;
            }
        },
        [acceptApplication, guardError, loadApplication]
    );

    const draftAnswer = useCallback(
        async (applicationId: string, sectionId: string, expectedRevision: number) => {
            try {
                await launchRun(() =>
                    acceleratorsApi.draft(applicationId, sectionId, expectedRevision)
                );
            } catch (failure) {
                if (failure instanceof AcceleratorsApiError && failure.status === 409) {
                    await loadApplication(applicationId).catch(() => undefined);
                }
                throw failure;
            }
        },
        [launchRun, loadApplication]
    );

    const dirty = Object.values(buffers).some(buffer => buffer.value !== buffer.baseline);
    useEffect(() => {
        if (!dirty) return;
        const warn = (event: BeforeUnloadEvent) => {
            event.preventDefault();
        };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [dirty]);

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
                start,
                loadApplication,
                buffers,
                changeAnswer,
                resolveConflict,
                saveAnswer,
                draftAnswer,
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
