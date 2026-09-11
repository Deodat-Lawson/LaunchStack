"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
    api,
    ApiError,
    type DashboardDto,
    type PartnerDetailDto,
    type PartnerItemDto,
    type ProgramDto,
    type RunDto,
} from "./api";

export interface PartnerFilters {
    stage: string;
    kind: string;
    minFit: string;
    staleOnly: boolean;
    search: string;
    order: "fit" | "activity" | "stage" | "created";
}

const DEFAULT_FILTERS: PartnerFilters = {
    stage: "",
    kind: "",
    minFit: "",
    staleOnly: false,
    search: "",
    order: "fit",
};
const ACTIVE_RUN = new Set([
    "queued",
    "profiling",
    "planning",
    "gathering",
    "resolving",
    "enriching",
    "screening",
    "scoring",
    "reporting",
]);

function message(error: unknown): string {
    if (error instanceof ApiError) return error.message;
    return error instanceof Error ? error.message : "Something went wrong";
}

export function useDistribution() {
    const [programs, setPrograms] = useState<ProgramDto[]>([]);
    const [programId, setProgramId] = useState<string | null>(null);
    const [dashboard, setDashboard] = useState<DashboardDto | null>(null);
    const [runs, setRuns] = useState<RunDto[]>([]);
    const [partners, setPartners] = useState<PartnerItemDto[]>([]);
    const [filters, setFilters] = useState<PartnerFilters>(DEFAULT_FILTERS);
    const [detail, setDetail] = useState<PartnerDetailDto | null>(null);
    const [detailId, setDetailId] = useState<string | null>(null);
    const [loading, setLoading] = useState({
        programs: true,
        dashboard: false,
        partners: false,
        runs: false,
        detail: false,
    });
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const program = useMemo(
        () => programs.find(p => p.id === programId) ?? null,
        [programs, programId]
    );

    const loadPrograms = useCallback(async () => {
        setLoading(l => ({ ...l, programs: true }));
        try {
            const { programs: list } = await api.listPrograms();
            setPrograms(list);
            setProgramId(current =>
                current && list.some(p => p.id === current) ? current : (list[0]?.id ?? null)
            );
        } catch (e) {
            setError(message(e));
        } finally {
            setLoading(l => ({ ...l, programs: false }));
        }
    }, []);

    const loadDashboard = useCallback(async (id: string) => {
        setLoading(l => ({ ...l, dashboard: true }));
        try {
            setDashboard((await api.dashboard(id)).dashboard);
        } catch (e) {
            setError(message(e));
        } finally {
            setLoading(l => ({ ...l, dashboard: false }));
        }
    }, []);

    const loadRuns = useCallback(async (id: string) => {
        setLoading(l => ({ ...l, runs: true }));
        try {
            setRuns((await api.listRuns(id)).runs);
        } catch (e) {
            setError(message(e));
        } finally {
            setLoading(l => ({ ...l, runs: false }));
        }
    }, []);

    const loadPartners = useCallback(async (id: string, f: PartnerFilters) => {
        setLoading(l => ({ ...l, partners: true }));
        try {
            const params = new URLSearchParams({ programId: id, limit: "200", order: f.order });
            if (f.stage) params.set("stage", f.stage);
            if (f.kind) params.set("kind", f.kind);
            if (f.minFit) params.set("minFit", f.minFit);
            if (f.staleOnly) params.set("stale", "1");
            if (f.search) params.set("q", f.search);
            setPartners((await api.listPartners(params)).partners);
        } catch (e) {
            setError(message(e));
        } finally {
            setLoading(l => ({ ...l, partners: false }));
        }
    }, []);

    const refreshAll = useCallback(async () => {
        if (!programId) return;
        await Promise.all([
            loadDashboard(programId),
            loadRuns(programId),
            loadPartners(programId, filters),
        ]);
    }, [programId, filters, loadDashboard, loadRuns, loadPartners]);

    useEffect(() => {
        void loadPrograms();
    }, [loadPrograms]);

    useEffect(() => {
        if (!programId) {
            setDashboard(null);
            setRuns([]);
            setPartners([]);
            return;
        }
        void loadDashboard(programId);
        void loadRuns(programId);
    }, [programId, loadDashboard, loadRuns]);

    useEffect(() => {
        if (programId) void loadPartners(programId, filters);
    }, [programId, filters, loadPartners]);

    // Poll while a run is active so the Runs tab and partner list move on their own.
    useEffect(() => {
        const active = runs.some(r => ACTIVE_RUN.has(r.status));
        if (pollRef.current) clearInterval(pollRef.current);
        if (!active || !programId) return;
        pollRef.current = setInterval(() => {
            void loadRuns(programId);
            void loadPartners(programId, filters);
            void loadDashboard(programId);
        }, 5000);
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [runs, programId, filters, loadRuns, loadPartners, loadDashboard]);

    const openPartner = useCallback(async (id: string | null) => {
        setDetailId(id);
        if (!id) {
            setDetail(null);
            return;
        }
        setLoading(l => ({ ...l, detail: true }));
        try {
            setDetail(await api.partner(id));
        } catch (e) {
            setError(message(e));
        } finally {
            setLoading(l => ({ ...l, detail: false }));
        }
    }, []);

    const afterMutation = useCallback(async () => {
        if (detailId) await openPartner(detailId);
        await refreshAll();
    }, [detailId, openPartner, refreshAll]);

    const act = useCallback(
        async (fn: () => Promise<unknown>, success?: string) => {
            setError(null);
            try {
                await fn();
                if (success) setNotice(success);
                await afterMutation();
                return true;
            } catch (e) {
                setError(message(e));
                return false;
            }
        },
        [afterMutation]
    );

    return {
        programs,
        program,
        programId,
        setProgramId,
        dashboard,
        runs,
        partners,
        filters,
        setFilters,
        detail,
        detailId,
        openPartner,
        loading,
        error,
        setError,
        notice,
        setNotice,
        refreshAll,
        loadPrograms,
        createProgram: (input: unknown) =>
            act(async () => {
                const { program: created } = await api.createProgram(input);
                await loadPrograms();
                setProgramId(created.id);
            }, "Program created"),
        updateProgram: (id: string, patch: unknown) =>
            act(async () => {
                await api.updateProgram(id, patch);
                await loadPrograms();
            }, "Program saved"),
        startRun: (maxCandidates: number) =>
            programId
                ? act(() => api.startRun(programId, maxCandidates), "Discovery run queued")
                : Promise.resolve(false),
        patchRelationship: (id: string, patch: unknown, success?: string) =>
            act(() => api.patchRelationship(id, patch), success),
        logEvent: (id: string, input: unknown) => act(() => api.logEvent(id, input), "Logged"),
        createAgreement: (id: string, input: unknown) =>
            act(() => api.createAgreement(id, input), "Agreement saved"),
        importPartners: (rows: unknown[]) =>
            programId
                ? act(async () => {
                      const r = await api.importPartners(programId, rows);
                      setNotice(`Imported ${r.created} partners (${r.existing} already known)`);
                  })
                : Promise.resolve(false),
        outreach: (relationshipIds: string[], goal?: string) =>
            programId
                ? act(async () => {
                      const r = await api.outreach(programId, relationshipIds, goal);
                      setNotice(
                          `Campaign #${r.campaignId} drafted for ${r.included.length} partner${r.included.length === 1 ? "" : "s"}${r.skipped.length ? `; ${r.skipped.length} skipped` : ""}. Approve it in Email.`
                      );
                  })
                : Promise.resolve(false),
    };
}

export type DistributionState = ReturnType<typeof useDistribution>;
