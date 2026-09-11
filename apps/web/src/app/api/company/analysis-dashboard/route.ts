import { NextResponse } from "next/server";
import { db } from "~/server/db/index";
import { document } from "@launchstack/store/schema";
import { users, documentViews, ChatHistory, userCompanyMemberships } from "~/server/db/schema";
import { eq, and, sql, gte, desc, count, inArray, max } from "drizzle-orm";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { normalizeRoleSlug } from "~/lib/authz/permissions";
import { scopedDocumentWhere } from "~/lib/authz/scope";

const shouldLogPerf =
    process.env.NODE_ENV === "development" &&
    (process.env.DEBUG_PERF === "1" || process.env.DEBUG_PERF === "true");

interface TrendDataPoint {
    date: string;
    count: number;
}

interface EmployeeInfo {
    id: number;
    name: string;
    email: string;
    role: string;
    status: string;
    lastActiveAt: string | null;
    createdAt: string;
    queryCount: number;
}

interface DocumentStat {
    id: number;
    title: string;
    category: string;
    views: number;
    lastViewedAt: string | null;
    createdAt: string;
}

interface AnalysisDashboardResponse {
    success: boolean;
    data: {
        totalEmployees: number;
        totalDocuments: number;
        employees: EmployeeInfo[];
        employeeTrend: TrendDataPoint[];
        documentViewsTrend: TrendDataPoint[];
        documentStats: DocumentStat[];
    };
}

export async function GET() {
    const requestStart = Date.now();
    let aggregateMs: number | null = null;
    let queryCountMs: number | null = null;
    let outcome = "ok";
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) {
            outcome =
                ctx.response.status === 401
                    ? "unauthorized"
                    : ctx.response.status === 403
                      ? "forbidden"
                      : "error";
            return ctx.response;
        }

        // Update last-active timestamp for the authenticated user.
        await db
            .update(users)
            .set({ lastActiveAt: new Date() })
            .where(eq(users.userId, ctx.data.authUserId));

        if (!ctx.data.can("analytics.view")) {
            outcome = "forbidden";
            return NextResponse.json(
                {
                    success: false,
                    error: "Forbidden. The analytics.view permission is required.",
                    permission: "analytics.view",
                },
                { status: 403 }
            );
        }

        const companyId = ctx.data.companyId;
        // Document totals and per-document stats only count what the caller
        // may read; a restricted folder they have no grant to is invisible
        // here too.
        const documentWhere = scopedDocumentWhere(companyId, await ctx.data.documentScope());
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // Fetch independent dashboard datasets in parallel.
        const aggregateStart = Date.now();
        const [
            employeesData,
            documentCountRows,
            documentStatsData,
            employeeTrendData,
            documentViewsTrendData,
        ] = await Promise.all([
            // Roster is the membership list for this workspace, with the role
            // and status granted here — `users.companyId` is only a default
            // workspace, and the legacy global columns are never read.
            db
                .select({
                    id: users.id,
                    name: users.name,
                    email: users.email,
                    role: userCompanyMemberships.role,
                    status: userCompanyMemberships.status,
                    lastActiveAt: users.lastActiveAt,
                    createdAt: userCompanyMemberships.createdAt,
                    userId: users.userId,
                })
                .from(userCompanyMemberships)
                .innerJoin(users, eq(users.id, userCompanyMemberships.userId))
                .where(eq(userCompanyMemberships.companyId, companyId))
                .orderBy(desc(users.lastActiveAt)),
            db.select({ count: count() }).from(document).where(documentWhere),
            db
                .select({
                    id: document.id,
                    title: document.title,
                    category: document.category,
                    createdAt: document.createdAt,
                    views: count(documentViews.id),
                    lastViewedAt: max(documentViews.viewedAt),
                })
                .from(document)
                .leftJoin(
                    documentViews,
                    and(
                        eq(document.id, documentViews.documentId),
                        eq(documentViews.companyId, companyId)
                    )
                )
                .where(documentWhere)
                .groupBy(document.id, document.title, document.category, document.createdAt)
                .orderBy(desc(count(documentViews.id))),
            db
                .select({
                    date: sql<string>`DATE(${userCompanyMemberships.createdAt})`.as("date"),
                    count: count(),
                })
                .from(userCompanyMemberships)
                .where(
                    and(
                        eq(userCompanyMemberships.companyId, companyId),
                        gte(userCompanyMemberships.createdAt, thirtyDaysAgo)
                    )
                )
                .groupBy(sql`DATE(${userCompanyMemberships.createdAt})`)
                .orderBy(sql`DATE(${userCompanyMemberships.createdAt})`),
            db
                .select({
                    date: sql<string>`DATE(${documentViews.viewedAt})`.as("date"),
                    count: count(),
                })
                .from(documentViews)
                .where(
                    and(
                        eq(documentViews.companyId, companyId),
                        gte(documentViews.viewedAt, thirtyDaysAgo)
                    )
                )
                .groupBy(sql`DATE(${documentViews.viewedAt})`)
                .orderBy(sql`DATE(${documentViews.viewedAt})`),
        ]);
        aggregateMs = Date.now() - aggregateStart;
        const [documentCount] = documentCountRows;

        // Query counts come from ChatHistory joined to this company's documents.
        // Members can belong to several workspaces, so filtering by user id
        // alone would count questions they asked somewhere else. The AI chat
        // aggregate that used to be merged in here is gone: `agent_ai_chatbot_chat`
        // carries no company or document, so there is nothing to scope it by.
        const employeeUserIds = employeesData.map(e => e.userId);

        let queryCountsData: { userId: string; count: number }[] = [];

        if (employeeUserIds.length > 0) {
            const queryCountStart = Date.now();
            queryCountsData = (
                await db
                    .select({
                        userId: ChatHistory.UserId,
                        count: count(),
                    })
                    .from(ChatHistory)
                    .innerJoin(document, eq(document.id, ChatHistory.documentId))
                    .where(
                        and(
                            inArray(ChatHistory.UserId, employeeUserIds),
                            eq(document.companyId, companyId)
                        )
                    )
                    .groupBy(ChatHistory.UserId)
            ).map(row => ({ userId: row.userId, count: Number(row.count) }));
            queryCountMs = Date.now() - queryCountStart;
        }

        const queryCountsMap = new Map(queryCountsData.map(q => [q.userId, q.count]));

        // Fill in missing dates for trends (to show continuous line chart)
        const fillTrendDates = (data: { date: string; count: number }[]): TrendDataPoint[] => {
            const result: TrendDataPoint[] = [];
            const dataMap = new Map(data.map(d => [d.date, Number(d.count)]));

            for (let i = 29; i >= 0; i--) {
                const date = new Date();
                date.setDate(date.getDate() - i);
                const dateStr = date.toISOString().split("T")[0]!;
                result.push({
                    date: dateStr,
                    count: dataMap.get(dateStr) ?? 0,
                });
            }
            return result;
        };

        // Calculate cumulative employee count trend
        const calculateCumulativeEmployeeTrend = (): TrendDataPoint[] => {
            const result: TrendDataPoint[] = [];
            const dailyJoins = new Map(employeeTrendData.map(d => [d.date, Number(d.count)]));

            // Count employees before 30 days ago
            const employeesBeforePeriod = employeesData.filter(
                e => new Date(e.createdAt) < thirtyDaysAgo
            ).length;

            let cumulative = employeesBeforePeriod;

            for (let i = 29; i >= 0; i--) {
                const date = new Date();
                date.setDate(date.getDate() - i);
                const dateStr = date.toISOString().split("T")[0]!;
                cumulative += dailyJoins.get(dateStr) ?? 0;
                result.push({
                    date: dateStr,
                    count: cumulative,
                });
            }
            return result;
        };

        // Format employee data
        const employees: EmployeeInfo[] = employeesData.map(emp => ({
            id: Number(emp.id),
            name: emp.name,
            email: emp.email,
            role: normalizeRoleSlug(emp.role),
            status: emp.status,
            lastActiveAt: emp.lastActiveAt?.toISOString() ?? null,
            createdAt: emp.createdAt.toISOString(),
            queryCount: queryCountsMap.get(emp.userId) ?? 0,
        }));

        // Format document stats
        const documentStats: DocumentStat[] = documentStatsData.map(doc => ({
            id: Number(doc.id),
            title: doc.title,
            category: doc.category,
            views: Number(doc.views),
            lastViewedAt: doc.lastViewedAt?.toISOString() ?? null,
            createdAt: doc.createdAt.toISOString(),
        }));

        const response: AnalysisDashboardResponse = {
            success: true,
            data: {
                totalEmployees: employeesData.length,
                totalDocuments: documentCount?.count ?? 0,
                employees,
                employeeTrend: calculateCumulativeEmployeeTrend(),
                documentViewsTrend: fillTrendDates(
                    documentViewsTrendData.map(d => ({
                        date: d.date,
                        count: Number(d.count),
                    }))
                ),
                documentStats,
            },
        };

        return NextResponse.json(response, { status: 200 });
    } catch (error: unknown) {
        outcome = "error";
        console.error("Error fetching analysis dashboard data:", error);
        return NextResponse.json(
            { success: false, error: "Unable to fetch analysis dashboard data" },
            { status: 500 }
        );
    } finally {
        if (shouldLogPerf) {
            const totalMs = Date.now() - requestStart;
            const aggregateSegment = aggregateMs == null ? "n/a" : `${aggregateMs}ms`;
            const queryCountSegment = queryCountMs == null ? "n/a" : `${queryCountMs}ms`;
            console.info(
                `[perf] analysis-dashboard total=${totalMs}ms aggregate=${aggregateSegment} queryCounts=${queryCountSegment} outcome=${outcome}`
            );
        }
    }
}
