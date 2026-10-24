"use client";

import React, { useCallback, useEffect, useState } from "react";
import { AlertCircle, Clock, FileText, MousePointerClick, RefreshCw, Users } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Button } from "~/components/ui/button";
import { Card, PageHeader, PageShell, Section } from "~/components/layout/page-shell";
import {
    usePublishedActions,
    type RegisterSectionActions,
} from "~/app/employer/documents/_workspace/settings/contract";
import { ChartsSection } from "./components/ChartsSection";
import { DocumentStatsTable } from "./components/DocumentStatsTable";
import { EmployeeActivityTable } from "./components/EmployeeActivityTable";
import type { DashboardData } from "./types";

interface StatTileProps {
    label: string;
    value: number | string;
    Icon: React.ComponentType<{
        size?: number | string;
        className?: string;
        style?: React.CSSProperties;
    }>;
    accent: string;
}

function StatTile({ label, value, Icon, accent }: StatTileProps) {
    const format = useFormatter();
    return (
        <Card style={{ borderLeft: `3px solid ${accent}` }}>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 8,
                }}
            >
                <span
                    className="mono"
                    style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.1em",
                        color: "var(--ink-3)",
                        textTransform: "uppercase",
                    }}
                >
                    {label}
                </span>
                <Icon style={{ width: 16, height: 16, color: accent }} />
            </div>
            <div
                style={{
                    fontSize: 30,
                    fontWeight: 800,
                    letterSpacing: "-0.02em",
                    color: "var(--ink)",
                    lineHeight: 1.1,
                }}
            >
                {typeof value === "number" ? format.number(value) : value}
            </div>
        </Card>
    );
}

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
                    eyebrow={t("eyebrow")}
                    title={t("title")}
                    description={t("description")}
                    actions={
                        <Button
                            onClick={() => void fetchDashboardData()}
                            disabled={loading}
                            style={{ padding: "9px 16px" }}
                        >
                            <RefreshCw
                                style={{
                                    width: 14,
                                    height: 14,
                                    animation: loading
                                        ? "lsw-spin 800ms linear infinite"
                                        : undefined,
                                }}
                            />
                            {loading ? t("refreshing") : t("refresh")}
                        </Button>
                    }
                />
            )}

            {error !== null && (
                <Card
                    style={{
                        marginBottom: 20,
                        borderColor: "oklch(0.85 0.09 25)",
                        background: "oklch(0.96 0.05 25)",
                    }}
                >
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                        <AlertCircle style={{ width: 18, height: 18, color: "var(--danger)" }} />
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--danger)" }}>
                                {t("loadFailed")}
                            </div>
                            <div
                                style={{
                                    fontSize: 12,
                                    color: "oklch(0.4 0.12 25)",
                                    marginTop: 4,
                                }}
                            >
                                {error || t("loadFailedFallback")}
                            </div>
                            <Button
                                variant="outline"
                                onClick={() => void fetchDashboardData()}
                                style={{ marginTop: 10, padding: "5px 10px" }}
                            >
                                {tc("actions.tryAgain")}
                            </Button>
                        </div>
                    </div>
                </Card>
            )}

            {loading && !data && error === null && (
                <Card>
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 14,
                            padding: "20px 0",
                            color: "var(--ink-3)",
                        }}
                    >
                        <RefreshCw
                            style={{
                                width: 18,
                                height: 18,
                                color: "var(--accent)",
                                animation: "lsw-spin 800ms linear infinite",
                            }}
                        />
                        <div style={{ fontSize: 14 }}>{t("loading")}</div>
                    </div>
                </Card>
            )}

            {data && (
                <>
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                            gap: 12,
                            marginBottom: 28,
                        }}
                    >
                        <StatTile
                            label={t("tiles.employees")}
                            value={data.totalEmployees}
                            Icon={Users}
                            accent="var(--accent)"
                        />
                        <StatTile
                            label={t("tiles.documents")}
                            value={data.totalDocuments}
                            Icon={FileText}
                            accent="oklch(0.6 0.16 225)"
                        />
                        <StatTile
                            label={t("tiles.active")}
                            value={data.employees.filter(e => e.status === "active").length}
                            Icon={Clock}
                            accent="oklch(0.58 0.15 160)"
                        />
                        <StatTile
                            label={t("tiles.views")}
                            value={data.documentViewsTrend.reduce((sum, d) => sum + d.count, 0)}
                            Icon={MousePointerClick}
                            accent="oklch(0.65 0.16 65)"
                        />
                    </div>

                    <Section title={t("trends.title")} description={t("trends.description")}>
                        <Card padding={18}>
                            <ChartsSection data={data} />
                        </Card>
                    </Section>

                    <Section title={t("documents.title")} description={t("documents.description")}>
                        <Card padding={0}>
                            <DocumentStatsTable documents={data.documentStats} />
                        </Card>
                    </Section>

                    <Section title={t("employees.title")} description={t("employees.description")}>
                        <Card padding={0}>
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
