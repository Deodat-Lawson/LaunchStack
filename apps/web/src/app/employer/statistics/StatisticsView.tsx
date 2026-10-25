"use client";

import React, { useCallback, useEffect, useState } from "react";
import { AlertCircle, Clock, FileText, MousePointerClick, RefreshCw, Users } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { Card, PageHeader, PageShell, Section } from "~/components/layout/page-shell";
import {
    usePublishedActions,
    type RegisterSectionActions,
} from "~/app/employer/documents/_workspace/settings/contract";
import { cn } from "~/lib/utils";
import { ChartsSection } from "./components/ChartsSection";
import { DocumentStatsTable } from "./components/DocumentStatsTable";
import { EmployeeActivityTable } from "./components/EmployeeActivityTable";
import { StatsCard } from "./components/StatsCard";
import type { DashboardData } from "./types";

/** Four across; two by two once the pane is too narrow for four. */
const KPI_GRID = "mb-7 grid grid-cols-4 gap-3 @max-lg:grid-cols-2";

export interface StatisticsViewProps {
    /**
     * Render inside a bounded flex container (e.g. the Studio drawer). Swaps the
     * full-viewport PageShell for a scrollable `height: 100%` one.
     */
    embedded?: boolean;
    /**
     * Body only: no page shell, no header, no Refresh button of its own. Used by
     * the settings hub, which supplies all three so every section shares one
     * header treatment and one action area.
     */
    bare?: boolean;
    /** Publishes Refresh into the settings chrome when `bare`. */
    onActions?: RegisterSectionActions;
}

export function StatisticsView({ embedded = false, bare = false, onActions }: StatisticsViewProps) {
    const t = useTranslations("statistics.view");
    const tc = useTranslations("common");
    const [data, setData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    // "" when the failure carried no message — the fallback is worded at render.
    const [error, setError] = useState<string | null>(null);

    const fetchDashboardData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch("/api/company/analysis-dashboard");
            const result = (await response.json()) as {
                success: boolean;
                data?: DashboardData;
                error?: string;
            };
            if (!result.success || !result.data) {
                throw new Error(result.error ?? "");
            }
            setData(result.data);
        } catch (err) {
            setError(err instanceof Error ? err.message : "");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void fetchDashboardData();
    }, [fetchDashboardData]);

    usePublishedActions(
        bare ? onActions : undefined,
        {
            primaryLabel: t("refresh"),
            primaryBusyLabel: t("refreshing"),
            onPrimary: () => void fetchDashboardData(),
            busy: loading,
        },
        [fetchDashboardData, loading, t]
    );

    const body = (
        <>
            {!bare && (
                <PageHeader
                    title={t("title")}
                    description={t("description")}
                    actions={
                        <Button onClick={() => void fetchDashboardData()} disabled={loading}>
                            <RefreshCw
                                aria-hidden
                                className={cn(loading && "animate-spin motion-reduce:animate-none")}
                            />
                            {loading ? t("refreshing") : t("refresh")}
                        </Button>
                    }
                />
            )}

            {error !== null && (
                <Card padding={16} className="border-danger/30 bg-danger-soft mb-5">
                    <div role="alert" className="flex items-start gap-2.5">
                        <AlertCircle
                            aria-hidden
                            className="text-danger mt-px size-[18px] shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                            <div className="text-danger-ink text-[13px] font-semibold">
                                {t("loadFailed")}
                            </div>
                            <div className="text-ink-2 mt-1 text-xs">
                                {error || t("loadFailedFallback")}
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void fetchDashboardData()}
                                className="mt-2.5"
                            >
                                {tc("actions.tryAgain")}
                            </Button>
                        </div>
                    </div>
                </Card>
            )}

            {loading && !data && error === null && (
                <div role="status" aria-busy="true" className="animate-loader-in">
                    <span className="sr-only">{t("loading")}</span>
                    <div className={KPI_GRID}>
                        {[0, 1, 2, 3].map(i => (
                            <Skeleton key={i} className="h-[82px] rounded-[14px]" />
                        ))}
                    </div>
                    <div className="@max-lg:grid-cols-1 mb-8 grid grid-cols-2 gap-3">
                        <Skeleton className="h-[316px] rounded-[14px]" />
                        <Skeleton className="@max-lg:hidden h-[316px] rounded-[14px]" />
                    </div>
                    <Skeleton className="h-[280px] rounded-[14px]" />
                </div>
            )}

            {data && (
                <>
                    <div className={KPI_GRID}>
                        <StatsCard
                            label={t("tiles.employees")}
                            value={data.totalEmployees}
                            icon={Users}
                        />
                        <StatsCard
                            label={t("tiles.documents")}
                            value={data.totalDocuments}
                            icon={FileText}
                        />
                        <StatsCard
                            label={t("tiles.active")}
                            value={data.employees.filter(e => e.status === "active").length}
                            icon={Clock}
                        />
                        <StatsCard
                            label={t("tiles.views")}
                            value={data.documentViewsTrend.reduce((sum, d) => sum + d.count, 0)}
                            icon={MousePointerClick}
                        />
                    </div>

                    <Section title={t("trends.title")} description={t("trends.description")}>
                        <ChartsSection data={data} />
                    </Section>

                    <Section title={t("documents.title")} description={t("documents.description")}>
                        <Card padding={0} className="overflow-hidden">
                            <DocumentStatsTable documents={data.documentStats} />
                        </Card>
                    </Section>

                    <Section title={t("employees.title")} description={t("employees.description")}>
                        <Card padding={0} className="overflow-hidden">
                            <EmployeeActivityTable employees={data.employees} />
                        </Card>
                    </Section>
                </>
            )}
        </>
    );

    // In the settings hub the surrounding column, padding, and header already
    // exist; wrapping again would double them.
    if (bare) return body;

    return (
        <PageShell wide embedded={embedded}>
            {body}
        </PageShell>
    );
}
