"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from "~/components/ui/sheet";
import type { DocumentStat, DocumentDetails } from "../types";
import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
} from "~/components/ui/chart";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts";
import { ProfileAvatar } from "~/components/ProfileAvatar";
import { Badge } from "~/components/ui/badge";
import { normalizeRoleSlug } from "~/lib/authz/permissions";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "~/components/ui/table";
import { FileText, Users, Eye, TrendingUp, ExternalLink } from "lucide-react";
import { Card } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { useRouter } from "next/navigation";
import { StatsCard } from "./StatsCard";

interface DocumentDetailsSheetProps {
    document: DocumentStat | null;
    isOpen: boolean;
    onClose: () => void;
}

type DetailsT = ReturnType<typeof useTranslations<"statistics.details">>;
type Format = ReturnType<typeof useFormatter>;

/** Axis text in muted ink, never the series colour. */
const TICK = { fontSize: 11, fill: "var(--ink-3)" };

/**
 * Without a photo, the initials' colour still says the role: owners keep the
 * brand fill, admins the info tint, everyone else a neutral one.
 */
function avatarTone(role: string): string | undefined {
    const slug = normalizeRoleSlug(role);
    if (slug === "owner") return undefined;
    if (slug === "admin") return "bg-info-soft text-info-ink";
    return "bg-panel-2 text-ink-2";
}

/** "Just now", "5m ago", "3h ago", "2d ago"; date and time after a week. */
function formatRelativeTime(dateString: string, t: DetailsT, format: Format): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return t("justNow");
    if (diffMins < 60) return t("minutesAgo", { count: diffMins });
    if (diffHours < 24) return t("hoursAgo", { count: diffHours });
    if (diffDays < 7) return t("daysAgo", { count: diffDays });
    return format.dateTime(date, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
    });
}

interface DocumentDetailsResponse {
    success: boolean;
    data?: DocumentDetails;
    error?: string;
}

export function DocumentDetailsSheet({ document, isOpen, onClose }: DocumentDetailsSheetProps) {
    const t = useTranslations("statistics.details");
    const format = useFormatter();
    const viewsChartConfig: ChartConfig = useMemo(
        () => ({ count: { label: t("viewsSeries"), color: "var(--info)" } }),
        [t]
    );
    const formatDate = (dateString: string): string =>
        format.dateTime(new Date(dateString), { month: "short", day: "numeric" });
    const [details, setDetails] = useState<DocumentDetails | null>(null);
    const [loading, setLoading] = useState(false);
    // "" when the failure carried no message — the fallback is worded at render.
    const [error, setError] = useState<string | null>(null);
    const router = useRouter();

    useEffect(() => {
        if (isOpen && document) {
            void fetchDetails(document.id);
        } else {
            setDetails(null);
            setError(null);
        }
    }, [isOpen, document]);

    const fetchDetails = async (id: number) => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch(`/api/company/documents/${id}/stats`);
            const result = (await response.json()) as DocumentDetailsResponse;

            if (!result.success || !result.data) {
                throw new Error(result.error ?? "");
            }

            setDetails(result.data);
        } catch (err) {
            setError(err instanceof Error ? err.message : "");
        } finally {
            setLoading(false);
        }
    };

    const handleViewDocument = () => {
        if (document) {
            router.push(`/employer/documents?docId=${document.id}`);
        }
    };

    if (!document) return null;

    const totalViewsIn30Days = details?.viewsTrend.reduce((sum, d) => sum + d.count, 0) ?? 0;

    return (
        <Sheet open={isOpen} onOpenChange={open => !open && onClose()}>
            <SheetContent className="w-full max-w-full gap-0 overflow-hidden p-0 sm:w-[560px] sm:max-w-[560px]">
                {/* Fixed header; the right padding clears the sheet's close button. */}
                <SheetHeader className="border-line bg-panel shrink-0 gap-0 border-b p-4 pr-12 sm:p-6 sm:pr-12">
                    <div className="flex items-start gap-3">
                        <FileText aria-hidden className="text-ink-3 mt-0.5 size-5 shrink-0" />
                        <div className="min-w-0 flex-1">
                            <SheetTitle className="line-clamp-2 text-left text-lg leading-tight">
                                {document.title}
                            </SheetTitle>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                <Badge variant="secondary">{document.category}</Badge>
                                <SheetDescription className="text-xs">
                                    {t("created", {
                                        date: format.dateTime(new Date(document.createdAt), {
                                            year: "numeric",
                                            month: "numeric",
                                            day: "numeric",
                                        }),
                                    })}
                                </SheetDescription>
                            </div>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleViewDocument}
                            className="shrink-0"
                        >
                            <ExternalLink aria-hidden />
                            <span className="sr-only sm:not-sr-only">{t("viewDoc")}</span>
                        </Button>
                    </div>
                </SheetHeader>

                {/* Scrollable content */}
                <div className="flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
                    {error !== null ? (
                        <Card
                            role="alert"
                            className="border-danger/30 bg-danger-soft rounded-[14px] p-4 shadow-none"
                        >
                            <p className="text-danger-ink m-0 text-sm font-medium">
                                {t("loadFailed", { error: error || t("loadFailedFallback") })}
                            </p>
                        </Card>
                    ) : loading ? (
                        <div role="status" aria-busy="true" className="animate-loader-in space-y-6">
                            <span className="sr-only">{t("loading")}</span>
                            <div className="grid grid-cols-3 gap-3">
                                {[0, 1, 2].map(i => (
                                    <Skeleton key={i} className="h-24 rounded-[14px]" />
                                ))}
                            </div>
                            <Skeleton className="h-[200px] rounded-[14px]" />
                            <Skeleton className="h-40 rounded-[14px]" />
                        </div>
                    ) : details ? (
                        <>
                            <div className="grid grid-cols-3 gap-3">
                                <StatsCard
                                    compact
                                    label={t("tiles.views")}
                                    value={details.totalViews}
                                    icon={Eye}
                                    caption={t("tiles.allTime")}
                                />
                                <StatsCard
                                    compact
                                    label={t("tiles.unique")}
                                    value={details.uniqueViewers}
                                    icon={Users}
                                    caption={t("tiles.viewers")}
                                />
                                <StatsCard
                                    compact
                                    label={t("tiles.thirtyDays")}
                                    value={totalViewsIn30Days}
                                    icon={TrendingUp}
                                    caption={t("tiles.recent")}
                                />
                            </div>

                            <section className="space-y-3">
                                <h3 className="text-ink m-0 text-sm font-semibold">
                                    {t("activity")}
                                </h3>
                                <Card className="border-line rounded-[14px] p-4 shadow-none">
                                    <ChartContainer
                                        config={viewsChartConfig}
                                        className="h-[160px] w-full"
                                    >
                                        <AreaChart
                                            data={details.viewsTrend}
                                            margin={{ top: 8, right: 8, left: -10, bottom: 0 }}
                                        >
                                            <CartesianGrid vertical={false} stroke="var(--line)" />
                                            <XAxis
                                                dataKey="date"
                                                tickLine={false}
                                                axisLine={false}
                                                tickFormatter={formatDate}
                                                tick={TICK}
                                                interval="preserveStartEnd"
                                                minTickGap={16}
                                            />
                                            <YAxis
                                                tickLine={false}
                                                axisLine={false}
                                                tick={TICK}
                                                tickFormatter={(value: number) =>
                                                    format.number(value)
                                                }
                                                width={28}
                                            />
                                            <ChartTooltip
                                                cursor={{ stroke: "var(--line)" }}
                                                content={
                                                    <ChartTooltipContent
                                                        labelFormatter={value =>
                                                            formatDate(value as string)
                                                        }
                                                    />
                                                }
                                            />
                                            <Area
                                                type="monotone"
                                                dataKey="count"
                                                stroke="var(--color-count)"
                                                strokeWidth={2}
                                                fill="var(--color-count)"
                                                fillOpacity={0.12}
                                            />
                                        </AreaChart>
                                    </ChartContainer>
                                </Card>
                            </section>

                            <section className="space-y-3">
                                <div className="flex items-center justify-between gap-2">
                                    <h3 className="text-ink m-0 text-sm font-semibold">
                                        {t("recentViewers")}
                                    </h3>
                                    <Badge variant="secondary" className="tabular-nums">
                                        {t("shown", { count: details.recentViewers.length })}
                                    </Badge>
                                </div>

                                <Card className="border-line gap-0 overflow-hidden rounded-[14px] p-0 shadow-none">
                                    <div className="max-h-[200px] overflow-y-auto">
                                        <Table aria-label={t("recentViewers")}>
                                            <TableHeader className="bg-panel-2 sticky top-0 z-10">
                                                <TableRow className="border-line hover:bg-transparent">
                                                    <TableHead className="text-ink-3 h-9 pl-4 text-xs font-medium">
                                                        {t("columns.user")}
                                                    </TableHead>
                                                    <TableHead className="text-ink-3 h-9 pr-4 text-right text-xs font-medium">
                                                        {t("columns.when")}
                                                    </TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {details.recentViewers.length > 0 ? (
                                                    details.recentViewers.map((viewer, i) => (
                                                        <TableRow
                                                            key={i}
                                                            className="border-line-2 hover:bg-panel-2/60"
                                                        >
                                                            <TableCell className="py-2.5 pl-4">
                                                                <div className="flex items-center gap-3">
                                                                    <ProfileAvatar
                                                                        name={viewer.name}
                                                                        email={viewer.email}
                                                                        src={viewer.avatarUrl}
                                                                        fallbackClassName={avatarTone(
                                                                            viewer.role
                                                                        )}
                                                                    />
                                                                    <div className="min-w-0">
                                                                        <p className="text-ink m-0 truncate text-sm font-medium">
                                                                            {viewer.name}
                                                                        </p>
                                                                        <p className="text-ink-3 m-0 truncate text-xs">
                                                                            {viewer.email}
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="text-ink-3 py-2.5 pr-4 text-right text-xs">
                                                                {formatRelativeTime(
                                                                    viewer.viewedAt,
                                                                    t,
                                                                    format
                                                                )}
                                                            </TableCell>
                                                        </TableRow>
                                                    ))
                                                ) : (
                                                    <TableRow className="hover:bg-transparent">
                                                        <TableCell
                                                            colSpan={2}
                                                            className="text-ink-3 py-8 text-center"
                                                        >
                                                            <div className="flex flex-col items-center gap-2">
                                                                <Eye
                                                                    aria-hidden
                                                                    className="text-ink-4 size-8"
                                                                />
                                                                <p className="m-0 text-sm">
                                                                    {t("noViews")}
                                                                </p>
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                )}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </Card>
                            </section>
                        </>
                    ) : null}
                </div>
            </SheetContent>
        </Sheet>
    );
}
