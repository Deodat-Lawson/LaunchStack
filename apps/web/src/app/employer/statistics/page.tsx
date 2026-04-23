"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Clock,
  FileText,
  MousePointerClick,
  RefreshCw,
  Users,
} from "lucide-react";

import { EmployerChrome } from "~/app/employer/_components/EmployerChrome";
import {
  Button,
  Card,
  PageHeader,
  PageShell,
  Section,
} from "~/app/employer/_components/primitives";
import { ChartsSection } from "./components/ChartsSection";
import { DocumentStatsTable } from "./components/DocumentStatsTable";
import { EmployeeActivityTable } from "./components/EmployeeActivityTable";
import type { DashboardData } from "./types";

interface StatTileProps {
  label: string;
  value: number | string;
  Icon: React.ComponentType<{ size?: number | string; className?: string; style?: React.CSSProperties }>;
  accent: string;
}

function StatTile({ label, value, Icon, accent }: StatTileProps) {
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
        {value}
      </div>
    </Card>
  );
}

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

  return (
    <>
      <EmployerChrome pageLabel="Launchstack" pageTitle="Analytics" />
      <PageShell wide>
        <PageHeader
          eyebrow="Analytics"
          title="Analytics dashboard"
          description="Company-wide view of documents, employee activity, and query trends. Refresh to pull the latest."
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
                  animation: loading ? "lsw-spin 800ms linear infinite" : undefined,
                }}
              />
              {loading ? "Refreshing…" : "Refresh data"}
            </Button>
          }
        />

        {error && (
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
                  Failed to load
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "oklch(0.4 0.12 25)",
                    marginTop: 4,
                  }}
                >
                  {error}
                </div>
                <Button
                  variant="secondary"
                  onClick={() => void fetchDashboardData()}
                  style={{ marginTop: 10, padding: "5px 10px" }}
                >
                  Try again
                </Button>
              </div>
            </div>
          </Card>
        )}

        {loading && !data && !error && (
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
              <div style={{ fontSize: 14 }}>Fetching company analytics and employee data…</div>
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
                label="Total employees"
                value={data.totalEmployees}
                Icon={Users}
                accent="var(--accent)"
              />
              <StatTile
                label="Total documents"
                value={data.totalDocuments}
                Icon={FileText}
                accent="oklch(0.6 0.16 225)"
              />
              <StatTile
                label="Active users"
                value={data.employees.filter((e) => e.status === "verified").length}
                Icon={Clock}
                accent="oklch(0.58 0.15 160)"
              />
              <StatTile
                label="30-day views"
                value={data.documentViewsTrend.reduce((sum, d) => sum + d.count, 0)}
                Icon={MousePointerClick}
                accent="oklch(0.65 0.16 65)"
              />
            </div>

            <Section
              title="Trends"
              description="Query volume and activity over the last 30 days."
            >
              <Card padding={18}>
                <ChartsSection data={data} />
              </Card>
            </Section>

            <Section title="Documents" description="Per-document stats and hit rates.">
              <Card padding={0}>
                <DocumentStatsTable documents={data.documentStats} />
              </Card>
            </Section>

            <Section title="Employees" description="Activity broken down by team member.">
              <Card padding={0}>
                <EmployeeActivityTable employees={data.employees} />
              </Card>
            </Section>
          </>
        )}
      </PageShell>
    </>
  );
}
