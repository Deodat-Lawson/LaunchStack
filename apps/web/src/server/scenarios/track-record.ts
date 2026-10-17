/**
 * The tested posts behind Brand's track record: each post test linked to a
 * Brand post, with the run's simulated engagement and the post's real
 * numbers. Joined here, in the app, because it spans two verticals
 * (scenarios and marketing) that don't import each other.
 */
import { and, desc, eq, sql } from "drizzle-orm";

import type { LinkedPostTest } from "@launchstack/pipelines/scenarios";

import { db } from "~/server/db";
import { brandPosts, scenarioPostLinks, scenarioRuns } from "~/server/db/schema";

export async function listLinkedPostTests(companyId: bigint): Promise<LinkedPostTest[]> {
    const rows = await db
        .select({
            runId: scenarioPostLinks.runId,
            brandPostId: scenarioPostLinks.brandPostId,
            platform: brandPosts.platform,
            status: brandPosts.status,
            body: brandPosts.body,
            publishedAt: brandPosts.publishedAt,
            metrics: brandPosts.metrics,
            predicted: sql<string | null>`${scenarioRuns.reception} ->> 'engagementRate'`,
        })
        .from(scenarioPostLinks)
        .innerJoin(
            scenarioRuns,
            and(eq(scenarioRuns.id, scenarioPostLinks.runId), eq(scenarioRuns.companyId, companyId))
        )
        .innerJoin(
            brandPosts,
            and(
                eq(brandPosts.id, scenarioPostLinks.brandPostId),
                eq(brandPosts.companyId, companyId)
            )
        )
        .where(and(eq(scenarioPostLinks.companyId, companyId), eq(scenarioRuns.status, "done")))
        .orderBy(desc(brandPosts.publishedAt));
    return rows.map(r => ({
        ...r,
        publishedAt: r.publishedAt ?? null,
        metrics: r.metrics ?? null,
        predicted: r.predicted === null ? null : Number(r.predicted),
    }));
}
