"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
    WeeklyReviewContextDto,
    WeeklyReviewDto,
    WeeklyReviewListDto,
    WeeklyReviewRoleDto,
    WeeklyReviewStage,
} from "~/server/vantage/weekly-review-client-types";
import { weeklyReviewApi } from "../api";
import { weeklyReviewErrorCode } from "./weekly-review-errors";

export type ReviewGeneration = {
    running: boolean;
    stage: WeeklyReviewStage | null;
    failedStage: WeeklyReviewStage | null;
    error: string | null;
    startedAt: number | null;
    complete: boolean;
    visitedStages: WeeklyReviewStage[];
};

const idleGeneration = (): ReviewGeneration => ({
    running: false,
    stage: null,
    failedStage: null,
    error: null,
    startedAt: null,
    complete: false,
    visitedStages: [],
});

type ReviewState = {
    enabled: boolean | null;
    review: WeeklyReviewDto | null;
    runs: WeeklyReviewListDto["runs"];
    activeId: string | null;
    loadedWeek: string | null;
    loading: boolean;
    loadError: string | null;
};
type ContextState = {
    context: WeeklyReviewContextDto | null;
    roleContext: WeeklyReviewRoleDto | null;
    loading: boolean;
    error: string | null;
};

/** Report identity, current access and setup load independently. Mutations never
 * replace a visible report until the server has returned an accepted result. */
export function useWeeklyReviewData(
    week: string,
    { includeReport = true }: { includeReport?: boolean } = {}
) {
    const [reportState, setReportState] = useState<ReviewState>({
        enabled: null,
        review: null,
        runs: [],
        activeId: null,
        loadedWeek: null,
        loading: includeReport,
        loadError: null,
    });
    const [contextState, setContextState] = useState<ContextState>({
        context: null,
        roleContext: null,
        loading: true,
        error: null,
    });
    const [generation, setGeneration] = useState<ReviewGeneration>(idleGeneration);
    const reportRequest = useRef(0);
    const contextRequest = useRef(0);
    const operation = useRef(0);
    const mounted = useRef(false);
    const generating = useRef<number | null>(null);
    const invalidateRequests = useCallback(() => {
        ++reportRequest.current;
        ++contextRequest.current;
        ++operation.current;
    }, []);

    const reloadContext = useCallback(async () => {
        const token = ++contextRequest.current;
        const current = () => mounted.current && token === contextRequest.current;
        setContextState(previous => ({ ...previous, loading: true, error: null }));
        try {
            const [context, roleContext] = await Promise.all([
                weeklyReviewApi.context(),
                weeklyReviewApi.role(),
            ]);
            if (current()) setContextState({ context, roleContext, loading: false, error: null });
        } catch (error) {
            if (current())
                setContextState(previous => ({
                    ...previous,
                    loading: false,
                    error: weeklyReviewErrorCode(error),
                }));
        }
    }, []);

    const loadReport = useCallback(
        async (id?: string, clear = false) => {
            if (!includeReport) return;
            const token = ++reportRequest.current;
            const current = () => mounted.current && token === reportRequest.current;
            setReportState(previous => ({
                ...previous,
                ...(clear ? { review: null, runs: [], activeId: null, loadedWeek: null } : {}),
                loading: true,
                loadError: null,
            }));
            try {
                const list = await weeklyReviewApi.list(week);
                if (!current()) return;
                const runs = list.runs.filter(run => String(run.week_start).slice(0, 10) === week);
                setReportState(previous => ({
                    ...previous,
                    enabled: list.enabled,
                    activeId: list.activeId,
                    runs,
                    loadedWeek: week,
                }));
                const chosen =
                    id ?? list.activeId ?? runs.find(run => run.status === "accepted")?.id;
                const review = chosen ? await weeklyReviewApi.get(chosen) : null;
                if (current()) setReportState(previous => ({ ...previous, review }));
            } catch (error) {
                if (current())
                    setReportState(previous => ({
                        ...previous,
                        loadError: weeklyReviewErrorCode(error),
                    }));
            } finally {
                if (current()) setReportState(previous => ({ ...previous, loading: false }));
            }
        },
        [includeReport, week]
    );

    useEffect(() => {
        mounted.current = true;
        ++operation.current;
        generating.current = null;
        setGeneration(idleGeneration());
        void reloadContext();
        void loadReport(undefined, true);
        return () => {
            mounted.current = false;
            invalidateRequests();
        };
    }, [loadReport, reloadContext, invalidateRequests]);

    const selectReport = useCallback(
        async (id: string) => {
            ++operation.current;
            await loadReport(id);
        },
        [loadReport]
    );

    const reload = useCallback(async () => {
        await Promise.all([loadReport(reportState.review?.id), reloadContext()]);
    }, [loadReport, reloadContext, reportState.review?.id]);

    const generate = useCallback(async () => {
        if (
            generating.current !== null ||
            !includeReport ||
            reportState.loading ||
            reportState.loadedWeek !== week ||
            reportState.enabled !== true
        )
            return;
        const token = ++operation.current;
        const requestToken = reportRequest.current;
        const current = () =>
            mounted.current &&
            token === operation.current &&
            requestToken === reportRequest.current;
        generating.current = token;
        let observed: WeeklyReviewStage | null = null;
        setGeneration({ ...idleGeneration(), running: true, startedAt: Date.now() });
        try {
            const saved = await weeklyReviewApi.generate(
                { weekStart: week, expectedActiveId: reportState.activeId },
                stage => {
                    if (!current()) return;
                    observed = stage;
                    setGeneration(previous => ({
                        ...previous,
                        stage,
                        visitedStages: previous.visitedStages.includes(stage)
                            ? previous.visitedStages
                            : [...previous.visitedStages, stage],
                    }));
                }
            );
            if (!current()) return;
            setReportState(previous => ({
                ...previous,
                review: saved,
                activeId: saved.id,
                loadError: null,
            }));
            setGeneration(previous => ({ ...previous, running: false, complete: true }));
            // A history refresh is independent of the accepted result already shown.
            try {
                const list = await weeklyReviewApi.list(week);
                if (current())
                    setReportState(previous => ({
                        ...previous,
                        activeId: list.activeId,
                        runs: list.runs.filter(run => String(run.week_start).slice(0, 10) === week),
                    }));
            } catch {
                // The accepted report remains available even if the history list is temporarily unavailable.
            }
        } catch (error) {
            if (current())
                setGeneration(previous => ({
                    ...previous,
                    running: false,
                    failedStage: observed,
                    error: weeklyReviewErrorCode(error),
                }));
        } finally {
            if (generating.current === token) generating.current = null;
        }
    }, [
        includeReport,
        reportState.activeId,
        reportState.enabled,
        reportState.loadedWeek,
        reportState.loading,
        week,
    ]);

    const recordDecision = useCallback(
        async (topicId: string, decision: string) => {
            const review = reportState.review;
            if (!review || generating.current !== null || reportState.loadedWeek !== week)
                return false;
            const token = operation.current;
            const requestToken = reportRequest.current;
            const current = () =>
                mounted.current &&
                token === operation.current &&
                requestToken === reportRequest.current;
            await weeklyReviewApi.decide(review.id, {
                expectedVersion: review.version,
                topicId,
                decision,
            });
            if (!current()) return false;
            const saved = await weeklyReviewApi.get(review.id);
            if (!current()) return false;
            setReportState(previous => ({ ...previous, review: saved }));
            return true;
        },
        [reportState.review, reportState.loadedWeek, week]
    );

    return {
        enabled: includeReport ? reportState.enabled : (contextState.context?.enabled ?? null),
        loading: includeReport ? reportState.loading : contextState.loading,
        contextLoading: contextState.loading,
        ready: includeReport
            ? !reportState.loading && reportState.loadedWeek === week
            : !contextState.loading && contextState.context !== null,
        review: reportState.loadedWeek === week ? reportState.review : null,
        runs: reportState.loadedWeek === week ? reportState.runs : [],
        activeId: reportState.loadedWeek === week ? reportState.activeId : null,
        context: contextState.context,
        roleContext: contextState.roleContext,
        loadError: reportState.loadError,
        contextError: contextState.error,
        generation,
        reload,
        reloadContext,
        selectReport,
        generate,
        recordDecision,
    };
}
