"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
    Users,
    FileText,
    TrendingUp,
    MousePointerClick,
    RefreshCw,
    Clock,
    AlertCircle,
} from "lucide-react";
import { Button } from "~/app/employer/documents/components/ui/button";
import { Card } from "~/app/employer/documents/components/ui/card";
import { cn } from "~/lib/utils";
import { EmployerNavbar } from "~/app/employer/_components/EmployerNavbar";
import { StatsCard } from "./components/StatsCard";
import { ChartsSection } from "./components/ChartsSection";
import { DocumentStatsTable } from "./components/DocumentStatsTable";
import { EmployeeActivityTable } from "./components/EmployeeActivityTable";
import type { DashboardData } from "./types";

export default function StatisticsPage() {
    const [data, setData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);
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
                throw new Error(result.error ?? "Failed to fetch dashboard data");
            }

            setData(result.data);
        } catch (err) {
            setError(err instanceof Error ? err.message : "An error occurred");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void fetchDashboardData();
    }, [fetchDashboardData]);

    if (loading && !data) {
    return (
            <div className="flex flex-col min-h-screen bg-background">
                <EmployerNavbar />
                <div className="flex flex-col items-center justify-center flex-1 py-20">
                    <div className="relative mb-8">
                        <div className="w-20 h-20 border-4 border-purple-100 dark:border-purple-900/30 rounded-full border-t-purple-600 dark:border-t-purple-500 animate-spin" />
                        <TrendingUp className="w-8 h-8 text-purple-600 dark:text-purple-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse" />
                    </div>
                    <h3 className="text-xl font-bold text-foreground mb-2">Loading Dashboard</h3>
                    <p className="text-muted-foreground max-w-sm text-center font-medium">
                        Fetching company analytics and employee data...
                    </p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col min-h-screen bg-background">
                <EmployerNavbar />
                <div className="flex flex-col items-center justify-center flex-1 py-20">
                    <Card className="p-6 border-destructive/20 bg-destructive/10 max-w-md">
                        <div className="flex items-start gap-4">
                            <div className="p-2 bg-destructive/20 rounded-lg">
                                <AlertCircle className="w-6 h-6 text-destructive" />
                            </div>
                        <div>
                                <h3 className="text-lg font-bold text-destructive">Failed to Load</h3>
                                <p className="text-destructive text-sm mt-1 font-medium">{error}</p>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void fetchDashboardData()}
                                    className="mt-4 border-destructive/30 text-destructive hover:bg-destructive/10"
                                >
                                    Try Again
                                </Button>
                            </div>
                        </div>
                    </Card>
                </div>
            </div>
        );
    }

    if (!data) return null;

    return (
        <div className="flex flex-col min-h-screen bg-background">
            <EmployerNavbar />
            
            {/* Header */}
            <div className="bg-background border-b border-border px-8 py-6 flex-shrink-0 z-10 shadow-sm sticky top-[73px]">
                <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-purple-600 rounded-2xl shadow-lg shadow-purple-500/20">
                            <TrendingUp className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-foreground leading-tight">
                                Analytics Dashboard
                            </h1>
                            <p className="text-sm text-muted-foreground font-medium mt-1">
                                Company-wide analytics, document performance, and employee activity
                            </p>
                        </div>
                    </div>

                    <Button
                        onClick={() => void fetchDashboardData()}
                        disabled={loading}
                        className="bg-purple-600 hover:bg-purple-700 text-white rounded-xl h-11 px-6 shadow-lg shadow-purple-500/20 gap-2 font-bold transition-all hover:scale-[1.02] active:scale-[0.98]"
                    >
                        <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
                        {loading ? "Refreshing..." : "Refresh Data"}
                    </Button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
                <div className="max-w-7xl mx-auto p-8 space-y-8">
                    {/* Summary Stats */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <StatsCard 
                            title="Total Employees" 
                            value={data.totalEmployees} 
                            icon={Users} 
                            color="purple" 
                        />
                        <StatsCard 
                            title="Total Documents" 
                            value={data.totalDocuments} 
                            icon={FileText} 
                            color="blue" 
                        />
                        <StatsCard 
                            title="Active Users" 
                            value={data.employees.filter((e) => e.status === "verified").length} 
                            icon={Clock} 
                            color="green" 
                        />
                        <StatsCard 
                            title="30 Days Views" 
                            value={data.documentViewsTrend.reduce((sum, d) => sum + d.count, 0)} 
                            icon={MousePointerClick} 
                            color="amber" 
                        />
                    </div>

                    {/* Charts Grid */}
                    <ChartsSection data={data} />

                    {/* Document Statistics Table */}
                    <DocumentStatsTable documents={data.documentStats} />

                    {/* Employees Table */}
                    <EmployeeActivityTable employees={data.employees} />
                </div>
            </div>
        </div>
    );
}
