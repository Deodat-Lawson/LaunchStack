import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "~/server/db/index";
import { users, document, documentViews } from "~/server/db/schema";
import { eq, and, sql, gte, desc, count } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";

interface Viewer {
    name: string;
    email: string;
    viewedAt: string;
    role: string;
}

interface TrendDataPoint {
    date: string;
    count: number;
}

interface DocumentDetailsResponse {
    success: boolean;
    data?: {
        id: number;
        title: string;
        category: string;
        createdAt: string;
        totalViews: number;
        uniqueViewers: number;
        recentViewers: Viewer[];
        viewsTrend: TrendDataPoint[];
    };
    error?: string;
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ documentId: string }> }
) {
    try {
        const { userId } = await auth();
        const documentId = (await params).documentId;

        if (!userId) {
            return NextResponse.json(
                { success: false, error: "Unauthorized" },
                { status: 401 }
            );
        }

        const [userInfo] = await db
            .select()
            .from(users)
            .where(eq(users.userId, userId));

        if (!userInfo || (userInfo.role !== "employer" && userInfo.role !== "owner")) {
            return NextResponse.json(
                { success: false, error: "Unauthorized" },
                { status: 403 }
            );
        }

        const docId = parseInt(documentId);
        if (isNaN(docId)) {
            return NextResponse.json(
                { success: false, error: "Invalid document ID" },
                { status: 400 }
            );
        }

        // Verify document belongs to company
        const [doc] = await db
            .select()
            .from(document)
            .where(and(
                eq(document.id, docId),
                eq(document.companyId, userInfo.companyId)
            ));

        if (!doc) {
            return NextResponse.json(
                { success: false, error: "Document not found" },
                { status: 404 }
            );
        }

        // Get total views
        const [viewsCount] = await db
            .select({ count: count() })
            .from(documentViews)
            .where(eq(documentViews.documentId, BigInt(docId)));

        // Get unique viewers
        const [uniqueViewers] = await db
            .select({ count: count(sql`DISTINCT ${documentViews.userId}`) })
            .from(documentViews)
            .where(eq(documentViews.documentId, BigInt(docId)));

        // Get recent viewers
        const recentViewersData = await db
            .select({
                name: users.name,
                email: users.email,
                viewedAt: documentViews.viewedAt,
                role: users.role,
            })
            .from(documentViews)
            .leftJoin(users, eq(documentViews.userId, users.userId))
            .where(eq(documentViews.documentId, BigInt(docId)))
            .orderBy(desc(documentViews.viewedAt))
            .limit(10);

        // Get 30-day trend
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const trendData = await db
            .select({
                date: sql<string>`DATE(${documentViews.viewedAt})`.as("date"),
                count: count(),
            })
            .from(documentViews)
            .where(
                and(
                    eq(documentViews.documentId, BigInt(docId)),
                    gte(documentViews.viewedAt, thirtyDaysAgo)
                )
            )
            .groupBy(sql`DATE(${documentViews.viewedAt})`)
            .orderBy(sql`DATE(${documentViews.viewedAt})`);

        // Fill trend dates
        const fillTrendDates = (data: { date: string; count: number }[]): TrendDataPoint[] => {
            const result: TrendDataPoint[] = [];
            const dataMap = new Map(data.map(d => [d.date, Number(d.count)]));
            
            for (let i = 29; i >= 0; i--) {
                const date = new Date();
                date.setDate(date.getDate() - i);
                const dateStr = date.toISOString().split('T')[0]!;
                result.push({
                    date: dateStr,
                    count: dataMap.get(dateStr) ?? 0,
                });
            }
            return result;
        };

        const response: DocumentDetailsResponse = {
            success: true,
            data: {
                id: doc.id,
                title: doc.title,
                category: doc.category,
                createdAt: doc.createdAt.toISOString(),
                totalViews: viewsCount?.count ?? 0,
                uniqueViewers: uniqueViewers?.count ?? 0,
                recentViewers: recentViewersData.map(v => ({
                    name: v.name ?? "Unknown User",
                    email: v.email ?? "No Email",
                    viewedAt: v.viewedAt.toISOString(),
                    role: v.role ?? "unknown",
                })),
                viewsTrend: fillTrendDates(trendData.map(d => ({
                    date: d.date,
                    count: Number(d.count)
                }))),
            },
        };

        return NextResponse.json(response);

    } catch (error) {
        console.error("Error fetching document details:", error);
        return NextResponse.json(
            { success: false, error: "Internal Server Error" },
            { status: 500 }
        );
    }
}
