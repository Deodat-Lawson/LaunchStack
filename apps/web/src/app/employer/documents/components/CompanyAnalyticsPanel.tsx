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
import { cn } from "~/lib/utils";
import { StatsCard } from "~/app/employer/statistics/components/StatsCard";
import { ChartsSection } from "~/app/employer/statistics/components/ChartsSection";
import { DocumentStatsTable } from "~/app/employer/statistics/components/DocumentStatsTable";
import { EmployeeActivityTable } from "~/app/employer/statistics/components/EmployeeActivityTable";
import type { DashboardData } from "~/app/employer/statistics/types";

export function CompanyAnalyticsPanel() {
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
      <div className="h-full flex flex-col items-center justify-center gap-4 bg-background">
        <div className="relative">
          <div className="w-14 h-14 border-2 border-purple-100 dark:border-purple-900/30 rounded-full border-t-purple-600 animate-spin" />
          <TrendingUp className="w-5 h-5 text-purple-600 dark:text-purple-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse" />
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold text-foreground">Loading Analytics</p>
          <p className="text-xs text-muted-foreground mt-0.5">Fetching company data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-background p-8">
        <div className="max-w-sm w-full p-5 rounded-xl border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/30">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-red-700 dark:text-red-400">Failed to load analytics</p>
              <p className="text-xs text-red-600/80 dark:text-red-500 mt-1">{error}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void fetchDashboardData()}
                className="mt-3 border-red-200 text-red-600 hover:bg-red-100 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20 h-7 text-xs"
              >
                Try Again
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="h-full overflow-y-auto bg-background custom-scrollbar">
      {/* Page Header */}
      <div className="border-b border-border px-8 py-4 flex items-center justify-between sticky top-0 bg-background/90 backdrop-blur-sm z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-purple-600 flex items-center justify-center shadow-sm shadow-purple-500/20">
            <TrendingUp className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-foreground leading-none">Analytics Dashboard</h1>
            <p className="text-[10px] text-muted-foreground mt-0.5">Company-wide analytics and employee activity</p>
          </div>
        </div>
        <Button
          onClick={() => void fetchDashboardData()}
          disabled={loading}
          size="sm"
          className="bg-purple-600 hover:bg-purple-700 text-white h-8 px-3 gap-1.5 text-xs shadow-sm shadow-purple-500/20"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-6 space-y-6">
        {/* Stats Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard title="Total Employees" value={data.totalEmployees} icon={Users} color="purple" />
          <StatsCard title="Total Documents" value={data.totalDocuments} icon={FileText} color="blue" />
          <StatsCard
            title="Active Users"
            value={data.employees.filter((e) => e.status === "verified").length}
            icon={Clock}
            color="green"
          />
          <StatsCard
            title="30 Day Views"
            value={data.documentViewsTrend.reduce((sum, d) => sum + d.count, 0)}
            icon={MousePointerClick}
            color="amber"
          />
        </div>

        {/* Charts */}
        <ChartsSection data={data} />

        {/* Document Stats Table */}
        <DocumentStatsTable documents={data.documentStats} />

        {/* Employee Activity Table */}
        <EmployeeActivityTable employees={data.employees} />
      </div>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 3px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: hsl(var(--border)); border-radius: 10px; }
      `}</style>
    </div>
  );
}
