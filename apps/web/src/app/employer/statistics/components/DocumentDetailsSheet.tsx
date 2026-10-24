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
import {
    FileText,
    Users,
    Eye,
    Clock,
    Calendar,
    TrendingUp,
    Loader2,
    ExternalLink,
} from "lucide-react";
import { Card } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { useRouter } from "next/navigation";

interface DocumentDetailsSheetProps {
    document: DocumentStat | null;
    isOpen: boolean;
    onClose: () => void;
}

type DetailsT = ReturnType<typeof useTranslations<"statistics.details">>;
type Format = ReturnType<typeof useFormatter>;

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
        () => ({ count: { label: t("viewsSeries"), color: "hsl(221, 83%, 53%)" } }),
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
            <SheetContent className="flex w-[420px] flex-col gap-0 overflow-hidden p-0 sm:w-[560px]">
                {/* Fixed Header */}
                <div className="from-info to-brand bg-gradient-to-br p-6 text-white">
                    <SheetHeader className="space-y-3">
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex min-w-0 flex-1 items-start gap-4">
                                <div className="shrink-0 rounded-xl bg-white/20 p-3 backdrop-blur-sm">
                                    <FileText className="h-6 w-6" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <SheetTitle className="line-clamp-2 text-left text-lg font-bold leading-tight text-white">
                                        {document.title}
                                    </SheetTitle>
                                    <div className="mt-2 flex items-center gap-2">
                                        <Badge className="border-0 bg-white/20 text-xs text-white hover:bg-white/30">
                                            {document.category}
                                        </Badge>
                                        <SheetDescription className="text-xs text-white/70">
                                            {t("created", {
                                                date: format.dateTime(
                                                    new Date(document.createdAt),
                                                    {
                                                        year: "numeric",
                                                        month: "numeric",
                                                        day: "numeric",
                                                    }
                                                ),
                                            })}
                                        </SheetDescription>
                                    </div>
                                </div>
                            </div>
                            <Button
                                onClick={handleViewDocument}
                                size="sm"
                                className="h-9 shrink-0 gap-2 border-0 bg-white/20 text-white backdrop-blur-sm hover:bg-white/30"
                            >
                                <ExternalLink className="h-4 w-4" />
                                <span className="hidden sm:inline">{t("viewDoc")}</span>
                            </Button>
                        </div>
                    </SheetHeader>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 space-y-6 overflow-y-auto p-6">
                    {error !== null ? (
                        <Card className="border-danger/20 bg-danger/5 p-4">
                            <p className="text-danger text-sm font-medium">
                                {t("loadFailed", { error: error || t("loadFailedFallback") })}
                            </p>
                        </Card>
                    ) : loading ? (
                        <div className="flex flex-col items-center justify-center gap-4 py-12">
                            <div className="relative">
                                <div className="border-3 h-12 w-12 animate-spin rounded-full border-blue-100 border-t-blue-600 dark:border-blue-900/30" />
                                <Loader2 className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 animate-pulse text-blue-600" />
                            </div>
                            <p className="text-ink-3 text-sm font-medium">{t("loading")}</p>
                        </div>
                    ) : details ? (
                        <>
                            {/* Stats Grid */}
                            <div className="grid grid-cols-3 gap-3">
                                <Card className="border-blue-200/50 bg-gradient-to-br from-blue-50 to-blue-100/50 p-4 dark:border-blue-800/30 dark:from-blue-950/30 dark:to-blue-900/20">
                                    <div className="mb-2 flex items-center gap-2">
                                        <Eye className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600/70 dark:text-blue-400/70">
                                            {t("tiles.views")}
                                        </span>
                                    </div>
                                    <div className="text-2xl font-black text-blue-700 dark:text-blue-300">
                                        {format.number(details.totalViews)}
                                    </div>
                                    <p className="mt-1 text-[10px] text-blue-600/60 dark:text-blue-400/60">
                                        {t("tiles.allTime")}
                                    </p>
                                </Card>

                                <Card className="border-brand-soft from-brand-soft to-brand-soft/50 bg-gradient-to-br p-4">
                                    <div className="mb-2 flex items-center gap-2">
                                        <Users className="text-brand-ink h-4 w-4" />
                                        <span className="text-brand-ink/70 text-[10px] font-bold uppercase tracking-wider">
                                            {t("tiles.unique")}
                                        </span>
                                    </div>
                                    <div className="text-brand-ink text-2xl font-black">
                                        {format.number(details.uniqueViewers)}
                                    </div>
                                    <p className="text-brand-ink/60 mt-1 text-[10px]">
                                        {t("tiles.viewers")}
                                    </p>
                                </Card>

                                <Card className="border-green-200/50 bg-gradient-to-br from-green-50 to-green-100/50 p-4 dark:border-green-800/30 dark:from-green-950/30 dark:to-green-900/20">
                                    <div className="mb-2 flex items-center gap-2">
                                        <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-green-600/70 dark:text-green-400/70">
                                            {t("tiles.thirtyDays")}
                                        </span>
                                    </div>
                                    <div className="text-2xl font-black text-green-700 dark:text-green-300">
                                        {format.number(totalViewsIn30Days)}
                                    </div>
                                    <p className="mt-1 text-[10px] text-green-600/60 dark:text-green-400/60">
                                        {t("tiles.recent")}
                                    </p>
                                </Card>
                            </div>

                            {/* Activity Chart */}
                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <Calendar className="text-ink-3 h-4 w-4" />
                                    <h3 className="text-ink-3 text-xs font-bold uppercase tracking-widest">
                                        {t("activity")}
                                    </h3>
                                </div>
                                <Card className="bg-panel-2/30 border-none p-4 shadow-sm">
                                    <ChartContainer
                                        config={viewsChartConfig}
                                        className="h-[160px] w-full"
                                    >
                                        <AreaChart
                                            data={details.viewsTrend}
                                            margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
                                        >
                                            <defs>
                                                <linearGradient
                                                    id="detailViewsGradient"
                                                    x1="0"
                                                    y1="0"
                                                    x2="0"
                                                    y2="1"
                                                >
                                                    <stop
                                                        offset="5%"
                                                        stopColor="hsl(221, 83%, 53%)"
                                                        stopOpacity={0.4}
                                                    />
                                                    <stop
                                                        offset="95%"
                                                        stopColor="hsl(221, 83%, 53%)"
                                                        stopOpacity={0}
                                                    />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid
                                                strokeDasharray="3 3"
                                                className="stroke-panel-2/50"
                                                vertical={false}
                                            />
                                            <XAxis
                                                dataKey="date"
                                                tickLine={false}
                                                axisLine={false}
                                                tickFormatter={formatDate}
                                                tick={{ fontSize: 9 }}
                                                interval="preserveStartEnd"
                                            />
                                            <YAxis
                                                tickLine={false}
                                                axisLine={false}
                                                tick={{ fontSize: 9 }}
                                                tickFormatter={(value: number) =>
                                                    format.number(value)
                                                }
                                                width={25}
                                            />
                                            <ChartTooltip
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
                                                stroke="hsl(221, 83%, 53%)"
                                                strokeWidth={2}
                                                fill="url(#detailViewsGradient)"
                                            />
                                        </AreaChart>
                                    </ChartContainer>
                                </Card>
                            </div>

                            {/* Recent Viewers */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Clock className="text-ink-3 h-4 w-4" />
                                        <h3 className="text-ink-3 text-xs font-bold uppercase tracking-widest">
                                            {t("recentViewers")}
                                        </h3>
                                    </div>
                                    <Badge variant="outline" className="text-[10px] font-bold">
                                        {t("shown", { count: details.recentViewers.length })}
                                    </Badge>
                                </div>

                                <Card className="overflow-hidden border shadow-sm">
                                    <div className="max-h-[200px] overflow-y-auto">
                                        <Table>
                                            <TableHeader className="bg-panel-2/80 sticky top-0 z-10 backdrop-blur-sm">
                                                <TableRow>
                                                    <TableHead className="py-2 text-[10px] font-bold uppercase tracking-wider">
                                                        {t("columns.user")}
                                                    </TableHead>
                                                    <TableHead className="py-2 text-right text-[10px] font-bold uppercase tracking-wider">
                                                        {t("columns.when")}
                                                    </TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {details.recentViewers.length > 0 ? (
                                                    details.recentViewers.map((viewer, i) => (
                                                        <TableRow key={i} className="group">
                                                            <TableCell className="py-2.5">
                                                                <div className="flex items-center gap-3">
                                                                    <ProfileAvatar
                                                                        name={viewer.name}
                                                                        email={viewer.email}
                                                                        src={viewer.avatarUrl}
                                                                        // Without a photo, the colour still says the role.
                                                                        fallbackClassName={
                                                                            normalizeRoleSlug(
                                                                                viewer.role
                                                                            ) === "owner"
                                                                                ? undefined
                                                                                : normalizeRoleSlug(
                                                                                        viewer.role
                                                                                    ) === "admin"
                                                                                  ? "bg-info"
                                                                                  : "bg-ink-4"
                                                                        }
                                                                    />
                                                                    <div className="min-w-0">
                                                                        <p className="truncate text-sm font-medium">
                                                                            {viewer.name}
                                                                        </p>
                                                                        <p className="text-ink-3 truncate text-[11px]">
                                                                            {viewer.email}
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="py-2.5 text-right">
                                                                <span className="text-ink-3 text-xs font-medium">
                                                                    {formatRelativeTime(
                                                                        viewer.viewedAt,
                                                                        t,
                                                                        format
                                                                    )}
                                                                </span>
                                                            </TableCell>
                                                        </TableRow>
                                                    ))
                                                ) : (
                                                    <TableRow>
                                                        <TableCell
                                                            colSpan={2}
                                                            className="text-ink-3 py-8 text-center"
                                                        >
                                                            <div className="flex flex-col items-center gap-2">
                                                                <Eye className="text-ink-3/30 h-8 w-8" />
                                                                <p className="text-sm">
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
                            </div>
                        </>
                    ) : null}
                </div>
            </SheetContent>
        </Sheet>
    );
}
