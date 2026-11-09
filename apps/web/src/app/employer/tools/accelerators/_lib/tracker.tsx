"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import {
    acceleratorsApi,
    type TrackerOpportunity,
    type TrackerPriority,
    type UpdateTrackerOpportunity,
} from "../api";

interface TrackerContextValue {
    /** Null until the first load finishes. */
    opportunities: TrackerOpportunity[] | null;
    error: unknown;
    reload: () => Promise<void>;
    track: (programId: string, cycleId?: string | null) => Promise<TrackerOpportunity>;
    update: (id: string, patch: UpdateTrackerOpportunity) => Promise<void>;
    untrack: (id: string) => Promise<void>;
    addTask: (
        id: string,
        input: { title: string; dueOn?: string | null; priority?: TrackerPriority }
    ) => Promise<void>;
    setTaskDone: (id: string, taskId: string, done: boolean) => Promise<void>;
    removeTask: (id: string, taskId: string) => Promise<void>;
}

const Context = createContext<TrackerContextValue | null>(null);

/**
 * The company's saved tracker. Every change goes to the server first and the
 * screen shows the server's answer, so colleagues' edits are never overwritten
 * by a stale local copy.
 */
export function TrackerProvider({ children }: { children: ReactNode }) {
    const [opportunities, setOpportunities] = useState<TrackerOpportunity[] | null>(null);
    const [error, setError] = useState<unknown>(null);

    const replace = useCallback((next: TrackerOpportunity) => {
        setOpportunities(current => {
            const list = current ?? [];
            return list.some(item => item.id === next.id)
                ? list.map(item => (item.id === next.id ? next : item))
                : [...list, next];
        });
    }, []);

    const reload = useCallback(async () => {
        try {
            const { opportunities: incoming } = await acceleratorsApi.tracker.list();
            setOpportunities(incoming);
            setError(null);
        } catch (failure) {
            setError(failure);
        }
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

    const refetch = useCallback(
        async (id: string) => replace((await acceleratorsApi.tracker.get(id)).opportunity),
        [replace]
    );

    const value: TrackerContextValue = {
        opportunities,
        error,
        reload,
        track: async (programId, cycleId) => {
            const { opportunity } = await acceleratorsApi.tracker.save({
                programId,
                ...(cycleId !== undefined ? { cycleId } : {}),
            });
            replace(opportunity);
            return opportunity;
        },
        update: async (id, patch) => {
            replace((await acceleratorsApi.tracker.update(id, patch)).opportunity);
        },
        untrack: async id => {
            await acceleratorsApi.tracker.remove(id);
            setOpportunities(current => current?.filter(item => item.id !== id) ?? null);
        },
        addTask: async (id, input) => {
            await acceleratorsApi.tracker.addTask(id, input);
            await refetch(id);
        },
        setTaskDone: async (id, taskId, done) => {
            await acceleratorsApi.tracker.updateTask(id, taskId, { done });
            await refetch(id);
        },
        removeTask: async (id, taskId) => {
            await acceleratorsApi.tracker.removeTask(id, taskId);
            await refetch(id);
        },
    };

    return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useTracker(): TrackerContextValue {
    const value = useContext(Context);
    if (!value) throw new Error("useTracker requires TrackerProvider");
    return value;
}
