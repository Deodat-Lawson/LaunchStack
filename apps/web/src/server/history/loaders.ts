/**
 * One loader per kind of history.
 *
 * A loader's whole job is to turn its own vertical's rows into `HistoryEntry`
 * — the sidebar knows nothing about `trend_search_jobs` or `distribution_runs`
 * and must not have to. Adding a vertical to the feed is adding a loader here
 * and a kind to `~/lib/workspace-history`; no UI change.
 *
 * Two rules every loader follows:
 *
 * 1. **Scope by company.** These rows are workspace work, visible to the
 *    workspace — unlike chat sessions, which are personal and live in
 *    `~/server/sessions`. The `where` clause is not optional.
 * 2. **Ask for a bounded window.** Each loader takes its own `limit` and the
 *    merge trims afterwards; a workspace with 50k email campaigns must not
 *    pull 50k rows to render twenty.
 *
 * `href` is left undefined for verticals that have no surface to open yet
 * (trend search, prospector, weekly review are API-only today). Those rows
 * still appear — a run that happened is history whether or not there is a
 * page for it — they just do not pretend to be links.
 */

import { desc, eq } from "drizzle-orm";

import type { HistoryEntry, HistoryStatus } from "~/lib/workspace-history";
import { db } from "~/server/db";
import {
    clientProspectorJobs,
    distributionPrograms,
    distributionRuns,
    emailCampaigns,
    founderWeeklyReviewRuns,
    repoExplainerJobs,
    repoWorkspaces,
    trendSearchJobs,
} from "~/server/db/schema";

export interface HistoryLoaderContext {
    companyId: bigint;
    /** Auth subject id. Only the chat loader narrows by it; runs are workspace-wide. */
    userId: string;
    /** Per-loader row cap, before the merge trims to the request's limit. */
    limit: number;
}

export interface HistoryLoader {
    kind: HistoryEntry["kind"];
    load(ctx: HistoryLoaderContext): Promise<HistoryEntry[]>;
}

/**
 * Every vertical spells its pipeline differently — `completed`, `published`,
 * `sent`, `scoring`, `enriching`. The sidebar only distinguishes the four
 * states a reader acts on, so each loader hands its own vocabulary to this.
 */
export function normalizeStatus(
    status: string,
    spec: { done: readonly string[]; failed?: readonly string[]; queued?: readonly string[] }
): HistoryStatus {
    if (spec.done.includes(status)) return "done";
    if ((spec.failed ?? ["failed"]).includes(status)) return "failed";
    if ((spec.queued ?? ["queued"]).includes(status)) return "queued";
    return "running";
}

/** Newest meaningful moment: when it finished, else when it last moved. */
function activityAt(...candidates: (Date | string | null | undefined)[]): string {
    for (const candidate of candidates) {
        if (candidate)
            return candidate instanceof Date
                ? candidate.toISOString()
                : new Date(candidate).toISOString();
    }
    return new Date(0).toISOString();
}

/** Collapse a free-text prompt onto one line so it fits a sidebar subtitle. */
function oneLine(value: string | null | undefined, max = 120): string | undefined {
    const flat = value?.replace(/\s+/g, " ").trim();
    if (!flat) return undefined;
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

const trendSearchLoader: HistoryLoader = {
    kind: "trend-search",
    async load({ companyId, limit }) {
        const rows = await db
            .select({
                id: trendSearchJobs.id,
                status: trendSearchJobs.status,
                query: trendSearchJobs.query,
                createdAt: trendSearchJobs.createdAt,
                completedAt: trendSearchJobs.completedAt,
                updatedAt: trendSearchJobs.updatedAt,
            })
            .from(trendSearchJobs)
            .where(eq(trendSearchJobs.companyId, companyId))
            .orderBy(desc(trendSearchJobs.createdAt))
            .limit(limit);

        return rows.map(row => ({
            id: `trend-search:${row.id}`,
            kind: "trend-search" as const,
            refId: row.id,
            title: oneLine(row.query) ?? "Trend search",
            subtitle: "Trend search",
            status: normalizeStatus(row.status, { done: ["completed"] }),
            at: activityAt(row.completedAt, row.updatedAt, row.createdAt),
        }));
    },
};

const prospectorLoader: HistoryLoader = {
    kind: "prospector",
    async load({ companyId, limit }) {
        const rows = await db
            .select({
                id: clientProspectorJobs.id,
                status: clientProspectorJobs.status,
                query: clientProspectorJobs.query,
                createdAt: clientProspectorJobs.createdAt,
                completedAt: clientProspectorJobs.completedAt,
                updatedAt: clientProspectorJobs.updatedAt,
            })
            .from(clientProspectorJobs)
            .where(eq(clientProspectorJobs.companyId, companyId))
            .orderBy(desc(clientProspectorJobs.createdAt))
            .limit(limit);

        return rows.map(row => ({
            id: `prospector:${row.id}`,
            kind: "prospector" as const,
            refId: row.id,
            title: oneLine(row.query) ?? "Prospect search",
            subtitle: "Client prospector",
            status: normalizeStatus(row.status, { done: ["completed"] }),
            at: activityAt(row.completedAt, row.updatedAt, row.createdAt),
        }));
    },
};

const repoExplainerLoader: HistoryLoader = {
    kind: "repo-explainer",
    async load({ companyId, limit }) {
        const rows = await db
            .select({
                id: repoExplainerJobs.id,
                status: repoExplainerJobs.status,
                diagramType: repoExplainerJobs.diagramType,
                instructions: repoExplainerJobs.instructions,
                owner: repoWorkspaces.owner,
                repo: repoWorkspaces.repo,
                createdAt: repoExplainerJobs.createdAt,
                completedAt: repoExplainerJobs.completedAt,
                updatedAt: repoExplainerJobs.updatedAt,
            })
            .from(repoExplainerJobs)
            .leftJoin(repoWorkspaces, eq(repoExplainerJobs.workspaceId, repoWorkspaces.id))
            .where(eq(repoExplainerJobs.companyId, companyId))
            .orderBy(desc(repoExplainerJobs.createdAt))
            .limit(limit);

        return rows.map(row => {
            const repo = row.owner && row.repo ? `${row.owner}/${row.repo}` : "Repository";
            return {
                id: `repo-explainer:${row.id}`,
                kind: "repo-explainer" as const,
                refId: row.id,
                title: `${repo} — ${row.diagramType}`,
                subtitle: oneLine(row.instructions) ?? "Repo explainer",
                status: normalizeStatus(row.status, { done: ["completed"] }),
                at: activityAt(row.completedAt, row.updatedAt, row.createdAt),
                href: "/employer/tools/repo-explainer",
            };
        });
    },
};

const distributionLoader: HistoryLoader = {
    kind: "distribution",
    async load({ companyId, limit }) {
        const rows = await db
            .select({
                id: distributionRuns.id,
                status: distributionRuns.status,
                programName: distributionPrograms.name,
                createdAt: distributionRuns.createdAt,
                completedAt: distributionRuns.completedAt,
                updatedAt: distributionRuns.updatedAt,
            })
            .from(distributionRuns)
            .leftJoin(distributionPrograms, eq(distributionRuns.programId, distributionPrograms.id))
            .where(eq(distributionRuns.companyId, companyId))
            .orderBy(desc(distributionRuns.createdAt))
            .limit(limit);

        return rows.map(row => ({
            id: `distribution:${row.id}`,
            kind: "distribution" as const,
            refId: row.id,
            title: row.programName ?? "Distribution run",
            subtitle: "Partner discovery",
            status: normalizeStatus(row.status, { done: ["completed"] }),
            at: activityAt(row.completedAt, row.updatedAt, row.createdAt),
            href: "/employer/tools/distribution",
        }));
    },
};

const emailLoader: HistoryLoader = {
    kind: "email",
    async load({ companyId, limit }) {
        const rows = await db
            .select({
                id: emailCampaigns.id,
                name: emailCampaigns.name,
                goal: emailCampaigns.goal,
                status: emailCampaigns.status,
                createdAt: emailCampaigns.createdAt,
                updatedAt: emailCampaigns.updatedAt,
            })
            .from(emailCampaigns)
            .where(eq(emailCampaigns.companyId, companyId))
            .orderBy(desc(emailCampaigns.createdAt))
            .limit(limit);

        return rows.map(row => ({
            id: `email:${row.id}`,
            kind: "email" as const,
            refId: String(row.id),
            title: row.name,
            subtitle: oneLine(row.goal) ?? "Email campaign",
            status: normalizeStatus(row.status, {
                done: ["sent"],
                // A campaign waiting on a human is not "running" — nothing is
                // happening to it until someone approves.
                queued: ["draft", "needs_revision", "pending_approval", "approved"],
            }),
            at: activityAt(row.updatedAt, row.createdAt),
            href: "/employer/tools/email-pipeline",
        }));
    },
};

const weeklyReviewLoader: HistoryLoader = {
    kind: "weekly-review",
    async load({ companyId, limit }) {
        const rows = await db
            .select({
                id: founderWeeklyReviewRuns.id,
                status: founderWeeklyReviewRuns.status,
                periodStart: founderWeeklyReviewRuns.reportingPeriodStart,
                periodEnd: founderWeeklyReviewRuns.reportingPeriodEnd,
                createdAt: founderWeeklyReviewRuns.createdAt,
                generatedAt: founderWeeklyReviewRuns.generatedAt,
                publishedAt: founderWeeklyReviewRuns.publishedAt,
                updatedAt: founderWeeklyReviewRuns.updatedAt,
            })
            .from(founderWeeklyReviewRuns)
            .where(eq(founderWeeklyReviewRuns.companyId, companyId))
            .orderBy(desc(founderWeeklyReviewRuns.createdAt))
            .limit(limit);

        return rows.map(row => ({
            id: `weekly-review:${row.id}`,
            kind: "weekly-review" as const,
            refId: row.id,
            title: `Week of ${row.periodStart}`,
            subtitle: `${row.periodStart} → ${row.periodEnd}`,
            // A generated-but-unpublished review is finished work someone can
            // read, so `draft` counts as done here.
            status: normalizeStatus(row.status, { done: ["published", "draft"] }),
            at: activityAt(row.publishedAt, row.generatedAt, row.updatedAt, row.createdAt),
        }));
    },
};

/** Every non-chat loader. Chat lives in `~/server/sessions` and joins at merge time. */
export const PIPELINE_LOADERS: readonly HistoryLoader[] = [
    trendSearchLoader,
    prospectorLoader,
    repoExplainerLoader,
    distributionLoader,
    emailLoader,
    weeklyReviewLoader,
];
